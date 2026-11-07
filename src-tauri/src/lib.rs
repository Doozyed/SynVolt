mod synapse_output;
mod launcher_window;
mod installer_cleanup;
mod library;
mod rscripts;
mod vscode_bridge;
mod explorer_bridge;
mod dma_bridge;
mod console_bridge;

/// Handles the narrowly scoped elevated helper before the desktop app starts.
pub fn run_launcher_window_helper() -> Option<i32> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).map(|arg| arg == "--synvolt-window-helper") != Some(true) { return None; }
    if args.len() != 3 { return Some(2); }
    let state = launcher_window::LauncherWindows::default();
    let success = if args[2] == "hide" {
        launcher_window::helper_hide(&state)
    } else if args[2] == "show" {
        launcher_window::helper_show(&state)
    } else { false };
    Some(if success { 0 } else { 1 })
}

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::windows::process::CommandExt;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Listener, Manager, State};
use vscode_bridge::VsCodeBridge;
use explorer_bridge::ExplorerBridge;
use dma_bridge::DmaBridge;
use console_bridge::{ConsoleBridge, CONSOLE_PORT};

#[cfg(target_os = "windows")]
fn disable_webview_shortcuts(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        let core = webview.controller().CoreWebView2().unwrap();
        let settings = core.Settings().unwrap();
        settings.SetAreDevToolsEnabled(false.into()).unwrap();
        settings.SetAreDefaultContextMenusEnabled(false.into()).unwrap();
        settings.SetIsStatusBarEnabled(false.into()).unwrap();
    });
}

const APP_VERSION: &str = "1.0.0";
const VERSION_URL: &str = "https://hosting-sepia-nine.vercel.app/version";

#[derive(Deserialize)]
struct VersionInfo {
    version: String,
    download_url: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LicenseAuthResponse {
    token: String,
    license_key: String,
    display_name: String,
    expires_at: Option<String>,
}

struct LspProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

struct LspState {
    process: Mutex<Option<LspProcess>>,
}

struct VsCodeState {
    bridge: VsCodeBridge,
}

struct ExplorerState {
    bridge: ExplorerBridge,
}

struct DmaState {
    bridge: DmaBridge,
}

struct ConsoleState {
    bridge: ConsoleBridge,
}

fn get_synapse_settings_path() -> Result<std::path::PathBuf, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA environment variable".to_string())?;
    Ok(std::path::Path::new(&local_app_data)
        .join("Synapse Z")
        .join("bin")
        .join("settings.syn"))
}

#[tauri::command]
fn load_client_settings_syn() -> Result<serde_json::Value, String> {
    let path = get_synapse_settings_path()?;

    if !path.exists() {
        return Ok(serde_json::json!({}));
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read settings.syn: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse settings.syn: {}", e))
}

#[tauri::command]
fn is_synapse_installed() -> Result<bool, String> {
    let settings = get_synapse_settings_path()?;
    let bin = settings.parent().ok_or("Invalid Synapse Z path")?;
    Ok(settings.is_file() && bin.join("scheduler").is_dir())
}

#[tauri::command]
async fn save_synz_installer(app: AppHandle) -> Result<String, String> {
    let resource = app.path().resource_dir().map_err(|e| e.to_string())?
        .join("synz").join("SynInstallerV2.exe");
    let source = if resource.is_file() {
        resource
    } else {
        #[cfg(debug_assertions)]
        { std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("SynInstallerV2.exe") }
        #[cfg(not(debug_assertions))]
        { return Err("The bundled SynZ installer could not be found.".into()); }
    };
    let downloads = app.path().download_dir().map_err(|_| "Could not find the Downloads folder.")?;
    tauri::async_runtime::spawn_blocking(move || copy_synz_installer(&source, &downloads))
        .await.map_err(|error| format!("Could not save the installer: {error}"))?
        .map(|path| path.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallerLaunchResult {
    path: String,
    launched: bool,
    cancelled: bool,
}

fn request_installer_elevation(path: &std::path::Path, owner: isize) -> Result<Option<isize>, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{GetLastError, HWND};
    use windows_sys::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SHELLEXECUTEINFOW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let executable: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let verb = if cfg!(synvolt_standard) { "open" } else { "runas" };
    let verb: Vec<u16> = verb.encode_utf16().chain(Some(0)).collect();
    let directory: Vec<u16> = path.parent().ok_or("Invalid installer location")?.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        let com_initialized = CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32) >= 0;
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOASYNC | SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_NO_UI;
        info.hwnd = owner as HWND;
        info.lpVerb = verb.as_ptr();
        info.lpFile = executable.as_ptr();
        info.lpDirectory = directory.as_ptr();
        info.nShow = SW_SHOWNORMAL;
        if ShellExecuteExW(&mut info) == 0 {
            let error = GetLastError();
            if com_initialized { CoUninitialize(); }
            return classify_installer_launch_error(error).map(|_| None);
        }
        let process = info.hProcess as isize;
        if com_initialized { CoUninitialize(); }
        return Ok(Some(process));
    }
}

fn classify_installer_launch_error(error: u32) -> Result<bool, String> {
    if error == windows_sys::Win32::Foundation::ERROR_CANCELLED { return Ok(false); }
    Err(format!("The installer was saved in Downloads, but Windows could not open it: {}", std::io::Error::from_raw_os_error(error as i32)))
}

#[tauri::command]
async fn run_synz_installer(app: AppHandle) -> Result<InstallerLaunchResult, String> {
    use std::sync::atomic::Ordering;
    let state = app.state::<launcher_window::LauncherWindows>();
    if state.installing.swap(true, Ordering::AcqRel) { return Err("A SynZ installation is already in progress.".into()); }
    let owner = app.get_webview_window("main").and_then(|window| window.hwnd().ok()).map(|hwnd| hwnd.0 as isize).unwrap_or(0);
    let path = match save_synz_installer(app.clone()).await { Ok(path) => path, Err(error) => { state.installing.store(false, Ordering::Release); return Err(error); } };
    let installer = std::path::PathBuf::from(&path);
    let app_for_install = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let state = app_for_install.state::<launcher_window::LauncherWindows>();
        let previous = launcher_window::stop_launchers(&state)?;
        match request_installer_elevation(&installer, owner) {
            Ok(Some(handle)) => {
                let app = app_for_install.clone();
                std::thread::spawn(move || finish_synz_install(app, installer, handle, previous));
                Ok(true)
            }
            Ok(None) => { let _ = launcher_window::restart_previous(&previous); Ok(false) }
            Err(error) => { let _ = launcher_window::restart_previous(&previous); Err(error) }
        }
    }).await.map_err(|error| format!("The installer could not be opened: {error}"));
    match outcome {
        Ok(Ok(true)) => Ok(InstallerLaunchResult { path, launched: true, cancelled: false }),
        Ok(Ok(false)) => { state.installing.store(false, Ordering::Release); Ok(InstallerLaunchResult { path, launched: false, cancelled: true }) },
        Ok(Err(error)) | Err(error) => { state.installing.store(false, Ordering::Release); Err(error) }
    }
}

