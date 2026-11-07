fn main() {
    println!("cargo:rerun-if-env-changed=SYNVOLT_STANDARD_BUILD");
    println!("cargo:rustc-check-cfg=cfg(synvolt_standard)");
    let standard =
        std::env::var_os("SYNVOLT_STANDARD_BUILD").as_deref() == Some(std::ffi::OsStr::new("1"));
    let manifest = if standard {
        println!("cargo:rustc-cfg=synvolt_standard");
        include_str!("windows-app-standard-manifest.xml")
    } else {
        include_str!("windows-app-manifest.xml")
    };
    let windows = tauri_build::WindowsAttributes::new().app_manifest(manifest);
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to build SynVolt");
}
