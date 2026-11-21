//! The library's commands: what the webview asks of the projects and
//! diagrams, by id — Rust owns where they are, so the webview never handles
//! paths.
//!
//! A project is a folder on disk — every folder directly in the default
//! location (`Dosik` in the user's Documents), and any other folder added to
//! the library — and a diagram is a `.dosik` file in it. The app's own record of ids,
//! orders and places sits in the app data (`library/state.json`). The older
//! library, folders and files named by id in `<app data>/projects`, is moved
//! into the default location once, before anything else is asked of it.

mod ctx;
mod disk;
mod folders;
mod legacy;
mod listing;
mod migrate;
mod names;
mod ops;
mod removal;
mod state;
mod walk;
mod watch;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use ctx::Library;
use listing::{shown_path, FolderMeta};
use ops::{ItemKind, Loaded, SaveOutcome};
use removal::{BoardFailure, FolderBoard, LocateOutcome, SystemTrash};
use state::BoardSpot;

/// what the window listens for (`LIBRARY_CHANGED_EVENT` in `useLibraryWatch.ts`)
pub const LIBRARY_CHANGED_EVENT: &str = "library-changed";

/// What changed outside the app: the diagrams whose files changed or went —
/// maybe none, when something new turned up. Either way the library is
/// worth listing again.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct LibraryChanged {
    pub changed: Vec<String>,
}

/// The library the app runs on — or why there is none — the move of the
/// older library, made once per run before anything else, and the watch on
/// its folders.
pub struct AppLibrary {
    library: Result<Library, String>,
    moved: OnceLock<Result<(), String>>,
    /// the stamp the app last read or wrote of each diagram, by id — what
    /// tells its own writes from someone else's
    seen: Mutex<HashMap<String, String>>,
    watcher: OnceLock<watch::Watcher>,
}

impl AppLibrary {
    fn new(library: Result<Library, String>) -> AppLibrary {
        AppLibrary {
            library,
            moved: OnceLock::new(),
            seen: Mutex::new(HashMap::new()),
            watcher: OnceLock::new(),
        }
    }

    fn seen(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.seen.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// the diagram `id` as the app just read or wrote it
    fn note_seen(&self, id: &str, stamp: &str) {
        self.seen().insert(id.to_string(), stamp.to_string());
    }

    /// What a batch of the watch's paths tells — `None`: nothing.
    fn sort_out(&self, paths: &[PathBuf]) -> Option<LibraryChanged> {
        let lib = self.ready().ok()?;
        let held = lib.lock();
        let st = lib.load_state(&held).ok()?;
        let changed = watch::sort_out(lib, &st, &mut self.seen(), paths)?;
        Some(LibraryChanged { changed })
    }

    /// The watch on what the record has now — the inbox made first, so a
    /// note the MCP server leaves is seen as it lands. Nothing before the
    /// watch has started.
    fn rewatch(&self) {
        let (Some(watcher), Ok(lib)) = (self.watcher.get(), self.ready()) else {
            return;
        };
        let _ = std::fs::create_dir_all(lib.inbox_dir());
        let roots = {
            let held = lib.lock();
            match lib.load_state(&held) {
                Ok(st) => watch::roots(lib, &st),
                Err(_) => return,
            }
        };
        watcher.watch(&roots);
    }

    /// The library, once the older one has been moved into it. A move that
    /// failed took back what it made; every command says so until the next
    /// run tries again — Home shows "Couldn't load your projects".
    fn ready(&self) -> Result<&Library, String> {
        let lib = self.library.as_ref().map_err(Clone::clone)?;
        self.moved
            .get_or_init(|| migrate::run(lib).map(|_| ()))
            .clone()?;
        Ok(lib)
    }
}

type Shelf<'a> = State<'a, Arc<AppLibrary>>;

/// Where the library is on this machine: the app data, the default
/// location (`DOSIK_LIBRARY_DIR`, or Documents), the home folder.
fn open(app: &AppHandle) -> Result<Library, String> {
    let paths = app.path();
    let data = paths.app_data_dir().map_err(|e| e.to_string())?;
    let home = paths.home_dir().ok();
    let documents = paths.document_dir().ok();
    let default = ctx::default_location(
        std::env::var_os("DOSIK_LIBRARY_DIR").as_deref(),
        tauri::is_dev(),
        documents.as_deref(),
        home.as_deref(),
    )?;
    Ok(Library::new(
        data.join("library"),
        default,
        data.join("projects"),
        home,
    ))
}

/// Puts the library in the app's hands; off the main thread — the window's
/// first questions wait for it, not the window — moves the older one and
/// starts watching the folders, telling the window what changed in them.
pub fn setup(app: &AppHandle) {
    let shelf = Arc::new(AppLibrary::new(open(app)));
    app.manage(Arc::clone(&shelf));
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = shelf.ready() {
            eprintln!("dosik: {error}");
            return;
        }
        let weak: Weak<AppLibrary> = Arc::downgrade(&shelf);
        let started = watch::Watcher::start(move |paths| {
            let Some(shelf) = weak.upgrade() else {
                return;
            };
            if let Some(changed) = shelf.sort_out(&paths) {
                let _ = app.emit(LIBRARY_CHANGED_EVENT, changed);
            }
        });
        match started {
            Ok(watcher) => {
                let _ = shelf.watcher.set(watcher);
                shelf.rewatch();
            }
            // the app works without it: changes outside show on the next listing
            Err(error) => eprintln!("dosik: {error}"),
        }
    });
}

