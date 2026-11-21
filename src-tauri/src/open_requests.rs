//! Files the OS asks the app to open (#149).
//!
//! They arrive three ways: macOS `RunEvent::Opened` (`open -b`, Finder), the
//! command line of the first launch, and the command line of a refused second
//! launch (single-instance, Windows/Linux). All three land in one queue, and
//! the window drains it — a launch *with* a file delivers the path before the
//! webview has a listener, and an emitted path nobody hears is lost. The event
//! only says "there is something to take".
//!
//! A file inside a project of the library is a library diagram: it is handed
//! over by its id, and opens as one — autosaved, in the tree (#253).

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::library::AppLibrary;

/// what the frontend listens for (`OPEN_REQUESTS_EVENT` in `useOpenRequests.ts`)
pub const OPEN_REQUESTS_EVENT: &str = "open-requests";

#[derive(Default)]
pub struct OpenRequests(Mutex<Vec<String>>);

/// One file to open: its path, and its id when it is a library diagram.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct OpenRequest {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagram: Option<String>,
}

/// The queued files, each with the library diagram it is, if any. Off the
/// main thread: on a first launch the library may still be moving.
#[tauri::command(async)]
pub fn take_open_requests(
    state: State<'_, OpenRequests>,
    library: State<'_, Arc<AppLibrary>>,
) -> Vec<OpenRequest> {
    let paths = std::mem::take(&mut *state.0.lock().unwrap());
    requests(paths, |path| library.diagram_at(path))
}

/// `paths` as requests, `diagram_at` saying which are library diagrams.
fn requests(paths: Vec<String>, diagram_at: impl Fn(&Path) -> Option<String>) -> Vec<OpenRequest> {
    paths
        .into_iter()
        .map(|path| OpenRequest {
            diagram: diagram_at(Path::new(&path)),
            path,
        })
        .collect()
}

/// Queues paths and tells the window. An empty batch changes nothing.
pub fn request_open(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    app.state::<OpenRequests>().0.lock().unwrap().extend(paths);
    let _ = app.emit(OPEN_REQUESTS_EVENT, ());
}

/// whether a file is a diagram by its name: `.dosik`, or the older
/// `.dosik.json`, in any case
pub fn is_diagram_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".dosik") || lower.ends_with(".dosik.json")
}

/// The diagram paths in a command line, made absolute against `cwd`.
///
/// Only `.dosik` and `.dosik.json`: a launch carries flags and the
/// executable's own path, and a stray argument must not turn into an
/// "unreadable file" toast. The first element is the executable and is
/// skipped.
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
        .filter(|arg| is_diagram_file(&arg.to_string_lossy()))
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
    fn a_dosik_file_and_an_older_dosik_json_both_count_in_any_case() {
        for name in ["a.dosik", "A.DOSIK", "b.dosik.json", "B.Dosik.JSON"] {
            assert!(is_diagram_file(name), "{name}");
        }
        for name in ["a.json", "a.dosikx", "dosik", "a.dosik.bak", "notes.txt"] {
            assert!(!is_diagram_file(name), "{name}");
        }
        let at = |name: &str| {
            std::env::temp_dir()
                .join(name)
                .to_string_lossy()
                .into_owned()
        };
        let found = diagram_paths(
            vec![
                "dosik".to_string(),
                at("new.dosik"),
                at("old.DOSIK.JSON"),
                at("x.json"),
            ],
            Path::new("/"),
        );
        assert_eq!(found, vec![at("new.dosik"), at("old.DOSIK.JSON")]);
    }

    #[test]
    fn a_request_names_the_library_diagram_it_is() {
        let library = std::env::temp_dir().join("lib").join("Flow.dosik");
        let mine = std::env::temp_dir().join("mine.dosik");
        let paths = vec![
            library.to_string_lossy().into_owned(),
            mine.to_string_lossy().into_owned(),
        ];
        let found = requests(paths.clone(), |p| (p == library).then(|| "d1".to_string()));
        assert_eq!(
            found,
            vec![
                OpenRequest {
                    path: paths[0].clone(),
                    diagram: Some("d1".into()),
                },
                OpenRequest {
                    path: paths[1].clone(),
                    diagram: None,
                },
            ]
        );
        // sent as {path, diagram}, the id left out for a file outside the library
        assert_eq!(
            serde_json::to_value(&found).unwrap(),
            serde_json::json!([
                { "path": paths[0], "diagram": "d1" },
                { "path": paths[1] }
            ])
        );
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
