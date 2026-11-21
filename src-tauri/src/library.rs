//! The library: projects (folders) of diagrams under the app data directory,
//! owned by Rust so the frontend never handles paths.
//!
//! ```text
//! projects/                          <- the library
//!   <folderId>/folder.json           <- {"name", "createdAt", "board"?} — a project the user sees
//!   <folderId>/<id>.dosik.json       <- a diagram
//!   <folderId>/<subId>/folder.json   <- {"name", "createdAt"} — a folder in it (#229)
//!   <folderId>/<subId>/…             <- folders and diagrams, down to MAX_DEPTH
//! ```
//!
//! Naming: the UI calls a folder a *project* and a file a *diagram* (#161).
//! Code that predates that keeps `project` for the file — `projectId`,
//! `ProjectMeta`, `save_project` — and the folder is `folder` everywhere.
//!
//! - No index file — membership is where the file sits. A second source of
//!   truth would drift from the files.
//! - Diagram ids are unique across the whole library and survive a move, so
//!   callers address a diagram by id alone; the folder is looked up.
//! - Writes go to a temp file and are renamed into place, so a crash mid-write
//!   never leaves a half-written file behind.
//! - Ids are validated before touching the file system (path traversal).
//!   Folder ids are unique across the library too, so a folder is found by
//!   walking: a path is never made out of what a caller sent, beyond one
//!   checked id on top of a folder that was found (#229 D7).
//! - Folders nest at most `MAX_DEPTH` deep, and symbolic links are never
//!   followed — neither a cycle nor a write outside the library (#229 D7).
//! - Order (#230 D1): a folder's items are in the order its `folder.json`
//!   `order` names them (`folder:<id>`, `diagram:<id>`); the projects' order
//!   is the library's own `projects/folder.json`, which holds nothing else and
//!   is no project and no diagram. What an order misses goes on top, newest
//!   first; a new item is put first; an order is always written whole.
//! - `folder.json` is read, changed and written back under one lock — a
//!   rename keeps the frame's place on the Home canvas (`board`, #221 D7) and
//!   any key a newer build wrote.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};

/// One diagram as the Home screen lists it.
#[derive(Serialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: String,
    pub title: String,
    /// last modification, milliseconds since the Unix epoch
    pub updated_at: u64,
    /// Whether the app can open it: a JSON object whose `nodes` and `edges`
    /// are arrays and with no `pages` key — a diagram is one canvas, and a
    /// document with pages (v2, never shipped) is listed only so it can be
    /// deleted (#229 D2). The same test as the frontend's `isDiagramDocShape`.
    pub readable: bool,
}

/// Where a project's frame sits on the Home canvas (#221 D7): its top-left
/// corner in board units, and whether its diagrams are folded into a stack —
/// `None` leaves that to the frame's size. Kept in the project's own
/// `folder.json`, so a deleted project takes its place with it.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct BoardSpot {
    pub x: i64,
    pub y: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collapsed: Option<bool>,
}

/// how far from the board's origin a frame may be placed, either way
pub const BOARD_LIMIT: i64 = 1_000_000;

impl BoardSpot {
    fn check(&self) -> Result<(), String> {
        // a range, not `abs`: `i64::MIN.abs()` overflows
        let range = -BOARD_LIMIT..=BOARD_LIMIT;
        if !range.contains(&self.x) || !range.contains(&self.y) {
            return Err(format!(
                "a place on the board is within {BOARD_LIMIT} of the origin"
            ));
        }
        Ok(())
    }

    /// Read from a `folder.json` someone may have edited by hand: a number
    /// that is not whole is rounded, a place out of range or of the wrong
    /// shape is no place, and a `collapsed` that is not a bool is left out.
    fn read(meta: &Value) -> Option<BoardSpot> {
        let board = meta.get("board")?.as_object()?;
        let coord = |key: &str| -> Option<i64> {
            let at = board.get(key)?.as_f64()?.round();
            (at.is_finite() && at.abs() <= BOARD_LIMIT as f64).then_some(at as i64)
        };
        Some(BoardSpot {
            x: coord("x")?,
            y: coord("y")?,
            collapsed: board.get("collapsed").and_then(Value::as_bool),
        })
    }
}

/// One project's new place, as `set_folder_boards` takes it.
#[derive(Deserialize, Debug, Clone)]
pub struct FolderBoard {
    pub id: String,
    pub board: BoardSpot,
}

/// A project `set_folder_boards` could not place, and why — as data, so the
/// frontend never reads ids back out of an error's text (#221).
#[derive(Serialize, Debug, PartialEq, Eq, Clone)]
pub struct BoardFailure {
    pub id: String,
    pub error: String,
}

/// One project (folder) — or a folder inside one (#229) — with its diagrams
/// and its folders, in the user's order (#230).
#[derive(Serialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FolderMeta {
    pub id: String,
    pub name: String,
    /// the newest edit of a diagram or folder in it, or when the folder was
    /// made if it is empty
    pub updated_at: u64,
    pub diagrams: Vec<ProjectMeta>,
    /// the folders in it, in its order — empty on a stray listing
    pub folders: Vec<FolderMeta>,
    /// its items, folders and diagrams mixed, in the order the user gave them
    /// (#230 D2, D5) — every item once; `folders` and `diagrams` follow it
    pub order: Vec<String>,
    /// a listing-only entry for diagrams that could not be moved into a
    /// folder — no folder on disk, so it takes no project actions
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub stray: bool,
    /// its frame's place on the Home canvas, once the canvas has placed it
    /// (#221 D7) — a project's alone: never on a folder inside one, nor on a
    /// stray listing, which has no folder to keep it in
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board: Option<BoardSpot>,
}

/// Title shown for a file that is in the folder but cannot be parsed. Listed
/// rather than hidden — hidden, there would be no way to delete it.
pub const UNREADABLE_TITLE: &str = "(unreadable)";
const DEFAULT_TITLE: &str = "Untitled Diagram";
/// where diagrams go when nothing else says — the library's first project
pub const DEFAULT_FOLDER_ID: &str = "my-diagrams";
pub const DEFAULT_FOLDER_NAME: &str = "My Diagrams";
/// a folder whose `folder.json` is missing or broken still lists, by this name
const UNNAMED_PROJECT: &str = "Untitled Project";
/// a folder inside a project whose `folder.json` names nothing (#229)
const UNNAMED_SUBFOLDER: &str = "Untitled Folder";
pub const MAX_FOLDER_NAME: usize = 80;
/// How deep folders nest — a project is level 1 (#229 D7). Windows' 260
/// character paths: the app data folder (~76) + 10 folders of 11 + a file
/// name and a temp suffix stays under it. Deeper directories made by hand are
/// not read.
pub const MAX_DEPTH: usize = 10;
const FOLDER_FILE: &str = "folder.json";
const EXT: &str = ".dosik.json";
const TMP_EXT: &str = ".tmp";

fn tmp_suffix() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

fn validate_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 32
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok {
        Ok(())
    } else {
        Err(format!("invalid id: {id:?}"))
    }
}

/// what a folder at `depth` is called in a refusal — a project at the top (#229)
fn kind_at(depth: usize) -> &'static str {
    if depth <= 1 {
        "project"
    } else {
        "folder"
    }
}

fn clean_name(name: &str, kind: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(format!("a {kind} needs a name"));
    }
    if name.chars().count() > MAX_FOLDER_NAME {
        return Err(format!(
            "a {kind} name is at most {MAX_FOLDER_NAME} characters"
        ));
    }
    Ok(name.to_string())
}

fn ensure_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))
}

/// a real directory — a symbolic link to one is not (#229 D7)
fn is_real_dir(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|m| m.is_dir())
}

/// a real file — a symbolic link to one is not (#229 D7)
fn is_real_file(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|m| m.is_file())
}

/// A folder the walk found: its id (its directory's name), where it is, and
/// how deep — a project is 1.
struct FolderEntry {
    id: String,
    path: PathBuf,
    depth: usize,
}

/// `(id, path)` of every folder directly inside `dir`, by name — directories
/// only: `file_type` does not follow links, so a link is never one.
fn child_dirs(dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<(String, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let id = entry.file_name().to_str()?.to_string();
            validate_id(&id).ok()?;
            entry
                .file_type()
                .is_ok_and(|t| t.is_dir())
                .then(|| (id, entry.path()))
        })
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Every folder in the library at any depth, depth first and by name, no
/// deeper than `MAX_DEPTH`. Iterative: a deep library costs no stack.
fn walk_folders(dir: &Path) -> Vec<FolderEntry> {
    let mut stack: Vec<FolderEntry> = child_dirs(dir)
        .into_iter()
        .rev()
        .map(|(id, path)| FolderEntry { id, path, depth: 1 })
        .collect();
    let mut out = Vec::new();
    while let Some(entry) = stack.pop() {
        if entry.depth < MAX_DEPTH {
            for (id, path) in child_dirs(&entry.path).into_iter().rev() {
                stack.push(FolderEntry {
                    id,
                    path,
                    depth: entry.depth + 1,
                });
            }
        }
        out.push(entry);
    }
    out
}

/// The folder `id` at any depth — a project or a folder inside one.
fn locate_folder(dir: &Path, id: &str) -> Result<FolderEntry, String> {
    validate_id(id)?;
    walk_folders(dir)
        .into_iter()
        .find(|f| f.id == id)
        .ok_or_else(|| format!("no such folder: {id:?}"))
}

/// The project `id` — a top-level folder only: what holds a board (#221 D7).
fn existing_project(dir: &Path, id: &str) -> Result<PathBuf, String> {
    validate_id(id)?;
    let path = dir.join(id);
    if is_real_dir(&path) {
        return Ok(path);
    }
    if locate_folder(dir, id).is_ok() {
        return Err("not a project".into());
    }
    Err(format!("no such project: {id:?}"))
}

/// Writes atomically: temp file next to the target, then rename.
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("no parent folder")?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("bad file name")?;
    // unique per write: two writers for the same file (autosave and an
    // explicit Save, or two app instances) must never share a temp file
    let tmp = parent.join(format!("{name}.{}{TMP_EXT}", tmp_suffix()));
    let written = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(contents.as_bytes())?;
        // the rename must not land before the bytes do — otherwise a power
        // cut can leave a renamed, empty file behind
        file.sync_all()
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("{}: {e}", tmp.display()));
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{}: {e}", path.display())
    })
}

/// Whether a parsed file is a one-canvas diagram: an object whose `nodes`
/// and `edges` are arrays, with no `pages` key at all — whatever it holds, a
/// `pages` key makes a multi-page document, which no longer opens (#229 D2).
fn is_one_canvas(doc: &serde_json::Value) -> bool {
    let Some(doc) = doc.as_object() else {
        return false;
    };
    let has = |key: &str| doc.get(key).is_some_and(|v| v.is_array());
    !doc.contains_key("pages") && has("nodes") && has("edges")
}

/// A diagram file's title and whether it can be opened, from one parse.
fn summary_of(contents: &str) -> (String, bool) {
    match serde_json::from_str::<serde_json::Value>(contents) {
        Ok(doc) => (
            doc.get("title")
                .and_then(|t| t.as_str())
                .filter(|t| !t.trim().is_empty())
                .unwrap_or(DEFAULT_TITLE)
                .to_string(),
            is_one_canvas(&doc),
        ),
        Err(_) => (UNREADABLE_TITLE.to_string(), false),
    }
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `(id, path)` of every diagram file directly inside `dir`
fn diagram_files(dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let id = name.to_str()?.strip_suffix(EXT)?.to_string();
            validate_id(&id).ok()?;
            // a link is no diagram of the library's (#229 D7)
            entry
                .file_type()
                .is_ok_and(|t| t.is_file())
                .then(|| (id, entry.path()))
        })
        .collect()
}

fn folder_meta(path: &Path) -> Option<Value> {
    std::fs::read_to_string(path.join(FOLDER_FILE))
        .ok()
        .and_then(|c| serde_json::from_str::<Value>(&c).ok())
}

/**
 * When the folder was made. Kept in `folder.json` rather than read off its
 * mtime: a rename rewrites the file, and an empty project would then jump to
 * the top of the list as if it had been edited (#161). A file without
 * one goes by its mtime.
 */
fn created_of(meta: Option<&Value>, path: &Path) -> u64 {
    meta.and_then(|v| v.get("createdAt").and_then(Value::as_u64))
        .unwrap_or_else(|| modified_ms(&path.join(FOLDER_FILE)))
}

fn folder_created(path: &Path) -> u64 {
    created_of(folder_meta(path).as_ref(), path)
}

/// A project's name, birth, board place and order — `folder.json` parsed once.
struct FolderInfo {
    name: String,
    created: u64,
    board: Option<BoardSpot>,
    /// its `order`, raw (#230 D2)
    order: Option<Value>,
    /// a folder.json that is an object with no `order` at all — what the
    /// first listing fixes (#230 D3)
    unordered: bool,
}

fn folder_info(path: &Path, depth: usize) -> FolderInfo {
    let meta = folder_meta(path);
    let unnamed = if depth <= 1 {
        UNNAMED_PROJECT
    } else {
        UNNAMED_SUBFOLDER
    };
    FolderInfo {
        name: meta
            .as_ref()
            .and_then(|v| v.get("name").and_then(Value::as_str))
            .filter(|n| !n.trim().is_empty())
            .unwrap_or(unnamed)
            .to_string(),
        created: created_of(meta.as_ref(), path),
        board: meta.as_ref().and_then(BoardSpot::read),
        order: meta.as_ref().and_then(|v| v.get("order")).cloned(),
        unordered: lacks_order(path, meta.as_ref(), depth),
    }
}

/// Whether the folder.json at `path` has no order to keep and may be given
/// one (#230 D3): an object without `order` — or, for the library itself
/// (`depth` 0), no file yet. One that is not an object is someone's.
fn lacks_order(path: &Path, meta: Option<&Value>, depth: usize) -> bool {
    match meta {
        Some(Value::Object(meta)) => !meta.contains_key("order"),
        Some(_) => false,
        None => depth == 0 && !path.join(FOLDER_FILE).exists(),
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Every read-change-write of a `folder.json` holds this: a rename and a
/// board save landing together must not drop each other's change (#221).
/// So does a project's removal — a board save runs off the main thread, and
/// one landing mid-removal would leave a new `folder.json` in a folder being
/// emptied: the removal failing, an empty project back (#221).
/// And so does every write that changes where folders and diagrams are: the
/// listing runs off the main thread and adopts the diagrams at the top of the
/// library, making My Diagrams for them — a save, delete or move of one of
/// those, or a first save making My Diagrams too, must not land in the middle
/// of it (#230).
static META_LOCK: Mutex<()> = Mutex::new(());

/// Counts the writes that change where folders and diagrams are — a folder
/// made, moved or removed, a diagram added, moved or deleted (#230). The listing runs off the main thread: when this moved while it
/// walked, what it saw may be torn, and it walks again.
static STRUCTURE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn structure() -> u64 {
    STRUCTURE.load(std::sync::atomic::Ordering::SeqCst)
}

/// A change to where folders and diagrams are, under way: it counts as it
/// begins and again as it ends — a seqlock (#230). It borrows
/// the `META_LOCK` guard it is made with, so the lock outlives it — a change
/// cannot go on once the lock is let go — changes never overlap, and an odd
/// count is one under way.
struct Restructure<'held> {
    _held: std::marker::PhantomData<&'held MutexGuard<'static, ()>>,
}

impl<'held> Restructure<'held> {
    fn begin(_held: &'held MutexGuard<'static, ()>) -> Self {
        STRUCTURE.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Restructure {
            _held: std::marker::PhantomData,
        }
    }
}

#[cfg(test)]
impl Restructure<'static> {
    /// a change a test keeps under way with no lock held — what a change that
    /// let the lock go early would be
    fn unguarded_for_tests() -> Self {
        STRUCTURE.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Restructure {
            _held: std::marker::PhantomData,
        }
    }
}

impl Drop for Restructure<'_> {
    fn drop(&mut self) {
        STRUCTURE.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Whether a walk between the counts `before` and `after` saw the library
/// whole: no change was under way as it began, none began meanwhile.
fn settled(before: u64, after: u64) -> bool {
    before.is_multiple_of(2) && before == after
}

/// how many times a listing walks before it gives what it last saw
const LIST_ATTEMPTS: usize = 3;

/// `META_LOCK`, held — a writer that panicked with it left nothing half-done
/// (writes are atomic), so its poison is ignored
fn meta_lock() -> MutexGuard<'static, ()> {
    META_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// What to do with a `folder.json` that is not a JSON object.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Broken {
    /// start over — a rename mends a project whose file was damaged
    Replace,
    /// leave it as it is and fail — a board is not worth the name it holds
    Refuse,
}

/// Reads `folder.json` (none is `{}`), lets `edit` change it and writes it
/// back atomically, every other key kept. A file without `createdAt` gets
/// its mtime as one first, so the write does not make an empty project look
/// new (#221 D7).
fn update_folder_meta(
    path: &Path,
    broken: Broken,
    edit: impl FnOnce(&mut Map<String, Value>),
) -> Result<(), String> {
    let _held = meta_lock();
    edit_folder_meta_locked(path, broken, true, edit)
}

/// `update_folder_meta` for a caller that holds `META_LOCK` already — a
/// move, which renames and writes an order under one hold (#230 D6).
/// `born`: give the file a `createdAt` if it has none — not the library's
/// own `folder.json`, which is no folder anyone made.
fn edit_folder_meta_locked(
    path: &Path,
    broken: Broken,
    born: bool,
    edit: impl FnOnce(&mut Map<String, Value>),
) -> Result<(), String> {
    // removed while this waited for the lock: gone, not a write into nowhere
    if !path.is_dir() {
        return Err(format!(
            "no such project: {:?}",
            path.file_name().unwrap_or_default()
        ));
    }
    let file = path.join(FOLDER_FILE);
    let mut meta = match std::fs::read_to_string(&file) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(meta)) => meta,
            _ if broken == Broken::Replace => Map::new(),
            _ => return Err(format!("{}: not a project file", file.display())),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Map::new(),
        Err(e) => return Err(format!("{}: {e}", file.display())),
    };
    if born && !meta.get("createdAt").is_some_and(Value::is_u64) {
        meta.insert("createdAt".into(), modified_ms(&file).into());
    }
    edit(&mut meta);
    write_atomic(&file, &Value::Object(meta).to_string())
}

fn board_value(board: &BoardSpot) -> Value {
    serde_json::to_value(board).unwrap_or(Value::Null)
}

/// A new project's `folder.json`: its name, its birth and, when it was made
/// on the canvas, its place there — `META_LOCK` held by the caller.
fn write_new_folder_meta_locked(
    path: &Path,
    name: &str,
    created_at: u64,
    board: Option<&BoardSpot>,
) -> Result<(), String> {
    let mut meta = Map::new();
    meta.insert("name".into(), name.into());
    meta.insert("createdAt".into(), created_at.into());
    if let Some(board) = board {
        meta.insert("board".into(), board_value(board));
    }
    write_atomic(&path.join(FOLDER_FILE), &Value::Object(meta).to_string())
}

