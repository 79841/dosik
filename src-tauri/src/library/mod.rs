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
mod roots;
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
use roots::{AddOutcome, ChangeOutcome};
use state::BoardSpot;

/// what the window listens for (`LIBRARY_CHANGED_EVENT` in `useLibraryWatch.ts`)
pub const LIBRARY_CHANGED_EVENT: &str = "library-changed";

/// what the window listens for (`FILES_CHANGED_EVENT` in `useLibraryWatch.ts`)
pub const FILES_CHANGED_EVENT: &str = "files-changed";

/// What changed of the files open in tabs outside the library, by the paths
/// the window gave: written to, or gone.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct FilesChanged {
    pub changed: Vec<String>,
    pub removed: Vec<String>,
}

/// What changed outside the app: the diagrams whose files changed or went —
/// maybe none, when something new turned up. Either way the library is
/// worth listing again.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct LibraryChanged {
    pub changed: Vec<String>,
    /// what changed is not known — the watch lost events: every diagram
    /// open in a tab is worth reading again
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub rescan: bool,
}

/// The library the app runs on — or why there is none — the move of the
/// older library, made once per run before anything else, and the watch on
/// its folders.
pub struct AppLibrary {
    library: Result<Library, String>,
    /// set once the older library has been moved — or found moved already
    moved: OnceLock<()>,
    /// why the last move failed; held while a move is under way
    failed: Mutex<Option<String>>,
    /// the stamp the app last read or wrote of each diagram, by id — what
    /// tells its own writes from someone else's
    seen: Mutex<HashMap<String, String>>,
    /// the files open in tabs outside the library, as the file system has
    /// their paths — each with the path the window gave
    files: Mutex<HashMap<PathBuf, String>>,
    watcher: OnceLock<watch::Watcher>,
    /// how many diagrams the move of the older library could not read and
    /// left there, not told yet
    left_behind: Mutex<usize>,
}

impl AppLibrary {
    fn new(library: Result<Library, String>) -> AppLibrary {
        AppLibrary {
            library,
            moved: OnceLock::new(),
            failed: Mutex::new(None),
            seen: Mutex::new(HashMap::new()),
            files: Mutex::new(HashMap::new()),
            watcher: OnceLock::new(),
            left_behind: Mutex::new(0),
        }
    }

    fn left_behind(&self) -> std::sync::MutexGuard<'_, usize> {
        self.left_behind.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// how many diagrams the move left behind — told once
    fn take_left_behind(&self) -> usize {
        std::mem::take(&mut *self.left_behind())
    }

