//! The older library, as an older build kept it — read once, to move it into
//! real folders (`migrate`). Nothing here writes.
//!
//! ```text
//! projects/                          <- the library
//!   folder.json                      <- {"order"} — the projects' order, nothing else
//!   <folderId>/folder.json           <- {"name", "createdAt", "board"?, "order"?} — a project
//!   <folderId>/<id>.dosik.json       <- a diagram
//!   <folderId>/<subId>/folder.json   <- {"name", "createdAt", "order"?} — a folder in it
//!   <id>.dosik.json                  <- a diagram from before projects
//! ```
//!
//! It reads the library the way the older build listed it:
//!
//! - A folder's items are in the order its `folder.json` names them
//!   (`folder:<id>`, `diagram:<id>`); what the order misses goes on top,
//!   newest first.
//! - Ids are unique across the library: a directory copied by hand repeats
//!   them, and what repeats one is not listed — the older build looked for
//!   an id depth first, then at the top.
//! - Folders nest at most `MAX_DEPTH` deep; symbolic links are never followed.
//! - Diagrams at the top of the library belong to My Diagrams — or, with no
//!   such project, to a listing of their own, last.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde_json::Value;

/// One diagram: its id, and when it was last written (ms since the epoch).
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct ProjectMeta {
    pub id: String,
    pub updated_at: u64,
}

/// Where a project's frame sat on the Home canvas.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct BoardSpot {
    pub x: i64,
    pub y: i64,
    pub collapsed: Option<bool>,
}

/// how far from the board's origin a frame may have been placed, either way
const BOARD_LIMIT: i64 = 1_000_000;

impl BoardSpot {
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

/// One project — or a folder inside one — with its diagrams and its folders,
/// in the user's order.
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct FolderMeta {
    pub id: String,
    pub name: String,
    /// the newest edit of a diagram or folder in it, or when the folder was
    /// made if it is empty
    pub updated_at: u64,
    pub diagrams: Vec<ProjectMeta>,
    pub folders: Vec<FolderMeta>,
    /// its items, folders and diagrams mixed, in order — every item once
    pub order: Vec<String>,
    /// a project's frame on the Home canvas — never a folder's
    pub board: Option<BoardSpot>,
}

/// where diagrams at the top of the library belong
pub const DEFAULT_FOLDER_ID: &str = "my-diagrams";
pub const DEFAULT_FOLDER_NAME: &str = "My Diagrams";
/// a folder whose `folder.json` names nothing
const UNNAMED_PROJECT: &str = "Untitled Project";
const UNNAMED_SUBFOLDER: &str = "Untitled Folder";
/// how deep folders nest — a project is level 1
pub const MAX_DEPTH: usize = 10;
const FOLDER_FILE: &str = "folder.json";
const EXT: &str = ".dosik.json";

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
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
            (valid_id(&id) && entry.file_type().is_ok_and(|t| t.is_dir()))
                .then(|| (id, entry.path()))
        })
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Every folder in the library at any depth, depth first and by name, no
/// deeper than `MAX_DEPTH`.
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

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `(id, path)` of every diagram file directly inside `dir` — links never
fn diagram_files(dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let id = name.to_str()?.strip_suffix(EXT)?.to_string();
            (valid_id(&id) && entry.file_type().is_ok_and(|t| t.is_file()))
                .then(|| (id, entry.path()))
        })
        .collect()
}

fn folder_meta(path: &Path) -> Option<Value> {
    std::fs::read_to_string(path.join(FOLDER_FILE))
        .ok()
        .and_then(|c| serde_json::from_str::<Value>(&c).ok())
}

/// A folder's name, birth, board place and order — `folder.json` parsed once.
struct FolderInfo {
    name: String,
    created: u64,
    board: Option<BoardSpot>,
    order: Option<Value>,
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
        // kept in the file, not read off its mtime: a rename rewrote it
        created: meta
            .as_ref()
            .and_then(|v| v.get("createdAt").and_then(Value::as_u64))
            .unwrap_or_else(|| modified_ms(&path.join(FOLDER_FILE))),
        board: meta.as_ref().and_then(BoardSpot::read),
        order: meta.as_ref().and_then(|v| v.get("order")).cloned(),
    }
}