/// Makes the default project if it is not there. Returns its path. Something
/// else under its name — a link, a file — is left alone and refused: a link
/// would carry the writes out of the library (#229). Under
/// `META_LOCK`: a first save and the listing may both want it (#230).
fn default_folder_locked(dir: &Path, held: &MutexGuard<'static, ()>) -> Result<PathBuf, String> {
    let path = dir.join(DEFAULT_FOLDER_ID);
    match std::fs::symlink_metadata(&path) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => {
            return Err(format!(
                "{}: not a folder — {DEFAULT_FOLDER_NAME} cannot be made",
                path.display()
            ))
        }
        Err(_) => {
            mid_write();
            let _change = Restructure::begin(held);
            std::fs::create_dir(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            write_new_folder_meta_locked(&path, DEFAULT_FOLDER_NAME, now_ms(), None)?;
            put_first_locked(dir, dir, 0, ItemKey::Folder(DEFAULT_FOLDER_ID.to_string()));
        }
    }
    Ok(path)
}

/// Diagrams saved before projects existed sit at the top of the library;
/// they move into the default project (#161). Safe to run on every listing.
/// The listing runs off the main thread: the moves happen under `META_LOCK`,
/// the diagrams looked up again under it — a save, delete or move of one of
/// them on the main thread goes first or after, never across (#230).
fn adopt_loose_diagrams(dir: &Path) -> Result<(), String> {
    if diagram_files(dir).is_empty() {
        return Ok(());
    }
    let held = meta_lock();
    let loose = diagram_files(dir);
    if loose.is_empty() {
        return Ok(());
    }
    let target = default_folder_locked(dir, &held)?;
    for (id, from) in loose {
        let to = target.join(format!("{id}{EXT}"));
        // a diagram that somehow exists in both places keeps the folder copy
        if to.exists() {
            continue;
        }
        // one file that will not move (locked by a sync tool, no permission)
        // must not hide the whole library — it stays put and the next listing
        // tries again (#161)
        let _change = Restructure::begin(&held);
        if let Err(e) = std::fs::rename(&from, &to) {
            eprintln!(
                "library: could not move {} into {DEFAULT_FOLDER_NAME}: {e}",
                from.display()
            );
        }
    }
    Ok(())
}

/// Where the diagram `id` is, if anywhere — in a folder at any depth, or
/// still at the top of the library when it could not be moved into one.
fn find(dir: &Path, id: &str) -> Result<Option<PathBuf>, String> {
    validate_id(id)?;
    let file = format!("{id}{EXT}");
    Ok(walk_folders(dir)
        .into_iter()
        .map(|folder| folder.path.join(&file))
        .chain(std::iter::once(dir.join(&file)))
        .find(|path| is_real_file(path)))
}

fn located(dir: &Path, id: &str) -> Result<PathBuf, String> {
    find(dir, id)?.ok_or_else(|| format!("no such diagram: {id:?}"))
}

/// What a path is asked of (#238): a folder (a project or one inside one) or a diagram.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Folder,
    Diagram,
}

/// Where an item is on disk (#238): `path` whole, for copying and opening;
/// `shown` the same from `~` when it is under the home folder, for reading.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ItemPath {
    pub path: String,
    pub shown: String,
}

/// The file or folder the library keeps `id` in — found the way every other
/// command finds it, so the webview never rebuilds the disk's layout: a folder
/// at any depth, a diagram in its folder or left at the library's top.
fn item_path(dir: &Path, kind: ItemKind, id: &str) -> Result<PathBuf, String> {
    match kind {
        ItemKind::Folder => Ok(locate_folder(dir, id)?.path),
        ItemKind::Diagram => located(dir, id),
    }
}

/// `path` from `~` when it is under `home` — by whole components, so
/// `/Users/a2` is not under `/Users/a`. On Windows the whole path, as File
/// Explorer shows it: `~` is no Windows idiom.
pub(crate) fn shown_path(path: &Path, home: Option<&Path>, windows: bool) -> String {
    if windows {
        return path.to_string_lossy().into_owned();
    }
    match home.and_then(|home| path.strip_prefix(home).ok()) {
        Some(rest) if rest.as_os_str().is_empty() => "~".to_string(),
        Some(rest) => format!("~/{}", rest.to_string_lossy()),
        None => path.to_string_lossy().into_owned(),
    }
}

/// The diagrams in `folder` that the listing shows: each id once, where `find` goes.
fn list_diagrams(folder: &Path, seen: &FirstSeen) -> Vec<ProjectMeta> {
    let mut out: Vec<ProjectMeta> = diagram_files(folder)
        .into_iter()
        .filter(|(id, path)| seen.diagrams.get(id) == Some(path))
        .map(|(id, path)| {
            let (title, readable) = std::fs::read_to_string(&path)
                .map(|c| summary_of(&c))
                .unwrap_or_else(|_| (UNREADABLE_TITLE.to_string(), false));
            ProjectMeta {
                id,
                title,
                updated_at: modified_ms(&path),
                readable,
            }
        })
        .collect();
    out.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    out
}

/// the newest of the folder's own diagrams and its folders — `None` when it holds nothing
fn newest_in(diagrams: &[ProjectMeta], folders: &[FolderMeta]) -> Option<u64> {
    diagrams
        .iter()
        .map(|d| d.updated_at)
        .chain(folders.iter().map(|f| f.updated_at))
        .max()
}

/// Where each folder id and each diagram id is found first — what every
/// lookup by id (`locate_folder`, `find`) lands on. A directory copied by
/// hand repeats ids — its own, and its diagrams' — and what repeats one is
/// not listed, so the app never shows one thing and opens, writes or deletes
/// another (#229).
struct FirstSeen {
    folders: std::collections::HashMap<String, PathBuf>,
    diagrams: std::collections::HashMap<String, PathBuf>,
}

fn first_seen(dir: &Path) -> FirstSeen {
    let mut seen = FirstSeen {
        folders: std::collections::HashMap::new(),
        diagrams: std::collections::HashMap::new(),
    };
    // the order `find` looks in: every folder, depth first, then the top
    for folder in walk_folders(dir) {
        for (id, file) in diagram_files(&folder.path) {
            seen.diagrams.entry(id).or_insert(file);
        }
        seen.folders.entry(folder.id).or_insert(folder.path);
    }
    for (id, file) in diagram_files(dir) {
        seen.diagrams.entry(id).or_insert(file);
    }
    seen
}

/// The folders directly inside `path` that the listing shows: each id once.
fn listed_children(path: &Path, seen: &FirstSeen) -> Vec<(String, PathBuf)> {
    child_dirs(path)
        .into_iter()
        .filter(|(id, sub)| seen.folders.get(id) == Some(sub))
        .collect()
}

/// An order the first listing writes down — the one it showed (#230 D3).
struct OrderFix {
    path: PathBuf,
    depth: usize,
    order: Vec<ItemKey>,
}

/// `folders` and `diagrams` in the places `order` gives them (#230 D5).
fn arrange(order: &[ItemKey], folders: &mut [FolderMeta], diagrams: &mut [ProjectMeta]) {
    let at: std::collections::HashMap<&ItemKey, usize> =
        order.iter().enumerate().map(|(i, k)| (k, i)).collect();
    let place_of = |k: ItemKey| at.get(&k).copied().unwrap_or(usize::MAX);
    folders.sort_by_key(|f| place_of(ItemKey::Folder(f.id.clone())));
    diagrams.sort_by_key(|d| place_of(ItemKey::Diagram(d.id.clone())));
}

/// One folder as the listing has it, everything under it included, down to
/// `MAX_DEPTH`, its items in its order (#230 D2). Only a project (`depth` 1)
/// carries its board. An order to write down goes into `fixes`.
fn list_folder(
    id: String,
    path: &Path,
    depth: usize,
    seen: &FirstSeen,
    fixes: &mut Vec<OrderFix>,
) -> FolderMeta {
    let mut diagrams = list_diagrams(path, seen);
    let info = folder_info(path, depth);
    let mut folders: Vec<FolderMeta> = if depth < MAX_DEPTH {
        listed_children(path, seen)
            .into_iter()
            .map(|(id, sub)| list_folder(id, &sub, depth + 1, seen, fixes))
            .collect()
    } else {
        Vec::new()
    };
    let items: Vec<(ItemKey, u64)> = folders
        .iter()
        .map(|f| (ItemKey::Folder(f.id.clone()), f.updated_at))
        .chain(
            diagrams
                .iter()
                .map(|d| (ItemKey::Diagram(d.id.clone()), d.updated_at)),
        )
        .collect();
    let order = resolve_order(info.order.as_ref(), &items);
    arrange(&order, &mut folders, &mut diagrams);
    if info.unordered && items.len() >= 2 {
        fixes.push(OrderFix {
            path: path.to_path_buf(),
            depth,
            order: order.clone(),
        });
    }
    FolderMeta {
        id,
        name: info.name,
        updated_at: newest_in(&diagrams, &folders).unwrap_or(info.created),
        diagrams,
        folders,
        order: order.iter().map(ToString::to_string).collect(),
        stray: false,
        board: if depth == 1 { info.board } else { None },
    }
}

#[cfg(test)]
thread_local! {
    /// what a test does in the middle of a listing — after it has looked up
    /// where everything is, before it walks (#230)
    static MID_LIST: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn mid_list() {
    let hook = MID_LIST.with(|hook| hook.borrow_mut().take());
    if let Some(hook) = hook {
        hook();
    }
}

#[cfg(not(test))]
fn mid_list() {}

#[cfg(test)]
thread_local! {
    /// what a test does in the middle of a write to a diagram file — after
    /// it found where the file is, before it touches it (#230)
    static MID_WRITE: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn mid_write() {
    let hook = MID_WRITE.with(|hook| hook.borrow_mut().take());
    if let Some(hook) = hook {
        hook();
    }
}

#[cfg(not(test))]
fn mid_write() {}

/// Every project with its diagrams and folders, in the user's order (#230):
/// the projects in the library's, the stray listing last. The first listing
/// of a library an older build left writes down the order it shows (D3).
pub fn list(dir: &Path) -> Result<Vec<FolderMeta>, String> {
    ensure_dir(dir)?;
    // best effort: projects already in folders must show even when the move
    // cannot happen at all (no room, `my-diagrams` taken by a file) — #161
    if let Err(e) = adopt_loose_diagrams(dir) {
        eprintln!("library: could not adopt older diagrams: {e}");
    }
    // a folder moved while the walk was under way would be missing from it,
    // all it holds with it: walk again, a few times at most (#230)
    // — when a change was under way as it began, or one began meanwhile
    let mut attempt = 1;
    let (out, fixes) = loop {
        let before = structure();
        let walked = list_once(dir);
        if settled(before, structure()) || attempt == LIST_ATTEMPTS {
            break walked;
        }
        attempt += 1;
    };
    for fix in fixes {
        // best effort: a library that cannot be written still lists (#230 D3)
        if let Err(e) = fix_order(&fix) {
            eprintln!(
                "library: could not write down the order of {}: {e}",
                fix.path.display()
            );
        }
    }
    Ok(out)
}

/// One walk of the library: what `list` shows, and the orders it would write
/// down (#230 D3) — torn when a move lands meanwhile, which `list` sees.
fn list_once(dir: &Path) -> (Vec<FolderMeta>, Vec<OrderFix>) {
    let seen = first_seen(dir);
    mid_list();
    let mut fixes = Vec::new();
    let mut out: Vec<FolderMeta> = listed_children(dir, &seen)
        .into_iter()
        .map(|(id, path)| list_folder(id, &path, 1, &seen, &mut fixes))
        .collect();
    let projects: Vec<(ItemKey, u64)> = out
        .iter()
        .map(|f| (ItemKey::Folder(f.id.clone()), f.updated_at))
        .collect();
    let root = folder_meta(dir);
    let order = resolve_order(root.as_ref().and_then(|m| m.get("order")), &projects);
    arrange(&order, &mut out, &mut []);
    if lacks_order(dir, root.as_ref(), 0) && projects.len() >= 2 {
        fixes.push(OrderFix {
            path: dir.to_path_buf(),
            depth: 0,
            order,
        });
    }
    // diagrams that could not be moved are still listed — under the default
    // project, where they were headed — so they can be opened, moved or
    // deleted; hidden, nothing could (the `(unreadable)` rule, #114)
    let stuck = list_diagrams(dir, &seen);
    if !stuck.is_empty() {
        match out.iter_mut().find(|f| f.id == DEFAULT_FOLDER_ID) {
            Some(default) => {
                // items of My Diagrams like its own: in its order, or on top
                // when it misses them — and moved among them (#230)
                default.diagrams.extend(stuck);
                let items: Vec<(ItemKey, u64)> = default
                    .folders
                    .iter()
                    .map(|f| (ItemKey::Folder(f.id.clone()), f.updated_at))
                    .chain(
                        default
                            .diagrams
                            .iter()
                            .map(|d| (ItemKey::Diagram(d.id.clone()), d.updated_at)),
                    )
                    .collect();
                let stored = folder_meta(&dir.join(DEFAULT_FOLDER_ID));
                let order = resolve_order(stored.as_ref().and_then(|m| m.get("order")), &items);
                arrange(&order, &mut default.folders, &mut default.diagrams);
                default.order = order.iter().map(ToString::to_string).collect();
                default.updated_at =
                    newest_in(&default.diagrams, &default.folders).unwrap_or(default.updated_at);
            }
            None => out.push(FolderMeta {
                id: DEFAULT_FOLDER_ID.to_string(),
                name: DEFAULT_FOLDER_NAME.to_string(),
                updated_at: stuck[0].updated_at,
                order: stuck
                    .iter()
                    .map(|d| ItemKey::Diagram(d.id.clone()).to_string())
                    .collect(),
                diagrams: stuck,
                folders: Vec::new(),
                stray: true,
                board: None,
            }),
        }
    }
    (out, fixes)
}

/// How new a folder is, everything under it counted — the listing's
/// `updatedAt`, from file times alone.
fn newest_under(path: &Path, depth: usize) -> u64 {
    let diagrams = diagram_files(path)
        .iter()
        .map(|(_, file)| modified_ms(file))
        .max();
    let folders = if depth < MAX_DEPTH {
        child_dirs(path)
            .iter()
            .map(|(_, sub)| newest_under(sub, depth + 1))
            .max()
    } else {
        None
    };
    diagrams
        .into_iter()
        .chain(folders)
        .max()
        .unwrap_or_else(|| folder_created(path))
}

/// The most recently edited project — by everything under it, the rule the
/// listing orders projects by (#229 D9) — read from file times alone: no
/// diagram is opened, unlike a full listing (#161).
fn latest_folder(dir: &Path) -> Option<PathBuf> {
    child_dirs(dir)
        .into_iter()
        .map(|(_, path)| (newest_under(&path, 1), path))
        // ties go to the lower id, the order `list()` shows them in — the same
        // save must not land in a different project from run to run
        .max_by(|(a, pa), (b, pb)| a.cmp(b).then_with(|| pb.file_name().cmp(&pa.file_name())))
        .map(|(_, path)| path)
}

/// A new project — and, made on the Home canvas, its place there (#221 D15).
#[cfg(test)]
pub fn make_folder(
    dir: &Path,
    id: &str,
    name: &str,
    board: Option<&BoardSpot>,
) -> Result<(), String> {
    make_folder_in(dir, id, name, board, None)
}

/// A new folder: a project, or inside the folder `parent` at any depth
/// (#229 D9). Its id is unique across the library; a folder at `MAX_DEPTH`
/// takes none; only a project takes a board.
pub fn make_folder_in(
    dir: &Path,
    id: &str,
    name: &str,
    board: Option<&BoardSpot>,
    parent: Option<&str>,
) -> Result<(), String> {
    validate_id(id)?;
    let name = clean_name(
        name,
        if parent.is_some() {
            "folder"
        } else {
            "project"
        },
    )?;
    if let Some(board) = board {
        board.check()?;
    }
    let (base, base_depth) = match parent {
        None => (dir.to_path_buf(), 0),
        Some(parent) => {
            if board.is_some() {
                return Err("a folder inside a project has no place on the canvas".into());
            }
            let parent = locate_folder(dir, parent)?;
            if parent.depth >= MAX_DEPTH {
                return Err(format!("folders nest at most {MAX_DEPTH} levels deep"));
            }
            (parent.path, parent.depth)
        }
    };
    let path = base.join(id);
    // where folders are changes under the hold (#230)
    let held = meta_lock();
    if std::fs::symlink_metadata(&path).is_ok() || walk_folders(dir).iter().any(|f| f.id == id) {
        return Err(format!("a folder with id {id:?} already exists"));
    }
    // the library itself may be new; the folder is made on its own, never its
    // parents: a parent deleted meanwhile, or the same id made at the same
    // moment, is an error rather than a folder brought back (#229)
    ensure_dir(dir)?;
    {
        let _change = Restructure::begin(&held);
        std::fs::create_dir(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        write_new_folder_meta_locked(&path, &name, now_ms(), board)?;
    }
    put_first_locked(dir, &base, base_depth, ItemKey::Folder(id.to_string()));
    Ok(())
}

/// Renames a project or a folder at any depth; every other key of its
/// `folder.json` stays (#221 D7, #229 D7 — #230 keeps the order there).
pub fn retitle_folder(dir: &Path, id: &str, name: &str) -> Result<(), String> {
    let folder = locate_folder(dir, id)?;
    let name = clean_name(name, kind_at(folder.depth))?;
    let path = folder.path;
    update_folder_meta(&path, Broken::Replace, |meta| {
        meta.insert("name".into(), name.into());
    })
}

/// Puts each project's frame where the Home canvas says (#221 D7, D9). One
/// project that cannot take its place — a bad id or value, a folder that is
/// gone, a `folder.json` that is not a project file — fails alone: the rest
/// are written, and what comes back is every one that was not, with why.
pub fn save_boards(dir: &Path, boards: &[FolderBoard]) -> Vec<BoardFailure> {
    boards
        .iter()
        .filter_map(|item| {
            item.board
                .check()
                .and_then(|()| existing_project(dir, &item.id))
                .and_then(|path| {
                    update_folder_meta(&path, Broken::Refuse, |meta| {
                        meta.insert("board".into(), board_value(&item.board));
                    })
                })
                .err()
                .map(|error| BoardFailure {
                    id: item.id.clone(),
                    error,
                })
        })
        .collect()
}

/// Deletes the project or folder and everything in it — never under a
/// `folder.json` write (`META_LOCK`). `remove_dir_all` does not follow links.
pub fn remove_folder(dir: &Path, id: &str) -> Result<(), String> {
    let path = locate_folder(dir, id)?.path;
    let held = meta_lock();
    let _change = Restructure::begin(&held);
    std::fs::remove_dir_all(&path).map_err(|e| format!("{}: {e}", path.display()))
}

pub fn load(dir: &Path, id: &str) -> Result<String, String> {
    let path = located(dir, id)?;
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Saves a diagram where it is, at any depth. A new one goes into `folder`
/// (any depth), or — when the caller does not say — the most recently edited
/// project, or the default one.
pub fn save(dir: &Path, id: &str, contents: &str, folder: Option<&str>) -> Result<(), String> {
    validate_id(id)?;
    ensure_dir(dir)?;
    // in a folder: only the main thread moves it, and this is the main thread
    // — `save_project` is a sync command, which Tauri runs on the main thread,
    // one after another with the moves and deletes (#230). Made
    // async, this branch needs the hold too: a move landing between the `find`
    // and the write would bring the file back where it was. A test keeps the
    // command sync (`save_project_runs_on_the_main_thread`).
    if let Some(path) = find(dir, id)? {
        if path.parent() != Some(dir) {
            return write_atomic(&path, contents);
        }
    }
    // at the top of the library, or new: the listing's adoption, off the main
    // thread, moves what is at the top and may make My Diagrams — so under
    // its hold, looked up again (#230)
    let held = meta_lock();
    if let Some(path) = find(dir, id)? {
        mid_write();
        return write_atomic(&path, contents);
    }
    let (target, depth) = match folder {
        Some(folder) => {
            let found = locate_folder(dir, folder)?;
            (found.path, found.depth)
        }
        None => match latest_folder(dir) {
            Some(recent) => (recent, 1),
            None => (default_folder_locked(dir, &held)?, 1),
        },
    };
    {
        let _change = Restructure::begin(&held);
        write_atomic(&target.join(format!("{id}{EXT}")), contents)?;
    }
    // a new diagram goes first in its folder (#230 D4)
    put_first_locked(dir, &target, depth, ItemKey::Diagram(id.to_string()));
    Ok(())
}

/// Deletes a diagram — under `META_LOCK`, looked up under it: the listing's
/// adoption may be moving it off the top of the library (#230).
pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    let held = meta_lock();
    let path = located(dir, id)?;
    mid_write();
    let _change = Restructure::begin(&held);
    std::fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Moves a diagram to another project or folder, at any depth, to its top.
/// Its id — and so every reference to it — stays the same.
#[cfg(test)]
pub fn move_to(dir: &Path, id: &str, folder: &str) -> Result<(), String> {
    move_to_at(dir, id, folder, None)
}

/// Moves a diagram into `folder`, at any depth, to `index` in its order —
/// the top when left out (#230 D4, D6). In the folder it is in already, an
/// index changes its place and none changes nothing. The order is written
/// after the rename under one hold of `META_LOCK`; an order that cannot be
/// written does not undo the move. The item is then one the folder's order
/// misses: on top, newest first among those (D2) — and in a folder whose
/// `folder.json` is no object, which has no order at all, the whole folder
/// goes newest first, the moved item by its last edit (#230).
/// A copy of it made by hand in `folder` is never written over.
pub fn move_to_at(dir: &Path, id: &str, folder: &str, index: Option<usize>) -> Result<(), String> {
    // looked up under the hold: the listing's adoption may be moving it off
    // the top of the library (#230)
    let held = meta_lock();
    let from = located(dir, id)?;
    mid_write();
    let target = locate_folder(dir, folder)?;
    let to = target.path.join(format!("{id}{EXT}"));
    let key = ItemKey::Diagram(id.to_string());
    if from == to {
        // in a folder already, which only the main thread changes
        drop(held);
        return match index {
            Some(index) => reorder(dir, Some(folder), &key.to_string(), index),
            None => Ok(()),
        };
    }
    // a copy made by hand under the same id: never written over (#230)
    if std::fs::symlink_metadata(&to).is_ok() {
        return Err(format!(
            "a diagram with id {id:?} already exists in {folder:?}"
        ));
    }
    {
        let _change = Restructure::begin(&held);
        std::fs::rename(&from, &to).map_err(|e| format!("{}: {e}", from.display()))?;
    }
    order_after_move(dir, &target, key, index);
    Ok(())
}

/// How many levels folder `path` (at `depth`) takes, itself included — no
/// deeper than the walk reads.
fn height_of(path: &Path, depth: usize) -> usize {
    if depth >= MAX_DEPTH {
        return 1;
    }
    1 + child_dirs(path)
        .iter()
        .map(|(_, sub)| height_of(sub, depth + 1))
        .max()
        .unwrap_or(0)
}

/// Moves folder `id` — never a project — with everything in it into folder
/// `parent`, at any depth, to `index` in its order: the top when left out
/// (#230 D6, D7). Never into itself or anything under it, never deeper than
/// `MAX_DEPTH` for anything in it. Its id stays.
pub fn move_folder_to(
    dir: &Path,
    id: &str,
    parent: &str,
    index: Option<usize>,
) -> Result<(), String> {
    let folder = locate_folder(dir, id)?;
    if folder.depth <= 1 {
        return Err("a project cannot be moved into a folder".into());
    }
    let target = locate_folder(dir, parent)?;
    if target.path.starts_with(&folder.path) {
        return Err("a folder cannot go inside itself".into());
    }
    let key = ItemKey::Folder(id.to_string());
    if folder.path.parent() == Some(target.path.as_path()) {
        return match index {
            Some(index) => reorder(dir, Some(parent), &key.to_string(), index),
            None => Ok(()),
        };
    }
    if target.depth + height_of(&folder.path, folder.depth) > MAX_DEPTH {
        return Err(format!("folders nest at most {MAX_DEPTH} levels deep"));
    }
    let to = target.path.join(id);
    let held = meta_lock();
    if std::fs::symlink_metadata(&to).is_ok() {
        return Err(format!("a folder with id {id:?} already exists"));
    }
    {
        let _change = Restructure::begin(&held);
        std::fs::rename(&folder.path, &to)
            .map_err(|e| format!("{}: {e}", folder.path.display()))?;
    }
    order_after_move(dir, &target, key, index);
    Ok(())
}

/// `key` into the order of the folder a move took it to — `META_LOCK` held.
/// Best effort: a `folder.json` that is no object is left as it is, and the
/// item lists by its last edit there (see `move_to_at`, #230).
fn order_after_move(dir: &Path, target: &FolderEntry, key: ItemKey, index: Option<usize>) {
    let placed = place_in_order_locked(dir, &target.path, target.depth, key, index.unwrap_or(0));
    if let Err(e) = placed {
        eprintln!(
            "library: moved, but could not write the order of {}: {e}",
            target.path.display()
        );
    }
}

/// Puts `item` at `index` among the items of folder `parent` — or of the
/// library (the projects) for `None` — where it is already (#230 D6).
pub fn reorder(dir: &Path, parent: Option<&str>, item: &str, index: usize) -> Result<(), String> {
    let key = ItemKey::parse(item)?;
    let (path, depth) = match parent {
        None => (dir.to_path_buf(), 0),
        Some(id) => {
            let found = locate_folder(dir, id)?;
            (found.path, found.depth)
        }
    };
    let _held = meta_lock();
    let items = items_in(dir, &path, depth);
    if !items.iter().any(|(k, _)| *k == key) {
        return Err(format!(
            "{item:?} is not in {:?}",
            parent.unwrap_or("the library")
        ));
    }
    write_placed_locked(&path, depth, &items, key, index)
}

/// An item of a folder, as its parent's order names it (#230 D1): a folder
/// or a diagram — the tree's own keys, `folder:<id>` and `diagram:<id>`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum ItemKey {
    Folder(String),
    Diagram(String),
}

impl ItemKey {
    /// a key as the frontend or an order sends it — its id checked before
    /// anything is looked up
    fn parse(key: &str) -> Result<ItemKey, String> {
        let bad = || format!("invalid item: {key:?}");
        let (kind, id) = key.split_once(':').ok_or_else(bad)?;
        validate_id(id).map_err(|_| bad())?;
        match kind {
            "folder" => Ok(ItemKey::Folder(id.to_string())),
            "diagram" => Ok(ItemKey::Diagram(id.to_string())),
            _ => Err(bad()),
        }
    }
}

impl std::fmt::Display for ItemKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ItemKey::Folder(id) => write!(f, "folder:{id}"),
            ItemKey::Diagram(id) => write!(f, "diagram:{id}"),
        }
    }
}