fn finish_synz_install(app: AppHandle, installer: std::path::PathBuf, handle: isize, previous: Vec<launcher_window::PreviousLauncher>) {
    use std::sync::atomic::Ordering;
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    let success = if handle == 0 { false } else { unsafe {
        let process = handle as windows_sys::Win32::Foundation::HANDLE;
        let waited = WaitForSingleObject(process, INFINITE) == WAIT_OBJECT_0;
        let mut code = 1;
        let ok = waited && GetExitCodeProcess(process, &mut code) != 0 && code == 0;
        CloseHandle(process);
        ok
    }};
    let state = app.state::<launcher_window::LauncherWindows>();
    let message = if success && is_synapse_installed().unwrap_or(false) {
        match launcher_window::restart_updated(&state, &installer, &previous) {
            Ok(()) => {
                let mut dirs = Vec::new();
                if let Ok(path) = app.path().download_dir() { dirs.push(path); }
                if let Ok(path) = app.path().desktop_dir() { dirs.push(path); }
                let mut protected = launcher_window::running_launcher_paths();
                protected.push(installer.clone());
                let count = installer_cleanup::recycle_duplicates(&installer, &dirs, &protected);
                format!("SynZ installation finished. Removed {count} duplicate installer(s).")
            }
            Err(error) => format!("SynZ installation finished, but the launcher could not restart: {error}"),
        }
    } else {
        let _ = launcher_window::restart_previous(&previous);
        "SynZ installation was not confirmed; existing installers were kept.".to_string()
    };
    state.installing.store(false, Ordering::Release);
    let _ = app.emit("synz-reinstall-finished", message);
}

fn copy_synz_installer(source: &std::path::Path, downloads: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let mut input = std::fs::File::open(source).map_err(|_| "The bundled SynZ installer could not be found.")?;
    for index in 0..10000 {
        let name = if index == 0 { "SynInstallerV2.exe".to_string() } else { format!("SynInstallerV2 ({index}).exe") };
        let target = downloads.join(name);
        let mut output = match std::fs::OpenOptions::new().write(true).create_new(true).open(&target) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not save the installer: {error}")),
        };
        if let Err(error) = std::io::copy(&mut input, &mut output) {
            drop(output);
            let _ = std::fs::remove_file(&target);
            return Err(format!("Could not save the installer: {error}"));
        }
        return Ok(target);
    }
    Err("Could not find an available filename in Downloads.".into())
}

#[cfg(test)]
mod installer_copy_tests {
    use super::{classify_installer_launch_error, copy_synz_installer};

    #[test]
    fn saves_copy_without_overwriting_existing_installer() {
        let dir = std::env::temp_dir().join(format!("synvolt-copy-test-{}-{}", std::process::id(), rand::random::<u32>()));
        std::fs::create_dir(&dir).unwrap();
        let source = dir.join("source.bin");
        let existing = dir.join("SynInstallerV2.exe");
        std::fs::write(&source, b"new installer").unwrap();
        std::fs::write(&existing, b"existing file").unwrap();
        let saved = copy_synz_installer(&source, &dir).unwrap();
        assert_eq!(saved.file_name().unwrap(), "SynInstallerV2 (1).exe");
        assert_eq!(std::fs::read(&existing).unwrap(), b"existing file");
        assert_eq!(std::fs::read(&saved).unwrap(), b"new installer");
        std::fs::remove_file(source).unwrap();
        std::fs::remove_file(existing).unwrap();
        std::fs::remove_file(saved).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn cancelling_elevation_is_not_reported_as_a_launch() {
        assert_eq!(classify_installer_launch_error(windows_sys::Win32::Foundation::ERROR_CANCELLED).unwrap(), false);
        assert!(classify_installer_launch_error(windows_sys::Win32::Foundation::ERROR_FILE_NOT_FOUND).is_err());
    }
}

#[tauri::command]
fn update_client_setting_syn(key: String, value: serde_json::Value) -> Result<serde_json::Value, String> {
    let path = get_synapse_settings_path()?;
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read Synapse Z settings: {}", e))?;
    let mut settings: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Could not parse Synapse Z settings: {}", e))?;
    let entries = settings.as_object_mut().ok_or("Invalid Synapse Z settings format")?;
    if !entries.contains_key(&key) {
        return Err("This setting is no longer available in Synapse Z".into());
    }
    entries.insert(key, value);
    let contents = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    let temporary = path.with_extension(format!("synvolt-{}.tmp", rand::random::<u64>()));
    let result = std::fs::write(&temporary, contents)
        .and_then(|_| std::fs::rename(&temporary, &path))
        .map_err(|e| format!("Could not save Synapse Z settings: {}", e));
    if result.is_err() { let _ = std::fs::remove_file(&temporary); }
    result?;
    Ok(settings)
}

#[tauri::command]
fn save_client_settings_syn(settings: serde_json::Value) -> Result<bool, String> {
    let path = get_synapse_settings_path()?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings folder: {}", e))?;
    }

    let serialized = serde_json::to_string(&settings)
        .map_err(|e| format!("Failed to serialize settings.syn: {}", e))?;

    std::fs::write(&path, serialized)
        .map_err(|e| format!("Failed to write settings.syn: {}", e))?;

    Ok(true)
}

fn get_console_wrapper(script: &str) -> String {
    let mut delimiter_level = 1;
    let mut closing = "]".to_string();
    while script.contains(&closing) {
        delimiter_level += 1;
        closing = format!("]{}]", "=".repeat(delimiter_level));
    }

    let equals = "=".repeat(delimiter_level);
    let open = format!("[{}[", equals);
    let close = format!("]{}]", equals);

    format!(
        r#"local __synz_console_port = {port}
local __synz_http_service = game:GetService("HttpService")
local __synz_console_socket = nil
local __synz_username = nil
pcall(function()
    local player = game:GetService("Players").LocalPlayer
    if player then __synz_username = player.Name end
end)

pcall(function()
    __synz_console_socket = WebSocket.connect("ws://127.0.0.1:" .. tostring(__synz_console_port))
end)

local function __synz_console_send(level, ...)
    if not __synz_console_socket then
        return
    end

    local packed = table.pack(...)
    pcall(function()
        local parts = table.create(packed.n)
        for index = 1, packed.n do
            parts[index] = tostring(packed[index])
        end
        local payload = __synz_http_service:JSONEncode({{ level = level, message = table.concat(parts, "\t"), username = __synz_username }})
        __synz_console_socket:Send(payload)
    end)
end

__synz_console_send("identity")

-- Roblox reports errors from spawned tasks and event callbacks through
-- MessageOut, outside the synchronous xpcall below.
pcall(function()
    local environment = type(getgenv) == "function" and getgenv() or _G
    if environment.__synvolt_error_connection then
        environment.__synvolt_error_connection:Disconnect()
    end
    environment.__synvolt_error_connection = game:GetService("LogService").MessageOut:Connect(function(message, messageType)
        if messageType == Enum.MessageType.MessageError then
            __synz_console_send("error", message)
        end
    end)
end)

local __synz_original_print = print
local __synz_original_warn = warn

print = function(...)
    __synz_console_send("info", ...)
    return __synz_original_print(...)
end

warn = function(...)
    __synz_console_send("warning", ...)
    return __synz_original_warn(...)
end

local function __synz_console_run()
    local __synz_fn, __synz_err = loadstring({open}{script}{close}, "synz-ui-console")
    if not __synz_fn then
        error(__synz_err, 0)
    end
    if type(setfenv) == "function" and type(getfenv) == "function" then
        setfenv(__synz_fn, getfenv())
    end
    return __synz_fn()
end

local __synz_ok, __synz_err = xpcall(__synz_console_run, function(err)
    local trace = tostring(err)
    if debug and debug.traceback then
        local ok, result = pcall(debug.traceback, trace, 2)
        if ok then trace = result end
    end
    __synz_console_send("error", trace)
    return trace
end)

if not __synz_ok then
    error(__synz_err, 0)
end"#,
        port = CONSOLE_PORT,
        open = open,
        script = script,
        close = close,
    )
}