/// Where each folder id and each diagram id is found first — what the older
/// build's every lookup by id landed on.
struct FirstSeen {
    folders: HashMap<String, PathBuf>,
    diagrams: HashMap<String, PathBuf>,
}

fn first_seen(dir: &Path) -> FirstSeen {
    let mut seen = FirstSeen {
        folders: HashMap::new(),
        diagrams: HashMap::new(),
    };
    // the order the older build looked in: every folder, depth first, then the top
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

/// The folders directly inside `path` that are listed: each id once.
fn listed_children(path: &Path, seen: &FirstSeen) -> Vec<(String, PathBuf)> {
    child_dirs(path)
        .into_iter()
        .filter(|(id, sub)| seen.folders.get(id) == Some(sub))
        .collect()
}

/// The diagrams in `folder` that are listed: each id once.
fn list_diagrams(folder: &Path, seen: &FirstSeen) -> Vec<ProjectMeta> {
    diagram_files(folder)
        .into_iter()
        .filter(|(id, path)| seen.diagrams.get(id) == Some(path))
        .map(|(id, path)| ProjectMeta {
            id,
            updated_at: modified_ms(&path),
        })
        .collect()
}

/// An item of a folder, as its parent's order names it.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum ItemKey {
    Folder(String),
    Diagram(String),
}