/// runs `job` on the library off the main thread
async fn blocking<T: Send + 'static>(
    shelf: &Shelf<'_>,
    job: impl FnOnce(&AppLibrary, &Library) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let shelf = Arc::clone(shelf);
    tauri::async_runtime::spawn_blocking(move || job(&shelf, shelf.ready()?))
        .await
        .map_err(|error| format!("the library could not be reached: {error}"))?
}

/// Every project with its folders and diagrams, the record brought in line
/// with the disk on the way — off the main thread: it reads every diagram.
/// The watch follows: a project taken in or found again is watched from now.
#[tauri::command]
pub async fn list_library(shelf: Shelf<'_>) -> Result<Vec<FolderMeta>, String> {
    blocking(&shelf, |shelf, lib| {
        let listed = listing::list(lib)?;
        shelf.rewatch();
        Ok(listed)
    })
    .await
}

/// A new project in the default location — or, with `parent`, a folder
/// inside that project or folder.
#[tauri::command]
pub fn create_folder(
    shelf: Shelf<'_>,
    id: String,
    name: String,
    board: Option<BoardSpot>,
    parent: Option<String>,
) -> Result<(), String> {
    folders::create_folder(
        shelf.ready()?,
        &id,
        &name,
        board.as_ref(),
        parent.as_deref(),
    )?;
    // the first project may have made the default location
    shelf.rewatch();
    Ok(())
}

/// Resolves the projects that could not take their place (none: all did);
/// rejects only when the library itself cannot be reached. Off the main
/// thread: the Home canvas's first look places every project at once.
#[tauri::command]
pub async fn set_folder_boards(
    shelf: Shelf<'_>,
    boards: Vec<FolderBoard>,
) -> Result<Vec<BoardFailure>, String> {
    blocking(&shelf, move |_, lib| Ok(removal::save_boards(lib, &boards))).await
}

/// A project or folder renamed on disk — an added project's folder moves, and the watch with it.
#[tauri::command]
pub fn rename_folder(shelf: Shelf<'_>, id: String, name: String) -> Result<(), String> {
    folders::rename_folder(shelf.ready()?, &id, &name)?;
    shelf.rewatch();
    Ok(())
}

