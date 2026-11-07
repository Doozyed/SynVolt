use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::{Component, Path, PathBuf};
use windows_sys::Win32::Storage::FileSystem::MoveFileW;

#[derive(Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Section {
    Scripts,
    Enabled,
    Disabled,
}

impl Section {
    fn directory(self) -> Result<PathBuf, String> {
        let scripts = super::get_scripts_dir_path()?;
        Ok(match self {
            Self::Scripts => scripts,
            Self::Enabled => scripts.with_file_name("autoexec"),
            Self::Disabled => scripts.with_file_name("autoexec-disabled"),
        })
    }
}

fn checked_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if !path
        .components()
        .all(|part| matches!(part, Component::Normal(_)))
        || relative.contains(':')
        || !matches!(
            path.extension()
                .and_then(OsStr::to_str)
                .map(str::to_lowercase)
                .as_deref(),
            Some("lua" | "luau")
        )
    {
        return Err("Invalid script path.".into());
    }
    let mut full = root.to_owned();
    for component in path.components() {
        full.push(component);
        if full
            .symlink_metadata()
            .is_ok_and(|m| m.file_type().is_symlink())
        {
            return Err("Cannot move a script through a symbolic link.".into());
        }
    }
    Ok(full)
}

fn move_without_replacing(source: &Path, target: &Path) -> Result<(), String> {
    let wide = |p: &Path| {
        p.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>()
    };
    // MoveFileW refuses to overwrite an existing destination.
    if unsafe { MoveFileW(wide(source).as_ptr(), wide(target).as_ptr()) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn move_library_script(
    from: Section,
    to: Section,
    relative: String,
    destination: String,
) -> Result<String, String> {
    let source = checked_path(&from.directory()?, &relative)?;
    let root = to.directory()?;
    let mut target = checked_path(&root, &destination)?;
    if !source.is_file() {
        return Err("The script no longer exists. Refresh Explorer.".into());
    }
    if source == target {
        return Err("The script is already in that folder.".into());
    }
    if to != Section::Scripts {
        let other = if to == Section::Enabled {
            Section::Disabled
        } else {
            Section::Enabled
        };
        if from == Section::Scripts && checked_path(&other.directory()?, &destination)?.exists() {
            return Err("Auto Execution already contains a script with that name.".into());
        }
    }
    if target.exists() && to == Section::Scripts && from != Section::Scripts {
        // Earlier versions kept a second copy under Scripts. Reuse an identical
        // original, or keep both versions when their contents have diverged.
        if std::fs::read(&source).map_err(|e| e.to_string())?
            == std::fs::read(&target).map_err(|e| e.to_string())?
        {
            std::fs::remove_file(&source).map_err(|e| e.to_string())?;
            return Ok(target.to_string_lossy().into_owned());
        }
        let stem = target.file_stem().unwrap().to_string_lossy().into_owned();
        let ext = target.extension().unwrap().to_string_lossy().into_owned();
        for n in 1.. {
            target.set_file_name(format!("{stem} (auto {n}).{ext}"));
            if !target.exists() {
                break;
            }
        }
    }
    std::fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
    move_without_replacing(&source, &target)?;
    Ok(target.to_string_lossy().into_owned())
}