impl ItemKey {
    fn parse(key: &str) -> Option<ItemKey> {
        let (kind, id) = key.split_once(':')?;
        if !valid_id(id) {
            return None;
        }
        match kind {
            "folder" => Some(ItemKey::Folder(id.to_string())),
            "diagram" => Some(ItemKey::Diagram(id.to_string())),
            _ => None,
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

/// A folder's items in the order it shows them: what `stored` names, each
/// once and only if it is there, after what it misses — those on top,
/// newest first, ties to the lower key. No order (or one that is not a list)
/// is all on top.
fn resolve_order(stored: Option<&Value>, items: &[(ItemKey, u64)]) -> Vec<ItemKey> {
    let present: HashSet<&ItemKey> = items.iter().map(|(k, _)| k).collect();
    let mut listed: Vec<ItemKey> = Vec::new();
    let mut taken = HashSet::new();
    if let Some(Value::Array(entries)) = stored {
        for entry in entries {
            let Some(key) = entry.as_str().and_then(ItemKey::parse) else {
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

/// `folders` and `diagrams` in the places `order` gives them.
fn arrange(order: &[ItemKey], folders: &mut [FolderMeta], diagrams: &mut [ProjectMeta]) {
    let at: HashMap<&ItemKey, usize> = order.iter().enumerate().map(|(i, k)| (k, i)).collect();
    let place_of = |k: ItemKey| at.get(&k).copied().unwrap_or(usize::MAX);
    folders.sort_by_key(|f| place_of(ItemKey::Folder(f.id.clone())));
    diagrams.sort_by_key(|d| place_of(ItemKey::Diagram(d.id.clone())));
}

fn items_of(folders: &[FolderMeta], diagrams: &[ProjectMeta]) -> Vec<(ItemKey, u64)> {
    folders
        .iter()
        .map(|f| (ItemKey::Folder(f.id.clone()), f.updated_at))
        .chain(
            diagrams
                .iter()
                .map(|d| (ItemKey::Diagram(d.id.clone()), d.updated_at)),
        )
        .collect()
}

fn newest_in(diagrams: &[ProjectMeta], folders: &[FolderMeta]) -> Option<u64> {
    diagrams
        .iter()
        .map(|d| d.updated_at)
        .chain(folders.iter().map(|f| f.updated_at))
        .max()
}

/// One folder with everything under it, down to `MAX_DEPTH`, its items in
/// its order. Only a project (`depth` 1) carries its board.
fn list_folder(id: String, path: &Path, depth: usize, seen: &FirstSeen) -> FolderMeta {
    let mut diagrams = list_diagrams(path, seen);
    let info = folder_info(path, depth);
    let mut folders: Vec<FolderMeta> = if depth < MAX_DEPTH {
        listed_children(path, seen)
            .into_iter()
            .map(|(id, sub)| list_folder(id, &sub, depth + 1, seen))
            .collect()
    } else {
        Vec::new()
    };
    let order = resolve_order(info.order.as_ref(), &items_of(&folders, &diagrams));
    arrange(&order, &mut folders, &mut diagrams);
    FolderMeta {
        id,
        name: info.name,
        updated_at: newest_in(&diagrams, &folders).unwrap_or(info.created),
        diagrams,
        folders,
        order: order.iter().map(ToString::to_string).collect(),
        board: if depth == 1 { info.board } else { None },
    }
}

/// The older library as it listed, with where each diagram is.
pub struct ReadOnly {
    /// every project, in the user's order, with its folders and diagrams in
    /// theirs; diagrams at the top of the library under My Diagrams — or,
    /// with no such project, in a listing of their own, last
    pub folders: Vec<FolderMeta>,
    /// where each diagram id is found first
    pub diagram_paths: HashMap<String, PathBuf>,
}

/// Reads the older library in `dir` — nothing made, moved or written.
pub fn read_only(dir: &Path) -> ReadOnly {
    let seen = first_seen(dir);
    let mut out: Vec<FolderMeta> = listed_children(dir, &seen)
        .into_iter()
        .map(|(id, path)| list_folder(id, &path, 1, &seen))
        .collect();
    let root = folder_meta(dir);
    let order = resolve_order(
        root.as_ref().and_then(|m| m.get("order")),
        &items_of(&out, &[]),
    );
    arrange(&order, &mut out, &mut []);
    let stuck = list_diagrams(dir, &seen);
    if !stuck.is_empty() {
        match out.iter_mut().find(|f| f.id == DEFAULT_FOLDER_ID) {
            Some(default) => {
                // items of My Diagrams like its own: in its order, or on top
                default.diagrams.extend(stuck);
                let stored = folder_meta(&dir.join(DEFAULT_FOLDER_ID));
                let order = resolve_order(
                    stored.as_ref().and_then(|m| m.get("order")),
                    &items_of(&default.folders, &default.diagrams),
                );
                arrange(&order, &mut default.folders, &mut default.diagrams);
                default.order = order.iter().map(ToString::to_string).collect();
                default.updated_at =
                    newest_in(&default.diagrams, &default.folders).unwrap_or(default.updated_at);
            }
            None => {
                let order = resolve_order(None, &items_of(&[], &stuck));
                let mut diagrams = stuck;
                arrange(&order, &mut [], &mut diagrams);
                out.push(FolderMeta {
                    id: DEFAULT_FOLDER_ID.to_string(),
                    name: DEFAULT_FOLDER_NAME.to_string(),
                    updated_at: newest_in(&diagrams, &[]).unwrap_or(0),
                    diagrams,
                    folders: Vec::new(),
                    order: order.iter().map(ToString::to_string).collect(),
                    board: None,
                });
            }
        }
    }
    ReadOnly {
        folders: out,
        diagram_paths: seen.diagrams,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::disk::tests::scratch;
    use std::time::{Duration, SystemTime};

    fn doc(title: &str) -> String {
        format!(r#"{{"version":1,"title":"{title}","nodes":[],"edges":[]}}"#)
    }

    fn put(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// a folder as the older build wrote it
    fn folder(path: &Path, meta: &str) {
        put(&path.join(FOLDER_FILE), meta);
    }

    fn set_mtime(path: &Path, secs: u64) {
        std::fs::OpenOptions::new()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1_600_000_000 + secs))
            .unwrap();
    }

    fn ids(list: &[FolderMeta]) -> Vec<&str> {
        list.iter().map(|f| f.id.as_str()).collect()
    }

    fn diagram_ids(folder: &FolderMeta) -> Vec<&str> {
        folder.diagrams.iter().map(|d| d.id.as_str()).collect()
    }

    fn tree(dir: &Path) -> Vec<(String, Vec<u8>)> {
        fn walk(dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
            let mut entries: Vec<_> = std::fs::read_dir(dir).unwrap().flatten().collect();
            entries.sort_by_key(|e| e.file_name());
            for entry in entries {
                let path = entry.path();
                if entry.file_type().unwrap().is_dir() {
                    out.push((path.display().to_string(), Vec::new()));
                    walk(&path, out);
                } else {
                    out.push((path.display().to_string(), std::fs::read(&path).unwrap()));
                }
            }
        }
        let mut out = Vec::new();
        walk(dir, &mut out);
        out
    }

    #[test]
    fn folders_and_diagrams_are_read_in_each_folders_order() {
        let dir = scratch("legacy-order");
        folder(&dir, r#"{"order":["folder:onb","folder:pay"]}"#);
        folder(
            &dir.join("pay"),
            r#"{"name":"Payments","createdAt":1,"board":{"x":1,"y":2},
                "order":["folder:chk","diagram:pyt","diagram:led","folder:arc"]}"#,
        );
        folder(&dir.join("onb"), r#"{"name":"Onboarding","createdAt":1}"#);
        folder(
            &dir.join("pay/chk"),
            r#"{"name":"Checkout","createdAt":1,"board":{"x":9,"y":9}}"#,
        );
        folder(&dir.join("pay/arc"), r#"{"name":"Archive","createdAt":1}"#);
        put(&dir.join("pay/led.dosik.json"), &doc("Ledger"));
        put(&dir.join("pay/pyt.dosik.json"), &doc("Payouts"));
        put(&dir.join("pay/chk/ord.dosik.json"), &doc("Order"));
        let read = read_only(&dir);
        assert_eq!(ids(&read.folders), vec!["onb", "pay"]);
        let pay = &read.folders[1];
        assert_eq!(pay.name, "Payments");
        assert_eq!(
            pay.order,
            vec!["folder:chk", "diagram:pyt", "diagram:led", "folder:arc"]
        );
        assert_eq!(ids(&pay.folders), vec!["chk", "arc"]);
        assert_eq!(diagram_ids(pay), vec!["pyt", "led"]);
        assert_eq!(
            pay.board,
            Some(BoardSpot {
                x: 1,
                y: 2,
                collapsed: None
            })
        );
        // a folder inside a project has no board, whatever its file says
        assert_eq!(pay.folders[0].board, None);
        assert_eq!(pay.folders[0].order, vec!["diagram:ord"]);
        assert_eq!(
            read.diagram_paths["ord"],
            dir.join("pay").join("chk").join("ord.dosik.json")
        );
    }

    #[test]
    fn what_an_order_misses_goes_on_top_newest_first() {
        let dir = scratch("legacy-unordered");
        folder(
            &dir.join("pay"),
            r#"{"name":"Payments","createdAt":1,"order":["diagram:a","folder:gone","diagram:a",5]}"#,
        );
        for (id, secs) in [("a", 10), ("b", 30), ("c", 20)] {
            let file = dir.join("pay").join(format!("{id}{EXT}"));
            put(&file, &doc(id));
            set_mtime(&file, secs);
        }
        let read = read_only(&dir);
        assert_eq!(
            read.folders[0].order,
            vec!["diagram:b", "diagram:c", "diagram:a"]
        );
        // with no order at all, the projects go newest first too
        folder(&dir.join("old"), r#"{"name":"Old","createdAt":1}"#);
        folder(
            &dir.join("new"),
            r#"{"name":"New","createdAt":99999999999999}"#,
        );
        assert_eq!(ids(&read_only(&dir).folders), vec!["new", "pay", "old"]);
    }

    #[test]
    fn diagrams_at_the_top_belong_to_my_diagrams_or_a_listing_of_their_own() {
        let dir = scratch("legacy-stray");
        folder(&dir.join("pay"), r#"{"name":"Payments","createdAt":1}"#);
        put(&dir.join("loose.dosik.json"), &doc("Loose"));
        let read = read_only(&dir);
        assert_eq!(ids(&read.folders), vec!["pay", DEFAULT_FOLDER_ID]);
        let stray = &read.folders[1];
        assert_eq!(stray.name, DEFAULT_FOLDER_NAME);
        assert_eq!(stray.order, vec!["diagram:loose"]);
        assert_eq!(read.diagram_paths["loose"], dir.join("loose.dosik.json"));
        // with My Diagrams there, they are among its own
        folder(
            &dir.join(DEFAULT_FOLDER_ID),
            r#"{"name":"Mine","createdAt":1,"order":["diagram:kept"]}"#,
        );
        put(
            &dir.join(DEFAULT_FOLDER_ID).join("kept.dosik.json"),
            &doc("Kept"),
        );
        let read = read_only(&dir);
        let mine = read
            .folders
            .iter()
            .find(|f| f.id == DEFAULT_FOLDER_ID)
            .unwrap();
        assert_eq!(mine.name, "Mine");
        assert_eq!(mine.order, vec!["diagram:loose", "diagram:kept"]);
    }

    #[test]
    fn an_id_copied_by_hand_is_read_once_where_the_older_build_looked_first() {
        let dir = scratch("legacy-dup");
        folder(&dir.join("pay"), r#"{"name":"Payments","createdAt":1}"#);
        folder(&dir.join("side"), r#"{"name":"Side","createdAt":1}"#);
        folder(&dir.join("pay/chk"), r#"{"name":"Checkout","createdAt":1}"#);
        folder(&dir.join("side/chk"), r#"{"name":"Copy","createdAt":1}"#);
        put(&dir.join("pay/dup.dosik.json"), &doc("Original"));
        put(&dir.join("side/chk/dup.dosik.json"), &doc("Copy"));
        let read = read_only(&dir);
        let pay = read.folders.iter().find(|f| f.id == "pay").unwrap();
        let side = read.folders.iter().find(|f| f.id == "side").unwrap();
        assert_eq!(ids(&pay.folders), vec!["chk"]);
        assert!(side.folders.is_empty());
        assert_eq!(diagram_ids(pay), vec!["dup"]);
        assert_eq!(
            read.diagram_paths["dup"],
            dir.join("pay").join("dup.dosik.json")
        );
    }

    #[test]
    fn names_are_read_leniently_and_odd_entries_skipped() {
        let dir = scratch("legacy-names");
        folder(&dir.join("broken"), "{not json");
        folder(&dir.join("blank"), r#"{"name":"  "}"#);
        folder(&dir.join("blank/sub"), r#"{"createdAt":1}"#);
        std::fs::create_dir_all(dir.join("bad id")).unwrap();
        put(&dir.join("blank/notes.txt"), "x");
        put(&dir.join("blank/p2.dosik.json.1-2.tmp"), "x");
        put(&dir.join("blank/bad id.dosik.json"), &doc("x"));
        let read = read_only(&dir);
        let names: Vec<(&str, &str)> = read
            .folders
            .iter()
            .map(|f| (f.id.as_str(), f.name.as_str()))
            .collect();
        assert!(names.contains(&("broken", UNNAMED_PROJECT)));
        assert!(names.contains(&("blank", UNNAMED_PROJECT)));
        assert_eq!(read.folders.len(), 2);
        let blank = read.folders.iter().find(|f| f.id == "blank").unwrap();
        assert_eq!(blank.folders[0].name, UNNAMED_SUBFOLDER);
        assert!(blank.diagrams.is_empty());
    }

    #[test]
    fn boards_are_read_leniently() {
        let dir = scratch("legacy-boards");
        let cases = [
            ("none", r#"{"name":"n"}"#),
            ("array", r#"{"name":"n","board":[1,2]}"#),
            ("text", r#"{"name":"n","board":{"x":"1","y":2}}"#),
            ("half", r#"{"name":"n","board":{"x":1}}"#),
            ("far", r#"{"name":"n","board":{"x":1000001,"y":0}}"#),
            (
                "odd",
                r#"{"name":"n","board":{"x":1,"y":2,"collapsed":"yes"}}"#,
            ),
            (
                "round",
                r#"{"name":"n","board":{"x":10.6,"y":-20.4,"collapsed":false}}"#,
            ),
        ];
        for (id, meta) in cases {
            folder(&dir.join(id), meta);
        }
        let read = read_only(&dir);
        let board = |id: &str| read.folders.iter().find(|f| f.id == id).unwrap().board;
        for id in ["none", "array", "text", "half", "far"] {
            assert_eq!(board(id), None, "{id}");
        }
        assert_eq!(
            board("odd"),
            Some(BoardSpot {
                x: 1,
                y: 2,
                collapsed: None
            })
        );
        assert_eq!(
            board("round"),
            Some(BoardSpot {
                x: 11,
                y: -20,
                collapsed: Some(false)
            })
        );
    }

    #[test]
    fn folders_deeper_than_max_depth_are_not_read() {
        let dir = scratch("legacy-deep");
        let mut at = dir.join("f1");
        folder(&at, r#"{"name":"1"}"#);
        for n in 2..=MAX_DEPTH + 1 {
            at = at.join(format!("f{n}"));
            folder(&at, &format!(r#"{{"name":"{n}"}}"#));
        }
        put(&at.join("deep.dosik.json"), &doc("Deep"));
        let read = read_only(&dir);
        let mut level = &read.folders[0];
        let mut depth = 1;
        while let Some(next) = level.folders.first() {
            level = next;
            depth += 1;
        }
        assert_eq!(depth, MAX_DEPTH);
        assert!(!read.diagram_paths.contains_key("deep"));
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_links_are_never_followed() {
        use std::os::unix::fs::symlink;
        let dir = scratch("legacy-links");
        let outside = scratch("legacy-links-out");
        folder(&dir.join("pay"), r#"{"name":"Payments"}"#);
        folder(&outside.join("ext"), r#"{"name":"Ext"}"#);
        put(&outside.join("ext/far.dosik.json"), &doc("Far"));
        put(&outside.join("x.dosik.json"), &doc("X"));
        symlink(outside.join("ext"), dir.join("pay").join("ext")).unwrap();
        symlink(outside.join("ext"), dir.join("ext2")).unwrap();
        symlink(
            outside.join("x.dosik.json"),
            dir.join("pay").join("x.dosik.json"),
        )
        .unwrap();
        let read = read_only(&dir);
        assert_eq!(ids(&read.folders), vec!["pay"]);
        assert!(read.folders[0].folders.is_empty());
        assert!(read.folders[0].diagrams.is_empty());
        assert!(read.diagram_paths.is_empty());
    }

    #[test]
    fn reading_writes_nothing() {
        let dir = scratch("legacy-nowrite");
        folder(&dir.join("pay"), r#"{"name":"Payments"}"#);
        folder(&dir.join("arc"), r#"{"name":"Archive"}"#);
        put(&dir.join("pay/a.dosik.json"), &doc("A"));
        put(&dir.join("pay/b.dosik.json"), &doc("B"));
        put(&dir.join("loose.dosik.json"), &doc("Loose"));
        let before = tree(&dir);
        read_only(&dir);
        assert_eq!(tree(&dir), before);
        // an empty or absent library reads as nothing, and is not made
        let none = dir.join("absent");
        assert!(read_only(&none).folders.is_empty());
        assert!(!none.exists());
    }
}
