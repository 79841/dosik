//! The app's own record of the library, `<app data>/library/state.json` —
//! everything about the projects that is not in their folders, which hold
//! nothing of Dosik's but the diagrams:
//!
//! ```text
//! { "v": 1,
//!   "migration": { "from", "to", "at" },        <- the older library moved, once
//!   "defaultLocation": "/…/Documents/Dosik",     <- where new projects go now
//!   "chosenLocation": "/…/Dropbox/Dosik",        <- the one picked in Settings
//!   "projects": [                               <- in the user's order
//!     { "id", "path",                            <- a folder anywhere on disk
//!       "board": { "x", "y", "collapsed"? },     <- its frame on the Home canvas
//!       "ids":   { "Sub/Flow.dosik": "<id>" },   <- what the app calls each item
//!       "order": { "": ["Sub", "Flow.dosik"] },  <- each folder's items, by name
//!       "keptAdded": true }                      <- added, lost, and kept so
//!   ] }
//! ```
//!
//! Keys are paths relative to the project, `/` between names, `""` the
//! project itself. A project whose folder cannot be found keeps its entry,
//! so it comes back whole when it is found. Only the app writes the file,
//! atomically; one it cannot parse is put aside and the library starts over.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::disk::{self, rel_within, split_rel, valid_rel};
use super::names::{display_name, natural_cmp};

pub const STATE_VERSION: u64 = 1;
pub const STATE_FILE: &str = "state.json";

/// how far from the board's origin a frame may be placed, either way
pub const BOARD_LIMIT: i64 = 1_000_000;

/// Where a project's frame sits on the Home canvas: its top-left corner in
/// board units, and whether its diagrams are folded into a stack — `None`
/// leaves that to the frame's size.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct BoardSpot {
    pub x: i64,
    pub y: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collapsed: Option<bool>,
}

impl BoardSpot {
    pub fn check(&self) -> Result<(), String> {
        // a range, not `abs`: `i64::MIN.abs()` overflows
        let range = -BOARD_LIMIT..=BOARD_LIMIT;
        if !range.contains(&self.x) || !range.contains(&self.y) {
            return Err(format!(
                "a place on the board is within {BOARD_LIMIT} of the origin"
            ));
        }
        Ok(())
    }