fn get_sidecar_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let resource_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let binary_name = "binaries/luau-lsp-x86_64-pc-windows-msvc.exe";
    let path = resource_path.join(binary_name);

    if !path.exists() {
        let dev_path = std::env::current_dir()
            .map_err(|e| format!("Failed to get current dir: {}", e))?
            .join("src-tauri")
            .join(binary_name);

        if dev_path.exists() {
            return Ok(dev_path);
        }

        return Err(format!("LSP binary not found at {:?} or {:?}", path, dev_path));
    }

    Ok(path)
}

#[tauri::command]
async fn start_lsp(app: AppHandle, state: State<'_, LspState>) -> Result<bool, String> {
    let mut process_guard = state.process.lock().map_err(|e| e.to_string())?;

    if process_guard.is_some() {
        return Ok(true);
    }

    let lsp_path = get_sidecar_path(&app)?;

    let mut child = Command::new(&lsp_path)
        .arg("lsp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn LSP: {}", e))?;

    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;

    *process_guard = Some(LspProcess {
        child,
        stdin,
        stdout: BufReader::new(stdout),
    });

    Ok(true)
}

#[tauri::command]
async fn stop_lsp(state: State<'_, LspState>) -> Result<bool, String> {
    let mut process_guard = state.process.lock().map_err(|e| e.to_string())?;

    if let Some(mut lsp) = process_guard.take() {
        let _ = lsp.child.kill();
    }

    Ok(true)
}

#[tauri::command]
async fn send_lsp_message(state: State<'_, LspState>, message: String) -> Result<String, String> {
    let mut process_guard = state.process.lock().map_err(|e| e.to_string())?;

    let lsp = process_guard
        .as_mut()
        .ok_or("LSP not started")?;

    let content_length = message.len();
    let header = format!("Content-Length: {}\r\n\r\n", content_length);

    lsp.stdin
        .write_all(header.as_bytes())
        .map_err(|e| format!("Failed to write header: {}", e))?;
    lsp.stdin
        .write_all(message.as_bytes())
        .map_err(|e| format!("Failed to write message: {}", e))?;
    lsp.stdin
        .flush()
        .map_err(|e| format!("Failed to flush: {}", e))?;

    let mut headers = HashMap::new();
    loop {
        let mut line = String::new();
        lsp.stdout
            .read_line(&mut line)
            .map_err(|e| format!("Failed to read header line: {}", e))?;

        let line = line.trim();
        if line.is_empty() {
            break;
        }

        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_lowercase(), value.trim().to_string());
        }
    }

    let content_length: usize = headers
        .get("content-length")
        .ok_or("Missing Content-Length header")?
        .parse()
        .map_err(|e| format!("Invalid Content-Length: {}", e))?;

    let mut content = vec![0u8; content_length];
    lsp.stdout
        .read_exact(&mut content)
        .map_err(|e| format!("Failed to read content: {}", e))?;

    String::from_utf8(content).map_err(|e| format!("Invalid UTF-8 response: {}", e))
}

#[tauri::command]
fn lsp_available(app: AppHandle) -> bool {
    get_sidecar_path(&app).is_ok()
}

#[tauri::command]
async fn execute_script(script: String, pids: Option<Vec<u32>>) -> Result<bool, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA environment variable")?;

    let scheduler_dir = std::path::Path::new(&local_app_data)
        .join("Synapse Z")
        .join("bin")
        .join("scheduler");

    if !scheduler_dir.exists() {
        return Err("Please install Synapse Z before running scripts.".to_string());
    }

    let content = format!("{}@@FileFullyWritten@@", script);

    let target_pids = pids.unwrap_or_else(|| vec![0]);

    for pid in target_pids {
        let random_name: String = (0..10)
            .map(|_| {
                let idx = rand::random::<usize>() % 62;
                b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[idx] as char
            })
            .collect();

        let file_name = if pid == 0 {
            format!("{}.lua", random_name)
        } else {
            format!("PID{}_{}.lua", pid, random_name)
        };

        let file_path = scheduler_dir.join(file_name);
        std::fs::write(&file_path, &content)
            .map_err(|e| format!("Failed to write script to scheduler: {}", e))?;
    }

    Ok(true)
}

#[tauri::command]
async fn execute_script_redirected(
    app: AppHandle,
    state: State<'_, ConsoleState>,
    script: String,
    pids: Option<Vec<u32>>,
) -> Result<bool, String> {
    state.bridge.start(app).await?;
    execute_script(get_console_wrapper(&script), pids).await
}

#[tauri::command]
async fn start_console_identity_probe(app: AppHandle, state: State<'_, ConsoleState>, pid: u32) -> Result<bool, String> {
    state.bridge.start(app).await?;
    let script = format!(r#"task.spawn(function()
    local ok, socket = pcall(function() return WebSocket.connect("ws://127.0.0.1:{port}") end)
    if not ok or not socket then return end
    local http = game:GetService("HttpService")
    while task.wait(3) do
        local player = game:GetService("Players").LocalPlayer
        if player then
            local sent = pcall(function()
                socket:Send(http:JSONEncode({{ level = "identity", username = player.Name, pid = {pid} }}))
            end)
            if not sent then break end
        end
    end
end)"#, port = CONSOLE_PORT, pid = pid);
    execute_script(script, Some(vec![pid])).await
}

