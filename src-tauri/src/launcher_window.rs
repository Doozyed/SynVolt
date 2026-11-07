use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
use std::path::{Path, PathBuf};
use std::os::windows::ffi::OsStrExt;
use sysinfo::{ProcessesToUpdate, System};
use tauri::Manager;
use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, CloseHandle};
use windows_sys::Win32::System::Threading::{CreateProcessW, PROCESS_INFORMATION, STARTUPINFOW, STARTF_USESHOWWINDOW};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindow, IsWindowVisible, SetForegroundWindow, ShowWindow,
    SW_HIDE, SW_SHOWNA,
};

#[derive(Default)]
pub struct LauncherWindows {
    windows: Mutex<Vec<(isize, u32)>>,
    pub installing: AtomicBool,
}

struct Search {
    pids: Vec<u32>,
    windows: Vec<(isize, u32)>,
}

unsafe extern "system" fn find_launcher(hwnd: HWND, arg: LPARAM) -> BOOL {
    let search = &mut *(arg as *mut Search);
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if !search.pids.contains(&pid) {
        return 1;
    }
    let mut text = [0u16; 128];
    let length = GetWindowTextW(hwnd, text.as_mut_ptr(), text.len() as i32);
    if is_launcher_window_title(&String::from_utf16_lossy(&text[..length as usize])) {
        search.windows.push((hwnd as isize, pid));
    }
    1
}

fn is_launcher_window_title(title: &str) -> bool {
    let title = title.trim().to_ascii_lowercase();
    title == "z" || title.contains("synapse z") || title.contains("synapsez") || title.contains("synz")
}

fn is_launcher_process_name(name: &str) -> bool {
    is_launcher_filename(name) || matches!(name.to_ascii_lowercase().as_str(), "synapse z.exe" | "synapsez.exe" | "synz.exe")
}

fn launcher_pids() -> Vec<u32> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes()
        .iter()
        .filter_map(|(pid, p)| {
            let name = p.name().to_string_lossy().to_ascii_lowercase();
            is_launcher_process_name(&name).then_some(pid.as_u32())
        })
        .collect()
}

fn hide_launcher_windows(state: &LauncherWindows) -> Result<bool, String> {
    let pids = launcher_pids();
    let mut search = Search {
        pids,
        windows: Vec::new(),
    };
    unsafe {
        EnumWindows(Some(find_launcher), (&mut search as *mut Search) as LPARAM);
    }
    hide_windows(state, search)
}

fn hide_windows(state: &LauncherWindows, search: Search) -> Result<bool, String> {
    let mut tracked = state.windows.lock().map_err(|e| e.to_string())?;
    tracked.retain(|(window, pid)| unsafe {
        let hwnd = *window as HWND;
        let mut owner = 0;
        IsWindow(hwnd) != 0 && GetWindowThreadProcessId(hwnd, &mut owner) != 0
            && owner == *pid && search.pids.contains(pid)
    });
    let mut found_window = false;
    let mut all_hidden = true;
    for (window, pid) in search.windows {
        found_window = true;
        let was_visible = unsafe { IsWindowVisible(window as HWND) != 0 };
        if was_visible { unsafe { ShowWindow(window as HWND, SW_HIDE); } }
        let hidden = unsafe { IsWindowVisible(window as HWND) == 0 };
        all_hidden &= hidden;
        if was_visible && hidden && !tracked.contains(&(window, pid)) {
            tracked.push((window, pid));
        }
    }
    Ok(found_window && all_hidden)
}

pub(crate) fn helper_hide(state: &LauncherWindows) -> bool {
    hide_launcher_windows(state).unwrap_or(false)
}

pub(crate) fn helper_show(state: &LauncherWindows) -> bool {
    let search = find_windows_with_tracked(state);
    let foreground = search.windows.first().copied();
    let shown = show_windows(state, search);
    if shown {
        if let Some((window, _)) = foreground { unsafe { SetForegroundWindow(window as HWND); } }
    }
    shown
}

#[tauri::command]
pub async fn hide_synapse_launcher(app: tauri::AppHandle, state: tauri::State<'_, LauncherWindows>) -> Result<bool, String> {
    if hide_launcher_windows(&state)? { return Ok(true); }
    if launcher_pids().is_empty() { return Ok(false); }
    if !request_elevated_window_action(&app, "hide").await? { return Ok(false); }
    let search = find_windows();
    if let Ok(mut tracked) = state.windows.lock() {
        for (window, pid) in &search.windows {
            if unsafe { IsWindowVisible(*window as HWND) == 0 } && !tracked.contains(&(*window, *pid)) {
                tracked.push((*window, *pid));
            }
        }
    }
    Ok(!search.windows.is_empty() && search.windows.iter().all(|(window, _)| unsafe { IsWindowVisible(*window as HWND) == 0 }))
}

