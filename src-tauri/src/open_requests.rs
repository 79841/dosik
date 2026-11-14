//! Files the OS asks the app to open (#149).
//!
//! They arrive three ways: macOS `RunEvent::Opened` (`open -b`, Finder), the
//! command line of the first launch, and the command line of a refused second
//! launch (single-instance, Windows/Linux). All three land in one queue, and
//! the window drains it — a launch *with* a file delivers the path before the
//! webview has a listener, and an emitted path nobody hears is lost. The event
//! only says "there is something to take".

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

/// what the frontend listens for (`OPEN_REQUESTS_EVENT` in `useOpenRequests.ts`)
pub const OPEN_REQUESTS_EVENT: &str = "open-requests";

#[derive(Default)]
pub struct OpenRequests(Mutex<Vec<String>>);

#[tauri::command]
pub fn take_open_requests(state: State<'_, OpenRequests>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// Queues paths and tells the window. An empty batch changes nothing.
pub fn request_open(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    app.state::<OpenRequests>().0.lock().unwrap().extend(paths);
    let _ = app.emit(OPEN_REQUESTS_EVENT, ());
}

/// The diagram paths in a command line, made absolute against `cwd`.
///
/// Only `.dosik.json`: a launch carries flags and the executable's own path,
/// and a stray argument must not turn into an "unreadable file" toast. The
/// first element is the executable and is skipped.
///
/// `OsString`, not `String`: `std::env::args()` panics on an argument that is
/// not UTF-8 — a legal Linux file name — and this runs in `setup`, where a
/// panic means the app never opens (#151). A path that is not UTF-8 is
/// passed on lossily; the webview can only name UTF-8 paths anyway.
pub fn diagram_paths<I, S>(args: I, cwd: &Path) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    args.into_iter()
        .skip(1)
        .map(Into::into)
        .filter(|arg| {
            arg.to_string_lossy()
                .to_lowercase()
                .ends_with(".dosik.json")
        })
        .map(|arg| {
            let path = PathBuf::from(arg);
            let absolute = if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            };
            absolute.to_string_lossy().into_owned()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn keeps_only_diagram_files_and_skips_the_executable() {
        // built from temp_dir so the path is absolute on every OS the CI runs
        let absolute = std::env::temp_dir()
            .join("a.dosik.json")
            .to_string_lossy()
            .into_owned();
        let notes = std::env::temp_dir()
            .join("notes.txt")
            .to_string_lossy()
            .into_owned();
        let found = diagram_paths(
            vec![
                "dosik".to_string(),
                "--flag".to_string(),
                absolute.clone(),
                notes,
            ],
            Path::new("/"),
        );
        assert_eq!(found, vec![absolute]);
    }

    #[test]
    fn relative_paths_resolve_against_the_launch_directory() {
        let found = diagram_paths(args(&["dosik", "plans/b.DOSIK.JSON"]), Path::new("/home/u"));
        assert_eq!(
            found,
            vec![Path::new("/home/u")
                .join("plans/b.DOSIK.JSON")
                .to_string_lossy()
                .into_owned()]
        );
    }

    #[test]
    fn an_executable_named_like_a_diagram_is_still_skipped() {
        assert!(diagram_paths(args(&["x.dosik.json"]), Path::new("/")).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn an_argument_that_is_not_utf8_does_not_panic() {
        use std::os::unix::ffi::OsStringExt;
        let odd = OsString::from_vec(b"/tmp/\xff.dosik.json".to_vec());
        let found = diagram_paths(vec![OsString::from("dosik"), odd], Path::new("/"));
        assert_eq!(found.len(), 1);
        assert!(found[0].ends_with(".dosik.json"));
    }
}