    fn files(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, String>> {
        self.files.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The files open in tabs outside the library are `paths` from now —
    /// each absolute one, by the path the file system has.
    fn set_files(&self, paths: Vec<String>) {
        *self.files() = paths
            .into_iter()
            .filter(|p| Path::new(p).is_absolute())
            .map(|p| (disk::normalized(Path::new(&p)), p))
            .collect();
    }

    /// What a batch of the watch's paths tells of the files open in tabs
    /// outside the library — `None`: nothing of theirs.
    fn files_changed(&self, paths: &[PathBuf]) -> Option<FilesChanged> {
        let files = self.files();
        if files.is_empty() {
            return None;
        }
        let mut changed = std::collections::BTreeSet::new();
        let mut removed = std::collections::BTreeSet::new();
        for path in paths {
            let Some(given) = files.get(&disk::normalized(path)) else {
                continue;
            };
            if disk::is_real_file(path) {
                changed.insert(given.clone());
            } else {
                removed.insert(given.clone());
            }
        }
        (!changed.is_empty() || !removed.is_empty()).then(|| FilesChanged {
            changed: changed.into_iter().collect(),
            removed: removed.into_iter().collect(),
        })
    }

    /// What to tell when the watch lost events: the library is worth listing
    /// again, and every file open outside it worth reading again — what
    /// changed is not known.
    fn missed(&self) -> (LibraryChanged, Option<FilesChanged>) {
        let files: std::collections::BTreeSet<String> = self.files().values().cloned().collect();
        let files = (!files.is_empty()).then(|| FilesChanged {
            changed: files.into_iter().collect(),
            removed: Vec::new(),
        });
        (
            LibraryChanged {
                changed: Vec::new(),
                rescan: true,
            },
            files,
        )
    }

    fn seen(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.seen.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// the diagram `id` as the app just read or wrote it
    fn note_seen(&self, id: &str, stamp: &str) {
        self.seen().insert(id.to_string(), stamp.to_string());
    }

    /// The library diagram the file at `path` is, if it is one (#253 D16) —
    /// what a file the OS hands over opens as. None while there is no
    /// library to look in.
    pub fn diagram_at(&self, path: &Path) -> Option<String> {
        let lib = self.ready().ok()?;
        ops::diagram_id_at(lib, path).unwrap_or_else(|error| {
            eprintln!("dosik: {error}");
            None
        })
    }

    /// What a batch of the watch's paths tells — `None`: nothing, or not
    /// yet: the older library is still being moved.
    fn sort_out(&self, paths: &[PathBuf]) -> Option<LibraryChanged> {
        let lib = self.settled()?;
        // the record as it is now; the files are read and the folders walked
        // without the lock, so the app's writes go on meanwhile
        let st = {
            let held = lib.lock();
            lib.load_state(&held).ok()?
        };
        // nor is `seen` held: a save notes its stamp in it from the main thread
        let before = self.seen().clone();
        let mut seen = before.clone();
        let changed = watch::sort_out(lib, &st, &mut seen, paths);
        let mut now = self.seen();
        for (id, stamp) in seen {
            // a stamp a save noted meanwhile is newer than what was read here
            if before.get(&id) != Some(&stamp) && now.get(&id) == before.get(&id) {
                now.insert(id, stamp);
            }
        }
        Some(LibraryChanged {
            changed: changed?,
            rescan: false,
        })
    }

    /// The watch on what the record has now — the inbox made first, so a
    /// note the MCP server leaves is seen as it lands — and on the files open
    /// in tabs outside the library. Nothing before the watch has started, and
    /// none of the library before the older one has moved: this never waits
    /// for the move — the run that moves it watches the library after.
    fn rewatch(&self) {
        let Some(watcher) = self.watcher.get() else {
            return;
        };
        let mut roots = std::collections::BTreeSet::new();
        if let Some(lib) = self.settled() {
            let _ = std::fs::create_dir_all(lib.inbox_dir());
            let held = lib.lock();
            if let Ok(st) = lib.load_state(&held) {
                roots = watch::roots(lib, &st);
            }
        }
        let files: Vec<PathBuf> = self.files().keys().cloned().collect();
        let more = watch::file_roots(&files, &roots);
        roots.extend(more);
        watcher.watch(&roots);
    }

    /// The library when the older one has been moved into it — `None` while
    /// that is under way, never tried, or failed. It never waits.
    fn settled(&self) -> Option<&Library> {
        self.moved.get()?;
        self.library.as_ref().ok()
    }

    /// The library, once the older one has been moved into it — moved first,
    /// when nothing has tried yet. A move that failed took back what it
    /// made; every command says so — Home shows "Couldn't load your
    /// projects" — until a listing tries again (`ready_trying_again`).
    fn ready(&self) -> Result<&Library, String> {
        self.ready_with(false)
    }

    /// `ready`, a move that failed before tried again — what a listing asks:
    /// what was in the way may be gone.
    fn ready_trying_again(&self) -> Result<&Library, String> {
        self.ready_with(true)
    }

    fn ready_with(&self, again: bool) -> Result<&Library, String> {
        let lib = self.library.as_ref().map_err(Clone::clone)?;
        if self.moved.get().is_some() {
            return Ok(lib);
        }
        let mut failed = self.failed.lock().unwrap_or_else(|e| e.into_inner());
        // moved while this waited for the one moving it
        if self.moved.get().is_some() {
            return Ok(lib);
        }
        if let (Some(why), false) = (failed.as_ref(), again) {
            return Err(why.clone());
        }
        match migrate::run(lib) {
            Ok(moved) => {
                *self.left_behind() += moved.unwrap_or(0);
                *failed = None;
                let _ = self.moved.set(());
                Ok(lib)
            }
            Err(why) => {
                *failed = Some(why.clone());
                Err(why)
            }
        }
    }
}

type Shelf<'a> = State<'a, Arc<AppLibrary>>;

/// Where the library is on this machine: its places in the app data — a
/// development run's apart from the real ones — the default location
/// (`DOSIK_LIBRARY_DIR`, the one chosen in Settings, or Documents), the home
/// folder.
fn open(app: &AppHandle) -> Result<Library, String> {
    let paths = app.path();
    let data = paths.app_data_dir().map_err(|e| e.to_string())?;
    let home = paths.home_dir().ok();
    let documents = paths.document_dir().ok();
    let dev = tauri::is_dev();
    let (record, older) = ctx::data_places(&data, dev);
    let chosen = ctx::chosen_location(&record);
    let default = ctx::default_location(
        std::env::var_os("DOSIK_LIBRARY_DIR").as_deref(),
        chosen.as_deref(),
        dev,
        documents.as_deref(),
        home.as_deref(),
    )?;
    let default = ctx::resolved_default_location(&default);
    Ok(Library::new(record, default, older, home))
}

/// Puts the library in the app's hands; off the main thread — the window's
/// first questions wait for it, not the window — moves the older one and
/// starts watching the folders, telling the window what changed in them.
pub fn setup(app: &AppHandle) {
    let shelf = Arc::new(AppLibrary::new(open(app)));
    app.manage(Arc::clone(&shelf));
    let app = app.clone();
    std::thread::spawn(move || {
        let weak: Weak<AppLibrary> = Arc::downgrade(&shelf);
        let started = watch::Watcher::start(move |batch| {
            let Some(shelf) = weak.upgrade() else {
                return;
            };
            let paths = match batch {
                watch::Batch::Paths(paths) => paths,
                watch::Batch::Missed => {
                    // what changed is not known: the window looks at it all
                    let (changed, files) = shelf.missed();
                    if let Some(files) = files {
                        let _ = app.emit(FILES_CHANGED_EVENT, files);
                    }
                    let _ = app.emit(LIBRARY_CHANGED_EVENT, changed);
                    return;
                }
            };
            if let Some(files) = shelf.files_changed(&paths) {
                let _ = app.emit(FILES_CHANGED_EVENT, files);
            }
            if let Some(changed) = shelf.sort_out(&paths) {
                let _ = app.emit(LIBRARY_CHANGED_EVENT, changed);
            }
        });
        match started {
            Ok(watcher) => {
                let _ = shelf.watcher.set(watcher);
            }
            // the app works without it: changes outside show on the next listing
            Err(error) => eprintln!("dosik: {error}"),
        }
        if let Err(error) = shelf.ready() {
            eprintln!("dosik: {error}");
        }
        // moved now: the library is watched from here
        shelf.rewatch();
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
/// A move of the older library that failed is tried again first. The watch
/// follows: a project taken in or found again is watched from now.
#[tauri::command]
pub async fn list_library(shelf: Shelf<'_>) -> Result<Vec<FolderMeta>, String> {
    let shelf = Arc::clone(&shelf);
    tauri::async_runtime::spawn_blocking(move || {
        let listed = listing::list(shelf.ready_trying_again()?)?;
        shelf.rewatch();
        Ok(listed)
    })
    .await
    .map_err(|error| format!("the library could not be reached: {error}"))?
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

/// How many files a project or folder holds besides the diagrams the listing
/// shows — what its delete takes to the Trash along. Off the main thread: it
/// walks everything in it.
#[tauri::command]
pub async fn count_other_files(shelf: Shelf<'_>, id: String) -> Result<usize, String> {
    blocking(&shelf, move |_, lib| removal::other_files(lib, &id)).await
}

/// A diagram into `folder`, to `index` in its order — the top if left out.
/// Off the main thread: across volumes it is copied.
#[tauri::command(async)]
pub fn move_project(
    shelf: Shelf<'_>,
    id: String,
    folder: String,
    index: Option<usize>,
) -> Result<(), String> {
    folders::move_diagram(shelf.ready()?, &id, &folder, index)
}

/// A folder (never a project) into `parent`, to `index` — the top if left
/// out. Off the main thread: across volumes all of it is copied.
#[tauri::command(async)]
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

/// Writes a diagram where it is — renamed after its title — or, with
/// `create`, makes a new one in `folder`. In place, with `base`, the stamp
/// its tab last saw, a file changed on disk meanwhile is not written
/// (`changedOnDisk`), nor one gone (`gone`), nor one out of reach
/// (`unreachable`); one the library does not have is gone — never made.
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
    create: Option<bool>,
) -> Result<SaveOutcome, String> {
    let lib = shelf.ready()?;
    let outcome = if create == Some(true) {
        ops::create(lib, &id, &contents, folder.as_deref())?
    } else {
        ops::save(lib, &id, &contents, base.as_deref())?
    };
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

/// What Add folder… came to.
#[derive(Serialize, Debug, PartialEq, Eq, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AddFolderAnswer {
    /// the folder picked is a project now, on top
    Added { id: String },
    /// it is in the library already, or inside or holding a project of it
    Already,
    /// it is too broad to be a project
    Invalid,
    /// nothing was picked
    Cancelled,
}

/// Add folder…: the system's folder picker — opened from here, so no path
/// ever comes from the webview — and the folder picked joins the library as
/// one project, on top, watched from now.
#[tauri::command]
pub async fn add_library_folder(
    app: AppHandle,
    shelf: Shelf<'_>,
) -> Result<AddFolderAnswer, String> {
    use tauri_plugin_dialog::DialogExt;
    blocking(&shelf, move |shelf, lib| {
        let Some(picked) = app.dialog().file().blocking_pick_folder() else {
            return Ok(AddFolderAnswer::Cancelled);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        let answer = match roots::add_folder_at(lib, &path)? {
            AddOutcome::Added { id } => AddFolderAnswer::Added { id },
            AddOutcome::Already => AddFolderAnswer::Already,
            AddOutcome::Invalid => AddFolderAnswer::Invalid,
        };
        shelf.rewatch();
        Ok(answer)
    })
    .await
}

/// What Change… came to.
#[derive(Serialize, Debug, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum ChangeAnswer {
    /// new projects go to the folder picked from now
    Changed,
    /// nothing was picked
    Cancelled,
    /// the folder picked is a project or inside one, or too broad
    Invalid,
}

/// Settings ▸ General ▸ Change…: the system's folder picker, opened where
/// the default location is, and the folder picked becomes it — the record
/// says so (the MCP server reads it there), every project stays, and the
/// watch follows.
#[tauri::command]
pub async fn change_default_location(
    app: AppHandle,
    shelf: Shelf<'_>,
) -> Result<ChangeAnswer, String> {
    use tauri_plugin_dialog::DialogExt;
    blocking(&shelf, move |shelf, lib| {
        let mut picker = app.dialog().file();
        let now = lib.default_location();
        if disk::is_real_dir(&now) {
            picker = picker.set_directory(now);
        }
        let Some(picked) = picker.blocking_pick_folder() else {
            return Ok(ChangeAnswer::Cancelled);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        let answer = match roots::set_default_location_at(lib, &path)? {
            ChangeOutcome::Changed => ChangeAnswer::Changed,
            ChangeOutcome::Invalid => ChangeAnswer::Invalid,
        };
        shelf.rewatch();
        Ok(answer)
    })
    .await
}

/// The files open in tabs outside the library (Open file…), watched from
/// now, so a change made to one elsewhere reaches its tab (`files-changed`).
/// Off the main thread: the window asks at once, the watch may be busy.
#[tauri::command(async)]
pub fn watch_files(shelf: Shelf<'_>, paths: Vec<String>) {
    shelf.set_files(paths);
    shelf.rewatch();
}

/// The library diagram the file at `path` is, if it is one (#253 D16): what
/// Open file… opens a file the user picked as. Asked of only — nothing is
/// written at `path`. Off the main thread: it may wait for the move.
#[tauri::command(async)]
pub fn library_diagram_at(shelf: Shelf<'_>, path: String) -> Option<String> {
    let path = Path::new(&path);
    path.is_absolute().then(|| shelf.diagram_at(path)).flatten()
}

/// Remove from Library: the project's record goes, its folder stays.
#[tauri::command]
pub fn remove_project(shelf: Shelf<'_>, id: String) -> Result<(), String> {
    removal::remove_project(shelf.ready()?, &id)?;
    shelf.rewatch();
    Ok(())
}

/// How many diagrams the move of the older library could not read and left
/// in it — told once, after the move: waits for it.
#[tauri::command]
pub async fn take_left_behind(shelf: Shelf<'_>) -> Result<usize, String> {
    blocking(&shelf, |shelf, _| Ok(shelf.take_left_behind())).await
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

/// The default location, for Settings ▸ General, shown with `~` — the one
/// chosen there last.
#[tauri::command]
pub fn library_root(shelf: Shelf<'_>) -> Result<ItemPath, String> {
    let lib = shelf.library.as_ref().map_err(Clone::clone)?;
    Ok(item_path_of(lib, &lib.default_location()))
}

/// Settings ▸ General ▸ Show in Finder: the default location opens — made
/// first, when nothing has made it yet and no project of it is lost.
#[tauri::command(async)]
pub fn show_library_in_finder(app: AppHandle, shelf: Shelf<'_>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let lib = shelf.ready()?;
    {
        let held = lib.lock();
        let st = lib.load_state(&held)?;
        ops::ensure_default_location(lib, &st)?;
    }
    let path = &lib.default_location();
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
        let attribute = command_attribute("save_project");
        assert!(!attribute.contains("async"), "{attribute}");
        let source = include_str!("mod.rs");
        assert!(!source.contains(concat!("async fn ", "save_project")));
    }

    /// the `#[tauri::command…]` line of the command `name`
    fn command_attribute(name: &str) -> String {
        let source = include_str!("mod.rs");
        let at = source
            .find(&format!("pub fn {name}("))
            .unwrap_or_else(|| panic!("{name}, a plain fn"));
        source[source[..at].rfind("#[tauri::command").unwrap()..at].to_string()
    }

    #[test]
    fn a_move_runs_off_the_main_thread() {
        // across volumes it copies everything in it: the window must not wait
        for name in ["move_project", "move_folder"] {
            assert!(command_attribute(name).contains("async"), "{name}");
        }
    }

    #[test]
    fn watch_files_runs_off_the_main_thread() {
        // the window asks it at once, while the older library may be moving
        assert!(command_attribute("watch_files").contains("async"));
    }

    #[test]
    fn the_watch_never_waits_for_the_move() {
        let lib = test_library("mod-rewatch");
        std::fs::create_dir_all(lib.legacy_dir.join("pay")).unwrap();
        std::fs::write(
            lib.legacy_dir.join("pay/folder.json"),
            r#"{"name":"Payments","createdAt":1}"#,
        )
        .unwrap();
        let default = lib.default_location();
        let shelf = AppLibrary::new(Ok(lib));
        let _ = shelf.watcher.set(watch::Watcher::start(|_| {}).unwrap());
        // the files open in tabs are watched, the move neither run nor waited for
        let file = default.parent().unwrap().join("a.dosik");
        std::fs::create_dir_all(default.parent().unwrap()).unwrap();
        std::fs::write(&file, "{}").unwrap();
        shelf.set_files(vec![file.to_string_lossy().into_owned()]);
        shelf.rewatch();
        assert!(!default.exists(), "the move did not run for the watch");
        assert_eq!(shelf.sort_out(&[default.join("Payments")]), None);
        assert!(!default.exists());
        // once it has moved, the library is watched too
        shelf.ready().unwrap();
        shelf.rewatch();
        let watched = shelf.watcher.get().unwrap().watched();
        assert!(watched.iter().any(|r| r.path == default), "{watched:?}");
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
        let default = lib.default_location();
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
        let parent = lib.default_location().parent().unwrap().to_path_buf();
        std::fs::create_dir_all(parent.parent().unwrap()).unwrap();
        std::fs::write(&parent, "in the way").unwrap();
        let shelf = AppLibrary::new(Ok(lib));
        let first = shelf.ready().err().expect("the move fails");
        assert!(first.contains("moving the older library failed"), "{first}");
        assert_eq!(shelf.ready().err(), Some(first));
    }

    #[test]
    fn how_many_diagrams_the_move_left_behind_is_told_once() {
        let shelf = AppLibrary::new(Err("no library".into()));
        assert_eq!(shelf.take_left_behind(), 0);
        *shelf.left_behind() += 3;
        assert_eq!(shelf.take_left_behind(), 3);
        assert_eq!(shelf.take_left_behind(), 0);
    }

    #[test]
    fn a_failed_move_is_tried_again_by_the_next_listing() {
        let lib = test_library("mod-again");
        std::fs::create_dir_all(lib.legacy_dir.join("pay")).unwrap();
        std::fs::write(
            lib.legacy_dir.join("pay/folder.json"),
            r#"{"name":"Payments","createdAt":1}"#,
        )
        .unwrap();
        let default = lib.default_location();
        let parent = default.parent().unwrap().to_path_buf();
        std::fs::create_dir_all(parent.parent().unwrap()).unwrap();
        std::fs::write(&parent, "in the way").unwrap();
        let shelf = AppLibrary::new(Ok(lib));
        let first = shelf.ready().err().expect("the move fails");
        // what was in the way is gone; a command does not try again, a listing does
        std::fs::remove_file(&parent).unwrap();
        assert_eq!(shelf.ready().err(), Some(first));
        shelf.ready_trying_again().unwrap();
        assert!(default.join("Payments").is_dir());
        shelf.ready().unwrap();
    }

    #[test]
    fn no_library_is_told_too() {
        let shelf = AppLibrary::new(Err("no app data folder".into()));
        assert_eq!(shelf.ready().err().as_deref(), Some("no app data folder"));
    }

    #[test]
    fn what_the_app_reads_and_writes_is_not_told_as_a_change() {
        let lib = test_library("mod-seen");
        let file = lib.default_location().join("P").join("Flow.dosik");
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
                changed: vec![id.clone()],
                rescan: false,
            })
        );
        assert_eq!(
            serde_json::to_value(LibraryChanged {
                changed: vec![id],
                rescan: false
            })
            .unwrap(),
            serde_json::json!({ "changed": [listed[0].diagrams[0].id] })
        );
    }

    #[test]
    fn a_batch_of_the_watch_is_sorted_out_without_the_lock() {
        let lib = test_library("mod-sort-unlocked");
        let file = lib.default_location().join("P").join("Flow.dosik");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, r#"{"title":"Flow","nodes":[],"edges":[]}"#).unwrap();
        let shelf = AppLibrary::new(Ok(lib));
        listing::list(shelf.ready().unwrap()).unwrap();
        std::fs::write(&file, r#"{"title":"Flow","nodes":[1],"edges":[]}"#).unwrap();
        assert!(shelf.sort_out(std::slice::from_ref(&file)).is_some());
        // it reads files and walks folders: the app's writes go on meanwhile
        assert_eq!(
            watch::LOCKED_WHILE_SORTING.with(std::cell::Cell::get),
            Some(false)
        );
    }

    #[test]
    fn a_file_open_outside_the_library_is_told_by_the_path_the_window_gave() {
        let lib = test_library("mod-files");
        let dir = lib.default_location().parent().unwrap().join("Mine");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.dosik.json");
        std::fs::write(&file, "{}").unwrap();
        let shelf = AppLibrary::new(Ok(lib));
        assert_eq!(shelf.files_changed(std::slice::from_ref(&file)), None);
        let given = file.to_string_lossy().into_owned();
        shelf.set_files(vec![given.clone(), "relative.dosik".into()]);
        assert_eq!(shelf.files().len(), 1);
        let other = dir.join("b.dosik");
        assert_eq!(
            shelf.files_changed(&[file.clone(), other]),
            Some(FilesChanged {
                changed: vec![given.clone()],
                removed: vec![],
            })
        );
        std::fs::remove_file(&file).unwrap();
        assert_eq!(
            shelf.files_changed(std::slice::from_ref(&file)),
            Some(FilesChanged {
                changed: vec![],
                removed: vec![given],
            })
        );
        shelf.set_files(Vec::new());
        assert_eq!(shelf.files_changed(&[file]), None);
    }

    #[test]
    fn events_the_watch_lost_tell_the_window_to_look_at_everything_again() {
        let lib = test_library("mod-missed");
        let dir = lib.default_location().parent().unwrap().join("Mine");
        std::fs::create_dir_all(&dir).unwrap();
        let shelf = AppLibrary::new(Ok(lib));
        // the library listed again, and every diagram open in a tab read again
        let told = shelf.missed().0;
        assert!(told.rescan && told.changed.is_empty());
        assert_eq!(
            serde_json::to_value(&told).unwrap(),
            serde_json::json!({ "changed": [], "rescan": true })
        );
        assert_eq!(shelf.missed().1, None);
        // and every file open outside it read again
        let file = dir.join("a.dosik").to_string_lossy().into_owned();
        shelf.set_files(vec![file.clone()]);
        assert_eq!(
            shelf.missed().1,
            Some(FilesChanged {
                changed: vec![file],
                removed: vec![],
            })
        );
    }

    #[test]
    fn the_folder_pickers_wait_off_the_main_thread() {
        // a system picker blocks until it closes: on the main thread it
        // would freeze the window under it
        let source = include_str!("mod.rs");
        for name in [
            "add_library_folder",
            "change_default_location",
            "locate_project",
        ] {
            assert!(
                source.contains(&format!("pub async fn {name}(")),
                "{name} is async"
            );
        }
    }

    #[test]
    fn add_folder_and_change_answer_as_the_window_reads_them() {
        assert_eq!(
            serde_json::to_value(AddFolderAnswer::Added { id: "p1".into() }).unwrap(),
            serde_json::json!({ "kind": "added", "id": "p1" })
        );
        for (answer, kind) in [
            (AddFolderAnswer::Already, "already"),
            (AddFolderAnswer::Invalid, "invalid"),
            (AddFolderAnswer::Cancelled, "cancelled"),
        ] {
            assert_eq!(
                serde_json::to_value(answer).unwrap(),
                serde_json::json!({ "kind": kind })
            );
        }
        for (answer, word) in [
            (ChangeAnswer::Changed, "changed"),
            (ChangeAnswer::Cancelled, "cancelled"),
            (ChangeAnswer::Invalid, "invalid"),
        ] {
            assert_eq!(
                serde_json::to_value(answer).unwrap(),
                serde_json::json!(word)
            );
        }
    }

    #[test]
    fn a_changed_default_location_is_watched_and_outlasts_the_run() {
        let lib = test_library("mod-change");
        let old = lib.default_location();
        std::fs::create_dir_all(old.join("P")).unwrap();
        let next = old.parent().unwrap().join("Elsewhere");
        std::fs::create_dir_all(next.join("Q")).unwrap();
        let data = lib.data_dir.clone();
        let shelf = AppLibrary::new(Ok(lib));
        listing::list(shelf.ready().unwrap()).unwrap();
        assert_eq!(
            roots::set_default_location_at(shelf.ready().unwrap(), &next).unwrap(),
            ChangeOutcome::Changed
        );
        let lib = shelf.ready().unwrap();
        let held = lib.lock();
        let st = lib.load_state(&held).unwrap();
        drop(held);
        let watched = watch::roots(lib, &st);
        assert!(watched.contains(&watch::Root {
            path: ctx::resolved_default_location(&next),
            recursive: true
        }));
        assert!(watched.contains(&watch::Root {
            path: old.join("P"),
            recursive: true
        }));
        // the next run starts where it was chosen
        let chosen = ctx::chosen_location(&data);
        assert_eq!(
            ctx::default_location(None, chosen.as_deref(), false, None, None).unwrap(),
            next
        );
    }

    #[test]
    fn a_run_told_where_by_the_environment_leaves_no_choice_behind() {
        let base = crate::library::disk::tests::scratch("mod-env-run");
        let data = base.join("appdata").join("library");
        let docs = base.join("home").join("Docs");
        let run = |default: PathBuf| {
            Library::new(
                data.clone(),
                default,
                base.join("appdata").join("projects"),
                Some(base.join("home")),
            )
        };
        let next_start = || {
            let chosen = ctx::chosen_location(&data);
            ctx::default_location(None, chosen.as_deref(), false, Some(&docs), None).unwrap()
        };
        // a run told where by DOSIK_LIBRARY_DIR writes it down as the
        // location in use, for the MCP server…
        let told = base.join("Told");
        std::fs::create_dir_all(told.join("T")).unwrap();
        let lib = run(told.clone());
        listing::list(&lib).unwrap();
        assert_eq!(
            state::load(&data).unwrap().default_location.as_deref(),
            told.to_str()
        );
        // …but the next run without it goes back to Documents
        assert_eq!(next_start(), docs.join("Dosik"));
        // unless that run picked it in Settings: then it was chosen
        assert_eq!(
            roots::set_default_location_at(&lib, &told).unwrap(),
            ChangeOutcome::Changed
        );
        assert_eq!(next_start(), told);
        // one chosen in Settings outlasts a later run told elsewhere
        let lib = run(docs.join("Dosik"));
        let chosen = base.join("Dropbox");
        std::fs::create_dir_all(&chosen).unwrap();
        assert_eq!(
            roots::set_default_location_at(&lib, &chosen).unwrap(),
            ChangeOutcome::Changed
        );
        listing::list(&run(told.clone())).unwrap();
        assert_eq!(next_start(), chosen);
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
        std::fs::create_dir_all(lib.default_location().join("P")).unwrap();
        let listed = listing::list(&lib).unwrap();
        let id = listed[0].id.clone();
        assert_eq!(
            last_place(&lib, &id).unwrap(),
            Some(lib.default_location().join("P"))
        );
        std::fs::remove_dir(lib.default_location().join("P")).unwrap();
        assert_eq!(last_place(&lib, &id).unwrap(), Some(lib.default_location()));
        assert!(last_place(&lib, "nope").is_err());
        assert!(last_place(&lib, "../x").is_err());
    }
}