/// A project or folder to the Trash — a folder added to the library is
/// refused: it is removed from the library instead (`remove_project`).
#[tauri::command]
pub fn delete_folder(shelf: Shelf<'_>, id: String) -> Result<(), String> {
    removal::delete_folder(shelf.ready()?, &id, &SystemTrash)?;
    shelf.rewatch();
    Ok(())
}

/// A diagram into `folder`, to `index` in its order — the top if left out.
#[tauri::command]
pub fn move_project(
    shelf: Shelf<'_>,
    id: String,
    folder: String,
    index: Option<usize>,
) -> Result<(), String> {
    folders::move_diagram(shelf.ready()?, &id, &folder, index)
}

/// A folder (never a project) into `parent`, to `index` — the top if left out.
#[tauri::command]
pub fn move_folder(
    shelf: Shelf<'_>,
    id: String,
    parent: String,
    index: Option<usize>,
) -> Result<(), String> {
    folders::move_folder(shelf.ready()?, &id, &parent, index)
}

/// `item` (`folder:<id>`, `diagram:<id>`) to `index` among the items of
/// `parent` — the projects, for none.
#[tauri::command]
pub fn reorder_item(
    shelf: Shelf<'_>,
    parent: Option<String>,
    item: String,
    index: usize,
) -> Result<(), String> {
    folders::reorder(shelf.ready()?, parent.as_deref(), &item, index)
}

/// A diagram as it is on disk: what it holds, the name it shows (its
/// file's), and its stamp — what a save of it brings back as `base`.
#[tauri::command(async)]
pub fn load_project(shelf: Shelf<'_>, id: String) -> Result<Loaded, String> {
    let loaded = ops::load(shelf.ready()?, &id)?;
    shelf.note_seen(&id, &loaded.stamp);
    Ok(loaded)
}

/// Writes a diagram where it is — renamed after its title — or, new, into
/// `folder`. With `base`, the stamp its tab last saw, a file changed on disk
/// meanwhile is not written (`changedOnDisk`), nor one gone (`gone`).
///
/// Sync on purpose: Tauri runs it on the main thread, so a tab's saves land
/// in the order they were sent.
#[tauri::command]
pub fn save_project(
    shelf: Shelf<'_>,
    id: String,
    contents: String,
    folder: Option<String>,
    base: Option<String>,
) -> Result<SaveOutcome, String> {
    let outcome = ops::save(
        shelf.ready()?,
        &id,
        &contents,
        folder.as_deref(),
        base.as_deref(),
    )?;
    // the app's own write: the watch says nothing of it
    if let SaveOutcome::Saved { stamp, .. } = &outcome {
        shelf.note_seen(&id, stamp);
    }
    Ok(outcome)
}

/// A diagram to the Trash.
#[tauri::command]
pub fn delete_project(shelf: Shelf<'_>, id: String) -> Result<(), String> {
    removal::delete_diagram(shelf.ready()?, &id, &SystemTrash)
}

/// What Locate… came to.
#[derive(Serialize, Debug, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum LocateAnswer {
    /// the folder picked took the project's place
    Located,
    /// nothing was picked
    Cancelled,
    /// the folder picked is in the library already, or holds or is inside
    /// a project of it — not taken
    Already,
}

/// The nearest folder there on the way to where the project `id` was — where
/// the picker opens.
fn last_place(lib: &Library, id: &str) -> Result<Option<PathBuf>, String> {
    state::validate_id(id)?;
    let held = lib.lock();
    let st = lib.load_state(&held)?;
    let record = st
        .project(id)
        .ok_or_else(|| format!("no such project: {id:?}"))?;
    Ok(record
        .root()
        .ancestors()
        .find(|p| disk::is_real_dir(p))
        .map(Path::to_path_buf))
}