/// A folder's items in the order it shows them (#230 D2): what `stored`
/// names, each once and only if it is there, after what it misses — those
/// on top, newest first, ties to the lower key. No order (or one that is not
/// a list) is all on top: #229's newest-first.
fn resolve_order(stored: Option<&Value>, items: &[(ItemKey, u64)]) -> Vec<ItemKey> {
    let present: std::collections::HashSet<&ItemKey> = items.iter().map(|(k, _)| k).collect();
    let mut listed: Vec<ItemKey> = Vec::new();
    let mut taken = std::collections::HashSet::new();
    if let Some(Value::Array(entries)) = stored {
        for entry in entries {
            let Some(key) = entry.as_str().and_then(|s| ItemKey::parse(s).ok()) else {
                continue;
            };
            if present.contains(&key) && taken.insert(key.clone()) {
                listed.push(key);
            }
        }
    }
    let mut unlisted: Vec<&(ItemKey, u64)> =
        items.iter().filter(|(k, _)| !taken.contains(k)).collect();
    unlisted.sort_by(|(a, at), (b, bt)| bt.cmp(at).then_with(|| a.to_string().cmp(&b.to_string())));
    unlisted
        .into_iter()
        .map(|(k, _)| k.clone())
        .chain(listed)
        .collect()
}

/// `order` with `key` at `index` — out of where it was first; past the end is the end
fn place(mut order: Vec<ItemKey>, key: ItemKey, index: usize) -> Vec<ItemKey> {
    order.retain(|k| *k != key);
    let at = index.min(order.len());
    order.insert(at, key);
    order
}

/// The items directly in the folder at `path` (`depth` 0: the library, whose
/// items are its projects), each with how new it is — the very items the
/// listing shows (#230 D6): folders once per id, down to `MAX_DEPTH`, links
/// never.
fn items_in(dir: &Path, path: &Path, depth: usize) -> Vec<(ItemKey, u64)> {
    let seen = first_seen(dir);
    let folders = if depth < MAX_DEPTH {
        listed_children(path, &seen)
            .into_iter()
            .map(|(id, sub)| (ItemKey::Folder(id), newest_under(&sub, depth + 1)))
            .collect()
    } else {
        Vec::new()
    };
    let diagrams = if depth == 0 {
        Vec::new()
    } else {
        // each diagram id once, as the listing shows it (#229);
        // My Diagrams also holds the diagrams stuck at the top (#230)
        let stuck = if depth == 1 && path == dir.join(DEFAULT_FOLDER_ID) {
            diagram_files(dir)
        } else {
            Vec::new()
        };
        diagram_files(path)
            .into_iter()
            .chain(stuck)
            .filter(|(id, file)| seen.diagrams.get(id) == Some(file))
            .map(|(id, file)| (ItemKey::Diagram(id), modified_ms(&file)))
            .collect()
    };
    [folders, diagrams].concat()
}

/// Writes `order` into the folder.json at `path` — the library's own at
/// `depth` 0 — every other key kept; one that is not an object is refused.
/// `META_LOCK` held by the caller.
fn write_order_locked(path: &Path, depth: usize, order: &[ItemKey]) -> Result<(), String> {
    let list: Vec<Value> = order.iter().map(|k| Value::String(k.to_string())).collect();
    edit_folder_meta_locked(path, Broken::Refuse, depth > 0, |meta| {
        meta.insert("order".into(), Value::Array(list));
    })
}

/// `key` at `index` in the order of the folder at `path` as it shows now,
/// written whole (#230 D1). `META_LOCK` held by the caller.
fn place_in_order_locked(
    dir: &Path,
    path: &Path,
    depth: usize,
    key: ItemKey,
    index: usize,
) -> Result<(), String> {
    write_placed_locked(path, depth, &items_in(dir, path, depth), key, index)
}

/// The order of the folder at `path` — its `items` as it shows them — with
/// `key` at `index`, written whole. `META_LOCK` held by the caller.
fn write_placed_locked(
    path: &Path,
    depth: usize,
    items: &[(ItemKey, u64)],
    key: ItemKey,
    index: usize,
) -> Result<(), String> {
    let stored = folder_meta(path);
    let order = resolve_order(stored.as_ref().and_then(|m| m.get("order")), items);
    write_order_locked(path, depth, &place(order, key, index))
}

/// A new item first in its folder (#230 D4) — best effort: an item its
/// folder's order misses shows on top anyway (D2). `META_LOCK` held by the
/// caller, which made the item under the same hold.
fn put_first_locked(dir: &Path, path: &Path, depth: usize, key: ItemKey) {
    if let Err(e) = place_in_order_locked(dir, path, depth, key, 0) {
        eprintln!(
            "library: could not put a new item first in {}: {e}",
            path.display()
        );
    }
}

/// Writes down the order a listing showed, unless one turned up meanwhile
/// (#230 D3) — a folder needs its folder.json; the library may have none yet.
fn fix_order(fix: &OrderFix) -> Result<(), String> {
    let _held = meta_lock();
    if !lacks_order(&fix.path, folder_meta(&fix.path).as_ref(), fix.depth) {
        return Ok(());
    }
    write_order_locked(&fix.path, fix.depth, &fix.order)
}

fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("projects"))
}

/// Off the main thread (#230 D3): the listing reads every diagram, and the
/// first one after an older build writes an order down for each folder.
#[tauri::command]
pub async fn list_library(app: AppHandle) -> Result<Vec<FolderMeta>, String> {
    let dir = library_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || list(&dir))
        .await
        .map_err(|error| format!("listing the library failed: {error}"))?
}

/// A new project — or, with `parent`, a folder inside that folder (#229 D9).
#[tauri::command]
pub fn create_folder(
    app: AppHandle,
    id: String,
    name: String,
    board: Option<BoardSpot>,
    parent: Option<String>,
) -> Result<(), String> {
    make_folder_in(
        &library_dir(&app)?,
        &id,
        &name,
        board.as_ref(),
        parent.as_deref(),
    )
}

/// `save_boards` on a blocking thread: a synced write per project must hold
/// neither the main thread nor an async worker (#221).
async fn place_boards(dir: PathBuf, boards: Vec<FolderBoard>) -> Result<Vec<BoardFailure>, String> {
    tauri::async_runtime::spawn_blocking(move || save_boards(&dir, &boards))
        .await
        .map_err(|error| format!("placing projects on the canvas failed: {error}"))
}

/// Resolves the projects that could not take their place (none: all did);
/// rejects only when the library itself cannot be reached. Off the main
/// thread: the Home canvas's first look places every project at once, a
/// synced write each, and the window must not wait on them (#221).
/// The folder lock keeps it in order with a rename and a project's removal.
#[tauri::command]
pub async fn set_folder_boards(
    app: AppHandle,
    boards: Vec<FolderBoard>,
) -> Result<Vec<BoardFailure>, String> {
    place_boards(library_dir(&app)?, boards).await
}

#[tauri::command]
pub fn rename_folder(app: AppHandle, id: String, name: String) -> Result<(), String> {
    retitle_folder(&library_dir(&app)?, &id, &name)
}

#[tauri::command]
pub fn delete_folder(app: AppHandle, id: String) -> Result<(), String> {
    remove_folder(&library_dir(&app)?, &id)
}

/// A diagram into `folder`, to `index` in its order — the top if left out (#230 D6).
#[tauri::command]
pub fn move_project(
    app: AppHandle,
    id: String,
    folder: String,
    index: Option<usize>,
) -> Result<(), String> {
    move_to_at(&library_dir(&app)?, &id, &folder, index)
}

/// A folder (never a project) into `parent`, to `index` — the top if left out (#230 D6).
#[tauri::command]
pub fn move_folder(
    app: AppHandle,
    id: String,
    parent: String,
    index: Option<usize>,
) -> Result<(), String> {
    move_folder_to(&library_dir(&app)?, &id, &parent, index)
}

/// `item` (`folder:<id>`, `diagram:<id>`) to `index` among the items of
/// `parent` — the projects, for none (#230 D6).
#[tauri::command]
pub fn reorder_item(
    app: AppHandle,
    parent: Option<String>,
    item: String,
    index: usize,
) -> Result<(), String> {
    reorder(&library_dir(&app)?, parent.as_deref(), &item, index)
}

#[tauri::command]
pub fn load_project(app: AppHandle, id: String) -> Result<String, String> {
    load(&library_dir(&app)?, &id)
}

/// Sync on purpose: Tauri runs it on the main thread, in turn with the moves
/// and deletes — `save` writes a diagram in a folder without `META_LOCK` on
/// that alone. Made async, look at `save`'s lock-free branch again (#230).
#[tauri::command]
pub fn save_project(
    app: AppHandle,
    id: String,
    contents: String,
    folder: Option<String>,
) -> Result<(), String> {
    save(&library_dir(&app)?, &id, &contents, folder.as_deref())
}

#[tauri::command]
pub fn delete_project(app: AppHandle, id: String) -> Result<(), String> {
    delete(&library_dir(&app)?, &id)
}

/// Where an item is on disk (#238) — the path card and Copy Path. Off the
/// main thread: it walks the folders, and the card asks as the pointer rests.
#[tauri::command(async)]
pub fn library_path(app: AppHandle, kind: ItemKind, id: String) -> Result<ItemPath, String> {
    let path = item_path(&library_dir(&app)?, kind, &id)?;
    let home = app.path().home_dir().ok();
    Ok(ItemPath {
        shown: shown_path(&path, home.as_deref(), cfg!(windows)),
        path: path.to_string_lossy().into_owned(),
    })
}

/// Show in Finder (#238): a folder opens in the file manager, a diagram's
/// file is shown selected in its folder. Opened from here, by id, so the
/// webview needs no right to open paths (`opener:default` stays as it is).
/// Off the main thread like `library_path` — it walks the folders too; the
/// opener's own commands open and reveal from an async command the same way.
#[tauri::command(async)]
pub fn show_in_finder(app: AppHandle, kind: ItemKind, id: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = item_path(&library_dir(&app)?, kind, &id)?;
    match kind {
        ItemKind::Folder => app.opener().open_path(path.to_string_lossy(), None::<&str>),
        ItemKind::Diagram => app.opener().reveal_item_in_dir(&path),
    }
    .map_err(|e| e.to_string())
}

/// The library's own folder (`projects/`) for Settings ▸ General (#252),
/// shown with `~` like the path card.
#[tauri::command]
pub fn library_root(app: AppHandle) -> Result<ItemPath, String> {
    let path = library_dir(&app)?;
    let home = app.path().home_dir().ok();
    Ok(ItemPath {
        shown: shown_path(&path, home.as_deref(), cfg!(windows)),
        path: path.to_string_lossy().into_owned(),
    })
}

