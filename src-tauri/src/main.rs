#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = tauri_app_lib::run_launcher_window_helper() {
        std::process::exit(code);
    }
    tauri_app_lib::run()
}
