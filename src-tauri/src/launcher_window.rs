use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
use std::path::{Path, PathBuf};
use std::os::windows::ffi::OsStrExt;
use sysinfo::{ProcessesToUpdate, System};
use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, CloseHandle};
use windows_sys::Win32::System::Threading::{CreateProcessW, PROCESS_INFORMATION, STARTUPINFOW, STARTF_USESHOWWINDOW};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindow, IsWindowVisible, ShowWindow,
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
    // The PID is already restricted to a recognized SynZ executable. Updated
    // launchers can change their title, so do not tie discovery to its text.
    !title.trim().is_empty()
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
    let mut tracked = state.windows.lock().map_err(|e| e.to_string())?;
    tracked.retain(|(window, pid)| unsafe {
        let hwnd = *window as HWND;
        let mut owner = 0;
        IsWindow(hwnd) != 0 && GetWindowThreadProcessId(hwnd, &mut owner) != 0
            && owner == *pid && search.pids.contains(pid)
    });
    for (window, pid) in search.windows {
        unsafe {
            ShowWindow(window as HWND, SW_HIDE);
        }
        if !tracked.contains(&(window, pid)) {
            tracked.push((window, pid));
        }
    }
    Ok(tracked.iter().any(|(window, _)| unsafe { IsWindowVisible(*window as HWND) == 0 }))
}

#[tauri::command]
pub fn hide_synapse_launcher(state: tauri::State<'_, LauncherWindows>) -> Result<bool, String> {
    hide_launcher_windows(&state)
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

#[tauri::command]
pub fn get_synapse_launcher_state() -> String {
    let search = find_windows();
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
    use super::{is_launcher_filename, is_launcher_process_name, is_launcher_window_title};

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
pub fn show_synapse_launcher(state: tauri::State<'_, LauncherWindows>) -> bool {
    let search = find_windows();
    for (window, _) in &search.windows { unsafe { ShowWindow(*window as HWND, SW_SHOWNA); } }
    if let Ok(mut windows) = state.windows.lock() { windows.clear(); }
    search.windows.iter().any(|(window, _)| unsafe { IsWindowVisible(*window as HWND) != 0 })
}
