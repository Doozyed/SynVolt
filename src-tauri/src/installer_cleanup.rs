use std::io::Read;
use std::path::{Path, PathBuf};
fn identical(a: &Path, b: &Path) -> bool {
    let (Ok(mut a), Ok(mut b)) = (std::fs::File::open(a), std::fs::File::open(b)) else { return false };
    if a.metadata().ok().map(|m| m.len()) != b.metadata().ok().map(|m| m.len()) { return false; }
    let (mut l, mut r) = ([0u8; 65536], [0u8; 65536]);
    loop { let (Ok(n), Ok(m)) = (a.read(&mut l), b.read(&mut r)) else { return false }; if n != m || l[..n] != r[..m] { return false; } if n == 0 { return true; } }
}
fn candidates(reference: &Path, dirs: &[PathBuf], protected: &[PathBuf]) -> Vec<PathBuf> {
    let protected: Vec<_> = protected.iter().filter_map(|p| p.canonicalize().ok()).collect();
    let mut found = Vec::new();
    for dir in dirs {
        let Ok(root) = dir.canonicalize() else { continue };
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) || !crate::launcher_window::is_launcher_filename(&entry.file_name().to_string_lossy()) { continue; }
            let Ok(path) = entry.path().canonicalize() else { continue };
            if path.parent() != Some(root.as_path()) || protected.contains(&path) || found.contains(&path) { continue; }
            if identical(reference, &path) { found.push(entry.path()); }
        }
    }
    found
}
pub fn recycle_duplicates(reference: &Path, dirs: &[PathBuf], protected: &[PathBuf]) -> usize {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{SHFileOperationW, SHFILEOPSTRUCTW, FO_DELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT};
    let mut count = 0;
    for path in candidates(reference, dirs, protected) {
        let filename: Vec<u16> = path.as_os_str().encode_wide().chain([0, 0]).collect();
        unsafe { let mut op: SHFILEOPSTRUCTW = std::mem::zeroed(); op.wFunc = FO_DELETE; op.pFrom = filename.as_ptr(); op.fFlags = (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT) as u16; if SHFileOperationW(&mut op) == 0 && op.fAnyOperationsAborted == 0 { count += 1; } }
    }
    count
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn finds_only_identical_unprotected_direct_children() {
        let root = std::env::temp_dir().join(format!("synvolt-cleanup-test-{}", std::process::id()));
        std::fs::create_dir_all(root.join("nested")).unwrap();
        let source = root.join("SynInstallerV2.exe"); let matching = root.join("SynInstallerV2 (1).exe"); let different = root.join("SynInstallerV2 (2).exe"); let unrelated = root.join("other.exe"); let nested = root.join("nested").join("SynInstallerV2 (3).exe");
        for p in [&source, &matching, &unrelated, &nested] { std::fs::write(p, b"installer").unwrap(); } std::fs::write(&different, b"different").unwrap();
        assert_eq!(candidates(&source, &[root.clone()], &[source.clone()]), vec![matching.clone()]);
        for p in [&source, &matching, &different, &unrelated, &nested] { std::fs::remove_file(p).unwrap(); } std::fs::remove_dir(root.join("nested")).unwrap(); std::fs::remove_dir(root).unwrap();
    }
}