    /// Read leniently, as from a file someone may have edited: a number that
    /// is not whole is rounded, a place out of range or of the wrong shape is
    /// no place, a `collapsed` that is not a bool is left out.
    fn read(value: &Value) -> Option<BoardSpot> {
        let board = value.as_object()?;
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

/// Ids are `[A-Za-z0-9_-]`, 1 to 32 of them — what the webview makes, and
/// all that is ever looked up.
pub fn validate_id(id: &str) -> Result<(), String> {
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

/// When the older library was moved here, from where to where.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
pub struct Migration {
    pub from: String,
    pub to: String,
    pub at: u64,
}

/// One project as the record keeps it.
#[derive(Serialize, Debug, PartialEq, Eq, Clone)]
pub struct ProjectRecord {
    pub id: String,
    /// the folder, whole
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board: Option<BoardSpot>,
    /// relative path → id, for every folder and diagram the app has named
    pub ids: BTreeMap<String, String>,
    /// relative folder → its items' names in the user's order
    pub order: BTreeMap<String, Vec<String>>,
    /// A folder added from elsewhere that could not be found when the
    /// default location moved onto its parent: it stays one added — not
    /// found, never forgotten — until it is found, located or removed.
    #[serde(rename = "keptAdded", skip_serializing_if = "std::ops::Not::not")]
    pub kept_added: bool,
}

impl ProjectRecord {
    pub fn new(id: &str, path: &Path) -> Result<ProjectRecord, String> {
        validate_id(id)?;
        Ok(ProjectRecord {
            id: id.to_string(),
            path: path_text(path)?,
            board: None,
            ids: BTreeMap::new(),
            order: BTreeMap::new(),
            kept_added: false,
        })
    }

    pub fn root(&self) -> PathBuf {
        PathBuf::from(&self.path)
    }

    /// the relative path the item `id` is at in this project
    pub fn rel_of(&self, id: &str) -> Option<&str> {
        self.ids
            .iter()
            .find(|(_, v)| v.as_str() == id)
            .map(|(k, _)| k.as_str())
    }
}

/// a path as the record writes it — the record is JSON, so UTF-8 only
pub fn path_text(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| format!("{}: not a UTF-8 path", path.display()))
}

/// Where an id is: a project (`rel` `None`) or an item in one.
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct Found {
    pub project: usize,
    pub rel: Option<String>,
}

/// The whole record.
#[derive(Serialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryState {
    pub v: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub migration: Option<Migration>,
    /// where new projects go now — what the MCP server reads
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_location: Option<String>,
    /// the default location picked in Settings, where the next run starts —
    /// apart from the one in use, which a run told elsewhere writes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chosen_location: Option<String>,
    pub projects: Vec<ProjectRecord>,
}

impl Default for LibraryState {
    fn default() -> Self {
        LibraryState {
            v: STATE_VERSION,
            migration: None,
            default_location: None,
            chosen_location: None,
            projects: Vec::new(),
        }
    }
}

/// The record in `dir`: none yet is an empty one. One that is not a JSON
/// object is put aside as `state.json.broken-<ms>` and the library starts
/// over — the older library is never moved again for it, its own marker
/// says so. One that cannot be read at all is an error: starting over then
/// would lose every id while the file is still there.
pub fn load(dir: &Path) -> Result<LibraryState, String> {
    let file = dir.join(STATE_FILE);
    let text = match std::fs::read_to_string(&file) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(LibraryState::default()),
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => String::new(),
        Err(e) => return Err(format!("{}: {e}", file.display())),
    };
    match serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| from_value(&v))
    {
        Some(state) => Ok(state),
        None => {
            let aside = dir.join(format!("{STATE_FILE}.broken-{}", disk::now_ms()));
            match std::fs::rename(&file, &aside) {
                Ok(()) => eprintln!(
                    "library: {} could not be read; put aside as {}",
                    file.display(),
                    aside.display()
                ),
                Err(e) => return Err(format!("{}: {e}", file.display())),
            }
            Ok(LibraryState::default())
        }
    }
}

/// Writes the record into `dir` atomically, making `dir` if need be.
pub fn save(dir: &Path, state: &LibraryState) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let text = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    disk::write_atomic(&dir.join(STATE_FILE), text.as_bytes())
}

/// The record from parsed JSON, leniently: a project without a usable id or
/// path is dropped, and so is an id seen before, a key that could step out
/// of its project, a board of the wrong shape. Only a value that is no
/// object at all is no record.
pub(super) fn from_value(value: &Value) -> Option<LibraryState> {
    let top = value.as_object()?;
    let mut seen = std::collections::HashSet::new();
    let mut projects = Vec::new();
    for entry in top
        .get("projects")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(entry) = entry.as_object() else {
            continue;
        };
        let (Some(id), Some(path)) = (
            entry.get("id").and_then(Value::as_str),
            entry.get("path").and_then(Value::as_str),
        ) else {
            continue;
        };
        if validate_id(id).is_err()
            || !Path::new(path).is_absolute()
            || !seen.insert(id.to_string())
        {
            continue;
        }
        let mut ids = BTreeMap::new();
        for (rel, item) in entry
            .get("ids")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let Some(item) = item.as_str() else {
                continue;
            };
            if valid_rel(rel) && validate_id(item).is_ok() && seen.insert(item.to_string()) {
                ids.insert(rel.clone(), item.to_string());
            }
        }
        projects.push(ProjectRecord {
            id: id.to_string(),
            path: path.to_string(),
            board: entry.get("board").and_then(BoardSpot::read),
            ids,
            order: read_orders(entry.get("order")),
            kept_added: entry.get("keptAdded").and_then(Value::as_bool) == Some(true),
        });
    }
    Some(LibraryState {
        v: STATE_VERSION,
        migration: top
            .get("migration")
            .and_then(|m| serde_json::from_value(m.clone()).ok()),
        default_location: top
            .get("defaultLocation")
            .and_then(Value::as_str)
            .map(str::to_string),
        chosen_location: top
            .get("chosenLocation")
            .and_then(Value::as_str)
            .map(str::to_string),
        projects,
    })
}

