use std::collections::HashSet;
use std::ffi::CString;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileA, ReadFile, WriteFile, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE,
    OPEN_EXISTING,
};
use windows_sys::Win32::System::Pipes::{
    PeekNamedPipe, SetNamedPipeHandleState, PIPE_READMODE_MESSAGE,
};

struct Pipe(HANDLE);
impl Drop for Pipe {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

fn open_pipe(name: &str) -> Option<Pipe> {
    let name = CString::new(name).ok()?;
    let handle = unsafe {
        CreateFileA(
            name.as_ptr().cast(),
            0xC0000000,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return None;
    }
    let mode = PIPE_READMODE_MESSAGE;
    unsafe {
        SetNamedPipeHandleState(handle, &mode, std::ptr::null(), std::ptr::null());
    }
    Some(Pipe(handle))
}

fn send(pipe: &Pipe, value: &str) -> bool {
    let mut written = 0;
    let sent = unsafe {
        WriteFile(
            pipe.0,
            value.as_ptr(),
            value.len() as u32,
            &mut written,
            std::ptr::null_mut(),
        ) != 0
    };
    sent && written == value.len() as u32
}

fn receive(pipe: &Pipe) -> Option<String> {
    unsafe {
        // The zero-length read waits until a message is ready. Windows reports
        // ERROR_MORE_DATA for a nonempty message, which is expected.
        let mut ignored = 0;
        ReadFile(
            pipe.0,
            std::ptr::null_mut(),
            0,
            &mut ignored,
            std::ptr::null_mut(),
        );
        let mut available = 0;
        if PeekNamedPipe(
            pipe.0,
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            &mut available,
            std::ptr::null_mut(),
        ) == 0
            || available == 0
            || available > 1024 * 1024
        {
            return None;
        }
        let mut bytes = vec![0; available as usize];
        let mut read = 0;
        if ReadFile(
            pipe.0,
            bytes.as_mut_ptr(),
            available,
            &mut read,
            std::ptr::null_mut(),
        ) == 0
        {
            return None;
        }
        bytes.truncate(read as usize);
        String::from_utf8(bytes)
            .ok()
            .map(|value| value.trim_matches('\0').to_string())
    }
}

fn mirror(pid: u32, app: &AppHandle) -> Option<()> {
    let handshake = open_pipe(&format!(r"\\.\pipe\synz-{}", pid))?;
    if !send(&handshake, "new") {
        return None;
    }
    let path = receive(&handshake)?;
    if !path.starts_with(&format!(r"\\.\pipe\synz-{}-", pid)) {
        return None;
    }
    drop(handshake);
    let mut pipe = None;
    for _ in 0..50 {
        pipe = open_pipe(&path);
        if pipe.is_some() {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    let pipe = pipe?;
    loop {
        if !send(&pipe, "1") || !send(&pipe, "read") {
            return None;
        }
        let count: usize = receive(&pipe)?.parse().ok()?;
        if count > 1000 {
            return None;
        }
        for _ in 0..count {
            let value = receive(&pipe)?;
            let (level, message) = if let Some(message) = value.strip_prefix("error ") {
                ("error", message)
            } else if let Some(value) = value.strip_prefix("output ") {
                let (kind, text) = value.split_once(' ')?;
                (
                    match kind {
                        "2" => "warning",
                        "3" => "error",
                        _ => "info",
                    },
                    text,
                )
            } else {
                continue;
            };
            let _ = app.emit(
                "console-log",
                serde_json::json!({ "level": level, "message": message }),
            );
        }
        thread::sleep(Duration::from_millis(100));
    }
}

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let active = Arc::new(Mutex::new(HashSet::new()));
        let mut system = System::new();
        loop {
            system.refresh_processes(ProcessesToUpdate::All, true);
            for (pid, process) in system.processes() {
                if !process
                    .name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case("RobloxPlayerBeta.exe")
                {
                    continue;
                }
                let pid = pid.as_u32();
                let mut sessions = match active.lock() {
                    Ok(sessions) => sessions,
                    Err(_) => return,
                };
                if !sessions.insert(pid) {
                    continue;
                }
                drop(sessions);
                let sessions = Arc::clone(&active);
                let app = app.clone();
                thread::spawn(move || {
                    let _ = mirror(pid, &app);
                    if let Ok(mut sessions) = sessions.lock() {
                        sessions.remove(&pid);
                    }
                });
            }
            thread::sleep(Duration::from_secs(3));
        }
    });
}