/// Locate…: the system's folder picker — opened from here, so no path ever
/// comes from the webview — and the folder picked takes the project's place.
#[tauri::command]
pub async fn locate_project(
    app: AppHandle,
    shelf: Shelf<'_>,
    id: String,
) -> Result<LocateAnswer, String> {
    use tauri_plugin_dialog::DialogExt;
    blocking(&shelf, move |shelf, lib| {
        let mut picker = app.dialog().file();
        if let Some(start) = last_place(lib, &id)? {
            picker = picker.set_directory(start);
        }
        let Some(picked) = picker.blocking_pick_folder() else {
            return Ok(LocateAnswer::Cancelled);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        let answer = match removal::locate_project_at(lib, &id, &path)? {
            LocateOutcome::Located => LocateAnswer::Located,
            LocateOutcome::Already => LocateAnswer::Already,
        };
        shelf.rewatch();
        Ok(answer)
    })
    .await
}

/// Remove from Library: the project's record goes, its folder stays.
#[tauri::command]
pub fn remove_project(shelf: Shelf<'_>, id: String) -> Result<(), String> {
    removal::remove_project(shelf.ready()?, &id)?;
    shelf.rewatch();
    Ok(())
}

/// Where an item is on disk: `path` whole, for copying and opening;
/// `shown` the same from `~` when it is under the home folder, for reading.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ItemPath {
    pub path: String,
    pub shown: String,
}

fn item_path_of(lib: &Library, path: &Path) -> ItemPath {
    ItemPath {
        shown: shown_path(path, lib.home.as_deref()),
        path: path.to_string_lossy().into_owned(),
    }
}

/// Where an item is on disk — the path card and Copy Path. Off the main
/// thread, as the card asks while the pointer rests.
#[tauri::command(async)]
pub fn library_path(shelf: Shelf<'_>, kind: ItemKind, id: String) -> Result<ItemPath, String> {
    let lib = shelf.ready()?;
    Ok(item_path_of(lib, &ops::item_path(lib, kind, &id)?))
}

/// Show in Finder: a folder opens in the file manager, a diagram's file is
/// shown selected in its folder. Opened from here, by id, so the webview
/// needs no right to open paths (`opener:default` stays as it is).
#[tauri::command(async)]
pub fn show_in_finder(
    app: AppHandle,
    shelf: Shelf<'_>,
    kind: ItemKind,
    id: String,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = ops::item_path(shelf.ready()?, kind, &id)?;
    match kind {
        ItemKind::Folder => app.opener().open_path(path.to_string_lossy(), None::<&str>),
        ItemKind::Diagram => app.opener().reveal_item_in_dir(&path),
    }
    .map_err(|e| e.to_string())
}

/// The default location, for Settings ▸ General, shown with `~`.
#[tauri::command]
pub fn library_root(shelf: Shelf<'_>) -> Result<ItemPath, String> {
    let lib = shelf.library.as_ref().map_err(Clone::clone)?;
    Ok(item_path_of(lib, &lib.default_location))
}