fn read_orders(value: Option<&Value>) -> BTreeMap<String, Vec<String>> {
    let mut out = BTreeMap::new();
    let Some(Value::Object(orders)) = value else {
        return out;
    };
    for (dir, names) in orders {
        if !(dir.is_empty() || valid_rel(dir)) {
            continue;
        }
        let Some(names) = names.as_array() else {
            continue;
        };
        let mut list: Vec<String> = Vec::new();
        for name in names.iter().filter_map(Value::as_str) {
            if disk::one_name(name) && !list.iter().any(|n| n == name) {
                list.push(name.to_string());
            }
        }
        out.insert(dir.clone(), list);
    }
    out
}

/// A folder's items in the order it shows them: what `stored` names, each
/// once and only if it is there; then each item `stored` misses at its place
/// by name — before the first item that sorts after it. With no `stored`,
/// all by name. Diagrams sort by the name they show, without their
/// extension. (An item made in the app or by the MCP server goes on top by
/// `place_item`, which writes the whole order down.)
pub fn merge_order(stored: Option<&[String]>, present: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for name in stored.into_iter().flatten() {
        if present.contains(name) && !out.contains(name) {
            out.push(name.clone());
        }
    }
    let mut missed: Vec<&String> = present.iter().filter(|n| !out.contains(n)).collect();
    missed.sort_by(|a, b| by_name(a, b));
    missed.dedup();
    for name in missed {
        let at = out
            .iter()
            .position(|n| by_name(n, name) == std::cmp::Ordering::Greater)
            .unwrap_or(out.len());
        out.insert(at, name.clone());
    }
    out
}

/// two items of a folder by the names they show, then by their whole names
fn by_name(a: &str, b: &str) -> std::cmp::Ordering {
    natural_cmp(display_name(a), display_name(b)).then_with(|| a.cmp(b))
}

/// `order` with `name` at `index` — out of where it was first; past the end is the end
pub fn place(mut order: Vec<String>, name: &str, index: usize) -> Vec<String> {
    order.retain(|n| n != name);
    let at = index.min(order.len());
    order.insert(at, name.to_string());
    order
}

/// Where a new project goes in the list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    /// on top — made in the app or handed over by the MCP server
    First,
    /// at its place by name — found in the default location
    ByName,
}

impl LibraryState {
    pub fn project(&self, id: &str) -> Option<&ProjectRecord> {
        self.projects.iter().find(|p| p.id == id)
    }

    pub fn project_index(&self, id: &str) -> Option<usize> {
        self.projects.iter().position(|p| p.id == id)
    }

    /// Where the id is: a project or an item of one.
    pub fn find(&self, id: &str) -> Option<Found> {
        self.projects.iter().enumerate().find_map(|(i, p)| {
            if p.id == id {
                Some(Found {
                    project: i,
                    rel: None,
                })
            } else {
                p.rel_of(id).map(|rel| Found {
                    project: i,
                    rel: Some(rel.to_string()),
                })
            }
        })
    }

    /// whether anything in the library — a project, a folder, a diagram — has `id`
    pub fn id_taken(&self, id: &str) -> bool {
        self.find(id).is_some()
    }

    /// A new id no item has: ten of `[A-Za-z0-9]`, from the standard
    /// library's randomly keyed hasher — no new dependency for it.
    pub fn new_id(&self) -> String {
        loop {
            let id = random_id();
            if !self.id_taken(&id) {
                return id;
            }
        }
    }

    /// Names the item at `rel` in project `project` `id`. An id another item
    /// has is refused; the same id again is nothing.
    pub fn insert_id(&mut self, project: usize, rel: &str, id: &str) -> Result<(), String> {
        validate_id(id)?;
        if !valid_rel(rel) {
            return Err(format!("not a path inside a project: {rel:?}"));
        }
        match self.find(id) {
            Some(Found {
                project: p,
                rel: Some(at),
            }) if p == project && at == rel => return Ok(()),
            Some(_) => return Err(format!("an item with id {id:?} already exists")),
            None => {}
        }
        let record = self.projects.get_mut(project).ok_or("no such project")?;
        record.ids.insert(rel.to_string(), id.to_string());
        Ok(())
    }