pub(crate) fn is_launcher_filename(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    if name == "syninstallerv2.exe" { return true; }
    name.strip_prefix("syninstallerv2 (")
        .and_then(|suffix| suffix.strip_suffix(").exe"))
        .is_some_and(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
}

fn find_launcher_executable() -> Option<PathBuf> {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    let profile = std::env::var_os("USERPROFILE").map(PathBuf::from)?;
    let mut dirs = vec![local.join("Synapse Z"), local.join("Synapse Z").join("bin"),
        local.join("Programs").join("Synapse Z"), profile.join("Downloads"), profile.join("Desktop")];
    for variable in ["APPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(variable) {
            dirs.push(PathBuf::from(root).join("Synapse Z"));
        }
    }
    if let Some(root) = std::env::var_os("OneDrive") {
        dirs.push(PathBuf::from(root).join("Desktop"));
    }
    let mut candidates = Vec::new();
    for dir in dirs {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if is_launcher_filename(&name) && entry.path().is_file() {
                    let modified = entry.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
                    candidates.push((modified, entry.path()));
                }
            }
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.into_iter().next().map(|(_, path)| path)
}

fn spawn_launcher(path: &Path, hidden: bool) -> Result<(), String> {
    let executable: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let directory: Vec<u16> = path.parent().ok_or("Invalid launcher location")?.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        let mut startup: STARTUPINFOW = std::mem::zeroed();
        startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        startup.dwFlags = STARTF_USESHOWWINDOW;
        startup.wShowWindow = if hidden { SW_HIDE as u16 } else { SW_SHOWNA as u16 };
        let mut process: PROCESS_INFORMATION = std::mem::zeroed();
        let success = CreateProcessW(executable.as_ptr(), std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), 0, 0,
            std::ptr::null(), directory.as_ptr(), &startup, &mut process);
        if success == 0 { return Err(std::io::Error::last_os_error().to_string()); }
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
    }
    Ok(())
}

#[tauri::command]
pub async fn start_synapse_launcher(state: tauri::State<'_, LauncherWindows>) -> Result<String, String> {
    if state.installing.load(Ordering::Acquire) { return Ok("installing".into()); }
    if !crate::is_synapse_installed()? { return Ok("not_installed".into()); }
    if launcher_pids().is_empty() {
        let Some(path) = find_launcher_executable() else { return Ok("not_found".into()); };
        if let Err(error) = spawn_launcher(&path, true) { return Err(format!("Could not open Synapse Z launcher: {error}")); }
    }
    for _ in 0..40 {
        if state.installing.load(Ordering::Acquire) { return Ok("installing".into()); }
        if hide_launcher_windows(&state)? { return Ok("hidden".into()); }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    if !launcher_pids().is_empty() { Ok("running".into()) } else { Err("Synapse Z launcher closed before it was ready.".into()) }
}

#[derive(Clone)]
pub(crate) struct PreviousLauncher {
    pub path: PathBuf,
    pub hidden: bool,
}

fn find_windows() -> Search {
    let mut search = Search { pids: launcher_pids(), windows: Vec::new() };
    unsafe { EnumWindows(Some(find_launcher), (&mut search as *mut Search) as LPARAM); }
    search
}

fn find_windows_with_tracked(state: &LauncherWindows) -> Search {
    let mut search = find_windows();
    merge_tracked(state, &mut search);
    search
}

fn merge_tracked(state: &LauncherWindows, search: &mut Search) {
    if let Ok(mut tracked) = state.windows.lock() {
        tracked.retain(|(window, pid)| unsafe {
            let hwnd = *window as HWND;
            let mut owner = 0;
            IsWindow(hwnd) != 0 && GetWindowThreadProcessId(hwnd, &mut owner) != 0
                && owner == *pid && search.pids.contains(pid)
        });
        for item in tracked.iter() {
            if !search.windows.contains(item) { search.windows.push(*item); }
        }
    }
}

#[tauri::command]
pub fn get_synapse_launcher_state(state: tauri::State<'_, LauncherWindows>) -> String {
    let search = find_windows_with_tracked(&state);
    if search.windows.is_empty() {
        return if search.pids.is_empty() { "not_running" } else { "running" }.into();
    }
    if search.windows.iter().any(|(hwnd, _)| unsafe { IsWindowVisible(*hwnd as HWND) != 0 }) {
        "visible".into()
    } else {
        "hidden".into()
    }
}

pub(crate) fn running_launcher_paths() -> Vec<PathBuf> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes().values().filter_map(|process| {
        let name = process.name().to_string_lossy();
        if is_launcher_process_name(&name) { process.exe().map(Path::to_path_buf) } else { None }
    }).collect()
}