#[tauri::command]
fn get_installed_font_families() -> Vec<String> {
    use windows_sys::Win32::Graphics::Gdi::{EnumFontFamiliesExW, GetDC, ReleaseDC, LOGFONTW, TEXTMETRICW};
    unsafe extern "system" fn collect(font: *const LOGFONTW, _: *const TEXTMETRICW, _: u32, data: isize) -> i32 {
        let name = &(*font).lfFaceName;
        let len = name.iter().position(|&c| c == 0).unwrap_or(name.len());
        let name = String::from_utf16_lossy(&name[..len]);
        if !name.is_empty() && !name.starts_with('@') { (&mut *(data as *mut Vec<String>)).push(name); }
        1
    }
    let mut names: Vec<String> = Vec::new();
    unsafe {
        let dc = GetDC(std::ptr::null_mut());
        if !dc.is_null() {
            let mut font: LOGFONTW = std::mem::zeroed();
            font.lfCharSet = 1;
            EnumFontFamiliesExW(dc, &font, Some(collect), &mut names as *mut _ as isize, 0);
            ReleaseDC(std::ptr::null_mut(), dc);
        }
    }
    names.sort_by_key(|name| name.to_lowercase());
    names.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    names
}

#[cfg(test)]
mod font_list_tests {
    #[test]
    fn windows_returns_installed_families_without_vertical_duplicates() {
        let fonts = super::get_installed_font_families();
        assert!(!fonts.is_empty());
        assert!(fonts.iter().all(|name| !name.is_empty() && !name.starts_with('@')));
        assert!(fonts.iter().any(|name| name.eq_ignore_ascii_case("Consolas")));
    }
}

#[tauri::command]
fn get_console_port() -> u16 {
    CONSOLE_PORT
}

#[tauri::command]
async fn handle_attach(_injector_path: Option<String>) -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
fn is_roblox_running() -> bool {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    sys.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_lowercase();
        name == "robloxplayerbeta.exe" || name == "windows10universal.exe"
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RobloxProcess {
    pid: u32,
    name: String,
}

#[tauri::command]
fn get_roblox_processes() -> Vec<RobloxProcess> {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    sys.processes()
        .iter()
        .filter_map(|(pid, process)| {
            let name = process.name().to_string_lossy().to_lowercase();
            if name == "robloxplayerbeta.exe" || name == "windows10universal.exe" {
                Some(RobloxProcess {
                    pid: pid.as_u32(),
                    name: format!("Roblox (PID {})", pid.as_u32()),
                })
            } else {
                None
            }
        })
        .collect()
}

#[tauri::command]
async fn reset_hwid() -> Result<String, String> {
    let account_key = read_account_key()?;
    let client = reqwest::Client::new();
    let response = client
        .post("https://z-api.synapse.do/resethwid")
        .header("key", &account_key)
        .header("USER-AGENT", "SYNZ-SERVICE")
        .send()
        .await
        .map_err(|e| format!("HWID reset request failed: {}", e))?;

    match response.status().as_u16() {
        418 => Ok("HWID reset successful".to_string()),
        429 => Err("Reset on cooldown. Try again later.".to_string()),
        403 => Err("Account is blacklisted.".to_string()),
        status => Err(format!("HWID reset failed: HTTP {}", status)),
    }
}

#[tauri::command]
async fn get_account_info() -> Result<AccountInfo, String> {
    let account_key = read_account_key()?;
    let expires_at = fetch_license_expiry(&account_key).await.ok().flatten();

    Ok(AccountInfo {
        key: account_key,
        expires_at,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountInfo {
    key: String,
    expires_at: Option<String>,
}

#[tauri::command]
fn logout_account() -> Result<bool, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;
    let account_key_path = std::path::Path::new(&local_app_data).join("auth_v2.syn");
    if account_key_path.exists() {
        std::fs::remove_file(&account_key_path)
            .map_err(|e| format!("Failed to remove account key: {}", e))?;
    }
    Ok(true)
}

fn read_account_key() -> Result<String, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;

    let account_key_path = std::path::Path::new(&local_app_data).join("auth_v2.syn");
    let key = std::fs::read_to_string(account_key_path)
        .map_err(|_| "Could not find local license account key")?;

    let trimmed = key.trim().to_string();
    if trimmed.is_empty() {
        return Err("Local license account key is empty".to_string());
    }

    Ok(trimmed)
}

async fn fetch_license_expiry(account_key: &str) -> Result<Option<String>, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://z-api.synapse.do/info")
        .header("key", account_key)
        .header("USER-AGENT", "SYNZ-SERVICE")
        .send()
        .await
        .map_err(|e| format!("License info request failed: {}", e))?;

    if response.status().as_u16() != 418 {
        return Err(format!("License info request failed: HTTP {}", response.status()));
    }

    let text = response.text()
        .await
        .map_err(|e| format!("Failed to read license info response: {}", e))?;

    let unix_seconds = text.trim().parse::<i64>()
        .map_err(|e| format!("Invalid license expiry timestamp: {}", e))?;
    let expires_at = chrono::DateTime::<chrono::Utc>::from_timestamp(unix_seconds, 0)
        .ok_or("Invalid expiry date returned by license API")?;

    Ok(Some(expires_at.to_rfc3339()))
}

#[tauri::command]
async fn redeem_license(license: String) -> Result<LicenseAuthResponse, String> {
    let trimmed_license = license.trim().to_string();
    if trimmed_license.is_empty() {
        return Err("License key is required".to_string());
    }

    let account_key = read_account_key()?;
    let client = reqwest::Client::new();
    let response = client
        .post("https://z-api.synapse.do/redeem")
        .header("key", &account_key)
        .header("USER-AGENT", "SYNZ-SERVICE")
        .header("license", &trimmed_license)
        .send()
        .await
        .map_err(|e| format!("License redemption failed: {}", e))?;

    match response.status().as_u16() {
        418 => {
            let body = response.text()
                .await
                .map_err(|e| format!("Failed to read license redemption response: {}", e))?;
            if !body.starts_with("Added") {
                return Err("Invalid license key".to_string());
            }
        }
        403 => return Err("Invalid license key".to_string()),
        status => return Err(format!("License redemption failed: HTTP {}", status)),
    }

    let expires_at = fetch_license_expiry(&account_key).await.ok().flatten();

    Ok(LicenseAuthResponse {
        token: trimmed_license.clone(),
        license_key: trimmed_license,
        display_name: "Licensed User".to_string(),
        expires_at,
    })
}

#[tauri::command]
async fn validate_license_session(_license: Option<String>) -> Result<bool, String> {
    let account_key = match read_account_key() {
        Ok(key) => key,
        Err(_) => return Ok(false),
    };

    Ok(fetch_license_expiry(&account_key).await.is_ok())
}

#[tauri::command]
fn toggle_protection(protection_type: String, enabled: bool) -> Result<bool, String> {
    if enabled {
        println!("active");
    }
    println!("[Protection] {} = {}", protection_type, enabled);
    Ok(enabled)
}

#[tauri::command]
async fn start_vscode_server(state: State<'_, VsCodeState>) -> Result<bool, String> {
    state.bridge.start().await?;
    Ok(true)
}

#[tauri::command]
async fn stop_vscode_server(state: State<'_, VsCodeState>) -> Result<bool, String> {
    state.bridge.stop().await;
    Ok(true)
}

#[tauri::command]
async fn is_vscode_server_running(state: State<'_, VsCodeState>) -> Result<bool, String> {
    Ok(state.bridge.is_running().await)
}

fn check_version_and_update() -> Result<(), String> {
    let response = reqwest::blocking::get(VERSION_URL)
        .map_err(|e| format!("Failed to fetch version: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Version check failed: HTTP {}", response.status()));
    }

    let version_info: VersionInfo = response.json()
        .map_err(|e| format!("Failed to parse version info: {}", e))?;

    if version_info.version != APP_VERSION {
        let current_exe = std::env::current_exe()
            .map_err(|e| format!("Failed to get current exe path: {}", e))?;

        let exe_dir = current_exe.parent()
            .ok_or("Failed to get exe directory")?;

        let exe_name = current_exe.file_name()
            .ok_or("Failed to get exe name")?
            .to_string_lossy();

        let new_exe_path = exe_dir.join(format!("{}.new", exe_name));
        let batch_path = exe_dir.join("_update.bat");

        let download_response = reqwest::blocking::get(&version_info.download_url)
            .map_err(|e| format!("Failed to download update: {}", e))?;

        if !download_response.status().is_success() {
            return Err(format!("Download failed: HTTP {}", download_response.status()));
        }

        let bytes = download_response.bytes()
            .map_err(|e| format!("Failed to read update: {}", e))?;

        std::fs::write(&new_exe_path, &bytes)
            .map_err(|e| format!("Failed to save update: {}", e))?;

        let batch_content = format!(
            "@echo off\r\ntimeout /t 1 /nobreak >nul\r\ndel \"{}\"\r\nmove \"{}\" \"{}\"\r\nstart \"\" \"{}\"\r\ndel \"%~f0\"\r\n",
            current_exe.display(),
            new_exe_path.display(),
            current_exe.display(),
            current_exe.display()
        );

        std::fs::write(&batch_path, &batch_content)
            .map_err(|e| format!("Failed to write update script: {}", e))?;

        Command::new("cmd")
            .args(["/C", &batch_path.to_string_lossy()])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| format!("Failed to launch update script: {}", e))?;

        std::process::exit(0);
    }

    Ok(())
}