/// Settings ▸ General ▸ Show in Finder: the default location opens — made
/// first, when nothing has made it yet.
#[tauri::command(async)]
pub fn show_library_in_finder(app: AppHandle, shelf: Shelf<'_>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let lib = shelf.ready()?;
    let path = &lib.default_location;
    std::fs::create_dir_all(path).map_err(|e| format!("{}: {e}", path.display()))?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::ctx::tests::test_library;

    #[test]
    fn save_project_runs_on_the_main_thread() {
        // a tab's saves land in the order they were sent: Tauri runs a sync
        // command on the main thread, one at a time
        let source = include_str!("mod.rs");
        let at = source
            .find("pub fn save_project(")
            .expect("save_project, a plain fn");
        let attribute = &source[source[..at].rfind("#[tauri::command").unwrap()..at];
        assert!(!attribute.contains("async"), "{attribute}");
        assert!(!source.contains(concat!("async fn ", "save_project")));
    }

    #[test]
    fn the_older_library_is_moved_once_before_anything_is_asked() {
        let lib = test_library("mod-ready");
        std::fs::create_dir_all(lib.legacy_dir.join("pay")).unwrap();
        std::fs::write(
            lib.legacy_dir.join("pay/folder.json"),
            r#"{"name":"Payments","createdAt":1}"#,
        )
        .unwrap();
        let default = lib.default_location.clone();
        let legacy = lib.legacy_dir.clone();
        let shelf = AppLibrary::new(Ok(lib));
        let lib = shelf.ready().unwrap();
        assert!(default.join("Payments").is_dir());
        assert!(legacy.join(migrate::MARKER).exists());
        // asked again, it is not moved again
        std::fs::remove_dir_all(default.join("Payments")).unwrap();
        shelf.ready().unwrap();
        assert!(!default.join("Payments").exists());
        assert!(std::ptr::eq(lib, shelf.ready().unwrap()));
    }

    #[test]
    fn a_failed_move_is_told_by_every_command_of_the_run() {
        let lib = test_library("mod-failed");
        std::fs::create_dir_all(lib.legacy_dir.join("pay")).unwrap();
        // a file where the default location's parent would be: nothing can be made
        let parent = lib.default_location.parent().unwrap().to_path_buf();
        std::fs::create_dir_all(parent.parent().unwrap()).unwrap();
        std::fs::write(&parent, "in the way").unwrap();
        let shelf = AppLibrary::new(Ok(lib));
        let first = shelf.ready().err().expect("the move fails");
        assert!(first.contains("moving the older library failed"), "{first}");
        assert_eq!(shelf.ready().err(), Some(first));
    }

    #[test]
    fn no_library_is_told_too() {
        let shelf = AppLibrary::new(Err("no app data folder".into()));
        assert_eq!(shelf.ready().err().as_deref(), Some("no app data folder"));
    }

    #[test]
    fn what_the_app_reads_and_writes_is_not_told_as_a_change() {
        let lib = test_library("mod-seen");
        let file = lib.default_location.join("P").join("Flow.dosik");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, r#"{"title":"Flow","nodes":[],"edges":[]}"#).unwrap();
        let shelf = AppLibrary::new(Ok(lib));
        let listed = listing::list(shelf.ready().unwrap()).unwrap();
        let id = listed[0].diagrams[0].id.clone();
        // read by the app: as it is, nothing to tell
        let loaded = ops::load(shelf.ready().unwrap(), &id).unwrap();
        shelf.note_seen(&id, &loaded.stamp);
        assert_eq!(shelf.sort_out(std::slice::from_ref(&file)), None);
        // written by someone else: told, with the diagram's id
        std::fs::write(&file, r#"{"title":"Flow","nodes":[1],"edges":[]}"#).unwrap();
        assert_eq!(
            shelf.sort_out(std::slice::from_ref(&file)),
            Some(LibraryChanged {
                changed: vec![id.clone()]
            })
        );
        assert_eq!(
            serde_json::to_value(LibraryChanged { changed: vec![id] }).unwrap(),
            serde_json::json!({ "changed": [listed[0].diagrams[0].id] })
        );
    }

    #[test]
    fn locate_answers_in_lower_case() {
        assert_eq!(
            serde_json::to_value(LocateAnswer::Cancelled).unwrap(),
            serde_json::json!("cancelled")
        );
        assert_eq!(
            serde_json::to_value(LocateAnswer::Already).unwrap(),
            serde_json::json!("already")
        );
    }

    #[test]
    fn the_picker_opens_where_the_project_was_or_nearest_to_it() {
        let lib = test_library("mod-last-place");
        std::fs::create_dir_all(lib.default_location.join("P")).unwrap();
        let listed = listing::list(&lib).unwrap();
        let id = listed[0].id.clone();
        assert_eq!(
            last_place(&lib, &id).unwrap(),
            Some(lib.default_location.join("P"))
        );
        std::fs::remove_dir(lib.default_location.join("P")).unwrap();
        assert_eq!(
            last_place(&lib, &id).unwrap(),
            Some(lib.default_location.clone())
        );
        assert!(last_place(&lib, "nope").is_err());
        assert!(last_place(&lib, "../x").is_err());
    }
}