pub(crate) fn stop_launchers(state: &LauncherWindows) -> Result<Vec<PreviousLauncher>, String> {
    let search = find_windows();
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut previous = Vec::new();
    let mut pids = Vec::new();
    for (pid, process) in sys.processes() {
        if !is_launcher_process_name(&process.name().to_string_lossy()) { continue; }
        let path = process.exe().filter(|path| path.is_file())
            .ok_or("Could not locate the running SynZ launcher. Close it manually before reinstalling.")?.to_path_buf();
        let hidden = !search.windows.iter().any(|(hwnd, owner)| *owner == pid.as_u32() && unsafe { IsWindowVisible(*hwnd as HWND) != 0 });
        previous.push(PreviousLauncher { path, hidden });
        pids.push(*pid);
    }
    for pid in &pids {
        if let Some(process) = sys.process(*pid) {
            if !process.kill() {
                let _ = restart_previous(&previous);
                return Err("Could not close the running SynZ launcher. Close it manually before reinstalling.".into());
            }
        }
    }
    for _ in 0..30 {
        sys.refresh_processes(ProcessesToUpdate::All, true);
        if pids.iter().all(|pid| sys.process(*pid).is_none()) {
            if let Ok(mut windows) = state.windows.lock() { windows.clear(); }
            return Ok(previous);
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let _ = restart_previous(&previous);
    Err("SynZ did not close in time. Close it manually before reinstalling.".into())
}

pub(crate) fn restart_previous(previous: &[PreviousLauncher]) -> Result<(), String> {
    let running = running_launcher_paths();
    for launcher in previous {
        if !running.iter().any(|path| path == &launcher.path) {
            spawn_launcher(&launcher.path, launcher.hidden)?;
        }
    }
    Ok(())
}

pub(crate) fn restart_updated(state: &LauncherWindows, path: &Path, previous: &[PreviousLauncher]) -> Result<(), String> {
    if previous.is_empty() { return Ok(()); }
    if launcher_pids().is_empty() { spawn_launcher(path, previous.iter().all(|item| item.hidden))?; }
    if previous.iter().all(|item| item.hidden) {
        for _ in 0..20 {
            if hide_launcher_windows(state)? { break; }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_launcher_filename, is_launcher_process_name, is_launcher_window_title, hide_windows, show_windows, merge_tracked, LauncherWindows, Search};

    #[test]
    fn recognizes_original_launcher_names_only() {
        assert!(is_launcher_filename("SynInstallerV2.exe"));
        assert!(is_launcher_filename("SynInstallerV2 (3).exe"));
        assert!(!is_launcher_filename("SynInstallerV2backup.exe"));
        assert!(!is_launcher_filename("SynInstallerV2 ().exe"));
        assert!(!is_launcher_filename("SynInstallerV2 (other).exe"));
    }

    #[test]
    fn recognizes_updated_launcher_windows_without_matching_other_apps() {
        assert!(is_launcher_process_name("Synapse Z.exe"));
        assert!(is_launcher_process_name("SynInstallerV2 (3).exe"));
        assert!(!is_launcher_process_name("SynVolt.exe"));
        assert!(is_launcher_window_title("Synapse Z Launcher"));
        assert!(is_launcher_window_title("Z"));
        assert!(is_launcher_window_title("SynZ"));
        assert!(!is_launcher_window_title("  "));
        assert!(!is_launcher_window_title("Other utility window"));
    }

    #[test]
    fn hide_show_survives_a_replaced_launcher_window() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, IsWindowVisible, ShowWindow, SW_SHOWNOACTIVATE, WS_OVERLAPPEDWINDOW};
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let title: Vec<u16> = "Z\0".encode_utf16().collect();
        let create = || unsafe { CreateWindowExW(0, class.as_ptr(), title.as_ptr(), WS_OVERLAPPEDWINDOW, -30000, -30000, 100, 100, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null()) };
        let state = LauncherWindows::default();
        let pid = std::process::id();
        let first = create();
        assert!(!first.is_null());
        unsafe { ShowWindow(first, SW_SHOWNOACTIVATE); }
        let search = || Search { pids: vec![pid], windows: vec![(first as isize, pid)] };
        assert!(hide_windows(&state, search()).unwrap());
        assert_eq!(unsafe { IsWindowVisible(first) }, 0);
        assert!(show_windows(&state, search()));
        assert_ne!(unsafe { IsWindowVisible(first) }, 0);
        assert!(hide_windows(&state, search()).unwrap());
        unsafe { DestroyWindow(first); }

        let second = create();
        assert!(!second.is_null());
        unsafe { ShowWindow(second, SW_SHOWNOACTIVATE); }
        let mut fresh = Search { pids: vec![pid], windows: vec![(second as isize, pid)] };
        merge_tracked(&state, &mut fresh);
        assert!(hide_windows(&state, fresh).unwrap());
        assert_eq!(unsafe { IsWindowVisible(second) }, 0);
        assert!(show_windows(&state, Search { pids: vec![pid], windows: vec![(second as isize, pid)] }));
        assert_ne!(unsafe { IsWindowVisible(second) }, 0);
        unsafe { DestroyWindow(second); }
    }
}

pub fn restore_launcher(state: &LauncherWindows) {
    let Ok(mut tracked) = state.windows.lock() else {
        return;
    };
    let current_pids = launcher_pids();
    for (window, pid) in tracked.drain(..) {
        let hwnd = window as HWND;
        let mut owner = 0;
        unsafe {
            if IsWindow(hwnd) != 0 {
                GetWindowThreadProcessId(hwnd, &mut owner);
                if owner == pid && current_pids.contains(&pid) {
                    ShowWindow(hwnd, SW_SHOWNA);
                }
            }
        }
    }
}

#[tauri::command]
pub async fn show_synapse_launcher(app: tauri::AppHandle, state: tauri::State<'_, LauncherWindows>) -> Result<bool, String> {
    if helper_show(&state) { return Ok(true); }
    if launcher_pids().is_empty() { return Ok(false); }
    if !request_elevated_window_action(&app, "show").await? { return Ok(false); }
    let search = find_windows_with_tracked(&state);
    if let Ok(mut tracked) = state.windows.lock() {
        tracked.retain(|(window, _)| unsafe { IsWindow(*window as HWND) != 0 && IsWindowVisible(*window as HWND) == 0 });
    }
    let shown = !search.windows.is_empty() && search.windows.iter().all(|(window, _)| unsafe { IsWindowVisible(*window as HWND) != 0 });
    if shown { if let Some((window, _)) = search.windows.first() { unsafe { SetForegroundWindow(*window as HWND); } } }
    Ok(shown)
}

fn show_windows(state: &LauncherWindows, search: Search) -> bool {
    for (window, _) in &search.windows {
        if unsafe { IsWindowVisible(*window as HWND) == 0 } {
            unsafe { ShowWindow(*window as HWND, SW_SHOWNA); }
        }
    }
    if let Ok(mut windows) = state.windows.lock() {
        // Keep windows that Windows refused to show so the next click can retry.
        windows.retain(|(window, _)| unsafe { IsWindow(*window as HWND) != 0 && IsWindowVisible(*window as HWND) == 0 });
    }
    !search.windows.is_empty() && search.windows.iter().all(|(window, _)| unsafe { IsWindowVisible(*window as HWND) != 0 })
}

async fn request_elevated_window_action(app: &tauri::AppHandle, action: &'static str) -> Result<bool, String> {
    let owner = app.get_webview_window("main").and_then(|window| window.hwnd().ok())
        .map(|hwnd| hwnd.0 as isize).unwrap_or(0);
    tauri::async_runtime::spawn_blocking(move || run_elevated_window_action(owner, action)).await
        .map_err(|error| format!("Could not request permission to control SynZ: {error}"))?
}

fn run_elevated_window_action(owner: isize, action: &str) -> Result<bool, String> {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_CANCELLED, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SHELLEXECUTEINFOW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS};
    if !matches!(action, "hide" | "show") { return Err("Invalid SynZ window action.".into()); }
    let path = std::env::current_exe().map_err(|_| "Could not find SynVolt.")?;
    let executable: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let verb: Vec<u16> = "runas".encode_utf16().chain(Some(0)).collect();
    let parameters: Vec<u16> = format!("--synvolt-window-helper {action}").encode_utf16().chain(Some(0)).collect();
    unsafe {
        let initialized = CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32) >= 0;
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOASYNC | SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_NO_UI;
        info.hwnd = owner as HWND;
        info.lpVerb = verb.as_ptr();
        info.lpFile = executable.as_ptr();
        info.lpParameters = parameters.as_ptr();
        info.nShow = SW_HIDE;
        if ShellExecuteExW(&mut info) == 0 {
            let error = GetLastError();
            if initialized { CoUninitialize(); }
            if error == ERROR_CANCELLED { return Err("Administrator permission was cancelled. SynZ is running with administrator rights; allow the request to control its window.".into()); }
            return Err(format!("Windows could not open the SynZ window helper: {}", std::io::Error::from_raw_os_error(error as i32)));
        }
        if initialized { CoUninitialize(); }
        if info.hProcess.is_null() { return Err("Windows did not return the SynZ window helper process.".into()); }
        let waited = WaitForSingleObject(info.hProcess, INFINITE) == WAIT_OBJECT_0;
        let mut exit_code = 1;
        let success = waited && GetExitCodeProcess(info.hProcess, &mut exit_code) != 0 && exit_code == 0;
        CloseHandle(info.hProcess);
        Ok(success)
    }
}