#[tauri::command]
fn get_app_version() -> String {
    APP_VERSION.to_string()
}

#[tauri::command]
async fn install_vscode_extension() -> Result<bool, String> {
    let url = "https://raw.githubusercontent.com/orev7s/vault/main/pearl-executor-1.0.0.vsix";

    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;

    let pearl_dir = std::path::Path::new(&local_app_data).join("Synapse Z");
    if !pearl_dir.exists() {
        std::fs::create_dir_all(&pearl_dir)
            .map_err(|e| format!("Failed to create Synapse Z directory: {}", e))?;
    }

    let vsix_path = pearl_dir.join("pearl-executor.vsix");

    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to download extension: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Failed to download extension: HTTP {}", response.status()));
    }

    let bytes = response.bytes()
        .await
        .map_err(|e| format!("Failed to read extension: {}", e))?;

    std::fs::write(&vsix_path, &bytes)
        .map_err(|e| format!("Failed to save extension: {}", e))?;

    let code_path = find_vscode_cli()?;

    let output = Command::new(&code_path)
        .args(["--install-extension", &vsix_path.to_string_lossy()])
        .creation_flags(0x08000000)
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                let _ = Command::new(&code_path)
                    .creation_flags(0x08000000)
                    .spawn();
                Ok(true)
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                Err(format!("Installation failed: {}", stderr))
            }
        }
        Err(e) => {
            Err(format!("Failed to run VS Code CLI: {}", e))
        }
    }
}

fn find_vscode_cli() -> Result<String, String> {
    if let Ok(output) = Command::new("code").arg("--version").creation_flags(0x08000000).output() {
        if output.status.success() {
            return Ok("code".to_string());
        }
    }

    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let program_files = std::env::var("PROGRAMFILES").unwrap_or_default();
    let program_files_x86 = std::env::var("PROGRAMFILES(X86)").unwrap_or_default();
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();

    let possible_paths = [
        format!("{}\\Programs\\Microsoft VS Code\\bin\\code.cmd", local_app_data),
        format!("{}\\Programs\\Microsoft VS Code\\Code.exe", local_app_data),
        format!("{}\\Microsoft VS Code\\bin\\code.cmd", program_files),
        format!("{}\\Microsoft VS Code\\Code.exe", program_files),
        format!("{}\\Microsoft VS Code\\bin\\code.cmd", program_files_x86),
        format!("{}\\Microsoft VS Code\\Code.exe", program_files_x86),
        format!("{}\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd", user_profile),
        format!("{}\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe", user_profile),
    ];

    for path in &possible_paths {
        if std::path::Path::new(path).exists() {
            return Ok(path.clone());
        }
    }

    Err("VS Code is not installed. Please install VS Code first.".to_string())
}

#[tauri::command]
async fn start_explorer_server(state: State<'_, ExplorerState>) -> Result<bool, String> {
    state.bridge.start().await?;
    Ok(true)
}

#[tauri::command]
async fn stop_explorer_server(state: State<'_, ExplorerState>) -> Result<bool, String> {
    state.bridge.stop().await;
    Ok(true)
}

#[tauri::command]
async fn is_explorer_connected(state: State<'_, ExplorerState>) -> Result<bool, String> {
    Ok(state.bridge.is_connected().await)
}

#[tauri::command]
async fn get_explorer_connection_info(state: State<'_, ExplorerState>) -> Result<Option<serde_json::Value>, String> {
    Ok(state.bridge.get_connection_info().await)
}

#[tauri::command]
async fn send_explorer_message(state: State<'_, ExplorerState>, message: String) -> Result<String, String> {
    println!("[Explorer] send_message called: {}", &message[..message.len().min(100)]);

    let mut rx = state.bridge.subscribe().await
        .ok_or("Explorer not connected")?;

    state.bridge.send_message(message.clone()).await?;

    let parsed: serde_json::Value = serde_json::from_str(&message)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    let request_id = parsed.get("requestId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let timeout = tokio::time::Duration::from_secs(10);
    let start = std::time::Instant::now();

    loop {
        if start.elapsed() > timeout {
            return Err("Request timeout".to_string());
        }

        match tokio::time::timeout(tokio::time::Duration::from_millis(100), rx.recv()).await {
            Ok(Ok(response)) => {
                println!("[Explorer] Got response: {}", &response[..response.len().min(100)]);

                if let Some(ref req_id) = request_id {
                    if let Ok(resp_parsed) = serde_json::from_str::<serde_json::Value>(&response) {
                        let resp_req_id = resp_parsed.get("data")
                            .and_then(|d| d.get("requestId"))
                            .and_then(|v| v.as_str());

                        if resp_req_id == Some(req_id.as_str()) {
                            return Ok(response);
                        }
                    }
                } else {
                    return Ok(response);
                }
            }
            Ok(Err(_)) => {
                return Err("Channel closed".to_string());
            }
            Err(_) => {
                continue;
            }
        }
    }
}

#[tauri::command]
fn get_explorer_port() -> u16 {
    21574
}

#[tauri::command]
async fn get_explorer_script() -> Result<String, String> {
    let url = "https://raw.githubusercontent.com/orev7s/vault/refs/heads/main/ws-explorer.lua";

    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to fetch explorer script: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Failed to fetch explorer script: HTTP {}", response.status()));
    }

    response.text()
        .await
        .map_err(|e| format!("Failed to read explorer script: {}", e))
}