    /// The id at `rel`, made if it has none.
    pub fn ensure_id(&mut self, project: usize, rel: &str) -> String {
        if let Some(id) = self.projects[project].ids.get(rel) {
            return id.clone();
        }
        let id = self.new_id();
        self.projects[project]
            .ids
            .insert(rel.to_string(), id.clone());
        id
    }

    /// Moves everything at or under `from` in project `src` to `to` in
    /// project `dst` — the same project for a rename — ids and orders alike:
    /// a moved or renamed item keeps its id, a folder keeps its items' order.
    /// Its name in its folder's order is the caller's to change.
    pub fn move_subtree(&mut self, src: usize, from: &str, dst: usize, to: &str) {
        let rekey = |key: &str| format!("{to}{}", &key[from.len()..]);
        let ids: Vec<(String, String)> =
            take_where(&mut self.projects[src].ids, |k| rel_within(k, from));
        let orders: Vec<(String, Vec<String>)> = take_where(&mut self.projects[src].order, |k| {
            !k.is_empty() && rel_within(k, from)
        });
        let target = &mut self.projects[dst];
        for (key, id) in ids {
            target.ids.insert(rekey(&key), id);
        }
        for (key, names) in orders {
            target.order.insert(rekey(&key), names);
        }
    }

    /// Forgets everything at or under `rel` in project `project`, and its
    /// name in its folder's order.
    pub fn remove_subtree(&mut self, project: usize, rel: &str) {
        let record = &mut self.projects[project];
        record.ids.retain(|k, _| !rel_within(k, rel));
        record
            .order
            .retain(|k, _| k.is_empty() || !rel_within(k, rel));
        let (parent, name) = split_rel(rel);
        if let Some(order) = record.order.get_mut(parent) {
            order.retain(|n| n != name);
        }
    }

    /// The order folder `dir` of project `project` shows its `present` items in.
    pub fn resolved_order(&self, project: usize, dir: &str, present: &[String]) -> Vec<String> {
        let stored = self.projects[project].order.get(dir).map(Vec::as_slice);
        merge_order(stored, present)
    }

    /// Puts `name` at `index` among the `present` items of folder `dir`, the
    /// whole order written down — so a new item stays on top of items the
    /// record had not ordered yet.
    pub fn place_item(
        &mut self,
        project: usize,
        dir: &str,
        name: &str,
        index: usize,
        present: &[String],
    ) {
        let order = place(self.resolved_order(project, dir, present), name, index);
        self.projects[project].order.insert(dir.to_string(), order);
    }

    /// `name` out of folder `dir`'s order — it moved elsewhere.
    pub fn take_from_order(&mut self, project: usize, dir: &str, name: &str) {
        if let Some(order) = self.projects[project].order.get_mut(dir) {
            order.retain(|n| n != name);
        }
    }

    /// The names of the items folder `dir` (at `depth`) of project
    /// `project` shows, from disk: what an index among them counts.
    pub fn visible_items(&self, project: usize, dir: &str, depth: usize) -> Vec<String> {
        let record = &self.projects[project];
        let Some(path) = disk::join_rel(&record.root(), dir) else {
            return Vec::new();
        };
        super::walk::visible_items(&path, dir, depth, &|rel| record.ids.contains_key(rel))
    }

    /// `old` is called `new` now in folder `dir`'s order, in the same place.
    pub fn rename_in_order(&mut self, project: usize, dir: &str, old: &str, new: &str) {
        if let Some(order) = self.projects[project].order.get_mut(dir) {
            order.retain(|n| n != new);
            for name in order.iter_mut() {
                if name == old {
                    *name = new.to_string();
                }
            }
        }
    }

    /// Adds a project — on top, or among the others by name.
    pub fn add_project(&mut self, record: ProjectRecord, slot: Slot) {
        let at = match slot {
            Slot::First => 0,
            Slot::ByName => {
                let name = project_name(&record);
                self.projects
                    .iter()
                    .position(|p| {
                        natural_cmp(&project_name(p), &name) == std::cmp::Ordering::Greater
                    })
                    .unwrap_or(self.projects.len())
            }
        };
        self.projects.insert(at, record);
    }