/// Settings ▸ General ▸ Show in Finder: the library folder opens (#252, the
/// same opening as a folder's Show in Finder, #238).
#[tauri::command(async)]
pub fn show_library_in_finder(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = library_dir(&app)?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    /// a fresh, empty directory per test (not created — `list` must create it)
    fn scratch() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("dosik-library-test-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn doc(title: &str) -> String {
        format!(r#"{{"version":1,"title":"{title}","nodes":[],"edges":[]}}"#)
    }

    /// pushes a file's mtime clearly into the future — mtime resolution is coarse
    fn touch_later(path: &Path, secs: u64) {
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(secs);
        // a write handle: Windows refuses set_modified on a read-only one
        std::fs::OpenOptions::new()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(later)
            .unwrap();
    }

    fn ids(folder: &FolderMeta) -> Vec<&str> {
        folder.diagrams.iter().map(|d| &d.id[..]).collect()
    }

    #[test]
    fn an_items_path_is_where_the_library_keeps_it() {
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        make_folder_in(&dir, "chk", "Checkout", None, Some("pay")).unwrap();
        save(&dir, "flow", &doc("Flow"), Some("chk")).unwrap();
        assert_eq!(
            item_path(&dir, ItemKind::Folder, "pay").unwrap(),
            dir.join("pay")
        );
        assert_eq!(
            item_path(&dir, ItemKind::Folder, "chk").unwrap(),
            dir.join("pay").join("chk")
        );
        assert_eq!(
            item_path(&dir, ItemKind::Diagram, "flow").unwrap(),
            dir.join("pay").join("chk").join("flow.dosik.json")
        );
        // a diagram the library could not move into a project stays at its top (the stray listing)
        std::fs::write(dir.join("loose.dosik.json"), doc("Loose")).unwrap();
        assert_eq!(
            item_path(&dir, ItemKind::Diagram, "loose").unwrap(),
            dir.join("loose.dosik.json")
        );
        // none such, a bad id, a folder asked for as a diagram and the other way round
        assert!(item_path(&dir, ItemKind::Folder, "nope").is_err());
        assert!(item_path(&dir, ItemKind::Diagram, "nope").is_err());
        assert!(item_path(&dir, ItemKind::Diagram, "../pay").is_err());
        assert!(item_path(&dir, ItemKind::Folder, "../pay").is_err());
        assert!(item_path(&dir, ItemKind::Diagram, "pay").is_err());
        assert!(item_path(&dir, ItemKind::Folder, "flow").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn an_items_path_never_follows_a_link() {
        // what `show_in_finder` opens: never a linked folder or file, in or out of the library
        use std::os::unix::fs::symlink;
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        let outside = scratch();
        std::fs::create_dir_all(outside.join("ext")).unwrap();
        std::fs::write(outside.join("ext").join(FOLDER_FILE), r#"{"name":"Ext"}"#).unwrap();
        std::fs::write(outside.join("far.dosik.json"), doc("Far")).unwrap();
        symlink(outside.join("ext"), dir.join("pay").join("ext")).unwrap();
        symlink(outside.join("ext"), dir.join("ext2")).unwrap();
        symlink(
            outside.join("far.dosik.json"),
            dir.join("pay").join("far.dosik.json"),
        )
        .unwrap();
        assert!(item_path(&dir, ItemKind::Folder, "ext").is_err());
        assert!(item_path(&dir, ItemKind::Folder, "ext2").is_err());
        assert!(item_path(&dir, ItemKind::Diagram, "far").is_err());
        assert_eq!(
            item_path(&dir, ItemKind::Folder, "pay").unwrap(),
            dir.join("pay")
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_path_under_the_home_folder_is_shown_from_a_tilde() {
        let home = Path::new("/Users/someone");
        assert_eq!(
            shown_path(
                Path::new("/Users/someone/Library/Application Support/x"),
                Some(home),
                false
            ),
            "~/Library/Application Support/x"
        );
        // outside it, or a name that only starts the same: as it is
        assert_eq!(
            shown_path(Path::new("/Volumes/data/x"), Some(home), false),
            "/Volumes/data/x"
        );
        assert_eq!(
            shown_path(Path::new("/Users/someone2/x"), Some(home), false),
            "/Users/someone2/x"
        );
        // the home folder itself, and no home folder known
        assert_eq!(
            shown_path(Path::new("/Users/someone"), Some(home), false),
            "~"
        );
        assert_eq!(
            shown_path(Path::new("/Users/someone/x"), None, false),
            "/Users/someone/x"
        );
    }

    #[test]
    fn a_path_on_windows_is_shown_whole_as_file_explorer_shows_it() {
        let path = Path::new(r"C:\Users\someone\AppData\Roaming\app.dosik.desktop\projects");
        assert_eq!(
            shown_path(path, Some(Path::new(r"C:\Users\someone")), true),
            r"C:\Users\someone\AppData\Roaming\app.dosik.desktop\projects"
        );
        // with no home folder known, the same
        assert_eq!(
            shown_path(path, None, true),
            r"C:\Users\someone\AppData\Roaming\app.dosik.desktop\projects"
        );
    }

    #[test]
    fn an_item_kind_is_folder_or_diagram_in_lower_case() {
        let kind: ItemKind = serde_json::from_str(r#""folder""#).unwrap();
        assert_eq!(kind, ItemKind::Folder);
        let kind: ItemKind = serde_json::from_str(r#""diagram""#).unwrap();
        assert_eq!(kind, ItemKind::Diagram);
        assert!(serde_json::from_str::<ItemKind>(r#""project""#).is_err());
        assert!(serde_json::from_str::<ItemKind>(r#""Folder""#).is_err());
    }

    #[test]
    fn an_empty_library_lists_nothing_and_is_created() {
        let dir = scratch();
        assert!(!dir.exists());
        assert_eq!(list(&dir).unwrap(), vec![]);
        assert!(dir.is_dir());
    }

    #[test]
    fn diagrams_from_before_projects_move_into_my_diagrams() {
        let dir = scratch();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.dosik.json"), doc("A")).unwrap();
        std::fs::write(dir.join("b.dosik.json"), doc("B")).unwrap();
        std::fs::write(dir.join("notes.txt"), "x").unwrap();

        let listed = list(&dir).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, DEFAULT_FOLDER_ID);
        assert_eq!(listed[0].name, DEFAULT_FOLDER_NAME);
        let mut moved = ids(&listed[0]);
        moved.sort();
        assert_eq!(moved, vec!["a", "b"]);
        assert!(!dir.join("a.dosik.json").exists());
        // a second listing changes nothing
        assert_eq!(list(&dir).unwrap(), listed);
        assert_eq!(load(&dir, "a").unwrap(), doc("A"));
    }

    #[cfg(unix)]
    #[test]
    fn a_diagram_that_will_not_move_does_not_hide_the_library() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch();
        // the default project exists but cannot take new files
        make_folder(&dir, DEFAULT_FOLDER_ID, DEFAULT_FOLDER_NAME, None).unwrap();
        save(&dir, "kept", &doc("Kept"), Some(DEFAULT_FOLDER_ID)).unwrap();
        std::fs::write(dir.join("stuck.dosik.json"), doc("Stuck")).unwrap();
        let target = dir.join(DEFAULT_FOLDER_ID);
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o555)).unwrap();

        let listed = list(&dir);
        let opened = load(&dir, "stuck");
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755)).unwrap();
        let listed = listed.unwrap();
        // not moved, but listed under the project it was headed for — and openable
        let mut shown = ids(&listed[0])
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>();
        shown.sort();
        assert_eq!(shown, vec!["kept", "stuck"]);
        assert!(
            dir.join("stuck.dosik.json").exists(),
            "left where it was, not lost"
        );
        assert_eq!(opened.unwrap(), doc("Stuck"));
        // with the folder writable again, the next listing moves it
        list(&dir).unwrap();
        assert!(!dir.join("stuck.dosik.json").exists());
    }

    #[test]
    fn a_default_project_that_cannot_be_made_does_not_hide_the_others() {
        let dir = scratch();
        make_folder(&dir, "work", "Work", None).unwrap();
        save(&dir, "w", &doc("W"), Some("work")).unwrap();
        // something not a folder sits where the default project would go
        std::fs::write(dir.join(DEFAULT_FOLDER_ID), "x").unwrap();
        std::fs::write(dir.join("old.dosik.json"), doc("Old")).unwrap();
        let listed = list(&dir).unwrap();
        let work = listed.iter().find(|f| f.id == "work").unwrap();
        assert_eq!(ids(work), vec!["w"]);
        // the old diagram is still there to open
        let stuck = listed.iter().find(|f| f.id == DEFAULT_FOLDER_ID).unwrap();
        assert_eq!(ids(stuck), vec!["old"]);
        // no folder behind it: the UI offers no project actions on it
        assert!(stuck.stray);
        assert!(!work.stray);
        assert_eq!(load(&dir, "old").unwrap(), doc("Old"));
    }

    #[test]
    fn a_tie_for_the_latest_project_is_broken_by_id() {
        let dir = scratch();
        make_folder(&dir, "bbb", "B", None).unwrap();
        make_folder(&dir, "aaa", "A", None).unwrap();
        for f in ["aaa", "bbb"] {
            let meta = serde_json::json!({ "name": f, "createdAt": 1000 }).to_string();
            std::fs::write(dir.join(f).join(FOLDER_FILE), meta).unwrap();
        }
        save(&dir, "new", &doc("New"), None).unwrap();
        assert!(dir.join("aaa").join("new.dosik.json").exists());
    }

    #[test]
    fn renaming_an_empty_project_does_not_move_it_up() {
        let dir = scratch();
        make_folder(&dir, "older", "Older", None).unwrap();
        // created clearly earlier than "newer"
        let meta = serde_json::json!({ "name": "Older", "createdAt": 1000 }).to_string();
        std::fs::write(dir.join("older").join(FOLDER_FILE), meta).unwrap();
        make_folder(&dir, "newer", "Newer", None).unwrap();
        retitle_folder(&dir, "older", "Renamed").unwrap();
        let order: Vec<String> = list(&dir).unwrap().into_iter().map(|f| f.id).collect();
        assert_eq!(order, vec!["newer", "older"]);
        assert_eq!(list(&dir).unwrap()[1].name, "Renamed");
    }

    #[test]
    fn projects_are_made_renamed_and_deleted_with_their_diagrams() {
        let dir = scratch();
        make_folder(&dir, "work", "  Work  ", None).unwrap();
        save(&dir, "d1", &doc("One"), Some("work")).unwrap();
        assert_eq!(list(&dir).unwrap()[0].name, "Work");

        retitle_folder(&dir, "work", "Client X").unwrap();
        assert_eq!(list(&dir).unwrap()[0].name, "Client X");

        remove_folder(&dir, "work").unwrap();
        assert!(list(&dir).unwrap().is_empty());
        assert!(load(&dir, "d1").is_err());
    }

    #[test]
    fn project_names_are_trimmed_and_bounded() {
        let dir = scratch();
        assert!(make_folder(&dir, "a", "   ", None).is_err());
        assert!(make_folder(&dir, "b", &"x".repeat(MAX_FOLDER_NAME + 1), None).is_err());
        assert!(make_folder(&dir, "c", &"가".repeat(MAX_FOLDER_NAME), None).is_ok());
        assert!(
            make_folder(&dir, "c", "again", None).is_err(),
            "an existing id is not overwritten"
        );
        assert!(retitle_folder(&dir, "c", "").is_err());
        assert!(retitle_folder(&dir, "nope", "Name").is_err());
    }

    #[test]
    fn a_new_diagram_goes_where_it_is_told_else_to_the_latest_project() {
        let dir = scratch();
        // nothing at all: the default project is made for it
        save(&dir, "first", &doc("First"), None).unwrap();
        assert_eq!(list(&dir).unwrap()[0].id, DEFAULT_FOLDER_ID);

        make_folder(&dir, "work", "Work", None).unwrap();
        save(&dir, "w1", &doc("W1"), Some("work")).unwrap();
        touch_later(&dir.join("work").join("w1.dosik.json"), 5);
        // unsaid: the most recently edited project, here "work"
        save(&dir, "loose", &doc("Loose"), None).unwrap();
        let work = list(&dir)
            .unwrap()
            .into_iter()
            .find(|f| f.id == "work")
            .unwrap();
        assert!(ids(&work).contains(&"loose"));
        assert!(save(&dir, "x", &doc("X"), Some("missing")).is_err());
    }

    #[test]
    fn an_existing_diagram_is_saved_in_place_whatever_folder_is_passed() {
        let dir = scratch();
        make_folder(&dir, "a", "A", None).unwrap();
        make_folder(&dir, "b", "B", None).unwrap();
        save(&dir, "d", &doc("v1"), Some("a")).unwrap();
        save(&dir, "d", &doc("v2"), Some("b")).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("a").join("d.dosik.json")).unwrap(),
            doc("v2")
        );
        assert!(!dir.join("b").join("d.dosik.json").exists());
    }

    #[test]
    fn diagrams_are_listed_with_their_title_newest_first() {
        let dir = scratch();
        make_folder(&dir, "f", "F", None).unwrap();
        save(&dir, "older", &doc("First"), Some("f")).unwrap();
        save(&dir, "newer", &doc("Second"), Some("f")).unwrap();
        touch_later(&dir.join("f").join("newer.dosik.json"), 5);
        let folder = &list(&dir).unwrap()[0];
        assert_eq!(
            folder
                .diagrams
                .iter()
                .map(|p| (&p.id[..], &p.title[..]))
                .collect::<Vec<_>>(),
            vec![("newer", "Second"), ("older", "First")]
        );
        assert_eq!(folder.updated_at, folder.diagrams[0].updated_at);
    }

    #[test]
    fn projects_an_older_build_left_are_ordered_by_their_newest_diagram() {
        // #230 D2: with no order written down, the newest first — as before
        let dir = scratch();
        make_folder(&dir, "old", "Old", None).unwrap();
        make_folder(&dir, "new", "New", None).unwrap();
        save(&dir, "o", &doc("O"), Some("old")).unwrap();
        save(&dir, "n", &doc("N"), Some("new")).unwrap();
        forget_orders(&dir);
        touch_later(&dir.join("old").join("o.dosik.json"), 5);
        let order: Vec<String> = list(&dir).unwrap().into_iter().map(|f| f.id).collect();
        assert_eq!(order, vec!["old", "new"]);
    }

    #[test]
    fn a_diagram_moves_between_projects_and_keeps_its_id() {
        let dir = scratch();
        make_folder(&dir, "a", "A", None).unwrap();
        make_folder(&dir, "b", "B", None).unwrap();
        save(&dir, "d", &doc("D"), Some("a")).unwrap();
        move_to(&dir, "d", "b").unwrap();
        assert!(dir.join("b").join("d.dosik.json").exists());
        assert!(!dir.join("a").join("d.dosik.json").exists());
        assert_eq!(load(&dir, "d").unwrap(), doc("D"));
        // moving to where it already is changes nothing
        move_to(&dir, "d", "b").unwrap();
        assert!(move_to(&dir, "d", "nope").is_err());
        assert!(move_to(&dir, "ghost", "a").is_err());
    }

    #[test]
    fn a_broken_file_is_listed_as_unreadable_not_hidden() {
        let dir = scratch();
        make_folder(&dir, "f", "F", None).unwrap();
        save(&dir, "good", &doc("Good"), Some("f")).unwrap();
        save(&dir, "bad", "{ not json", Some("f")).unwrap();
        let titles: Vec<String> = list(&dir).unwrap()[0]
            .diagrams
            .iter()
            .map(|p| p.title.clone())
            .collect();
        assert!(titles.contains(&UNREADABLE_TITLE.to_string()));
        assert!(titles.contains(&"Good".to_string()));
    }

    #[test]
    fn a_folder_without_a_readable_name_still_lists() {
        let dir = scratch();
        std::fs::create_dir_all(dir.join("bare")).unwrap();
        std::fs::create_dir_all(dir.join("broken")).unwrap();
        std::fs::write(dir.join("broken").join(FOLDER_FILE), "{ nope").unwrap();
        for folder in list(&dir).unwrap() {
            assert_eq!(folder.name, UNNAMED_PROJECT);
        }
    }

    #[test]
    fn a_missing_or_blank_title_reads_as_untitled() {
        let dir = scratch();
        save(&dir, "a", r#"{"version":1,"nodes":[],"edges":[]}"#, None).unwrap();
        save(&dir, "b", &doc("   "), None).unwrap();
        for p in &list(&dir).unwrap()[0].diagrams {
            assert_eq!(p.title, DEFAULT_TITLE);
        }
    }

    #[test]
    fn load_and_delete_find_the_diagram_by_id() {
        let dir = scratch();
        make_folder(&dir, "f", "F", None).unwrap();
        save(&dir, "p1", &doc("Loaded"), Some("f")).unwrap();
        assert_eq!(load(&dir, "p1").unwrap(), doc("Loaded"));
        assert!(load(&dir, "nope").is_err());
        delete(&dir, "p1").unwrap();
        assert!(list(&dir).unwrap()[0].diagrams.is_empty());
        assert!(delete(&dir, "p1").is_err());
    }

    #[test]
    fn ids_that_could_escape_the_folder_are_rejected_everywhere() {
        let dir = scratch();
        make_folder(&dir, "f", "F", None).unwrap();
        for bad in [
            "../x",
            "a/b",
            "a b",
            "",
            "x".repeat(33).as_str(),
            ".hidden",
            "..",
        ] {
            assert!(
                save(&dir, bad, "{}", Some("f")).is_err(),
                "save accepted {bad:?}"
            );
            assert!(
                save(&dir, "ok", "{}", Some(bad)).is_err(),
                "save folder accepted {bad:?}"
            );
            assert!(load(&dir, bad).is_err(), "load accepted {bad:?}");
            assert!(delete(&dir, bad).is_err(), "delete accepted {bad:?}");
            assert!(move_to(&dir, bad, "f").is_err(), "move accepted {bad:?}");
            assert!(
                make_folder(&dir, bad, "N", None).is_err(),
                "create accepted {bad:?}"
            );
            assert!(
                retitle_folder(&dir, bad, "N").is_err(),
                "rename accepted {bad:?}"
            );
            assert!(
                remove_folder(&dir, bad).is_err(),
                "remove_folder accepted {bad:?}"
            );
        }
        assert!(save(&dir, "ok_id-1", "{}", Some("f")).is_ok());
    }

    // ---------------------------------------------------------------- #229
    // Folders nest: a project holds folders and diagrams, a folder the same,
    // down to MAX_DEPTH. Ids are unique across the library.

    /// a folder `id` made inside `parent`
    fn sub(dir: &Path, parent: &str, id: &str, name: &str) {
        make_folder_in(dir, id, name, None, Some(parent)).unwrap();
    }

    /// the listed folder `id`, at any depth
    fn listed_folder(listed: &[FolderMeta], id: &str) -> Option<FolderMeta> {
        listed.iter().find_map(|f| {
            if f.id == id {
                Some(f.clone())
            } else {
                listed_folder(&f.folders, id)
            }
        })
    }

    fn sub_ids(folder: &FolderMeta) -> Vec<&str> {
        folder.folders.iter().map(|f| &f.id[..]).collect()
    }

    /// a chain of folders `c1` … `c{n}` under project `top`; returns the deepest id
    fn chain(dir: &Path, top: &str, n: usize) -> String {
        let mut parent = top.to_string();
        for k in 1..=n {
            let id = format!("c{k}");
            sub(dir, &parent, &id, &id);
            parent = id;
        }
        parent
    }

    #[test]
    fn a_flat_library_lists_every_folder_with_no_sub_folders() {
        // T1: the library as it is today opens as projects with no folders
        let dir = scratch();
        make_folder(&dir, "a", "A", None).unwrap();
        save(&dir, "p1", &doc("One"), Some("a")).unwrap();
        let listed = list(&dir).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].folders.is_empty());
        let json = serde_json::to_value(&listed).unwrap();
        assert_eq!(json[0]["folders"], serde_json::json!([]));
    }

    #[test]
    fn nested_folders_are_listed_level_by_level() {
        // T2
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", Some(&spot(40, 80, None))).unwrap();
        sub(&dir, "pay", "chk", "Checkout");
        sub(&dir, "chk", "flw", "Flows");
        save(&dir, "led", &doc("Ledger"), Some("pay")).unwrap();
        save(&dir, "ord", &doc("Order"), Some("chk")).unwrap();
        // a nested folder's board is never read — only a project has a frame
        let chk_meta = dir.join("pay").join("chk").join(FOLDER_FILE);
        std::fs::write(
            &chk_meta,
            r#"{"name":"Checkout","createdAt":1,"board":{"x":1,"y":2}}"#,
        )
        .unwrap();
        let listed = list(&dir).unwrap();
        assert_eq!(listed.len(), 1);
        let pay = &listed[0];
        assert_eq!(ids(pay), vec!["led"]);
        assert_eq!(pay.board, Some(spot(40, 80, None)));
        assert_eq!(sub_ids(pay), vec!["chk"]);
        let chk = &pay.folders[0];
        assert_eq!(chk.name, "Checkout");
        assert_eq!(ids(chk), vec!["ord"]);
        assert_eq!(chk.board, None);
        assert_eq!(sub_ids(chk), vec!["flw"]);
        let flw = &chk.folders[0];
        assert!(flw.diagrams.is_empty() && flw.folders.is_empty());
        let json = serde_json::to_value(&listed).unwrap();
        let nested = &json[0]["folders"][0];
        assert_eq!(nested["folders"][0]["folders"], serde_json::json!([]));
        assert!(nested.get("board").is_none());
        assert!(nested.get("updatedAt").is_some());
        assert_eq!(nested["diagrams"][0]["readable"], serde_json::json!(true));
    }

    #[test]
    fn a_folder_is_as_new_as_anything_under_it() {
        // T3
        let dir = scratch();
        make_folder(&dir, "a", "A", None).unwrap();
        make_folder(&dir, "b", "B", None).unwrap();
        sub(&dir, "a", "deep", "Deep");
        sub(&dir, "a", "empty", "Empty");
        std::fs::write(
            dir.join("a").join("empty").join(FOLDER_FILE),
            r#"{"name":"Empty","createdAt":5}"#,
        )
        .unwrap();
        save(&dir, "top", &doc("Top"), Some("a")).unwrap();
        save(&dir, "mid", &doc("Mid"), Some("b")).unwrap();
        save(&dir, "new", &doc("New"), Some("deep")).unwrap();
        touch_later(&dir.join("b").join("mid.dosik.json"), 100);
        touch_later(&dir.join("a").join("deep").join("new.dosik.json"), 200);
        // the order an older build would show: newest first (#230 D2)
        forget_orders(&dir);
        let listed = list(&dir).unwrap();
        // project a holds the newest diagram, deep inside: it comes first
        assert_eq!(
            listed.iter().map(|f| &f.id[..]).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        let a = &listed[0];
        let deep = listed_folder(&listed, "deep").unwrap();
        assert_eq!(a.updated_at, deep.updated_at);
        assert_eq!(deep.updated_at, deep.diagrams[0].updated_at);
        // an empty folder is as new as its birth; folders newest first
        assert_eq!(listed_folder(&listed, "empty").unwrap().updated_at, 5);
        assert_eq!(sub_ids(a), vec!["deep", "empty"]);
        // a new diagram with no folder goes to the newest project, by its subtree
        save(&dir, "fresh", &doc("Fresh"), None).unwrap();
        assert!(dir.join("a").join("fresh.dosik.json").is_file());
    }

    #[test]
    fn nested_folders_are_made_anywhere_once_per_id() {
        // T5
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        make_folder(&dir, "side", "Side", None).unwrap();
        sub(&dir, "pay", "chk", "Checkout");
        sub(&dir, "chk", "flw", "Flows");
        assert!(dir
            .join("pay")
            .join("chk")
            .join("flw")
            .join(FOLDER_FILE)
            .is_file());
        let meta = folder_json(&dir.join("pay").join("chk"), "flw");
        assert_eq!(meta["name"], "Flows");
        assert!(meta["createdAt"].is_u64());
        assert!(meta.get("board").is_none());
        // ids are unique across the library, at any depth
        assert!(make_folder_in(&dir, "chk", "Again", None, Some("side")).is_err());
        assert!(make_folder(&dir, "flw", "Top", None).is_err());
        assert!(make_folder_in(&dir, "pay", "Inside", None, Some("side")).is_err());
        // no such parent, a stray listing has no folder, a bad id
        assert!(make_folder_in(&dir, "x1", "X", None, Some("gone")).is_err());
        assert!(make_folder_in(&dir, "x2", "X", None, Some(DEFAULT_FOLDER_ID)).is_err());
        assert!(make_folder_in(&dir, "x 3", "X", None, Some("pay")).is_err());
        // a board belongs to a project only
        assert!(make_folder_in(&dir, "x4", "X", Some(&spot(0, 0, None)), Some("pay")).is_err());
        assert!(!dir.join("pay").join("x4").exists());
    }

    #[test]
    fn folders_nest_at_most_max_depth() {
        // T5: the project is level 1, so MAX_DEPTH - 1 folders fit under it
        let dir = scratch();
        make_folder(&dir, "top", "Top", None).unwrap();
        let deepest = chain(&dir, "top", MAX_DEPTH - 2);
        // under a folder at depth MAX_DEPTH - 1: fine
        make_folder_in(&dir, "last", "Last", None, Some(&deepest)).unwrap();
        let err = make_folder_in(&dir, "over", "Over", None, Some("last")).unwrap_err();
        assert_eq!(err, format!("folders nest at most {MAX_DEPTH} levels deep"));
        save(&dir, "bottom", &doc("Bottom"), Some("last")).unwrap();
        assert_eq!(load(&dir, "bottom").unwrap(), doc("Bottom"));
        assert!(listed_folder(&list(&dir).unwrap(), "last").is_some());
    }

    #[test]
    fn deeper_folders_made_by_hand_are_not_read() {
        // T6
        let dir = scratch();
        make_folder(&dir, "top", "Top", None).unwrap();
        let deepest = chain(&dir, "top", MAX_DEPTH - 1);
        // a folder past the cap, made outside the app
        let mut path = dir.join("top");
        for k in 1..=MAX_DEPTH - 1 {
            path = path.join(format!("c{k}"));
        }
        assert!(path.ends_with(&deepest));
        let hidden = path.join("toodeep");
        std::fs::create_dir_all(&hidden).unwrap();
        std::fs::write(hidden.join("lost.dosik.json"), doc("Lost")).unwrap();
        let listed = list(&dir).unwrap();
        assert!(listed_folder(&listed, &deepest).unwrap().folders.is_empty());
        assert!(listed_folder(&listed, "toodeep").is_none());
        assert!(load(&dir, "lost").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_links_are_never_followed() {
        // T7
        use std::os::unix::fs::symlink;
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        make_folder(&dir, "side", "Side", None).unwrap();
        save(&dir, "real", &doc("Real"), Some("side")).unwrap();
        let outside = scratch();
        std::fs::create_dir_all(outside.join("ext")).unwrap();
        std::fs::write(outside.join("ext").join(FOLDER_FILE), r#"{"name":"Ext"}"#).unwrap();
        std::fs::write(outside.join("ext").join("far.dosik.json"), doc("Far")).unwrap();
        std::fs::write(outside.join("x.dosik.json"), "original").unwrap();
        // a link to a folder inside the library, one outside it, and a diagram link
        symlink(dir.join("side"), dir.join("pay").join("loop")).unwrap();
        symlink(outside.join("ext"), dir.join("pay").join("ext")).unwrap();
        symlink(outside.join("ext"), dir.join("ext2")).unwrap();
        symlink(
            outside.join("x.dosik.json"),
            dir.join("pay").join("x.dosik.json"),
        )
        .unwrap();
        let listed = list(&dir).unwrap();
        assert_eq!(
            listed.iter().map(|f| &f.id[..]).collect::<Vec<_>>().len(),
            2
        );
        let pay = listed.iter().find(|f| f.id == "pay").unwrap();
        assert!(pay.folders.is_empty(), "{:?}", sub_ids(pay));
        assert!(pay.diagrams.is_empty());
        assert!(load(&dir, "far").is_err());
        assert!(load(&dir, "x").is_err());
        assert!(make_folder_in(&dir, "n1", "N", None, Some("loop")).is_err());
        assert!(make_folder_in(&dir, "n2", "N", None, Some("ext")).is_err());
        assert!(save(&dir, "new", &doc("New"), Some("ext2")).is_err());
        // a save under the link's id writes the library's own file, never the target
        save(&dir, "x", &doc("Mine"), Some("pay")).unwrap();
        assert_eq!(
            std::fs::read_to_string(outside.join("x.dosik.json")).unwrap(),
            "original"
        );
        // the real folder the loop pointed at is still there, once
        assert_eq!(load(&dir, "real").unwrap(), doc("Real"));
    }

    #[test]
    fn a_folder_id_copied_by_hand_is_listed_once_where_saves_go() {
        // #229: two directories with one id — the listing shows the
        // one every lookup (save, move, rename) finds, so TS and Rust agree
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        make_folder(&dir, "side", "Side", None).unwrap();
        sub(&dir, "pay", "chk", "Checkout");
        std::fs::create_dir_all(dir.join("side").join("chk")).unwrap();
        std::fs::write(
            dir.join("side").join("chk").join(FOLDER_FILE),
            r#"{"name":"Copy","createdAt":1}"#,
        )
        .unwrap();
        save(&dir, "into", &doc("Into"), Some("chk")).unwrap();
        let listed = list(&dir).unwrap();
        let pay = listed.iter().find(|f| f.id == "pay").unwrap();
        let side = listed.iter().find(|f| f.id == "side").unwrap();
        assert_eq!(sub_ids(pay), vec!["chk"]);
        assert!(side.folders.is_empty(), "{:?}", sub_ids(side));
        assert_eq!(ids(&pay.folders[0]), vec!["into"]);
    }

    #[test]
    fn a_diagram_id_copied_by_hand_is_listed_once_where_loads_and_deletes_go() {
        // #229: a folder copied by hand copies its diagrams'
        // ids too — the listing shows the file every lookup by id (`find`)
        // lands on, so opening or deleting a row never touches another file
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        make_folder(&dir, "side", "Side", None).unwrap();
        save(&dir, "dup", &doc("Original"), Some("pay")).unwrap();
        sub(&dir, "side", "copy", "Copy");
        let copy = dir.join("side").join("copy").join("dup.dosik.json");
        std::fs::write(&copy, doc("Copy")).unwrap();
        // the copy is newer: listed first, it would be the row the app picks
        touch_later(&copy, 60);
        let listed = list(&dir).unwrap();
        let pay = listed.iter().find(|f| f.id == "pay").unwrap();
        assert_eq!(ids(pay), vec!["dup"]);
        assert!(listed_folder(&listed, "copy").unwrap().diagrams.is_empty());
        assert_eq!(load(&dir, "dup").unwrap(), doc("Original"));
        // deleting the listed row deletes the listed file; the copy shows next
        delete(&dir, "dup").unwrap();
        assert!(copy.exists());
        let listed = list(&dir).unwrap();
        assert_eq!(ids(&listed_folder(&listed, "copy").unwrap()), vec!["dup"]);
    }

    #[test]
    fn a_folder_inside_a_project_is_named_as_a_folder() {
        // #229: the fallback name and the refusals say "folder" below
        // the top; a project's stay as they were
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        sub(&dir, "pay", "chk", "Checkout");
        std::fs::write(
            dir.join("pay").join("chk").join(FOLDER_FILE),
            r#"{"createdAt":1}"#,
        )
        .unwrap();
        std::fs::create_dir_all(dir.join("bare")).unwrap();
        let listed = list(&dir).unwrap();
        assert_eq!(
            listed_folder(&listed, "chk").unwrap().name,
            "Untitled Folder"
        );
        assert_eq!(
            listed_folder(&listed, "bare").unwrap().name,
            "Untitled Project"
        );
        assert_eq!(
            retitle_folder(&dir, "chk", "  ").unwrap_err(),
            "a folder needs a name"
        );
        assert_eq!(
            retitle_folder(&dir, "pay", "  ").unwrap_err(),
            "a project needs a name"
        );
        assert_eq!(
            make_folder_in(&dir, "n1", " ", None, Some("pay")).unwrap_err(),
            "a folder needs a name"
        );
        assert_eq!(
            make_folder_in(&dir, "n2", &"x".repeat(81), None, Some("pay")).unwrap_err(),
            format!("a folder name is at most {MAX_FOLDER_NAME} characters")
        );
        assert_eq!(
            make_folder(&dir, "n3", " ", None).unwrap_err(),
            "a project needs a name"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_default_project_is_never_written_through() {
        // T7 (#229): `my-diagrams` a link out of the library and no
        // real project — a save with no folder and the adoption of loose
        // diagrams must not follow it
        use std::os::unix::fs::symlink;
        let dir = scratch();
        ensure_dir(&dir).unwrap();
        let outside = scratch();
        ensure_dir(&outside).unwrap();
        symlink(&outside, dir.join(DEFAULT_FOLDER_ID)).unwrap();
        std::fs::write(dir.join("loose.dosik.json"), doc("Loose")).unwrap();
        // the listing leaves the loose diagram where it is, listed as stray
        let listed = list(&dir).unwrap();
        let stray = listed.iter().find(|f| f.stray).unwrap();
        assert_eq!(ids(stray), vec!["loose"]);
        assert!(dir.join("loose.dosik.json").exists());
        // a save with nowhere to go fails instead of writing through the link
        assert!(save(&dir, "fresh", &doc("Fresh"), None).is_err());
        let outside_files: Vec<_> = std::fs::read_dir(&outside).unwrap().flatten().collect();
        assert!(outside_files.is_empty(), "{outside_files:?}");
    }

    #[test]
    fn a_nested_rename_keeps_every_other_key() {
        // T8
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        sub(&dir, "pay", "chk", "Checkout");
        let file = dir.join("pay").join("chk").join(FOLDER_FILE);
        std::fs::write(
            &file,
            r#"{"name":"Checkout","createdAt":7,"order":["b","a"],"x-future":{"k":1}}"#,
        )
        .unwrap();
        retitle_folder(&dir, "chk", "  Basket  ").unwrap();
        let meta: Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(meta["name"], "Basket");
        assert_eq!(meta["createdAt"], 7);
        assert_eq!(meta["order"], serde_json::json!(["b", "a"]));
        assert_eq!(meta["x-future"], serde_json::json!({ "k": 1 }));
        // a broken one is mended, as a project's is
        std::fs::write(&file, "not json").unwrap();
        retitle_folder(&dir, "chk", "Mended").unwrap();
        assert_eq!(
            listed_folder(&list(&dir).unwrap(), "chk").unwrap().name,
            "Mended"
        );
    }

    #[test]
    fn a_nested_folder_goes_with_everything_in_it() {
        // T9
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        sub(&dir, "pay", "chk", "Checkout");
        sub(&dir, "chk", "flw", "Flows");
        sub(&dir, "pay", "arc", "Archive");
        save(&dir, "ord", &doc("Order"), Some("flw")).unwrap();
        save(&dir, "old", &doc("Old"), Some("arc")).unwrap();
        remove_folder(&dir, "chk").unwrap();
        assert!(!dir.join("pay").join("chk").exists());
        assert!(load(&dir, "ord").is_err());
        assert_eq!(load(&dir, "old").unwrap(), doc("Old"));
        let listed = list(&dir).unwrap();
        assert_eq!(sub_ids(&listed[0]), vec!["arc"]);
    }

    #[test]
    fn removing_a_nested_folder_waits_for_a_folder_file_write() {
        // T9: under the same lock as a project's removal
        let dir = scratch();
        make_folder(&dir, "p", "P", None).unwrap();
        sub(&dir, "p", "n", "N");
        let removed = {
            let lib = dir.clone();
            let inner = dir.join("p").join("n");
            while_a_meta_write_holds_the_lock(
                move || remove_folder(&lib, "n"),
                move || assert!(inner.is_dir(), "removed under a folder.json write"),
            )
        };
        removed.unwrap();
        assert!(!dir.join("p").join("n").exists());
    }

    #[test]
    fn saving_finds_a_nested_diagram_in_place() {
        // T10
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        make_folder(&dir, "side", "Side", None).unwrap();
        sub(&dir, "pay", "chk", "Checkout");
        save(&dir, "ord", &doc("v1"), Some("chk")).unwrap();
        assert!(dir.join("pay").join("chk").join("ord.dosik.json").is_file());
        // an existing diagram is written where it is, whatever folder is passed
        save(&dir, "ord", &doc("v2"), Some("side")).unwrap();
        save(&dir, "ord", &doc("v3"), None).unwrap();
        assert_eq!(load(&dir, "ord").unwrap(), doc("v3"));
        assert!(!dir.join("side").join("ord.dosik.json").exists());
        assert!(save(&dir, "new", &doc("New"), Some("gone")).is_err());
    }

    #[test]
    fn nested_diagrams_move_load_and_delete_by_id() {
        // T11
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        sub(&dir, "pay", "chk", "Checkout");
        sub(&dir, "chk", "flw", "Flows");
        save(&dir, "ord", &doc("Order"), Some("pay")).unwrap();
        move_to(&dir, "ord", "flw").unwrap();
        let flows = dir.join("pay").join("chk").join("flw");
        assert!(flows.join("ord.dosik.json").is_file());
        assert_eq!(load(&dir, "ord").unwrap(), doc("Order"));
        // the same place again is nothing to do
        move_to(&dir, "ord", "flw").unwrap();
        move_to(&dir, "ord", "pay").unwrap();
        assert!(dir.join("pay").join("ord.dosik.json").is_file());
        assert!(move_to(&dir, "ord", "gone").is_err());
        move_to(&dir, "ord", "chk").unwrap();
        delete(&dir, "ord").unwrap();
        assert!(load(&dir, "ord").is_err());
    }

    #[test]
    fn a_board_for_a_nested_folder_fails_alone() {
        // T12
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        sub(&dir, "pay", "chk", "Checkout");
        let failed = save_boards(
            &dir,
            &[
                placed("chk", spot(1, 2, None)),
                placed("pay", spot(3, 4, None)),
            ],
        );
        assert_eq!(
            failed,
            vec![BoardFailure {
                id: "chk".into(),
                error: "not a project".into(),
            }]
        );
        assert_eq!(board_of(&dir, "pay"), Some(spot(3, 4, None)));
        let meta = folder_json(&dir.join("pay"), "chk");
        assert!(meta.get("board").is_none());
    }

    #[test]
    fn nested_ids_that_could_escape_are_rejected() {
        // T13: parent and folder go through validate_id before any path is made
        let dir = scratch();
        make_folder(&dir, "f", "F", None).unwrap();
        for bad in ["../x", "a/b", "/abs", "..", "", "x".repeat(33).as_str()] {
            assert!(
                make_folder_in(&dir, "ok", "N", None, Some(bad)).is_err(),
                "parent {bad:?}"
            );
            assert!(
                save(&dir, "ok2", "{}", Some(bad)).is_err(),
                "folder {bad:?}"
            );
            assert!(move_to(&dir, "nope", bad).is_err(), "move {bad:?}");
        }
        assert!(!dir.join("ok").exists());
        assert!(!dir.parent().unwrap().join("x").join("ok").exists());
    }

    #[test]
    fn the_library_root_folder_file_is_the_projects_order_and_no_project() {
        // #229 T14 → #230 D1: the projects' order lives there, nothing else is read from it
        let dir = scratch();
        std::fs::create_dir_all(&dir).unwrap();
        let root = dir.join(FOLDER_FILE);
        std::fs::write(&root, r#"{"order":["b","a"],"x-future":1}"#).unwrap();
        make_folder(&dir, "a", "A", None).unwrap();
        let listed = list(&dir).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed.iter().all(|f| !f.stray));
        assert!(!dir.join(DEFAULT_FOLDER_ID).exists());
        // the new project went first; entries that are no keys are dropped, other keys stay
        let meta = folder_meta(&dir).unwrap();
        assert_eq!(meta["order"], serde_json::json!(["folder:a"]));
        assert_eq!(meta["x-future"], 1);
    }

    #[test]
    fn save_is_atomic_and_leaves_no_temp_file() {
        let dir = scratch();
        make_folder(&dir, "f", "F", None).unwrap();
        save(&dir, "p1", &doc("v1"), Some("f")).unwrap();
        save(&dir, "p1", &doc("v2"), Some("f")).unwrap();
        let mut names: Vec<String> = std::fs::read_dir(dir.join("f"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec![FOLDER_FILE, "p1.dosik.json"]);
        assert_eq!(load(&dir, "p1").unwrap(), doc("v2"));
    }

    /// the one diagram `list` gives the library
    fn listed_one(dir: &Path) -> ProjectMeta {
        list(dir).unwrap()[0].diagrams[0].clone()
    }

    #[test]
    fn a_one_canvas_diagram_is_readable() {
        let dir = scratch();
        save(&dir, "a", &doc("A"), None).unwrap();
        let a = listed_one(&dir);
        assert!(a.readable);
        assert_eq!(a.title, "A");
    }

    #[test]
    fn a_document_with_pages_is_listed_unreadable_under_its_own_title() {
        // v2 was never shipped: listed so it can be deleted, never opened (#229 D2)
        let dir = scratch();
        let book = r#"{"version":2,"title":"Book","pages":[
            {"id":"p1","name":"Overview","nodes":[],"edges":[]}
        ]}"#;
        save(&dir, "b", book, None).unwrap();
        let b = listed_one(&dir);
        assert!(!b.readable);
        assert_eq!(b.title, "Book");
        // any `pages` key at the top, whatever it holds, even beside nodes and edges
        let dir = scratch();
        let both = r#"{"version":1,"title":"Both","nodes":[],"edges":[],"pages":null}"#;
        save(&dir, "c", both, None).unwrap();
        assert!(!listed_one(&dir).readable);
        // no title: the default one
        let dir = scratch();
        save(&dir, "d", r#"{"pages":[]}"#, None).unwrap();
        assert_eq!(listed_one(&dir).title, DEFAULT_TITLE);
    }

    #[test]
    fn a_file_that_cannot_be_read_is_unreadable() {
        let dir = scratch();
        save(&dir, "bad", "{ not json", None).unwrap();
        let bad = listed_one(&dir);
        assert!(!bad.readable);
        assert_eq!(bad.title, UNREADABLE_TITLE);
        // JSON, but not shaped like a diagram: no nodes and edges arrays
        for odd in [
            r#"{"title":"Odd"}"#,
            r#"{"title":"Odd","nodes":[]}"#,
            r#"{"title":"Odd","nodes":{},"edges":[]}"#,
            r#"[1,2]"#,
        ] {
            let dir = scratch();
            save(&dir, "odd", odd, None).unwrap();
            assert!(!listed_one(&dir).readable, "{odd}");
        }
    }

    #[test]
    fn a_stray_diagram_says_whether_it_is_readable_too() {
        let dir = scratch();
        // something not a folder sits where the default project would go
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(DEFAULT_FOLDER_ID), "x").unwrap();
        std::fs::write(dir.join("old.dosik.json"), doc("Old")).unwrap();
        let listed = list(&dir).unwrap();
        let stuck = listed.iter().find(|f| f.id == DEFAULT_FOLDER_ID).unwrap();
        assert!(stuck.stray);
        assert!(stuck.diagrams[0].readable);
    }

    #[test]
    fn readable_is_sent_in_camel_case_with_no_page_names() {
        let meta = ProjectMeta {
            id: "a".into(),
            title: "A".into(),
            updated_at: 1,
            readable: true,
        };
        let json = serde_json::to_value(&meta).unwrap();
        assert_eq!(json["readable"], serde_json::json!(true));
        assert_eq!(json["updatedAt"], serde_json::json!(1));
        assert!(json.get("pageNames").is_none());
    }

    #[test]
    fn stray_files_in_a_folder_are_ignored() {
        let dir = scratch();
        make_folder(&dir, "f", "F", None).unwrap();
        save(&dir, "p1", &doc("Real"), Some("f")).unwrap();
        std::fs::write(dir.join("f").join("notes.txt"), "x").unwrap();
        std::fs::write(dir.join("f").join("p2.dosik.json.123-4.tmp"), "x").unwrap();
        assert_eq!(ids(&list(&dir).unwrap()[0]), vec!["p1"]);
    }

    fn folder_json(dir: &Path, id: &str) -> serde_json::Value {
        let text = std::fs::read_to_string(dir.join(id).join(FOLDER_FILE)).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    fn spot(x: i64, y: i64, collapsed: Option<bool>) -> BoardSpot {
        BoardSpot { x, y, collapsed }
    }

    fn board_of(dir: &Path, id: &str) -> Option<BoardSpot> {
        list(dir)
            .unwrap()
            .into_iter()
            .find(|f| f.id == id)
            .and_then(|f| f.board)
    }

    fn placed(id: &str, board: BoardSpot) -> FolderBoard {
        FolderBoard {
            id: id.to_string(),
            board,
        }
    }

    #[test]
    fn renaming_keeps_the_board_and_unknown_keys() {
        let dir = scratch();
        make_folder(&dir, "work", "Work", None).unwrap();
        let meta = serde_json::json!({
            "name": "Work",
            "createdAt": 1000,
            "board": { "x": 40, "y": 80, "collapsed": true },
            "x-future": 1
        });
        std::fs::write(dir.join("work").join(FOLDER_FILE), meta.to_string()).unwrap();
        retitle_folder(&dir, "work", "Client").unwrap();
        let after = folder_json(&dir, "work");
        assert_eq!(after["name"], "Client");
        assert_eq!(after["createdAt"], 1000);
        assert_eq!(
            after["board"],
            serde_json::json!({ "x": 40, "y": 80, "collapsed": true })
        );
        assert_eq!(after["x-future"], 1);
    }

    #[test]
    fn a_new_folder_file_is_its_name_and_birth() {
        let dir = scratch();
        make_folder(&dir, "work", "Work", None).unwrap();
        let meta = folder_json(&dir, "work");
        let keys: Vec<&String> = meta.as_object().unwrap().keys().collect();
        assert_eq!(keys, vec!["createdAt", "name"]);
    }

    #[test]
    fn a_folder_can_be_made_with_its_board() {
        let dir = scratch();
        make_folder(&dir, "work", "Work", Some(&spot(-120, 360, None))).unwrap();
        assert_eq!(
            folder_json(&dir, "work")["board"],
            serde_json::json!({ "x": -120, "y": 360 })
        );
        assert_eq!(board_of(&dir, "work"), Some(spot(-120, 360, None)));
        // a board out of range makes no folder at all
        assert!(make_folder(&dir, "far", "Far", Some(&spot(BOARD_LIMIT + 1, 0, None))).is_err());
        assert!(!dir.join("far").exists());
    }

    #[test]
    fn the_extreme_numbers_are_out_of_range() {
        // i64::MIN has no positive twin: `abs` would overflow (#221)
        for (x, y) in [
            (i64::MIN, 0),
            (0, i64::MIN),
            (i64::MAX, 0),
            (BOARD_LIMIT + 1, 0),
            (0, -BOARD_LIMIT - 1),
        ] {
            assert!(spot(x, y, None).check().is_err(), "{x}, {y}");
        }
        for (x, y) in [
            (BOARD_LIMIT, -BOARD_LIMIT),
            (-BOARD_LIMIT, BOARD_LIMIT),
            (0, 0),
        ] {
            assert!(spot(x, y, None).check().is_ok(), "{x}, {y}");
        }
        // and one written that way fails alone, without taking the call down
        let dir = scratch();
        make_folder(&dir, "min", "Min", None).unwrap();
        let failed = save_boards(&dir, &[placed("min", spot(i64::MIN, 0, None))]);
        assert_eq!(failed.len(), 1);
        assert_eq!(board_of(&dir, "min"), None);
    }

    #[test]
    fn a_board_is_saved_and_listed() {
        let dir = scratch();
        for id in ["a", "b", "c"] {
            make_folder(&dir, id, id, None).unwrap();
        }
        assert_eq!(board_of(&dir, "a"), None);
        let failed = save_boards(
            &dir,
            &[
                placed("a", spot(0, 0, None)),
                placed("b", spot(40, -80, Some(true))),
                placed("c", spot(-1_000_000, 1_000_000, Some(false))),
            ],
        );
        assert_eq!(failed, vec![]);
        assert_eq!(board_of(&dir, "a"), Some(spot(0, 0, None)));
        assert_eq!(board_of(&dir, "b"), Some(spot(40, -80, Some(true))));
        assert_eq!(
            board_of(&dir, "c"),
            Some(spot(-1_000_000, 1_000_000, Some(false)))
        );
        // the board is replaced whole: no collapsed now means none
        assert!(save_boards(&dir, &[placed("b", spot(1, 2, None))]).is_empty());
        assert_eq!(board_of(&dir, "b"), Some(spot(1, 2, None)));
        assert_eq!(
            list(&dir)
                .unwrap()
                .iter()
                .find(|f| f.id == "b")
                .unwrap()
                .name,
            "b"
        );
    }

    #[test]
    fn saving_a_board_keeps_an_empty_projects_place() {
        let dir = scratch();
        for id in ["older", "newer"] {
            std::fs::create_dir_all(dir.join(id)).unwrap();
            std::fs::write(
                dir.join(id).join(FOLDER_FILE),
                format!(r#"{{"name":"{id}"}}"#),
            )
            .unwrap();
        }
        // no createdAt: each one's age is its file's mtime
        touch_later(&dir.join("newer").join(FOLDER_FILE), 60);
        let order =
            |dir: &Path| -> Vec<String> { list(dir).unwrap().into_iter().map(|f| f.id).collect() };
        assert_eq!(order(&dir), vec!["newer", "older"]);
        assert!(save_boards(&dir, &[placed("older", spot(0, 0, None))]).is_empty());
        assert_eq!(order(&dir), vec!["newer", "older"]);
        assert!(folder_json(&dir, "older")["createdAt"].is_u64());
    }

    #[test]
    fn bad_boards_fail_alone() {
        let dir = scratch();
        make_folder(&dir, "good", "Good", None).unwrap();
        make_folder(&dir, "far", "Far", None).unwrap();
        let failed = save_boards(
            &dir,
            &[
                placed("far", spot(BOARD_LIMIT + 1, 0, None)),
                placed("../escape", spot(0, 0, None)),
                placed("gone", spot(0, 0, None)),
                placed("good", spot(20, 40, None)),
            ],
        );
        assert_eq!(board_of(&dir, "good"), Some(spot(20, 40, None)));
        assert_eq!(board_of(&dir, "far"), None);
        // what failed comes back as data, each with why — not inside one message
        let ids: Vec<&str> = failed.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids, vec!["far", "../escape", "gone"]);
        assert!(failed.iter().all(|f| !f.error.is_empty()), "{failed:?}");
    }

    #[test]
    fn a_broken_folder_file_is_not_overwritten() {
        let dir = scratch();
        for id in ["broken", "list"] {
            std::fs::create_dir_all(dir.join(id)).unwrap();
        }
        std::fs::write(dir.join("broken").join(FOLDER_FILE), "{ nope").unwrap();
        std::fs::write(dir.join("list").join(FOLDER_FILE), "[1, 2]").unwrap();
        let failed = save_boards(
            &dir,
            &[
                placed("broken", spot(0, 0, None)),
                placed("list", spot(0, 0, None)),
            ],
        );
        let ids: Vec<&str> = failed.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids, vec!["broken", "list"]);
        let read = |id: &str| std::fs::read_to_string(dir.join(id).join(FOLDER_FILE)).unwrap();
        assert_eq!(read("broken"), "{ nope");
        assert_eq!(read("list"), "[1, 2]");
    }

    #[test]
    fn renaming_mends_a_broken_folder_file() {
        let dir = scratch();
        std::fs::create_dir_all(dir.join("broken")).unwrap();
        std::fs::write(dir.join("broken").join(FOLDER_FILE), "{ nope").unwrap();
        retitle_folder(&dir, "broken", "Fixed").unwrap();
        assert_eq!(list(&dir).unwrap()[0].name, "Fixed");
    }

    #[test]
    fn a_bare_folder_gets_a_folder_file() {
        let dir = scratch();
        std::fs::create_dir_all(dir.join("bare")).unwrap();
        assert!(save_boards(&dir, &[placed("bare", spot(60, 20, None))]).is_empty());
        let meta = folder_json(&dir, "bare");
        assert_eq!(meta["board"], serde_json::json!({ "x": 60, "y": 20 }));
        assert!(meta["createdAt"].is_u64());
        assert!(meta.get("name").is_none());
        let listed = list(&dir).unwrap();
        assert_eq!(listed[0].name, UNNAMED_PROJECT);
        assert_eq!(listed[0].board, Some(spot(60, 20, None)));
    }

    #[test]
    fn boards_are_read_leniently() {
        let dir = scratch();
        let cases = [
            ("none", serde_json::json!({ "name": "n" })),
            ("array", serde_json::json!({ "name": "n", "board": [1, 2] })),
            (
                "text",
                serde_json::json!({ "name": "n", "board": { "x": "1", "y": 2 } }),
            ),
            (
                "half",
                serde_json::json!({ "name": "n", "board": { "x": 1 } }),
            ),
            (
                "far",
                serde_json::json!({ "name": "n", "board": { "x": 1_000_001, "y": 0 } }),
            ),
            (
                "odd",
                serde_json::json!({ "name": "n", "board": { "x": 1, "y": 2, "collapsed": "yes" } }),
            ),
            (
                "round",
                serde_json::json!({ "name": "n", "board": { "x": 10.6, "y": -20.4, "collapsed": false } }),
            ),
        ];
        for (id, meta) in &cases {
            std::fs::create_dir_all(dir.join(id)).unwrap();
            std::fs::write(dir.join(id).join(FOLDER_FILE), meta.to_string()).unwrap();
        }
        for id in ["none", "array", "text", "half", "far"] {
            assert_eq!(board_of(&dir, id), None, "{id}");
        }
        assert_eq!(board_of(&dir, "odd"), Some(spot(1, 2, None)));
        assert_eq!(board_of(&dir, "round"), Some(spot(11, -20, Some(false))));
        // a stray listing has no folder, so no board
        std::fs::write(dir.join("loose.dosik.json"), doc("Loose")).unwrap();
        std::fs::write(dir.join(DEFAULT_FOLDER_ID), "a file in the way").unwrap();
        let listed = list(&dir).unwrap();
        let stray = listed.iter().find(|f| f.stray).unwrap();
        assert_eq!(stray.board, None);
    }

    #[test]
    fn a_board_is_sent_in_camel_case_and_left_out_when_none() {
        let dir = scratch();
        make_folder(&dir, "a", "A", Some(&spot(1, 2, Some(true)))).unwrap();
        make_folder(&dir, "b", "B", None).unwrap();
        let listed = list(&dir).unwrap();
        let json = serde_json::to_value(&listed).unwrap();
        let by_id = |id: &str| {
            json.as_array()
                .unwrap()
                .iter()
                .find(|f| f["id"] == id)
                .unwrap()
                .clone()
        };
        assert_eq!(
            by_id("a")["board"],
            serde_json::json!({ "x": 1, "y": 2, "collapsed": true })
        );
        assert!(by_id("b").get("board").is_none());
        // and a board comes in the same shape
        let incoming: Vec<FolderBoard> =
            serde_json::from_str(r#"[{"id":"a","board":{"x":3,"y":4}}]"#).unwrap();
        assert_eq!(incoming[0].board, spot(3, 4, None));
    }

    /// holds the folder lock as a `folder.json` write would, runs `call` on
    /// another thread while it is held and lets `meanwhile` act there; then
    /// lets go and returns what `call` came to
    fn while_a_meta_write_holds_the_lock<T: Send + 'static>(
        call: impl FnOnce() -> T + Send + 'static,
        meanwhile: impl FnOnce(),
    ) -> T {
        let held = meta_lock();
        let other = std::thread::spawn(call);
        // time for `call` to reach the lock — after it, nothing it does can land
        std::thread::sleep(std::time::Duration::from_millis(150));
        meanwhile();
        drop(held);
        other.join().unwrap()
    }

    #[test]
    fn removing_a_project_waits_for_a_folder_file_write() {
        // a board write landing mid-removal would leave a new folder.json in a
        // folder being emptied: "Directory not empty", an empty project back
        // (#221)
        let dir = scratch();
        make_folder(&dir, "p", "P", None).unwrap();
        let removed = {
            let lib = dir.clone();
            while_a_meta_write_holds_the_lock(
                move || remove_folder(&lib, "p"),
                || assert!(dir.join("p").is_dir(), "removed under a folder.json write"),
            )
        };
        removed.unwrap();
        assert!(!dir.join("p").exists());
    }

    #[test]
    fn a_board_for_a_project_removed_while_it_waited_fails_as_gone() {
        let dir = scratch();
        make_folder(&dir, "p", "P", None).unwrap();
        let failed = {
            let lib = dir.clone();
            while_a_meta_write_holds_the_lock(
                move || save_boards(&lib, &[placed("p", spot(0, 0, None))]),
                || std::fs::remove_dir_all(dir.join("p")).unwrap(),
            )
        };
        assert_eq!(failed.len(), 1);
        assert!(failed[0].error.contains("no such project"), "{failed:?}");
        assert!(!dir.join("p").exists());
    }

    #[test]
    fn boards_are_placed_on_a_blocking_thread_with_the_same_outcome() {
        let dir = scratch();
        make_folder(&dir, "p", "P", None).unwrap();
        let failed = tauri::async_runtime::block_on(place_boards(
            dir.clone(),
            vec![
                placed("p", spot(20, 40, None)),
                placed("gone", spot(0, 0, None)),
            ],
        ))
        .unwrap();
        let ids: Vec<&str> = failed.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids, vec!["gone"]);
        assert_eq!(board_of(&dir, "p"), Some(spot(20, 40, None)));
    }

    #[test]
    fn a_failed_place_is_sent_as_its_id_and_why() {
        let failure = BoardFailure {
            id: "b".into(),
            error: "not a project file".into(),
        };
        assert_eq!(
            serde_json::to_value(vec![failure]).unwrap(),
            serde_json::json!([{ "id": "b", "error": "not a project file" }])
        );
    }

    // ---------------------------------------------------------------- #230
    // The order of a folder's items and of the projects: `order` in each
    // folder.json, the projects' in the library's own folder.json.

    fn key(s: &str) -> ItemKey {
        ItemKey::parse(s).unwrap()
    }

    fn keys(list: &[&str]) -> Vec<ItemKey> {
        list.iter().map(|s| key(s)).collect()
    }

    /// what a folder.json at `path` (a folder, or the library) says its order is
    fn order_at(path: &Path) -> Option<Vec<String>> {
        let meta = folder_meta(path)?;
        let order = meta.get("order")?.as_array()?;
        Some(
            order
                .iter()
                .map(|v| v.as_str().unwrap_or("?").to_string())
                .collect(),
        )
    }

    /// sets the order a folder.json at `path` holds, by hand
    fn set_order(path: &Path, order: &[&str]) {
        let mut meta = match folder_meta(path) {
            Some(Value::Object(m)) => m,
            _ => Map::new(),
        };
        meta.insert("order".into(), serde_json::json!(order));
        std::fs::write(path.join(FOLDER_FILE), Value::Object(meta).to_string()).unwrap();
    }

    /// a library as an older build left it: no order anywhere
    fn forget_orders(dir: &Path) {
        let paths =
            std::iter::once(dir.to_path_buf()).chain(walk_folders(dir).into_iter().map(|f| f.path));
        for path in paths {
            if let Some(Value::Object(mut meta)) = folder_meta(&path) {
                meta.remove("order");
                std::fs::write(path.join(FOLDER_FILE), Value::Object(meta).to_string()).unwrap();
            }
        }
    }

    /// every folder.json in the library — the library's own too — with its bytes and mtime
    fn folder_files(dir: &Path) -> Vec<(PathBuf, String, u64)> {
        std::iter::once(dir.to_path_buf())
            .chain(walk_folders(dir).into_iter().map(|f| f.path))
            .filter_map(|path| {
                let file = path.join(FOLDER_FILE);
                let text = std::fs::read_to_string(&file).ok()?;
                Some((file.clone(), text, modified_ms(&file)))
            })
            .collect()
    }

    // used by a test that runs on Unix only
    #[cfg(unix)]
    fn order_strings(order: &[ItemKey]) -> Vec<String> {
        order.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn item_keys_name_a_folder_or_a_diagram() {
        // T1
        assert_eq!(
            key("folder:chk2b7cccc"),
            ItemKey::Folder("chk2b7cccc".into())
        );
        assert_eq!(
            key("diagram:led9x0aaaa"),
            ItemKey::Diagram("led9x0aaaa".into())
        );
        assert_eq!(key("folder:a").to_string(), "folder:a");
        assert_eq!(key("diagram:a").to_string(), "diagram:a");
        for bad in [
            "a",
            "page:a",
            "folder:",
            "folder:../a",
            "folder:a/b",
            "diagram:a b",
            ":a",
        ] {
            assert!(ItemKey::parse(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn without_an_order_items_go_newest_first() {
        // T1: what #229 showed — ties to the lower key
        let items = vec![
            (key("folder:a"), 1),
            (key("diagram:b"), 3),
            (key("folder:c"), 2),
            (key("diagram:d"), 2),
        ];
        assert_eq!(
            resolve_order(None, &items),
            keys(&["diagram:b", "diagram:d", "folder:c", "folder:a"])
        );
    }

    #[test]
    fn the_stored_order_is_kept_and_what_it_misses_goes_on_top() {
        // T1: the spec's example — stale, duplicate and foreign entries are dropped
        let stored = serde_json::json!([
            "diagram:led9x0aaaa",
            "folder:gone0000xx",
            "diagram:led9x0aaaa",
            5,
            "page:x",
            "folder:../up"
        ]);
        let items = vec![
            (key("folder:chk2b7cccc"), 1_761_900_000_000),
            (key("diagram:led9x0aaaa"), 1_761_800_000_000),
            (key("diagram:new7q2eeee"), 1_761_950_000_000),
        ];
        assert_eq!(
            resolve_order(Some(&stored), &items),
            keys(&[
                "diagram:new7q2eeee",
                "folder:chk2b7cccc",
                "diagram:led9x0aaaa"
            ])
        );
        // an order that is not a list counts as none
        assert_eq!(
            resolve_order(Some(&serde_json::json!("x")), &items),
            resolve_order(None, &items)
        );
    }

    #[test]
    fn a_folder_and_a_diagram_with_one_id_are_two_items() {
        // T1
        let items = vec![(key("folder:x"), 1), (key("diagram:x"), 1)];
        let stored = serde_json::json!(["diagram:x", "folder:x"]);
        assert_eq!(
            resolve_order(Some(&stored), &items),
            keys(&["diagram:x", "folder:x"])
        );
    }

    #[test]
    fn placing_takes_the_item_out_first_and_stays_in_bounds() {
        // T1
        let abc = keys(&["folder:a", "diagram:b", "folder:c"]);
        assert_eq!(
            place(abc.clone(), key("folder:c"), 0),
            keys(&["folder:c", "folder:a", "diagram:b"])
        );
        assert_eq!(
            place(abc.clone(), key("folder:a"), 99),
            keys(&["diagram:b", "folder:c", "folder:a"])
        );
        assert_eq!(
            place(abc, key("diagram:n"), 1),
            keys(&["folder:a", "diagram:n", "diagram:b", "folder:c"])
        );
    }

    /// Payments (pay) with Checkout (chk, holding Order flow) and Archive
    /// (arc), and the diagrams Ledger (led) and Payouts (pyt); Onboarding (onb)
    fn payments(dir: &Path) {
        make_folder(dir, "pay", "Payments", None).unwrap();
        make_folder(dir, "onb", "Onboarding", None).unwrap();
        sub(dir, "pay", "chk", "Checkout");
        sub(dir, "pay", "arc", "Archive");
        save(dir, "led", &doc("Ledger schema"), Some("pay")).unwrap();
        save(dir, "pyt", &doc("Payouts"), Some("pay")).unwrap();
        save(dir, "ord", &doc("Order flow"), Some("chk")).unwrap();
    }

    #[test]
    fn the_listing_follows_each_folders_order() {
        // T2
        let dir = scratch();
        payments(&dir);
        let pay = dir.join("pay");
        set_order(
            &pay,
            &["folder:chk", "diagram:pyt", "diagram:led", "folder:arc"],
        );
        let listed = list(&dir).unwrap();
        let p = listed_folder(&listed, "pay").unwrap();
        assert_eq!(
            p.order,
            vec!["folder:chk", "diagram:pyt", "diagram:led", "folder:arc"]
        );
        assert_eq!(sub_ids(&p), vec!["chk", "arc"]);
        assert_eq!(ids(&p), vec!["pyt", "led"]);
        assert_eq!(
            listed_folder(&listed, "chk").unwrap().order,
            vec!["diagram:ord"]
        );
        assert_eq!(
            listed_folder(&listed, "arc").unwrap().order,
            Vec::<String>::new()
        );
        // sent as `order`, a list of keys
        let sent = serde_json::to_value(&p).unwrap();
        assert_eq!(sent["order"][0], "folder:chk");
    }

    #[test]
    fn projects_follow_the_library_order_and_the_stray_listing_comes_last() {
        // T2
        let dir = scratch();
        make_folder(&dir, "a", "A", None).unwrap();
        make_folder(&dir, "b", "B", None).unwrap();
        make_folder(&dir, "c", "C", None).unwrap();
        // b is in no order: it goes on top
        set_order(&dir, &["folder:c", "folder:a"]);
        // something not a folder where My Diagrams would go: the stray listing
        std::fs::write(dir.join(DEFAULT_FOLDER_ID), "x").unwrap();
        std::fs::write(dir.join("old.dosik.json"), doc("Old")).unwrap();
        let listed = list(&dir).unwrap();
        assert_eq!(
            listed.iter().map(|f| &f.id[..]).collect::<Vec<_>>(),
            vec!["b", "c", "a", DEFAULT_FOLDER_ID]
        );
        assert!(listed[3].stray);
        assert_eq!(listed[3].order, vec!["diagram:old"]);
    }

    #[test]
    fn the_first_listing_fixes_the_order_it_shows() {
        // T3: an older build's library keeps the look it had, then stays put
        let dir = scratch();
        payments(&dir);
        forget_orders(&dir);
        touch_later(&dir.join("pay").join("led.dosik.json"), 50);
        let first = list(&dir).unwrap();
        let pay = listed_folder(&first, "pay").unwrap();
        assert_eq!(order_at(&dir.join("pay")), Some(pay.order.clone()));
        assert_eq!(
            pay.order[0], "diagram:led",
            "newest first, as #229 showed it"
        );
        let projects: Vec<String> = first.iter().map(|f| format!("folder:{}", f.id)).collect();
        assert_eq!(order_at(&dir), Some(projects));
        // one item: nothing to fix
        assert_eq!(order_at(&dir.join("pay").join("chk")), None);
        // the next listing writes nothing
        let before = folder_files(&dir);
        std::thread::sleep(std::time::Duration::from_millis(20));
        assert_eq!(list(&dir).unwrap(), first);
        assert_eq!(folder_files(&dir), before);
        // an edit no longer moves a diagram up
        touch_later(&dir.join("pay").join("pyt.dosik.json"), 100);
        let again = listed_folder(&list(&dir).unwrap(), "pay").unwrap();
        assert_eq!(again.order, pay.order);
    }

    #[test]
    fn fixing_leaves_alone_an_order_a_folder_without_its_file_and_other_keys() {
        // T3
        let dir = scratch();
        payments(&dir);
        forget_orders(&dir);
        let pay = dir.join("pay");
        // other keys stay
        let mut meta = folder_json(&dir, "pay");
        meta["x-future"] = serde_json::json!(7);
        meta["board"] = serde_json::json!({"x": 40, "y": 80});
        std::fs::write(pay.join(FOLDER_FILE), meta.to_string()).unwrap();
        // an order that is not a list is someone's: left as it is
        let chk = pay.join("chk");
        save(&dir, "ord2", &doc("Two"), Some("chk")).unwrap();
        let mut chk_meta = folder_json(&pay, "chk");
        chk_meta["order"] = serde_json::json!("hand-made");
        std::fs::write(chk.join(FOLDER_FILE), chk_meta.to_string()).unwrap();
        // a folder with no folder.json gets none
        let bare = pay.join("bare");
        std::fs::create_dir(&bare).unwrap();
        std::fs::write(bare.join("b1.dosik.json"), doc("B1")).unwrap();
        std::fs::write(bare.join("b2.dosik.json"), doc("B2")).unwrap();
        list(&dir).unwrap();
        let after = folder_json(&dir, "pay");
        assert_eq!(after["x-future"], 7);
        assert_eq!(after["board"], serde_json::json!({"x": 40, "y": 80}));
        assert_eq!(after["name"], "Payments");
        assert!(after["order"].is_array());
        assert_eq!(folder_json(&pay, "chk")["order"], "hand-made");
        assert!(!bare.join(FOLDER_FILE).exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_library_whose_order_cannot_be_written_still_lists() {
        // T3
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch();
        payments(&dir);
        forget_orders(&dir);
        let pay = dir.join("pay");
        std::fs::set_permissions(&pay, std::fs::Permissions::from_mode(0o555)).unwrap();
        let listed = list(&dir);
        std::fs::set_permissions(&pay, std::fs::Permissions::from_mode(0o755)).unwrap();
        let listed = listed.unwrap();
        assert_eq!(listed_folder(&listed, "pay").unwrap().order.len(), 4);
        assert_eq!(order_at(&pay), None);
    }

    #[test]
    fn new_folders_and_diagrams_go_to_the_top_of_their_parent() {
        // T4
        let dir = scratch();
        make_folder(&dir, "p", "P", None).unwrap();
        save(&dir, "d1", &doc("D1"), Some("p")).unwrap();
        save(&dir, "d2", &doc("D2"), Some("p")).unwrap();
        assert_eq!(
            order_at(&dir.join("p")).unwrap(),
            vec!["diagram:d2", "diagram:d1"]
        );
        sub(&dir, "p", "f1", "F1");
        assert_eq!(
            order_at(&dir.join("p")).unwrap(),
            vec!["folder:f1", "diagram:d2", "diagram:d1"]
        );
        save(&dir, "d3", &doc("D3"), Some("f1")).unwrap();
        assert_eq!(
            order_at(&dir.join("p").join("f1")).unwrap(),
            vec!["diagram:d3"]
        );
        make_folder(&dir, "q", "Q", None).unwrap();
        assert_eq!(order_at(&dir).unwrap(), vec!["folder:q", "folder:p"]);
        // with no folder said: the latest project's top
        touch_later(&dir.join("p").join("d1.dosik.json"), 50);
        save(&dir, "d4", &doc("D4"), None).unwrap();
        assert_eq!(order_at(&dir.join("p")).unwrap()[0], "diagram:d4");
        // the listing shows it so
        let listed = list(&dir).unwrap();
        assert_eq!(
            listed.iter().map(|f| &f.id[..]).collect::<Vec<_>>(),
            vec!["q", "p"]
        );
        assert_eq!(listed[1].order[0], "diagram:d4");
    }

    #[test]
    fn my_diagrams_made_for_a_first_save_goes_on_top() {
        // T4
        let dir = scratch();
        make_folder(&dir, "p", "P", None).unwrap();
        std::fs::remove_dir_all(dir.join("p")).unwrap();
        save(&dir, "first", &doc("First"), None).unwrap();
        assert_eq!(
            order_at(&dir).unwrap()[0],
            format!("folder:{DEFAULT_FOLDER_ID}")
        );
        assert_eq!(
            order_at(&dir.join(DEFAULT_FOLDER_ID)).unwrap(),
            vec!["diagram:first"]
        );
    }

    #[test]
    fn a_parent_without_an_order_is_fixed_as_it_shows_with_the_new_item_first() {
        // T4
        let dir = scratch();
        make_folder(&dir, "p", "P", None).unwrap();
        save(&dir, "x", &doc("X"), Some("p")).unwrap();
        save(&dir, "y", &doc("Y"), Some("p")).unwrap();
        forget_orders(&dir);
        touch_later(&dir.join("p").join("x.dosik.json"), 50);
        save(&dir, "z", &doc("Z"), Some("p")).unwrap();
        assert_eq!(
            order_at(&dir.join("p")).unwrap(),
            vec!["diagram:z", "diagram:x", "diagram:y"]
        );
    }

    #[test]
    fn saving_a_diagram_that_is_there_leaves_the_order_alone() {
        // T4
        let dir = scratch();
        payments(&dir);
        let before = folder_files(&dir);
        std::thread::sleep(std::time::Duration::from_millis(20));
        save(&dir, "led", &doc("Ledger v2"), None).unwrap();
        save(&dir, "ord", &doc("Order v2"), Some("pay")).unwrap();
        assert_eq!(folder_files(&dir), before);
    }

    #[test]
    fn a_moved_diagram_goes_to_the_top_or_where_it_is_told() {
        // T5
        let dir = scratch();
        payments(&dir);
        let chk = dir.join("pay").join("chk");
        let pay_before = std::fs::read_to_string(dir.join("pay").join(FOLDER_FILE)).unwrap();
        move_to_at(&dir, "led", "chk", None).unwrap();
        assert_eq!(order_at(&chk).unwrap(), vec!["diagram:led", "diagram:ord"]);
        // where it came from is not written: its stale key is dropped when read
        assert_eq!(
            std::fs::read_to_string(dir.join("pay").join(FOLDER_FILE)).unwrap(),
            pay_before
        );
        assert!(!listed_folder(&list(&dir).unwrap(), "pay")
            .unwrap()
            .order
            .contains(&"diagram:led".to_string()));
        move_to_at(&dir, "pyt", "chk", Some(1)).unwrap();
        assert_eq!(
            order_at(&chk).unwrap(),
            vec!["diagram:led", "diagram:pyt", "diagram:ord"]
        );
        // in the same folder: with an index it changes place, without it nothing
        move_to_at(&dir, "led", "chk", Some(99)).unwrap();
        assert_eq!(
            order_at(&chk).unwrap(),
            vec!["diagram:pyt", "diagram:ord", "diagram:led"]
        );
        move_to_at(&dir, "led", "chk", None).unwrap();
        assert_eq!(
            order_at(&chk).unwrap(),
            vec!["diagram:pyt", "diagram:ord", "diagram:led"]
        );
        assert_eq!(load(&dir, "led").unwrap(), doc("Ledger schema"));
        assert!(move_to_at(&dir, "led", "gone", None).is_err());
    }

    #[test]
    fn an_item_takes_its_new_place_among_its_siblings() {
        // T6
        let dir = scratch();
        payments(&dir);
        let pay = dir.join("pay");
        set_order(
            &pay,
            &["folder:chk", "diagram:led", "diagram:pyt", "folder:arc"],
        );
        reorder(&dir, Some("pay"), "diagram:pyt", 1).unwrap();
        assert_eq!(
            order_at(&pay).unwrap(),
            vec!["folder:chk", "diagram:pyt", "diagram:led", "folder:arc"]
        );
        reorder(&dir, Some("pay"), "folder:chk", 99).unwrap();
        assert_eq!(
            order_at(&pay).unwrap(),
            vec!["diagram:pyt", "diagram:led", "folder:arc", "folder:chk"]
        );
        // the projects' order is the library's own
        reorder(&dir, None, "folder:pay", 0).unwrap();
        assert_eq!(order_at(&dir).unwrap(), vec!["folder:pay", "folder:onb"]);
        let root = folder_meta(&dir).unwrap();
        assert!(root.get("createdAt").is_none(), "the library has no birth");
        assert!(root.get("name").is_none());
        assert_eq!(
            list(&dir)
                .unwrap()
                .iter()
                .map(|f| &f.id[..])
                .collect::<Vec<_>>(),
            vec!["pay", "onb"]
        );
    }

    #[test]
    fn reordering_refuses_what_is_not_there() {
        // T6
        let dir = scratch();
        payments(&dir);
        let err = reorder(&dir, Some("pay"), "diagram:ord", 0).unwrap_err();
        assert!(err.contains("is not in"), "{err}");
        assert!(reorder(&dir, None, "diagram:led", 0).is_err());
        assert!(reorder(&dir, None, "folder:chk", 0).is_err());
        for bad in ["led", "page:led", "diagram:../x", "diagram:a/b"] {
            let err = reorder(&dir, Some("pay"), bad, 0).unwrap_err();
            assert!(err.starts_with("invalid item"), "{bad}: {err}");
        }
        assert!(reorder(&dir, Some("gone"), "diagram:led", 0).is_err());
        assert!(reorder(&dir, Some("../pay"), "diagram:led", 0).is_err());
        assert!(reorder(&dir, Some(DEFAULT_FOLDER_ID), "diagram:led", 0).is_err());
        // a folder.json that is not a project file is not overwritten
        std::fs::write(dir.join("pay").join(FOLDER_FILE), "[1,2]").unwrap();
        let err = reorder(&dir, Some("pay"), "diagram:led", 0).unwrap_err();
        assert!(err.contains("not a project file"), "{err}");
        assert_eq!(
            std::fs::read_to_string(dir.join("pay").join(FOLDER_FILE)).unwrap(),
            "[1,2]"
        );
    }

    #[test]
    fn a_folder_moves_with_everything_in_it() {
        // T7
        let dir = scratch();
        payments(&dir);
        move_folder_to(&dir, "chk", "arc", None).unwrap();
        assert!(dir
            .join("pay")
            .join("arc")
            .join("chk")
            .join("ord.dosik.json")
            .is_file());
        assert!(!dir.join("pay").join("chk").exists());
        assert_eq!(
            order_at(&dir.join("pay").join("arc")).unwrap(),
            vec!["folder:chk"]
        );
        assert_eq!(load(&dir, "ord").unwrap(), doc("Order flow"));
        // into another project, at a place
        save(&dir, "o1", &doc("O1"), Some("onb")).unwrap();
        save(&dir, "o2", &doc("O2"), Some("onb")).unwrap();
        move_folder_to(&dir, "chk", "onb", Some(1)).unwrap();
        assert_eq!(
            order_at(&dir.join("onb")).unwrap(),
            vec!["diagram:o2", "folder:chk", "diagram:o1"]
        );
        save(&dir, "ord", &doc("Order v2"), None).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("onb").join("chk").join("ord.dosik.json")).unwrap(),
            doc("Order v2")
        );
        let listed = list(&dir).unwrap();
        assert_eq!(
            sub_ids(&listed_folder(&listed, "onb").unwrap()),
            vec!["chk"]
        );
        assert!(listed_folder(&listed, "arc").unwrap().folders.is_empty());
    }

    #[test]
    fn a_folder_never_goes_inside_itself_and_a_project_stays_a_project() {
        // T7
        let dir = scratch();
        payments(&dir);
        sub(&dir, "chk", "flw", "Flows");
        sub(&dir, "flw", "drf", "Drafts");
        for into in ["chk", "flw", "drf"] {
            let err = move_folder_to(&dir, "chk", into, None).unwrap_err();
            assert_eq!(err, "a folder cannot go inside itself", "into {into}");
        }
        let err = move_folder_to(&dir, "pay", "onb", None).unwrap_err();
        assert_eq!(err, "a project cannot be moved into a folder");
        assert!(move_folder_to(&dir, "gone", "onb", None).is_err());
        assert!(move_folder_to(&dir, "chk", "gone", None).is_err());
        assert!(move_folder_to(&dir, "chk", DEFAULT_FOLDER_ID, None).is_err());
        assert!(move_folder_to(&dir, "../chk", "onb", None).is_err());
        assert!(move_folder_to(&dir, "chk", "a/b", None).is_err());
        assert!(dir.join("pay").join("chk").join("flw").join("drf").is_dir());
    }

    #[test]
    fn a_moved_folder_stays_within_max_depth() {
        // T7: depth(parent) + height(folder) ≤ MAX_DEPTH
        let dir = scratch();
        make_folder(&dir, "top", "Top", None).unwrap();
        let deepest = chain(&dir, "top", MAX_DEPTH - 2); // c8, at depth 9
        sub(&dir, "top", "x", "X");
        sub(&dir, "x", "y", "Y"); // x is two levels tall
        let err = move_folder_to(&dir, "x", &deepest, None).unwrap_err();
        assert_eq!(err, format!("folders nest at most {MAX_DEPTH} levels deep"));
        let above = format!("c{}", MAX_DEPTH - 3); // c7, at depth 8
        move_folder_to(&dir, "x", &above, None).unwrap();
        assert!(listed_folder(&list(&dir).unwrap(), "y").is_some());
    }

    #[test]
    fn a_folder_moved_to_its_own_parent_only_changes_its_place() {
        // T7
        let dir = scratch();
        payments(&dir);
        let pay = dir.join("pay");
        set_order(
            &pay,
            &["folder:chk", "diagram:led", "diagram:pyt", "folder:arc"],
        );
        move_folder_to(&dir, "chk", "pay", None).unwrap();
        assert_eq!(
            order_at(&pay).unwrap(),
            vec!["folder:chk", "diagram:led", "diagram:pyt", "folder:arc"]
        );
        move_folder_to(&dir, "chk", "pay", Some(2)).unwrap();
        assert_eq!(
            order_at(&pay).unwrap(),
            vec!["diagram:led", "diagram:pyt", "folder:chk", "folder:arc"]
        );
    }

    #[test]
    fn the_order_survives_a_rename_and_a_board() {
        // T8
        let dir = scratch();
        payments(&dir);
        let before = order_at(&dir.join("pay")).unwrap();
        retitle_folder(&dir, "pay", "Pay").unwrap();
        assert!(save_boards(&dir, &[placed("pay", spot(8, 8, None))]).is_empty());
        assert_eq!(order_at(&dir.join("pay")).unwrap(), before);
    }

    #[test]
    fn reordering_waits_for_a_folder_file_write() {
        // T8: the same lock as a rename and a board
        let dir = scratch();
        payments(&dir);
        let pay = dir.join("pay");
        set_order(
            &pay,
            &["folder:chk", "diagram:led", "diagram:pyt", "folder:arc"],
        );
        let done = {
            let lib = dir.clone();
            let file = pay.join(FOLDER_FILE);
            let before = std::fs::read_to_string(&file).unwrap();
            while_a_meta_write_holds_the_lock(
                move || reorder(&lib, Some("pay"), "folder:arc", 0),
                move || assert_eq!(std::fs::read_to_string(&file).unwrap(), before),
            )
        };
        done.unwrap();
        assert_eq!(order_at(&pay).unwrap()[0], "folder:arc");
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_folder_is_no_item_of_an_order() {
        // T9
        let dir = scratch();
        payments(&dir);
        let outside = scratch();
        std::fs::create_dir_all(outside.join("lnk")).unwrap();
        std::os::unix::fs::symlink(outside.join("lnk"), dir.join("pay").join("lnk")).unwrap();
        set_order(&dir.join("pay"), &["folder:lnk", "folder:chk"]);
        let pay = listed_folder(&list(&dir).unwrap(), "pay").unwrap();
        assert!(!pay.order.contains(&"folder:lnk".to_string()));
        assert!(reorder(&dir, Some("pay"), "folder:lnk", 0).is_err());
        assert_eq!(order_strings(&keys(&["folder:a"])), vec!["folder:a"]);
    }

    // ------------------------------------------------------- #230

    #[test]
    fn a_folder_moved_while_the_library_is_listed_is_not_lost() {
        // the listing runs off the main thread; a move landing
        // between its look-up of where things are and its walk would drop the
        // moved folder and everything in it from that listing
        let dir = scratch();
        payments(&dir);
        let lib = dir.clone();
        MID_LIST.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                move_folder_to(&lib, "chk", "onb", None).unwrap();
            }));
        });
        let listed = list(&dir).unwrap();
        let onb = listed_folder(&listed, "onb").unwrap();
        assert_eq!(sub_ids(&onb), vec!["chk"]);
        assert_eq!(ids(&listed_folder(&listed, "chk").unwrap()), vec!["ord"]);
        assert!(!sub_ids(&listed_folder(&listed, "pay").unwrap()).contains(&"chk"));
    }

    #[test]
    fn a_diagram_never_moves_over_a_hidden_copy_of_itself() {
        // a copy made by hand keeps its id; the listing shows one,
        // but a move must not overwrite the other
        let dir = scratch();
        make_folder(&dir, "aaa", "A", None).unwrap();
        make_folder(&dir, "zzz", "Z", None).unwrap();
        save(&dir, "dup", &doc("Original"), Some("aaa")).unwrap();
        let copy = dir.join("zzz").join("dup.dosik.json");
        std::fs::write(&copy, doc("Copy")).unwrap();
        let err = move_to_at(&dir, "dup", "zzz", None).unwrap_err();
        assert!(err.contains("already"), "{err}");
        assert_eq!(std::fs::read_to_string(&copy).unwrap(), doc("Copy"));
        assert_eq!(load(&dir, "dup").unwrap(), doc("Original"));
    }

    #[test]
    fn a_folder_never_moves_over_something_of_its_name() {
        // a directory, a file or a link already named as it in the
        // target (walked after the real one, so the id still finds Checkout)
        let dir = scratch();
        payments(&dir);
        make_folder(&dir, "zzz", "Z", None).unwrap();
        let taken = dir.join("zzz").join("chk");
        std::fs::create_dir(&taken).unwrap();
        let err = move_folder_to(&dir, "chk", "zzz", None).unwrap_err();
        assert!(err.contains("already exists"), "{err}");
        assert!(dir.join("pay").join("chk").join("ord.dosik.json").is_file());
        std::fs::remove_dir(&taken).unwrap();
        std::fs::write(&taken, "x").unwrap();
        assert!(move_folder_to(&dir, "chk", "zzz", None).is_err());
        assert!(dir.join("pay").join("chk").is_dir());
        #[cfg(unix)]
        {
            std::fs::remove_file(&taken).unwrap();
            let elsewhere = scratch();
            std::fs::create_dir_all(&elsewhere).unwrap();
            std::os::unix::fs::symlink(&elsewhere, &taken).unwrap();
            assert!(move_folder_to(&dir, "chk", "zzz", None).is_err());
            assert!(dir.join("pay").join("chk").is_dir());
        }
    }

    #[test]
    fn an_order_that_cannot_be_written_does_not_undo_a_move_or_a_new_item() {
        // T8, D4: the item is made or moved all the same
        let dir = scratch();
        payments(&dir);
        let onb = dir.join("onb");
        std::fs::write(onb.join(FOLDER_FILE), "[]").unwrap();
        move_to_at(&dir, "led", "onb", None).unwrap();
        assert!(onb.join("led.dosik.json").is_file());
        make_folder_in(&dir, "fresh", "Fresh", None, Some("onb")).unwrap();
        assert!(onb.join("fresh").is_dir());
        save(&dir, "new", &doc("New"), Some("onb")).unwrap();
        assert!(onb.join("new.dosik.json").is_file());
        move_folder_to(&dir, "chk", "onb", None).unwrap();
        assert!(onb.join("chk").join("ord.dosik.json").is_file());
        // the file that is not a project file is left as it is
        assert_eq!(
            std::fs::read_to_string(onb.join(FOLDER_FILE)).unwrap(),
            "[]"
        );
        // and all of it is listed — newest first, the folder having no order
        let listed = list(&dir).unwrap();
        let o = listed_folder(&listed, "onb").unwrap();
        assert_eq!(o.order.len(), 4);
        assert_eq!(o.order[0], "diagram:new");
    }

    #[cfg(unix)]
    #[test]
    fn a_diagram_stuck_at_the_top_moves_among_my_diagrams() {
        // a diagram that could not move into My Diagrams is listed
        // there; its place among the folder's items can change like theirs
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch();
        make_folder(&dir, DEFAULT_FOLDER_ID, DEFAULT_FOLDER_NAME, None).unwrap();
        save(&dir, "kept", &doc("Kept"), Some(DEFAULT_FOLDER_ID)).unwrap();
        save(&dir, "kept2", &doc("Kept 2"), Some(DEFAULT_FOLDER_ID)).unwrap();
        std::fs::write(dir.join("stuck.dosik.json"), doc("Stuck")).unwrap();
        // the library itself cannot be written: the file stays at the top
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();
        let first = list(&dir);
        let reordered = reorder(&dir, Some(DEFAULT_FOLDER_ID), "diagram:stuck", 2);
        let after = list(&dir);
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        let first = first.unwrap();
        let mine = first.iter().find(|f| f.id == DEFAULT_FOLDER_ID).unwrap();
        assert!(mine.order.contains(&"diagram:stuck".to_string()));
        reordered.unwrap();
        let mine = after
            .unwrap()
            .into_iter()
            .find(|f| f.id == DEFAULT_FOLDER_ID)
            .unwrap();
        assert_eq!(mine.order[2], "diagram:stuck");
        assert_eq!(ids(&mine)[2], "stuck");
    }

    // ------------------------------------------------------- #230

    /// Runs the listing's adoption on another thread from inside a write and
    /// waits a little for it: done at once when nothing holds it back, still
    /// waiting when the write holds `META_LOCK` (#230).
    fn adopt_meanwhile(dir: &Path) -> std::sync::mpsc::Receiver<()> {
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let lib = dir.to_path_buf();
        MID_WRITE.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                let (tx, rx) = std::sync::mpsc::channel();
                std::thread::spawn(move || {
                    let _ = adopt_loose_diagrams(&lib);
                    let _ = tx.send(());
                    let _ = done_tx.send(());
                });
                let _ = rx.recv_timeout(std::time::Duration::from_millis(300));
            }));
        });
        done_rx
    }

    fn copies_of(dir: &Path, id: &str) -> Vec<PathBuf> {
        let file = format!("{id}{EXT}");
        walk_folders(dir)
            .into_iter()
            .map(|f| f.path.join(&file))
            .chain(std::iter::once(dir.join(&file)))
            .filter(|p| p.is_file())
            .collect()
    }

    #[test]
    fn a_save_of_a_diagram_at_the_top_never_leaves_two_copies() {
        // the listing adopts diagrams at the top off the main
        // thread; one landing in the middle of a save of such a diagram left
        // the save writing it back at the top — two copies, the edit in one
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        std::fs::write(dir.join("loose.dosik.json"), doc("Old")).unwrap();
        let adopted = adopt_meanwhile(&dir);
        save(&dir, "loose", &doc("New"), None).unwrap();
        adopted
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        let copies = copies_of(&dir, "loose");
        assert_eq!(copies.len(), 1, "{copies:?}");
        assert_eq!(load(&dir, "loose").unwrap(), doc("New"));
    }

    #[test]
    fn a_delete_of_a_diagram_at_the_top_is_not_beaten_by_the_listing() {
        // the adoption moved the file away under the delete
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        std::fs::write(dir.join("loose.dosik.json"), doc("Old")).unwrap();
        let adopted = adopt_meanwhile(&dir);
        let deleted = delete(&dir, "loose");
        adopted
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        deleted.unwrap();
        assert!(copies_of(&dir, "loose").is_empty());
    }

    #[test]
    fn a_move_of_a_diagram_at_the_top_is_not_beaten_by_the_listing() {
        // the adoption moved the file away under the move
        let dir = scratch();
        make_folder(&dir, "pay", "Payments", None).unwrap();
        std::fs::write(dir.join("loose.dosik.json"), doc("Old")).unwrap();
        let adopted = adopt_meanwhile(&dir);
        let moved = move_to_at(&dir, "loose", "pay", None);
        adopted
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        moved.unwrap();
        assert_eq!(
            copies_of(&dir, "loose"),
            vec![dir.join("pay").join("loose.dosik.json")]
        );
    }

    #[test]
    fn a_first_save_and_the_listing_make_my_diagrams_once() {
        // with no project yet, a save and the listing's
        // adoption both made My Diagrams — one of them failed on the other's
        let dir = scratch();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("loose.dosik.json"), doc("Old")).unwrap();
        let adopted = adopt_meanwhile(&dir);
        save(&dir, "fresh", &doc("Fresh"), None).unwrap();
        adopted
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        let mine = dir.join(DEFAULT_FOLDER_ID);
        assert!(mine.join("fresh.dosik.json").is_file());
        assert!(mine.join("loose.dosik.json").is_file());
        assert_eq!(
            folder_meta(&mine).and_then(|m| m.get("name").cloned()),
            Some(Value::from(DEFAULT_FOLDER_NAME))
        );
    }

    #[test]
    fn a_walk_counts_as_whole_only_when_no_change_was_under_way() {
        // a seqlock — odd is a change under way
        assert!(settled(4, 4));
        assert!(!settled(4, 6));
        assert!(!settled(5, 5));
        assert!(!settled(5, 6));
    }

    thread_local! {
        /// a change a test began and has not ended yet
        static UNDER_WAY: std::cell::RefCell<Option<Restructure<'static>>> = const { std::cell::RefCell::new(None) };
    }

    #[test]
    fn a_listing_that_saw_a_move_whose_count_had_not_moved_walks_again() {
        // the count moved only after the rename — a walk that
        // saw the rename and ended before the count moved gave a listing
        // without the moved folder and all it holds
        let dir = scratch();
        payments(&dir);
        let lib = dir.clone();
        MID_LIST.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                let change = Restructure::unguarded_for_tests();
                std::fs::rename(lib.join("pay").join("chk"), lib.join("onb").join("chk")).unwrap();
                UNDER_WAY.with(|c| *c.borrow_mut() = Some(change));
            }));
        });
        let listed = list(&dir).unwrap();
        UNDER_WAY.with(|c| c.borrow_mut().take());
        assert_eq!(
            sub_ids(&listed_folder(&listed, "onb").unwrap()),
            vec!["chk"]
        );
        assert_eq!(ids(&listed_folder(&listed, "chk").unwrap()), vec!["ord"]);
    }

    #[test]
    fn save_project_runs_on_the_main_thread() {
        // `save` writes a diagram in a folder without the
        // lock because `save_project` is a sync command — run on the main
        // thread, in turn with the moves and deletes. Made async, that branch
        // must be looked at again.
        let source = include_str!("library.rs");
        let at = source
            .find("pub fn save_project(")
            .expect("save_project, a plain fn");
        let attribute = &source[source[..at].rfind("#[tauri::command").unwrap()..at];
        assert!(!attribute.contains("async"), "{attribute}");
        assert!(!source.contains(concat!("async fn ", "save_project")));
    }
}