#[tauri::command]
async fn save_decompiled_script(name: String, content: String) -> Result<String, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;

    let workspace_dir = std::path::Path::new(&local_app_data)
        .join("Synapse Z")
        .join("workspace");

    if !workspace_dir.exists() {
        std::fs::create_dir_all(&workspace_dir)
            .map_err(|e| format!("Failed to create workspace directory: {}", e))?;
    }

    let safe_name = name.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let file_name = if safe_name.ends_with(".lua") || safe_name.ends_with(".luau") {
        safe_name
    } else {
        format!("{}.lua", safe_name)
    };

    let file_path = workspace_dir.join(&file_name);

    std::fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn save_all_scripts(scripts: Vec<(String, String)>) -> Result<String, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let dump_dir = std::path::Path::new(&local_app_data)
        .join("Synapse Z")
        .join("workspace")
        .join(format!("dump_{}", timestamp));

    std::fs::create_dir_all(&dump_dir)
        .map_err(|e| format!("Failed to create dump directory: {}", e))?;

    let mut saved_count = 0;
    for (path, content) in scripts {
        let safe_path = path
            .replace("game:GetService(\"", "")
            .replace("\")", "")
            .replace([':', '"', '<', '>', '|', '*', '?'], "_")
            .replace('.', "/");

        let file_path = dump_dir.join(format!("{}.lua", safe_path));

        if let Some(parent) = file_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        if std::fs::write(&file_path, &content).is_ok() {
            saved_count += 1;
        }
    }

    Ok(dump_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn open_folder_in_explorer(path: String) -> Result<bool, String> {
    Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;

    Ok(true)
}

#[tauri::command]
fn get_workspace_path() -> Result<String, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;

    let workspace_dir = std::path::Path::new(&local_app_data)
        .join("Synapse Z")
        .join("workspace");

    if !workspace_dir.exists() {
        std::fs::create_dir_all(&workspace_dir)
            .map_err(|e| format!("Failed to create workspace directory: {}", e))?;
    }

    Ok(workspace_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn get_scripts_path() -> Result<String, String> {
    Ok(get_scripts_dir_path()?.to_string_lossy().to_string())
}

fn get_scripts_dir_path() -> Result<std::path::PathBuf, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;

    let scripts_dir = std::path::Path::new(&local_app_data)
        .join("Synapse Z")
        .join("scripts");

    if !scripts_dir.exists() {
        std::fs::create_dir_all(&scripts_dir)
            .map_err(|e| format!("Failed to create scripts directory: {}", e))?;
    }

    Ok(scripts_dir)
}

fn resolve_scripts_relative_path(relative_path: &str) -> Result<std::path::PathBuf, String> {
    let relative = std::path::Path::new(relative_path);

    if relative.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return Err("Invalid scripts path".to_string());
    }

    Ok(get_scripts_dir_path()?.join(relative))
}

#[tauri::command]
fn create_scripts_folder(relative_path: String) -> Result<bool, String> {
    let folder_path = resolve_scripts_relative_path(&relative_path)?;

    if folder_path.exists() {
        return Err("Folder already exists".to_string());
    }

    std::fs::create_dir_all(&folder_path)
        .map_err(|e| format!("Failed to create folder: {}", e))?;

    Ok(true)
}

#[tauri::command]
fn move_scripts_entry(from_relative_path: String, to_relative_path: String) -> Result<bool, String> {
    let source_path = resolve_scripts_relative_path(&from_relative_path)?;
    let target_path = resolve_scripts_relative_path(&to_relative_path)?;

    if !source_path.exists() {
        return Err("Source path does not exist".to_string());
    }

    if target_path.exists() {
        return Err("Target path already exists".to_string());
    }

    if source_path.is_dir() && target_path.starts_with(&source_path) {
        return Err("Cannot move a folder into itself".to_string());
    }

    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to prepare target directory: {}", e))?;
    }

    std::fs::rename(&source_path, &target_path)
        .map_err(|e| format!("Failed to move entry: {}", e))?;

    Ok(true)
}

#[tauri::command]
fn get_app_storage_path() -> Result<String, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;

    let storage_dir = std::path::Path::new(&local_app_data)
        .join("Synapse Z")
        .join("state");

    if !storage_dir.exists() {
        std::fs::create_dir_all(&storage_dir)
            .map_err(|e| format!("Failed to create app storage directory: {}", e))?;
    }

    Ok(storage_dir.to_string_lossy().to_string())
}

#[derive(serde::Serialize, Clone)]
struct WorkspaceEntry {
    name: String,
    path: String,
    is_dir: bool,
    extension: Option<String>,
}

#[tauri::command]
fn read_workspace_dir(dir_path: String) -> Result<Vec<WorkspaceEntry>, String> {
    let path = std::path::Path::new(&dir_path);

    if !path.exists() {
        return Ok(vec![]);
    }

    let mut entries: Vec<WorkspaceEntry> = vec![];

    let read_dir = std::fs::read_dir(path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir {
        if let Ok(entry) = entry {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let file_path = entry.path().to_string_lossy().to_string();
            let is_dir = entry.path().is_dir();
            let extension = if is_dir {
                None
            } else {
                entry.path().extension().map(|e| e.to_string_lossy().to_string())
            };

            entries.push(WorkspaceEntry {
                name: file_name,
                path: file_path,
                is_dir,
                extension,
            });
        }
    }

    entries.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        } else if a.is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    Ok(entries)
}