    pub fn remove_project(&mut self, id: &str) -> Option<ProjectRecord> {
        let at = self.project_index(id)?;
        Some(self.projects.remove(at))
    }

    /// Puts project `id` at `index` among the projects.
    pub fn move_project(&mut self, id: &str, index: usize) -> Result<(), String> {
        let record = self
            .remove_project(id)
            .ok_or_else(|| format!("no such project: {id:?}"))?;
        let at = index.min(self.projects.len());
        self.projects.insert(at, record);
        Ok(())
    }

    /// the project registered at `path`, if any — spelt as given, or as
    /// the file system has it
    pub fn project_at(&self, path: &Path) -> Option<usize> {
        let exact = self
            .projects
            .iter()
            .position(|p| Path::new(&p.path) == path);
        exact.or_else(|| {
            let wanted = disk::normalized(path);
            self.projects
                .iter()
                .position(|p| disk::normalized(Path::new(&p.path)) == wanted)
        })
    }
}

/// a project's name: its folder's
pub fn project_name(record: &ProjectRecord) -> String {
    Path::new(&record.path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// what `pred` picks out of `map`, taken out of it
fn take_where<V>(map: &mut BTreeMap<String, V>, pred: impl Fn(&str) -> bool) -> Vec<(String, V)> {
    let keys: Vec<String> = map.keys().filter(|k| pred(k)).cloned().collect();
    keys.into_iter()
        .filter_map(|k| map.remove(&k).map(|v| (k, v)))
        .collect()
}

/// ten random characters of `[A-Za-z0-9]`
fn random_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    use std::sync::atomic::{AtomicU64, Ordering};
    const ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u64(SEQ.fetch_add(1, Ordering::Relaxed));
    hasher.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
    );
    let mut bits = hasher.finish();
    (0..10)
        .map(|_| {
            let c = ALPHABET[(bits % 62) as usize] as char;
            bits /= 62;
            c
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::disk::tests::{names_in, scratch};

    fn s(list: &[&str]) -> Vec<String> {
        list.iter().map(|n| n.to_string()).collect()
    }

    fn record(id: &str, path: &str) -> ProjectRecord {
        ProjectRecord::new(id, &abs(path)).unwrap()
    }

    /// an absolute path on any platform
    fn abs(path: &str) -> PathBuf {
        std::env::temp_dir().join(path)
    }

    fn state_with(projects: Vec<ProjectRecord>) -> LibraryState {
        LibraryState {
            projects,
            ..LibraryState::default()
        }
    }

    #[test]
    fn no_record_yet_is_an_empty_one() {
        let dir = scratch("state-none");
        assert_eq!(load(&dir).unwrap(), LibraryState::default());
        assert!(names_in(&dir).is_empty(), "loading writes nothing");
    }

    #[test]
    fn a_broken_record_is_put_aside_and_the_library_starts_over() {
        for text in ["{not json", "[1, 2]", "\"text\"", ""] {
            let dir = scratch("state-broken");
            std::fs::write(dir.join(STATE_FILE), text).unwrap();
            assert_eq!(load(&dir).unwrap(), LibraryState::default(), "{text:?}");
            let names = names_in(&dir);
            assert_eq!(names.len(), 1, "{names:?}");
            assert!(names[0].starts_with("state.json.broken-"), "{names:?}");
            assert_eq!(std::fs::read_to_string(dir.join(&names[0])).unwrap(), text);
        }
    }

    #[test]
    fn a_record_that_cannot_be_read_is_an_error_and_stays() {
        let dir = scratch("state-unreadable");
        // a folder where the file should be: there, but no file to read
        std::fs::create_dir(dir.join(STATE_FILE)).unwrap();
        assert!(load(&dir).is_err());
        assert!(dir.join(STATE_FILE).is_dir());
    }

    #[test]
    fn a_record_round_trips_and_is_written_atomically() {
        let dir = scratch("state-round").join("library");
        let mut p = record("p1", "Docs/Dosik/Payments");
        p.board = Some(BoardSpot {
            x: 10,
            y: -20,
            collapsed: Some(true),
        });
        p.ids.insert("Flow.dosik".into(), "d1".into());
        p.ids.insert("Sub".into(), "f1".into());
        p.order.insert("".into(), s(&["Sub", "Flow.dosik"]));
        p.kept_added = true;
        let state = LibraryState {
            migration: Some(Migration {
                from: "/old".into(),
                to: "/new".into(),
                at: 5,
            }),
            default_location: Some("/new".into()),
            chosen_location: Some("/chosen".into()),
            ..state_with(vec![p])
        };
        save(&dir, &state).unwrap();
        assert_eq!(names_in(&dir), vec![STATE_FILE]);
        assert_eq!(load(&dir).unwrap(), state);
        let raw: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join(STATE_FILE)).unwrap()).unwrap();
        assert_eq!(raw["v"], 1);
        assert_eq!(raw["defaultLocation"], "/new");
        assert_eq!(raw["chosenLocation"], "/chosen");
        assert_eq!(raw["projects"][0]["keptAdded"], true);
        assert_eq!(
            raw["projects"][0]["order"][""],
            serde_json::json!(["Sub", "Flow.dosik"])
        );
    }

    #[test]
    fn a_hand_edited_record_is_read_leniently() {
        let dir = scratch("state-lenient");
        let root = abs("P").to_string_lossy().into_owned();
        let text = serde_json::json!({
            "v": 1,
            "migration": "nonsense",
            "projects": [
                { "id": "ok", "path": root, "board": { "x": 1.6, "y": "far" },
                  "ids": { "a.dosik": "d1", "../escape.dosik": "d2", "b.dosik": "bad id!",
                           "c.dosik": "ok", "d.dosik": "d1" },
                  "order": { "": ["a.dosik", "a.dosik", 3, "../x"], "../up": ["a"], "Sub": "no" } },
                { "id": "ok", "path": root },
                { "id": "rel", "path": "relative/path" },
                { "path": root },
                "not an object"
            ]
        });
        std::fs::write(dir.join(STATE_FILE), text.to_string()).unwrap();
        let state = load(&dir).unwrap();
        assert_eq!(state.migration, None);
        assert_eq!(state.projects.len(), 1);
        let p = &state.projects[0];
        assert_eq!(p.board, None, "a board without a usable y is no board");
        // an unsafe key, a bad id, an id the project or another item has: dropped
        assert_eq!(p.ids.keys().collect::<Vec<_>>(), vec!["a.dosik"]);
        assert_eq!(p.order.get(""), Some(&s(&["a.dosik"])));
        assert_eq!(p.order.len(), 1);
    }

    #[test]
    fn a_board_is_read_leniently() {
        let read = |v: Value| BoardSpot::read(&v);
        assert_eq!(
            read(serde_json::json!({"x": 1.4, "y": 2.6, "collapsed": "yes"})),
            Some(BoardSpot {
                x: 1,
                y: 3,
                collapsed: None
            })
        );
        assert_eq!(read(serde_json::json!({"x": 2_000_000, "y": 0})), None);
        assert_eq!(read(serde_json::json!([1, 2])), None);
        assert!(BoardSpot {
            x: i64::MIN,
            y: 0,
            collapsed: None
        }
        .check()
        .is_err());
    }

    #[test]
    fn ids_are_found_both_ways_and_never_shared() {
        let mut state = state_with(vec![record("p1", "A"), record("p2", "B")]);
        state.insert_id(0, "Flow.dosik", "d1").unwrap();
        state.insert_id(1, "Sub", "f1").unwrap();
        assert_eq!(
            state.find("p2"),
            Some(Found {
                project: 1,
                rel: None
            })
        );
        assert_eq!(
            state.find("f1"),
            Some(Found {
                project: 1,
                rel: Some("Sub".into())
            })
        );
        assert_eq!(state.find("nope"), None);
        assert_eq!(state.projects[0].rel_of("d1"), Some("Flow.dosik"));
        // the same again is nothing; an id taken by another item or a project is refused
        state.insert_id(0, "Flow.dosik", "d1").unwrap();
        assert!(state.insert_id(1, "Other.dosik", "d1").is_err());
        assert!(state.insert_id(1, "Other.dosik", "p1").is_err());
        assert!(state.insert_id(1, "../x", "d9").is_err());
        assert!(state.insert_id(1, "x", "bad id").is_err());
    }

    #[test]
    fn new_ids_fit_the_id_rule_and_are_unique() {
        let mut state = state_with(vec![record("p1", "A")]);
        let mut seen = std::collections::HashSet::new();
        for n in 0..500 {
            let id = state.ensure_id(0, &format!("d{n}.dosik"));
            assert_eq!(id.len(), 10);
            assert!(id.chars().all(|c| c.is_ascii_alphanumeric()), "{id}");
            validate_id(&id).unwrap();
            assert!(seen.insert(id));
        }
        // an item that has an id keeps it
        let again = state.ensure_id(0, "d0.dosik");
        assert_eq!(state.projects[0].ids.get("d0.dosik"), Some(&again));
    }

    #[test]
    fn a_renamed_folder_takes_its_keys_with_it_and_no_others() {
        let mut state = state_with(vec![record("p1", "A")]);
        for (rel, id) in [
            ("Sub", "f1"),
            ("Sub/x.dosik", "d1"),
            ("Sub/In", "f2"),
            ("Subway", "f3"),
            ("Sub/In/y.dosik", "d2"),
        ] {
            state.insert_id(0, rel, id).unwrap();
        }
        state.projects[0]
            .order
            .insert("".into(), s(&["Subway", "Sub"]));
        state.projects[0]
            .order
            .insert("Sub".into(), s(&["x.dosik", "In"]));
        state.projects[0]
            .order
            .insert("Sub/In".into(), s(&["y.dosik"]));
        state.move_subtree(0, "Sub", 0, "Renamed");
        state.rename_in_order(0, "", "Sub", "Renamed");
        let p = &state.projects[0];
        assert_eq!(
            p.ids
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("Renamed", "f1"),
                ("Renamed/In", "f2"),
                ("Renamed/In/y.dosik", "d2"),
                ("Renamed/x.dosik", "d1"),
                ("Subway", "f3"),
            ]
        );
        assert_eq!(p.order.get(""), Some(&s(&["Subway", "Renamed"])));
        assert_eq!(p.order.get("Renamed"), Some(&s(&["x.dosik", "In"])));
        assert_eq!(p.order.get("Renamed/In"), Some(&s(&["y.dosik"])));
        assert!(!p.order.contains_key("Sub"));
    }

    #[test]
    fn a_subtree_moves_between_projects_with_its_ids() {
        let mut state = state_with(vec![record("p1", "A"), record("p2", "B")]);
        state.insert_id(0, "Sub", "f1").unwrap();
        state.insert_id(0, "Sub/x.dosik", "d1").unwrap();
        state.insert_id(0, "keep.dosik", "d2").unwrap();
        state.projects[0]
            .order
            .insert("Sub".into(), s(&["x.dosik"]));
        state.move_subtree(0, "Sub", 1, "Deep/Sub 2");
        assert_eq!(state.projects[0].ids.len(), 1);
        assert_eq!(
            state.find("d1").unwrap(),
            Found {
                project: 1,
                rel: Some("Deep/Sub 2/x.dosik".into())
            }
        );
        assert_eq!(state.find("f1").unwrap().rel.as_deref(), Some("Deep/Sub 2"));
        assert_eq!(
            state.projects[1].order.get("Deep/Sub 2"),
            Some(&s(&["x.dosik"]))
        );
    }

    #[test]
    fn a_removed_subtree_leaves_nothing_behind() {
        let mut state = state_with(vec![record("p1", "A")]);
        state.insert_id(0, "Sub", "f1").unwrap();
        state.insert_id(0, "Sub/x.dosik", "d1").unwrap();
        state.insert_id(0, "Subway", "f2").unwrap();
        state.projects[0]
            .order
            .insert("".into(), s(&["Sub", "Subway"]));
        state.projects[0]
            .order
            .insert("Sub".into(), s(&["x.dosik"]));
        state.remove_subtree(0, "Sub");
        let p = &state.projects[0];
        assert_eq!(p.ids.keys().collect::<Vec<_>>(), vec!["Subway"]);
        assert_eq!(p.order.get(""), Some(&s(&["Subway"])));
        assert!(!p.order.contains_key("Sub"));
    }

    #[test]
    fn with_no_order_items_go_by_name() {
        let present = s(&[
            "b.dosik",
            "Flow 10.dosik",
            "Archive",
            "flow 2.dosik",
            "Flow.dosik.json",
        ]);
        assert_eq!(
            merge_order(None, &present),
            s(&[
                "Archive",
                "b.dosik",
                "Flow.dosik.json",
                "flow 2.dosik",
                "Flow 10.dosik"
            ])
        );
    }

    #[test]
    fn a_stored_order_is_kept_and_what_it_misses_goes_in_by_name() {
        let stored = s(&["c.dosik", "gone.dosik", "a.dosik", "c.dosik"]);
        let present = s(&["a.dosik", "b.dosik", "c.dosik", "d.dosik"]);
        // b goes before the first that sorts after it (c, on top); d at the end
        assert_eq!(
            merge_order(Some(&stored), &present),
            s(&["b.dosik", "c.dosik", "a.dosik", "d.dosik"])
        );
    }

    #[test]
    fn placing_writes_the_whole_order_with_the_item_where_it_is_told() {
        let mut state = state_with(vec![record("p1", "A")]);
        let present = s(&["a.dosik", "b.dosik", "z.dosik"]);
        state.place_item(0, "", "z.dosik", 0, &present);
        assert_eq!(
            state.projects[0].order.get(""),
            Some(&s(&["z.dosik", "a.dosik", "b.dosik"]))
        );
        // still on top though the record's order and the names disagree
        assert_eq!(
            state.resolved_order(0, "", &present),
            s(&["z.dosik", "a.dosik", "b.dosik"])
        );
        state.place_item(0, "", "z.dosik", 99, &present);
        assert_eq!(
            state.projects[0].order.get(""),
            Some(&s(&["a.dosik", "b.dosik", "z.dosik"]))
        );
        assert_eq!(place(s(&["a", "b", "c"]), "c", 1), s(&["a", "c", "b"]));
    }

    #[test]
    fn a_rename_keeps_the_items_place() {
        let mut state = state_with(vec![record("p1", "A")]);
        state.projects[0]
            .order
            .insert("".into(), s(&["a.dosik", "b.dosik", "c.dosik"]));
        state.rename_in_order(0, "", "b.dosik", "Bee.dosik");
        assert_eq!(
            state.projects[0].order.get(""),
            Some(&s(&["a.dosik", "Bee.dosik", "c.dosik"]))
        );
        // a folder with no order has nothing to rename
        state.rename_in_order(0, "Sub", "x", "y");
        assert!(!state.projects[0].order.contains_key("Sub"));
    }

    #[test]
    fn projects_go_on_top_or_by_name_and_move_and_go() {
        let mut state = state_with(vec![record("p1", "Lib/Beta"), record("p2", "Lib/Delta")]);
        state.add_project(record("p3", "Lib/Alpha"), Slot::ByName);
        state.add_project(record("p4", "Lib/Charlie"), Slot::ByName);
        state.add_project(record("p5", "Lib/Zulu"), Slot::First);
        let ids = |s: &LibraryState| s.projects.iter().map(|p| p.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&state), s(&["p5", "p3", "p1", "p4", "p2"]));
        state.move_project("p5", 99).unwrap();
        assert_eq!(ids(&state), s(&["p3", "p1", "p4", "p2", "p5"]));
        assert!(state.move_project("nope", 0).is_err());
        assert_eq!(
            state.remove_project("p1").map(|p| p.id),
            Some("p1".to_string())
        );
        assert_eq!(state.project_at(&abs("Lib/Charlie")), Some(1));
        assert_eq!(project_name(&state.projects[0]), "Alpha");
    }
}
