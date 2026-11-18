//! Dosik's MCP server, copied out of the app bundle into the app data (#252).
//!
//! The bundle carries `mcp/server/` (built by `pnpm build:mcp`). Claude Code,
//! ChatGPT and Codex are registered with a copy in the app data rather than
//! with the bundle itself, so moving Dosik.app does not break them; the copy is
//! refreshed whenever the bundled one differs (`package-info.json` holds the
//! version and a hash of the build), so an update reaches them too.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// the marker beside the server — `scripts/mcp/paths.mjs` reads the same file
pub const PACKAGE_INFO: &str = "package-info.json";
/// the server's entry inside the folder
pub const SERVER_ENTRY: &str = "server.mjs";
/// what a complete copy holds — `scripts/build-mcp.mjs` writes these
pub const REQUIRED: [&str; 5] = [
    PACKAGE_INFO,
    SERVER_ENTRY,
    "dosik-headless.mjs",
    "diagram-view.js",
    "openapi.yaml",
];
/// what a build without a packaged server says (a development run before `pnpm build:mcp`)
pub const NOT_BUNDLED: &str = "This build of Dosik carries no MCP server.";

#[derive(Debug, PartialEq, Eq)]
pub enum InstallOutcome {
    /// copied (first time, the bundled build differs, or the copy lost a file)
    Installed,
    /// the copy already is this build
    UpToDate,
    /// this build carries no server
    NotBundled,
}

/// The last copy's trouble, for Settings ▸ Integrations to show (#252): None when
/// it went fine, the reason otherwise.
#[derive(Default)]
pub struct McpServerState(pub Mutex<Option<String>>);

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

/// Makes `target` a copy of `bundled` unless it already is — the same marker
/// and every required file present, so a copy with a file gone is copied
/// again. The new copy is assembled beside the old one and swapped in: the old
/// one steps aside first and goes only once the new one is in place, so a
/// failure midway never leaves a half-written server, or none at all.
pub fn install_server(bundled: &Path, target: &Path) -> Result<InstallOutcome, String> {
    let Ok(marker) = std::fs::read(bundled.join(PACKAGE_INFO)) else {
        return Ok(InstallOutcome::NotBundled);
    };
    let same = std::fs::read(target.join(PACKAGE_INFO)).ok().as_deref() == Some(marker.as_slice());
    if same && REQUIRED.iter().all(|file| target.join(file).exists()) {
        return Ok(InstallOutcome::UpToDate);
    }
    let staging = target.with_extension("staging");
    let old = target.with_extension("old");
    let _ = std::fs::remove_dir_all(&staging);
    let _ = std::fs::remove_dir_all(&old);
    copy_dir(bundled, &staging).map_err(|e| format!("Copying the MCP server failed: {e}"))?;
    if target.exists() {
        std::fs::rename(target, &old)
            .map_err(|e| format!("Replacing the MCP server failed: {e}"))?;
    }
    if let Err(e) = std::fs::rename(&staging, target) {
        // put the old copy back rather than leave none
        let _ = std::fs::rename(&old, target);
        return Err(format!("Installing the MCP server failed: {e}"));
    }
    let _ = std::fs::remove_dir_all(&old);
    Ok(InstallOutcome::Installed)
}

/// `<app data>/mcp/server` — where the registered copy lives
pub fn installed_dir(app_data: &Path) -> PathBuf {
    app_data.join("mcp").join("server")
}

/// The bundled server copied into the app data now, its trouble kept for
/// Settings — at launch, and again before an install (a copy that lost a
/// file is repaired there).
pub fn ensure<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<InstallOutcome, String> {
    use tauri::path::BaseDirectory;
    use tauri::Manager;
    // the launch copy and an Install's check never swap folders at the same time
    static COPYING: Mutex<()> = Mutex::new(());
    let _copying = COPYING.lock().unwrap_or_else(|e| e.into_inner());
    let result = app
        .path()
        .resolve("mcp/server", BaseDirectory::Resource)
        .map_err(|e| e.to_string())
        .and_then(|bundled| {
            let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
            install_server(&bundled, &installed_dir(&data))
        });
    if let Some(state) = app.try_state::<McpServerState>() {
        *state.0.lock().unwrap() = match &result {
            Ok(InstallOutcome::NotBundled) => Some(NOT_BUNDLED.to_string()),
            Ok(_) => None,
            Err(e) => Some(e.clone()),
        };
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("dosik-mcp-install-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn bundle(dir: &Path, build: &str) {
        std::fs::create_dir_all(dir).unwrap();
        for file in REQUIRED {
            std::fs::write(dir.join(file), "").unwrap();
        }
        std::fs::write(
            dir.join(PACKAGE_INFO),
            format!(r#"{{"version":"0.2.0","build":"{build}"}}"#),
        )
        .unwrap();
        std::fs::write(dir.join(SERVER_ENTRY), format!("// {build}")).unwrap();
    }

    #[test]
    fn copies_a_bundled_server_the_first_time_and_then_leaves_it() {
        let root = temp("first");
        let (bundled, target) = (root.join("bundle"), root.join("data/mcp/server"));
        bundle(&bundled, "a");
        assert_eq!(
            install_server(&bundled, &target),
            Ok(InstallOutcome::Installed)
        );
        assert_eq!(
            std::fs::read_to_string(target.join(SERVER_ENTRY)).unwrap(),
            "// a"
        );
        assert_eq!(
            install_server(&bundled, &target),
            Ok(InstallOutcome::UpToDate)
        );
        assert!(!target.with_extension("staging").exists());
    }

    #[test]
    fn replaces_the_copy_when_the_bundled_build_differs() {
        let root = temp("update");
        let (bundled, target) = (root.join("bundle"), root.join("data/mcp/server"));
        bundle(&bundled, "a");
        install_server(&bundled, &target).unwrap();
        std::fs::write(target.join("stale.txt"), "old").unwrap();
        bundle(&bundled, "b");
        assert_eq!(
            install_server(&bundled, &target),
            Ok(InstallOutcome::Installed)
        );
        assert_eq!(
            std::fs::read_to_string(target.join(SERVER_ENTRY)).unwrap(),
            "// b"
        );
        // the old copy went as a whole
        assert!(!target.join("stale.txt").exists());
        assert!(!target.with_extension("old").exists());
    }

    #[test]
    fn a_copy_missing_a_file_is_copied_again() {
        let root = temp("repair");
        let (bundled, target) = (root.join("bundle"), root.join("data/mcp/server"));
        bundle(&bundled, "a");
        install_server(&bundled, &target).unwrap();
        std::fs::remove_file(target.join("dosik-headless.mjs")).unwrap();
        assert_eq!(
            install_server(&bundled, &target),
            Ok(InstallOutcome::Installed)
        );
        assert!(target.join("dosik-headless.mjs").exists());
    }

    #[test]
    fn a_build_without_a_server_installs_nothing() {
        let root = temp("none");
        let target = root.join("data/mcp/server");
        assert_eq!(
            install_server(&root.join("missing"), &target),
            Ok(InstallOutcome::NotBundled)
        );
        assert!(!target.exists());
    }

    #[test]
    fn installed_dir_is_mcp_server_under_app_data() {
        assert_eq!(
            installed_dir(Path::new("/data")),
            PathBuf::from("/data/mcp/server")
        );
    }
}