#[tauri::command]
fn read_workspace_file(file_path: String) -> Result<String, String> {
    std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
fn get_autoexec_path() -> Result<String, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;

    let autoexec_dir = std::path::Path::new(&local_app_data)
        .join("Synapse Z")
        .join("autoexec");

    if !autoexec_dir.exists() {
        std::fs::create_dir_all(&autoexec_dir)
            .map_err(|e| format!("Failed to create autoexec directory: {}", e))?;
    }

    Ok(autoexec_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn add_to_autoexec(script_name: String, content: String) -> Result<bool, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;

    let autoexec_dir = std::path::Path::new(&local_app_data)
        .join("Synapse Z")
        .join("autoexec");

    if !autoexec_dir.exists() {
        std::fs::create_dir_all(&autoexec_dir)
            .map_err(|e| format!("Failed to create autoexec directory: {}", e))?;
    }

    let file_path = autoexec_dir.join(&script_name);
    std::fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write autoexec script: {}", e))?;

    Ok(true)
}

#[tauri::command]
fn remove_from_autoexec(script_name: String) -> Result<bool, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;

    let autoexec_dir = std::path::Path::new(&local_app_data)
        .join("Synapse Z")
        .join("autoexec");

    let file_path = autoexec_dir.join(&script_name);

    if file_path.exists() {
        std::fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to remove autoexec script: {}", e))?;
    }

    Ok(true)
}

#[tauri::command]
fn is_in_autoexec(script_name: String) -> Result<bool, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;

    let autoexec_dir = std::path::Path::new(&local_app_data)
        .join("Synapse Z")
        .join("autoexec");

    let file_path = autoexec_dir.join(&script_name);

    Ok(file_path.exists())
}

#[tauri::command]
fn get_autoexec_scripts() -> Result<Vec<String>, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;

    let autoexec_dir = std::path::Path::new(&local_app_data)
        .join("Synapse Z")
        .join("autoexec");

    if !autoexec_dir.exists() {
        return Ok(vec![]);
    }

    let mut scripts = vec![];
    let read_dir = std::fs::read_dir(&autoexec_dir)
        .map_err(|e| format!("Failed to read autoexec directory: {}", e))?;

    for entry in read_dir {
        if let Ok(entry) = entry {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".lua") || name.ends_with(".luau") {
                    scripts.push(name.to_string());
                }
            }
        }
    }

    Ok(scripts)
}

#[tauri::command]
fn load_favorites() -> Result<Vec<String>, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;

    let pearl_dir = std::path::Path::new(&local_app_data).join("Synapse Z");
    if !pearl_dir.exists() {
        std::fs::create_dir_all(&pearl_dir)
            .map_err(|e| format!("Failed to create Synapse Z directory: {}", e))?;
    }

    let favorites_path = pearl_dir.join("favorites.json");

    if !favorites_path.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&favorites_path)
        .map_err(|e| format!("Failed to read favorites: {}", e))?;

    let favorites: Vec<String> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse favorites: {}", e))?;

    Ok(favorites)
}

#[tauri::command]
fn save_favorites(favorites: Vec<String>) -> Result<bool, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Failed to get LOCALAPPDATA")?;

    let pearl_dir = std::path::Path::new(&local_app_data).join("Synapse Z");
    if !pearl_dir.exists() {
        std::fs::create_dir_all(&pearl_dir)
            .map_err(|e| format!("Failed to create Synapse Z directory: {}", e))?;
    }

    let favorites_path = pearl_dir.join("favorites.json");

    let content = serde_json::to_string(&favorites)
        .map_err(|e| format!("Failed to serialize favorites: {}", e))?;

    std::fs::write(&favorites_path, content)
        .map_err(|e| format!("Failed to write favorites: {}", e))?;

    Ok(true)
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<bool, String> {
    let path = std::path::Path::new(&path);

    if path.exists() {
        Command::new("explorer")
            .args(["/select,", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to reveal in explorer: {}", e))?;
    } else if let Some(parent) = path.parent() {
        if parent.exists() {
            Command::new("explorer")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
        }
    }

    Ok(true)
}

async fn install_vsix(vsix_path: &std::path::Path) -> Result<bool, String> {
    let output = Command::new("code")
        .args(["--install-extension", &vsix_path.to_string_lossy()])
        .creation_flags(0x08000000)
        .output();

    match output {
        Ok(result) => {
            if result.status.success() {
                Ok(true)
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                if stderr.contains("not recognized") || stderr.contains("not found") {
                    Err("VS Code CLI not found. Please install VS Code first.".to_string())
                } else {
                    Err(format!("Installation failed: {}", stderr))
                }
            }
        }
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                Err("VS Code is not installed or not in PATH. Please install VS Code first.".to_string())
            } else {
                Err(format!("Failed to run VS Code CLI: {}", e))
            }
        }
    }
}

#[tauri::command]
async fn start_dma_server(state: State<'_, DmaState>) -> Result<bool, String> {
    state.bridge.start().await?;
    Ok(true)
}

#[tauri::command]
async fn stop_dma_server(state: State<'_, DmaState>) -> Result<bool, String> {
    state.bridge.stop().await;
    Ok(true)
}

#[tauri::command]
async fn is_dma_connected(state: State<'_, DmaState>) -> Result<bool, String> {
    Ok(state.bridge.is_connected().await)
}

#[tauri::command]
async fn send_dma_script(state: State<'_, DmaState>, script: String) -> Result<bool, String> {
    state.bridge.send_script(script).await?;
    Ok(true)
}

#[tauri::command]
async fn launch_dma_exe(state: State<'_, DmaState>, exe_path: String, auto_close_seconds: u32) -> Result<bool, String> {
    state.bridge.launch_hidden_exe(exe_path, auto_close_seconds).await?;
    Ok(true)
}

#[tauri::command]
fn get_dma_port() -> u16 {
    21575
}

#[tauri::command]
async fn get_roblox_auth_ticket(cookie: String) -> Result<String, String> {
    let client = reqwest::Client::new();

    let csrf_response = client
        .post("https://auth.roblox.com/v1/authentication-ticket")
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .header("Content-Type", "application/json")
        .header("Referer", "https://www.roblox.com")
        .send()
        .await
        .map_err(|e| format!("CSRF request failed: {}", e))?;

    let csrf_token = csrf_response
        .headers()
        .get("x-csrf-token")
        .ok_or("No CSRF token returned")?
        .to_str()
        .map_err(|_| "Invalid CSRF token")?
        .to_string();

    let ticket_response = client
        .post("https://auth.roblox.com/v1/authentication-ticket")
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .header("Content-Type", "application/json")
        .header("x-csrf-token", &csrf_token)
        .header("Referer", "https://www.roblox.com")
        .send()
        .await
        .map_err(|e| format!("Auth ticket request failed: {}", e))?;

    if !ticket_response.status().is_success() {
        return Err(format!("Auth ticket failed: HTTP {}", ticket_response.status()));
    }

    let ticket = ticket_response
        .headers()
        .get("rbx-authentication-ticket")
        .ok_or("No auth ticket in response")?
        .to_str()
        .map_err(|_| "Invalid auth ticket")?
        .to_string();

    Ok(ticket)
}

#[tauri::command]
fn open_roblox_url(url: String) -> Result<bool, String> {
    Command::new("cmd")
        .args(["/C", "start", "", &url])
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| format!("Failed to open URL: {}", e))?;
    Ok(true)
}

#[tauri::command]
fn launch_roblox() -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let url: Vec<u16> = "roblox://navigation/home".encode_utf16().chain(Some(0)).collect();
    let result = unsafe {
        ShellExecuteW(std::ptr::null_mut(), std::ptr::null(), url.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL)
    };
    if result as isize <= 32 {
        return Err("Windows could not open Roblox. Check that Roblox is installed.".into());
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RobloxUserInfo {
    id: u64,
    name: String,
    display_name: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct RobloxUsernameLookupRequest {
    usernames: Vec<String>,
    exclude_banned_users: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RobloxUsernameLookupEntry {
    id: u64,
    name: String,
    display_name: String,
}

#[derive(serde::Deserialize)]
struct RobloxUsernameLookupResponse {
    data: Vec<RobloxUsernameLookupEntry>,
}

#[tauri::command]
async fn fetch_roblox_user_from_cookie(cookie: String) -> Result<RobloxUserInfo, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://users.roblox.com/v1/users/authenticated")
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Invalid cookie (HTTP {})", response.status()));
    }

    let info: serde_json::Value = response.json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(RobloxUserInfo {
        id: info["id"].as_u64().unwrap_or(0),
        name: info["name"].as_str().unwrap_or("").to_string(),
        display_name: info["displayName"].as_str().unwrap_or("").to_string(),
    })
}

#[tauri::command]
async fn fetch_roblox_user_by_username(username: String) -> Result<RobloxUserInfo, String> {
    let trimmed = username.trim();
    if trimmed.is_empty() {
        return Err("Username is required".to_string());
    }

    let client = reqwest::Client::new();
    let response = client
        .post("https://users.roblox.com/v1/usernames/users")
        .json(&RobloxUsernameLookupRequest {
            usernames: vec![trimmed.to_string()],
            exclude_banned_users: false,
        })
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Username lookup failed (HTTP {})", response.status()));
    }

    let body: RobloxUsernameLookupResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let user = body
        .data
        .into_iter()
        .next()
        .ok_or("User not found")?;

    Ok(RobloxUserInfo {
        id: user.id,
        name: user.name,
        display_name: user.display_name,
    })
}

#[tauri::command]
async fn fetch_roblox_avatar(user_id: u64) -> Result<String, String> {
    let url = format!(
        "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={}&size=150x150&format=Png&isCircular=false",
        user_id
    );
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Ok(String::new());
    }

    let json: serde_json::Value = response.json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(json["data"][0]["imageUrl"].as_str().unwrap_or("").to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RobloxGameInfo {
    universe_id: u64,
    name: String,
    thumbnail_url: String,
}

#[tauri::command]
async fn fetch_roblox_game_details(place_id: u64) -> Result<RobloxGameInfo, String> {
    let uni_url = format!("https://apis.roblox.com/universes/v1/places/{}/universe", place_id);
    let uni_response = reqwest::get(&uni_url)
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !uni_response.status().is_success() {
        return Err("Invalid place ID".to_string());
    }

    let uni_json: serde_json::Value = uni_response.json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let universe_id = uni_json["universeId"].as_u64()
        .ok_or("Could not get universe ID")?;

    let game_url = format!("https://games.roblox.com/v1/games?universeIds={}", universe_id);
    let game_response = reqwest::get(&game_url)
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let game_json: serde_json::Value = game_response.json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let name = game_json["data"][0]["name"].as_str()
        .unwrap_or("Unknown Game")
        .to_string();

    let thumb_url = format!(
        "https://thumbnails.roblox.com/v1/games/icons?universeIds={}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false",
        universe_id
    );
    let thumb_response = reqwest::get(&thumb_url).await;
    let thumbnail_url = match thumb_response {
        Ok(resp) if resp.status().is_success() => {
            let tj: serde_json::Value = resp.json().await.unwrap_or_default();
            tj["data"][0]["imageUrl"].as_str().unwrap_or("").to_string()
        }
        _ => String::new(),
    };

    Ok(RobloxGameInfo {
        universe_id,
        name,
        thumbnail_url,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(launcher_window::LauncherWindows::default())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                launcher_window::restore_launcher(&window.state::<launcher_window::LauncherWindows>());
            }
        })
        .manage(LspState {
            process: Mutex::new(None),
        })
        .manage(VsCodeState {
            bridge: VsCodeBridge::new(),
        })
        .manage(ExplorerState {
            bridge: ExplorerBridge::new(),
        })
        .manage(DmaState {
            bridge: DmaBridge::new(),
        })
        .manage(ConsoleState {
            bridge: ConsoleBridge::new(),
        })
        .setup(|app| {
            synapse_output::start(app.handle().clone());
            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    disable_webview_shortcuts(&window);
                }
                let app_handle = app.handle().clone();
                app.listen("tauri://webview-created", move |_event| {
                    for (_, window) in app_handle.webview_windows() {
                        disable_webview_shortcuts(&window);
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launcher_window::get_synapse_launcher_state,
            launcher_window::hide_synapse_launcher,
            launcher_window::start_synapse_launcher,
            launcher_window::show_synapse_launcher,
            rscripts::fetch_rscripts,
            library::move_library_script,
            start_lsp,
            stop_lsp,
            send_lsp_message,
            lsp_available,
            execute_script,
            execute_script_redirected,
            start_console_identity_probe,
            get_console_port,
            get_installed_font_families,
            load_client_settings_syn,
            is_synapse_installed,
            save_synz_installer,
            run_synz_installer,
            update_client_setting_syn,
            save_client_settings_syn,
            redeem_license,
            validate_license_session,
            handle_attach,
            is_roblox_running,
            get_roblox_processes,
            reset_hwid,
            get_account_info,
            logout_account,
            toggle_protection,
            start_vscode_server,
            stop_vscode_server,
            is_vscode_server_running,
            get_app_version,
            install_vscode_extension,
            start_explorer_server,
            stop_explorer_server,
            is_explorer_connected,
            get_explorer_connection_info,
            send_explorer_message,
            get_explorer_port,
            get_explorer_script,
            save_decompiled_script,
            save_all_scripts,
            open_folder_in_explorer,
            get_workspace_path,
            get_scripts_path,
            create_scripts_folder,
            move_scripts_entry,
            get_app_storage_path,
            reveal_in_explorer,
            read_workspace_dir,
            read_workspace_file,
            get_autoexec_path,
            add_to_autoexec,
            remove_from_autoexec,
            is_in_autoexec,
            get_autoexec_scripts,
            load_favorites,
            save_favorites,
            start_dma_server,
            stop_dma_server,
            is_dma_connected,
            send_dma_script,
            launch_dma_exe,
            get_dma_port,
            fetch_roblox_user_from_cookie,
            fetch_roblox_user_by_username,
            fetch_roblox_avatar,
            fetch_roblox_game_details,
            get_roblox_auth_ticket,
            open_roblox_url,
            launch_roblox
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
