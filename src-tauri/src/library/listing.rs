//! The listing: every project with its folders and diagrams, as the app
//! shows them, and the record brought in line with the disk on the way.
//!
//! - Folders directly in the default location are projects by themselves;
//!   a new one takes its place among the others by name.
//! - What the MCP server made while the app was away waits in the inbox
//!   (`{path, at}` files), taken in once the default location's folders are
//!   registered: a folder outside every project is registered on top of the
//!   projects, a project noted by itself goes on top, an item inside one goes
//!   on top of its folder. Each note is removed once read, taken or not —
//!   after the record is written, so a note is never lost to a failed write
//!   — unless what it names cannot be looked at now: it waits for later.
//! - A new folder or diagram gets an id; an id whose item is gone is
//!   forgotten. Renaming outside the app is a removal and an addition.
//! - A project whose folder cannot be found stays, "not found", with its ids,
//!   orders and place — unless it was directly in the default location and
//!   that is still there: then the folder was removed or renamed in the file
//!   manager, and the project goes with it.
//! - The walk takes no lock; a change made meanwhile is caught by the change
//!   count, and the walk is made again — the last time with the lock held,
//!   so a busy app cannot keep every walk torn.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use super::ctx::{settled, Library, LIST_ATTEMPTS};
use super::disk::{self, normalized, split_rel};
use super::names;
use super::state::{self, merge_order, BoardSpot, LibraryState, ProjectRecord, Slot};
use super::walk::{self, Entry, WalkedDir};

/// One diagram as the app lists it.
#[derive(Serialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiagramMeta {
    pub id: String,
    /// its file's name, without the extension
    pub title: String,
    /// last modification, milliseconds since the Unix epoch
    pub updated_at: u64,
    /// whether the app can open it
    pub readable: bool,
}

/// One project — or a folder inside one — with its diagrams and folders,
/// in the user's order.
#[derive(Serialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FolderMeta {
    pub id: String,
    pub name: String,
    /// the newest edit of anything in it, or the folder's own when it is empty
    pub updated_at: u64,
    pub diagrams: Vec<DiagramMeta>,
    pub folders: Vec<FolderMeta>,
    /// its items, `folder:<id>` and `diagram:<id>` mixed, in order — every
    /// item once; `folders` and `diagrams` follow it
    pub order: Vec<String>,
    /// a project's frame on the Home canvas — never a folder's
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board: Option<BoardSpot>,
    /// a project whose folder cannot be found: listed in its place, empty
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub missing: bool,
    /// a project outside the default location — removed from the library,
    /// never deleted
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub added: bool,
    /// a project's folder, whole — what "not found" names
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// the same from `~` when it is under the home folder, for reading
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shown: Option<String>,
    /// A project's diagrams the record keeps but the listing could not
    /// reach — its folder not found, or a folder in it that could not be
    /// read: still there, maybe, so a tab of one stays open.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub held: Vec<String>,
}

/// `path` from `~` when it is under `home` — by whole components, so
/// `/Users/a2` is not under `/Users/a`. `/` between names on every platform.
pub fn shown_path(path: &Path, home: Option<&Path>) -> String {
    match home.and_then(|home| path.strip_prefix(home).ok()) {
        Some(rest) if rest.as_os_str().is_empty() => "~".to_string(),
        Some(rest) => {
            let names: Vec<String> = rest
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect();
            format!("~/{}", names.join("/"))
        }
        None => path.to_string_lossy().into_owned(),
    }
}

#[cfg(test)]
thread_local! {
    /// what a test does in the middle of a listing — after the walk, before
    /// the record is brought in line with it
    pub(crate) static MID_LIST: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
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

/// Every project with its folders and diagrams, in the user's order — the
/// record brought in line with the disk first.
pub fn list(lib: &Library) -> Result<Vec<FolderMeta>, String> {
    {
        let held = lib.lock();
        let mut st = lib.load_state(&held)?;
        let (changed, notes) = take_in(lib, &mut st)?;
        if changed {
            // counted as a change: a listing walking meanwhile did not see
            // what got an id here, and must not forget it
            let _change = lib.restructure(&held);
            lib.save_state(&held, &st)?;
        }
        // read, taken or not, and the record has what came of them: gone
        for note in notes {
            if let Err(e) = std::fs::remove_file(&note) {
                eprintln!("library: inbox {}: {e}", note.display());
            }
        }
    }
    let mut attempt = 1;
    let mut cache = lib.take_read_cache();
    loop {
        // the last walk holds the lock: no change of the app's tears it
        let last = attempt == LIST_ATTEMPTS;
        let early = last.then(|| lib.lock());
        let before = lib.structure();
        let roots: Vec<(String, PathBuf)> = {
            let st = match &early {
                Some(held) => lib.load_state(held)?,
                None => lib.load_state(&lib.lock())?,
            };
            st.projects
                .iter()
                .map(|p| (p.id.clone(), p.root()))
                .collect()
        };
        let walked: HashMap<String, (PathBuf, Walk)> = roots
            .into_iter()
            .map(|(id, root)| {
                let tree = walk::walk_with(&root, &mut cache);
                (id, (root, tree))
            })
            .collect();
        mid_list();
        let held = early.unwrap_or_else(|| lib.lock());
        let whole = settled(before, lib.structure());
        if !whole && !last {
            attempt += 1;
            continue;
        }
        let mut st = lib.load_state(&held)?;
        let original = st.clone();
        let out = reconcile(lib, &mut st, &walked, whole, &mut cache);
        lib.keep_read_cache(cache);
        if st != original {
            // counted as a change: a listing walking meanwhile did not see
            // what got an id here, and must not forget it
            let _change = lib.restructure(&held);
            lib.save_state(&held, &st)?;
        }
        return Ok(out);
    }
}

/// A project's folder as the walk found it: there (maybe not all read), not
/// there, or the file system would not say.
type Walk = Result<Option<WalkedDir>, String>;

/// The default location's folders registered, the inbox taken in, the
/// default location written down — whether the record changed, and the
/// notes read, for the caller to remove once the record is written. A
/// default location the app may not read is an error: the whole library is
/// then out of reach, not empty.
fn take_in(lib: &Library, st: &mut LibraryState) -> Result<(bool, Vec<PathBuf>), String> {
    let mut changed = false;
    let default = lib.default_location().to_string_lossy().into_owned();
    if st.default_location.as_deref() != Some(default.as_str()) {
        st.default_location = Some(default);
        changed = true;
    }
    // the default location's own folders first: a note of something made in
    // one the app has not listed yet then finds it
    changed |= register_default_projects(lib, st)?;
    let (took, notes) = accept_inbox(lib, st);
    Ok((changed || took, notes))
}

/// how long a note of something that cannot be looked at waits in the inbox
const NOTE_PATIENCE_MS: u64 = 7 * 24 * 3600 * 1000;

/// Takes in every note of the inbox, oldest first — the newest ends on top
/// — whether anything was taken, and every note read, whatever became of it.
fn accept_inbox(lib: &Library, st: &mut LibraryState) -> (bool, Vec<PathBuf>) {
    let Ok(read) = std::fs::read_dir(lib.inbox_dir()) else {
        return (false, Vec::new());
    };
    let mut notes: Vec<(u64, String, PathBuf, Option<PathBuf>)> = read
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            if walk::classify(&name, false) == Entry::Skip || !name.ends_with(".json") {
                return None;
            }
            let note = std::fs::read_to_string(entry.path())
                .ok()
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
            let at = note
                .as_ref()
                .and_then(|n| n.get("at"))
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
            let target = note
                .as_ref()
                .and_then(|n| n.get("path"))
                .and_then(serde_json::Value::as_str)
                .map(PathBuf::from);
            Some((at, name, entry.path(), target))
        })
        .collect();
    notes.sort();
    let mut changed = false;
    let mut read = Vec::new();
    let now = disk::now_ms();
    for (at, _, file, target) in notes {
        match target {
            Some(target) => match take_one(lib, st, &target) {
                Ok(Some(took)) => changed |= took,
                // the file system would not say: a later listing looks again
                // — for a week; one still out of sight by then is let go
                Ok(None) if now.saturating_sub(at) < NOTE_PATIENCE_MS => continue,
                Ok(None) => eprintln!(
                    "library: inbox {}: out of sight for a week; let go",
                    target.display()
                ),
                Err(e) => eprintln!("library: inbox {}: {e}", target.display()),
            },
            None => eprintln!("library: inbox {}: not a note", file.display()),
        }
        read.push(file);
    }
    (changed, read)
}

/// One note: an item inside a project goes on top of its folder (and gets
/// an id, so an empty folder shows); a folder outside every project is a
/// new project, on top. Whether the record changed — `None` when what it
/// names cannot be looked at now (no permission, a disk that went away):
/// the note waits for a later listing.
fn take_one(lib: &Library, st: &mut LibraryState, target: &Path) -> Result<Option<bool>, String> {
    if !target.is_absolute() {
        return Err("not an absolute path".into());
    }
    if let Some((project, rel)) = item_in_project(st, target) {
        let root = st.projects[project].root();
        if let disk::Presence::Unknown(_) = disk::presence_within(&root, &rel) {
            return Ok(None);
        }
        // each name as it is stored: the record knows it so
        let rel = walk::stored_rel(&root, &rel).ok_or("not there")?;
        // through real folders only: a link on the way leads outside the project
        let is_dir = match disk::presence_within(&root, &rel) {
            disk::Presence::Dir => true,
            disk::Presence::File => false,
            disk::Presence::Unknown(_) => return Ok(None),
            _ => return Err("not there".into()),
        };
        if rel.is_empty() {
            // a project noted by itself — a folder of the default location
            // the MCP server made: on top, as one made in the app
            if project == 0 {
                return Ok(Some(false));
            }
            let id = st.projects[project].id.clone();
            st.move_project(&id, 0)?;
            return Ok(Some(true));
        }
        if !walk::shown_rel(&rel, is_dir) {
            return Err("not an item the library shows".into());
        }
        st.ensure_id(project, &rel);
        let (parent, name) = split_rel(&rel);
        let parent_depth = if parent.is_empty() {
            1
        } else {
            parent.split('/').count() + 1
        };
        let present = st.visible_items(project, parent, parent_depth);
        st.place_item(project, parent, name, 0, &present);
        return Ok(Some(true));
    }
    match disk::presence(target) {
        disk::Presence::Dir => {}
        disk::Presence::Unknown(_) => return Ok(None),
        _ => return Err("not a folder".into()),
    }
    check_new_project(lib, st, target, None).map_err(|r| r.to_string())?;
    let id = st.new_id();
    st.add_project(ProjectRecord::new(&id, target)?, Slot::First);
    Ok(Some(true))
}

/// The project `target` is in, and where in it (`""`: the project itself)
/// — `None` outside every project, or when a name on the way is not UTF-8.
pub fn item_in_project(st: &LibraryState, target: &Path) -> Option<(usize, String)> {
    ProjectRoots::of(st).find(target)
}

/// The projects' folders, as the record has them and as the file system
/// has them — worked out once for many paths, as a batch of the watch's.
pub struct ProjectRoots {
    roots: Vec<(PathBuf, PathBuf)>,
}

impl ProjectRoots {
    pub fn of(st: &LibraryState) -> ProjectRoots {
        ProjectRoots {
            roots: st
                .projects
                .iter()
                .map(|p| {
                    let root = p.root();
                    let real = normalized(&root);
                    (root, real)
                })
                .collect(),
        }
    }

    /// The project `target` is in, and where in it — see `item_in_project`.
    /// As spelt first; as the file system has it when that finds none.
    pub fn find(&self, target: &Path) -> Option<(usize, String)> {
        let rel = |rest: &Path| -> Option<String> {
            let mut names = Vec::new();
            for part in rest.components() {
                match part {
                    Component::Normal(name) => names.push(name.to_str()?.to_string()),
                    _ => return None,
                }
            }
            Some(names.join("/"))
        };
        if let Some((i, rest)) = self
            .roots
            .iter()
            .enumerate()
            .find_map(|(i, (root, _))| Some((i, target.strip_prefix(root).ok()?)))
        {
            return Some((i, rel(rest)?));
        }
        let real = normalized(target);
        let (i, rest) = self
            .roots
            .iter()
            .enumerate()
            .find_map(|(i, (_, root))| Some((i, real.strip_prefix(root).ok()?)))?;
        Some((i, rel(rest)?))
    }
}

/// Registers every folder directly in the default location the record does
/// not have yet, among the projects by name. One the record has by another
/// spelling — through a link, or renamed only in case on a disk that ignores
/// case — is the same folder: it keeps its id and takes the name it has now.
pub(super) fn register_default_projects(
    lib: &Library,
    st: &mut LibraryState,
) -> Result<bool, String> {
    let default = &lib.default_location();
    let denied = |kind: std::io::ErrorKind| -> Result<bool, String> {
        if kind == std::io::ErrorKind::PermissionDenied {
            Err(format!(
                "{}: Dosik may not read this folder",
                default.display()
            ))
        } else {
            // it cannot tell: nothing is registered, nothing forgotten
            Ok(false)
        }
    };
    match disk::presence(default) {
        disk::Presence::Dir => {}
        disk::Presence::Unknown(kind) => return denied(kind),
        _ => return Ok(false),
    }
    let found = match walk::entries(default) {
        Ok(found) => found,
        Err(e) => return denied(e.kind()),
    };
    let mut changed = false;
    // each project's folder as the file system has it, worked out once
    let mut real: Vec<PathBuf> = st.projects.iter().map(|p| normalized(&p.root())).collect();
    for (name, is_dir) in found {
        if !is_dir {
            continue;
        }
        let path = default.join(&name);
        if st.projects.iter().any(|p| p.root() == path) {
            continue;
        }
        let path_real = normalized(&path);
        if let Some(at) = real.iter().position(|r| *r == path_real) {
            st.projects[at].path = path.to_string_lossy().into_owned();
            changed = true;
            continue;
        }
        if real.iter().any(|r| r.starts_with(&path_real)) {
            continue;
        }
        let id = st.new_id();
        match ProjectRecord::new(&id, &path) {
            Ok(record) => {
                st.add_project(record, Slot::ByName);
                real = st.projects.iter().map(|p| normalized(&p.root())).collect();
                changed = true;
            }
            Err(e) => eprintln!("library: {e}"),
        }
    }
    Ok(changed)
}

/// Too broad to be a project: a root, or the home folder or one holding it.
pub fn is_broad(path: &Path, home: Option<&Path>) -> bool {
    path.parent().is_none() || home.is_some_and(|home| home.starts_with(path))
}

/// Why a folder cannot become a project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// it overlaps the library: it is a project, is inside one, or holds
    /// one or the default location
    Overlap(String),
    /// no folder a project can be: relative, or too broad
    Invalid(String),
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Refusal::Overlap(why) | Refusal::Invalid(why) => f.write_str(why),
        }
    }
}

/// Whether `path` may become a project (`except`: the project being located
/// again, whose own place is no clash): an absolute, not too broad folder
/// that neither is a project, nor is inside one, nor holds one or the
/// default location — and is not deep inside the default location, where
/// its parent is a project of itself.
pub fn check_new_project(
    lib: &Library,
    st: &LibraryState,
    path: &Path,
    except: Option<&str>,
) -> Result<(), Refusal> {
    let overlap = |why: &str| Err(Refusal::Overlap(why.to_string()));
    if !path.is_absolute() {
        return Err(Refusal::Invalid("not an absolute path".into()));
    }
    if is_broad(path, lib.home.as_deref()) {
        return Err(Refusal::Invalid("too broad a folder for a project".into()));
    }
    let wanted = normalized(path);
    let default = normalized(&lib.default_location());
    if default.starts_with(&wanted) {
        return overlap("it holds the library folder");
    }
    if wanted.starts_with(&default) && wanted.parent() != Some(default.as_path()) {
        return overlap("it is inside a project of the library folder");
    }
    for project in st.projects.iter().filter(|p| Some(p.id.as_str()) != except) {
        let there = normalized(&project.root());
        if there == wanted {
            return overlap("already in the library");
        }
        if wanted.starts_with(&there) {
            return overlap("it is inside another project");
        }
        if there.starts_with(&wanted) {
            return overlap("it holds another project");
        }
    }
    Ok(())
}

/// The record brought in line with the walks, and the listing built from
/// both. `whole`: the walks saw the library whole — only then is anything
/// forgotten; a torn walk only adds.
fn reconcile(
    lib: &Library,
    st: &mut LibraryState,
    walked: &HashMap<String, (PathBuf, Walk)>,
    whole: bool,
    cache: &mut walk::ReadCache,
) -> Vec<FolderMeta> {
    let default_there = disk::presence(&lib.default_location()) == disk::Presence::Dir;
    let mut out = Vec::new();
    let mut gone = Vec::new();
    for i in 0..st.projects.len() {
        let root = st.projects[i].root();
        let id = st.projects[i].id.clone();
        // a project moved meanwhile is walked where it is now
        let tree = match walked.get(&id) {
            Some((path, tree)) if *path == root => tree.clone(),
            _ => walk::walk_with(&root, cache),
        };
        // one kept added (`kept_added`) is not found until found, located or removed
        let kept = st.projects[i].kept_added;
        match tree {
            Ok(None) if whole && default_there && !kept && lib.in_default_location(&root) => {
                gone.push(id)
            }
            Ok(None) => out.push(missing_meta(lib, &st.projects[i])),
            // there, maybe, but it would not say: shown empty, nothing forgotten
            Err(_) => {
                let unread = walk::unread(state::project_name(&st.projects[i]));
                out.push(project_meta(lib, &st.projects[i], &unread));
            }
            Ok(Some(tree)) => {
                // found again: what its place says it is
                st.projects[i].kept_added = false;
                let listed = tree.listed_dirs();
                let away: HashSet<String> = tree.online_only_rels().into_iter().collect();
                let ids = &st.projects[i].ids;
                let shown = walk::shown(tree, &|rel| ids.contains_key(rel));
                sync(st, i, &shown, whole.then_some((&listed, &away)));
                out.push(project_meta(lib, &st.projects[i], &shown));
            }
        }
    }
    for id in gone {
        st.remove_project(&id);
    }
    out
}

/// An id for every item that shows; when the walk was whole (`listed`: each
/// folder it found, and whether all of what is directly in it was read;
/// `away`: the diagrams kept online only), the ids and orders of items that
/// are gone forgotten — gone from a folder that was read whole, or with
/// one: a folder that was not, and what is in it, are kept as the record
/// has them, and so is a diagram kept online only.
fn sync(
    st: &mut LibraryState,
    project: usize,
    shown: &WalkedDir,
    whole: Option<(&HashMap<String, bool>, &HashSet<String>)>,
) {
    let dirs = shown.all_dirs();
    let present: Vec<String> = dirs
        .iter()
        .filter(|d| !d.rel.is_empty())
        .map(|d| d.rel.clone())
        .chain(
            dirs.iter()
                .flat_map(|d| d.diagrams.iter().map(|g| g.rel.clone())),
        )
        .collect();
    for rel in &present {
        st.ensure_id(project, rel);
    }
    let Some((listed, away)) = whole else {
        return;
    };
    // whether what was at `rel` is known gone: the nearest folder holding it
    // that the walk found was read whole
    let gone = |rel: &str| {
        let mut at = rel;
        loop {
            let (parent, _) = split_rel(at);
            if let Some(read) = listed.get(parent) {
                return *read;
            }
            if parent.is_empty() {
                return false;
            }
            at = parent;
        }
    };
    let keep: HashSet<&String> = present.iter().collect();
    let items: HashMap<&str, Vec<String>> = dirs
        .iter()
        .map(|d| (d.rel.as_str(), d.item_names()))
        .collect();
    let record = &mut st.projects[project];
    record
        .ids
        .retain(|k, _| keep.contains(k) || away.contains(k) || !gone(k));
    record
        .order
        .retain(|dir, names| match items.get(dir.as_str()) {
            Some(there) if listed.get(dir.as_str()) == Some(&true) => {
                names.retain(|n| there.contains(n) || away.contains(&disk::child_rel(dir, n)));
                !names.is_empty()
            }
            // not all of it read: as the record has it
            Some(_) => true,
            None => !gone(dir),
        });
}

fn missing_meta(lib: &Library, record: &ProjectRecord) -> FolderMeta {
    let root = record.root();
    FolderMeta {
        id: record.id.clone(),
        name: state::project_name(record),
        updated_at: 0,
        diagrams: Vec::new(),
        folders: Vec::new(),
        order: Vec::new(),
        board: record.board,
        missing: true,
        added: record.kept_added || !lib.in_default_location(&root),
        path: Some(record.path.clone()),
        shown: Some(shown_path(&root, lib.home.as_deref())),
        held: held_diagrams(record, &HashSet::new()),
    }
}

fn project_meta(lib: &Library, record: &ProjectRecord, shown: &WalkedDir) -> FolderMeta {
    let root = record.root();
    let meta = folder_meta(record, shown);
    let listed: HashSet<String> = all_diagram_ids(&meta);
    FolderMeta {
        name: state::project_name(record),
        board: record.board,
        added: !lib.in_default_location(&root),
        path: Some(record.path.clone()),
        shown: Some(shown_path(&root, lib.home.as_deref())),
        held: held_diagrams(record, &listed),
        ..meta
    }
}

/// every diagram's id in a listed folder, at any depth
fn all_diagram_ids(folder: &FolderMeta) -> HashSet<String> {
    let mut out: HashSet<String> = folder.diagrams.iter().map(|d| d.id.clone()).collect();
    for sub in &folder.folders {
        out.extend(all_diagram_ids(sub));
    }
    out
}

/// The diagrams the record keeps for a project that the listing does not
/// show — right after the record is brought in line with a whole walk,
/// none; else the ones it could not reach.
fn held_diagrams(record: &ProjectRecord, listed: &HashSet<String>) -> Vec<String> {
    record
        .ids
        .iter()
        .filter(|(rel, id)| {
            names::diagram_stem(split_rel(rel).1).is_some() && !listed.contains(*id)
        })
        .map(|(_, id)| id.clone())
        .collect()
}

/// One folder of a project — the project itself at the top — its items in
/// its order.
fn folder_meta(record: &ProjectRecord, dir: &WalkedDir) -> FolderMeta {
    let id_of = |rel: &str| record.ids.get(rel).cloned().unwrap_or_default();
    let mut folders: Vec<FolderMeta> = dir.dirs.iter().map(|d| folder_meta(record, d)).collect();
    let mut diagrams: Vec<DiagramMeta> = dir
        .diagrams
        .iter()
        .map(|d| DiagramMeta {
            id: id_of(&d.rel),
            title: d.name.clone(),
            updated_at: d.modified,
            readable: d.readable,
        })
        .collect();
    let names = dir.item_names();
    let resolved = merge_order(record.order.get(&dir.rel).map(Vec::as_slice), &names);
    let order: Vec<String> = resolved
        .iter()
        .filter_map(|name| {
            if let Some(sub) = dir.dirs.iter().find(|d| &d.name == name) {
                Some(format!("folder:{}", id_of(&sub.rel)))
            } else {
                dir.diagrams
                    .iter()
                    .find(|d| &d.file == name)
                    .map(|d| format!("diagram:{}", id_of(&d.rel)))
            }
        })
        .collect();
    let place = |key: String| order.iter().position(|k| *k == key).unwrap_or(usize::MAX);
    folders.sort_by_key(|f| place(format!("folder:{}", f.id)));
    diagrams.sort_by_key(|d| place(format!("diagram:{}", d.id)));
    let newest = diagrams
        .iter()
        .map(|d| d.updated_at)
        .chain(folders.iter().map(|f| f.updated_at))
        .max();
    FolderMeta {
        id: if dir.rel.is_empty() {
            record.id.clone()
        } else {
            id_of(&dir.rel)
        },
        name: dir.name.clone(),
        updated_at: newest.unwrap_or(dir.modified),
        diagrams,
        folders,
        order,
        board: None,
        missing: false,
        added: false,
        path: None,
        shown: None,
        held: Vec::new(),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::library::ctx::tests::test_library;
    use crate::library::state::STATE_FILE;

    pub(crate) fn doc() -> &'static str {
        r#"{"version":1,"title":"x","nodes":[],"edges":[]}"#
    }

    pub(crate) fn put(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    pub(crate) fn names_of(list: &[FolderMeta]) -> Vec<String> {
        list.iter().map(|f| f.name.clone()).collect()
    }

    pub(crate) fn project<'a>(list: &'a [FolderMeta], name: &str) -> &'a FolderMeta {
        list.iter()
            .find(|f| f.name == name)
            .unwrap_or_else(|| panic!("no project {name} in {:?}", names_of(list)))
    }

    pub(crate) fn titles(folder: &FolderMeta) -> Vec<String> {
        folder.diagrams.iter().map(|d| d.title.clone()).collect()
    }

    pub(crate) fn folder_names(folder: &FolderMeta) -> Vec<String> {
        folder.folders.iter().map(|f| f.name.clone()).collect()
    }

    /// every id in the listing, projects, folders and diagrams
    pub(crate) fn all_ids(list: &[FolderMeta]) -> Vec<String> {
        fn walk_ids(f: &FolderMeta, out: &mut Vec<String>) {
            out.push(f.id.clone());
            out.extend(f.diagrams.iter().map(|d| d.id.clone()));
            for sub in &f.folders {
                walk_ids(sub, out);
            }
        }
        let mut out = Vec::new();
        for f in list {
            walk_ids(f, &mut out);
        }
        out
    }

    fn inbox(lib: &Library, name: &str, path: &Path, at: u64) {
        let note = serde_json::json!({ "path": path.to_string_lossy(), "at": at });
        put(
            &lib.inbox_dir().join(format!("{name}.json")),
            &note.to_string(),
        );
    }

    fn record(lib: &Library) -> LibraryState {
        let held = lib.lock();
        lib.load_state(&held).unwrap()
    }

    #[test]
    fn an_empty_library_lists_nothing_and_makes_no_folder() {
        let lib = test_library("list-empty");
        assert!(list(&lib).unwrap().is_empty());
        assert!(
            !lib.default_location().exists(),
            "the listing makes no default location"
        );
    }

    #[test]
    fn folders_in_the_default_location_are_projects_by_name() {
        let lib = test_library("list-default");
        let at = &lib.default_location();
        std::fs::create_dir_all(at.join("beta")).unwrap();
        std::fs::create_dir_all(at.join("Alpha")).unwrap();
        std::fs::create_dir_all(at.join(".hidden")).unwrap();
        put(&at.join("Loose.dosik"), doc());
        let listed = list(&lib).unwrap();
        assert_eq!(names_of(&listed), vec!["Alpha", "beta"]);
        assert!(listed.iter().all(|p| !p.added && !p.missing));
        // a third one comes in by name, the others keep their places
        std::fs::create_dir_all(at.join("Charlie")).unwrap();
        let listed = list(&lib).unwrap();
        assert_eq!(names_of(&listed), vec!["Alpha", "beta", "Charlie"]);
        let alpha = project(&listed, "Alpha");
        assert_eq!(
            alpha.path.as_deref(),
            Some(at.join("Alpha").to_str().unwrap())
        );
        assert_eq!(alpha.shown.as_deref(), Some("~/Docs/Dosik/Alpha"));
        assert_eq!(
            record(&lib).default_location.as_deref(),
            Some(at.to_str().unwrap())
        );
    }

    #[test]
    fn a_listing_again_gives_the_same_ids() {
        let lib = test_library("list-same");
        let at = &lib.default_location();
        put(&at.join("P/Flow.dosik"), doc());
        put(&at.join("P/Sub/Inner.dosik"), doc());
        let first = list(&lib).unwrap();
        let ids = all_ids(&first);
        assert_eq!(ids.len(), 4);
        assert_eq!(ids.iter().collect::<HashSet<_>>().len(), 4, "{ids:?}");
        let written = std::fs::read_to_string(lib.data_dir.join(STATE_FILE)).unwrap();
        assert_eq!(all_ids(&list(&lib).unwrap()), ids);
        let again = std::fs::read_to_string(lib.data_dir.join(STATE_FILE)).unwrap();
        assert_eq!(written, again, "nothing new, nothing written");
    }

    #[test]
    fn what_changed_while_the_app_was_away_is_taken_in() {
        let lib = test_library("list-away");
        let at = &lib.default_location();
        put(&at.join("P/Keep.dosik"), doc());
        put(&at.join("P/Gone.dosik"), doc());
        put(&at.join("P/Old name.dosik"), doc());
        let first = list(&lib).unwrap();
        let p = project(&first, "P");
        let id_of =
            |f: &FolderMeta, t: &str| f.diagrams.iter().find(|d| d.title == t).unwrap().id.clone();
        let keep = id_of(p, "Keep");
        let renamed = id_of(p, "Old name");
        std::fs::remove_file(at.join("P/Gone.dosik")).unwrap();
        std::fs::rename(at.join("P/Old name.dosik"), at.join("P/New name.dosik")).unwrap();
        put(&at.join("P/Added.dosik"), doc());
        let listed = list(&lib).unwrap();
        let p = project(&listed, "P");
        assert_eq!(titles(p), vec!["Added", "Keep", "New name"]);
        assert_eq!(id_of(p, "Keep"), keep);
        // renamed outside the app: removed and added, a new id
        assert_ne!(id_of(p, "New name"), renamed);
        let st = record(&lib);
        assert!(!st.projects[0].ids.values().any(|v| *v == renamed));
        assert_eq!(st.projects[0].ids.len(), 3);
    }

    #[test]
    fn items_go_by_name_unless_the_record_orders_them() {
        let lib = test_library("list-order");
        let at = &lib.default_location();
        for name in ["b", "Flow 10", "flow 2", "a"] {
            put(&at.join(format!("P/{name}.dosik")), doc());
        }
        std::fs::create_dir_all(at.join("P/Folder")).unwrap();
        put(&at.join("P/Folder/x.dosik"), doc());
        let listed = list(&lib).unwrap();
        let p = project(&listed, "P");
        assert_eq!(titles(p), vec!["a", "b", "flow 2", "Flow 10"]);
        let folder_id = &p.folders[0].id;
        // "Folder" sorts after "flow 2" and "Flow 10": "fl" before "fo"
        assert_eq!(p.order[4], format!("folder:{folder_id}"), "{:?}", p.order);
        // a stored order is followed, and what it misses goes in by name
        {
            let held = lib.lock();
            let mut st = lib.load_state(&held).unwrap();
            st.projects[0]
                .order
                .insert(String::new(), vec!["flow 2.dosik".into(), "a.dosik".into()]);
            lib.save_state(&held, &st).unwrap();
        }
        let listed = list(&lib).unwrap();
        let p = project(&listed, "P");
        // b before the first item that sorts after it; Flow 10 after them all
        assert_eq!(titles(p), vec!["b", "flow 2", "a", "Flow 10"]);
        assert_eq!(p.order.len(), 5);
    }

    #[test]
    fn a_diagram_unchanged_since_the_last_listing_is_not_read_again() {
        let lib = test_library("list-read-once");
        let file = lib.default_location().join("P/Flow.dosik");
        put(&file, doc());
        let when = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000);
        let set = |at: std::time::SystemTime| {
            std::fs::OpenOptions::new()
                .write(true)
                .open(&file)
                .unwrap()
                .set_modified(at)
                .unwrap();
        };
        set(when);
        assert!(list(&lib).unwrap()[0].diagrams[0].readable);
        // other bytes of the same length, the same time: taken as unchanged
        let broken = "x".repeat(doc().len());
        std::fs::write(&file, &broken).unwrap();
        set(when);
        assert!(
            list(&lib).unwrap()[0].diagrams[0].readable,
            "not read again"
        );
        // a new time: read again
        set(when + std::time::Duration::from_secs(5));
        assert!(!list(&lib).unwrap()[0].diagrams[0].readable);
    }

    #[test]
    fn a_folder_shows_with_a_diagram_in_it_or_an_id() {
        let lib = test_library("list-shown");
        let at = &lib.default_location();
        std::fs::create_dir_all(at.join("P/empty made outside")).unwrap();
        put(&at.join("P/src/code.rs"), "fn main() {}");
        put(&at.join("P/docs/deep/Flow.dosik"), doc());
        let listed = list(&lib).unwrap();
        let p = project(&listed, "P");
        assert_eq!(folder_names(p), vec!["docs"]);
        assert_eq!(folder_names(&p.folders[0]), vec!["deep"]);
        // once it has an id the folder stays, its diagram gone or not
        std::fs::remove_file(at.join("P/docs/deep/Flow.dosik")).unwrap();
        let listed = list(&lib).unwrap();
        assert_eq!(folder_names(project(&listed, "P")), vec!["docs"]);
    }

    #[test]
    fn the_inbox_registers_a_folder_on_top_and_is_emptied() {
        let lib = test_library("list-inbox");
        let at = &lib.default_location();
        std::fs::create_dir_all(at.join("Mine")).unwrap();
        list(&lib).unwrap();
        let base = lib
            .data_dir
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();
        let older = base.join("work").join("session-1").join("diagrams");
        let newer = base.join("work").join("session-2");
        std::fs::create_dir_all(&older).unwrap();
        std::fs::create_dir_all(&newer).unwrap();
        put(&newer.join("Plan.dosik"), doc());
        inbox(&lib, "b", &older, 10);
        inbox(&lib, "a", &newer, 20);
        // refused: inside a project, too broad, not there
        inbox(&lib, "c", &older.join("inside"), 5);
        inbox(&lib, "d", Path::new("/"), 6);
        inbox(&lib, "e", &base.join("nowhere"), 7);
        put(&lib.inbox_dir().join("broken.json"), "{");
        let listed = list(&lib).unwrap();
        assert_eq!(names_of(&listed), vec!["session-2", "diagrams", "Mine"]);
        let s2 = project(&listed, "session-2");
        assert!(s2.added);
        assert_eq!(titles(s2), vec!["Plan"]);
        let left: Vec<_> = std::fs::read_dir(lib.inbox_dir())
            .unwrap()
            .flatten()
            .collect();
        assert!(left.is_empty(), "every note is removed");
    }

    #[cfg(unix)]
    #[test]
    fn a_note_of_what_cannot_be_looked_at_now_waits_in_the_inbox() {
        let lib = test_library("list-inbox-later");
        let at = lib.default_location();
        std::fs::create_dir_all(at.join("P/Locked/Sub")).unwrap();
        put(&at.join("P/Flow.dosik"), doc());
        list(&lib).unwrap();
        inbox(
            &lib,
            "n",
            &at.join("P/Locked/Sub"),
            crate::library::disk::now_ms(),
        );
        {
            let Some(_unlock) = lock_out(&at.join("P/Locked")) else {
                return;
            };
            list(&lib).unwrap();
            assert!(lib.inbox_dir().join("n.json").is_file(), "kept for later");
        }
        // looked at again once it can be: taken in, and gone
        list(&lib).unwrap();
        assert!(!lib.inbox_dir().join("n.json").exists());
        assert!(record(&lib).projects[0].ids.contains_key("Locked/Sub"));
    }

    #[cfg(unix)]
    #[test]
    fn a_note_of_what_cannot_be_looked_at_for_a_week_is_let_go() {
        let lib = test_library("list-inbox-week");
        let at = lib.default_location();
        std::fs::create_dir_all(at.join("P/Locked/Sub")).unwrap();
        put(&at.join("P/Flow.dosik"), doc());
        list(&lib).unwrap();
        let week = 7 * 24 * 3600 * 1000;
        let now = crate::library::disk::now_ms();
        inbox(&lib, "old", &at.join("P/Locked/Sub"), now - week - 1000);
        inbox(&lib, "new", &at.join("P/Locked/Sub"), now - 1000);
        let Some(_unlock) = lock_out(&at.join("P/Locked")) else {
            return;
        };
        list(&lib).unwrap();
        assert!(!lib.inbox_dir().join("old.json").exists(), "let go");
        assert!(lib.inbox_dir().join("new.json").is_file(), "kept for later");
    }

    #[cfg(unix)]
    #[test]
    fn a_note_stays_in_the_inbox_until_the_record_has_it() {
        use std::os::unix::fs::PermissionsExt;
        let lib = test_library("list-inbox-kept");
        std::fs::create_dir_all(lib.default_location().join("P")).unwrap();
        list(&lib).unwrap();
        let repo = lib.default_location().parent().unwrap().join("Repo");
        std::fs::create_dir_all(&repo).unwrap();
        inbox(&lib, "x", &repo, 1);
        // the record cannot be written: its folder takes no new file
        let mode = |m| std::fs::set_permissions(&lib.data_dir, std::fs::Permissions::from_mode(m));
        mode(0o555).unwrap();
        let probe = lib.data_dir.join("probe");
        if std::fs::write(&probe, "x").is_ok() {
            let _ = std::fs::remove_file(&probe);
            mode(0o755).unwrap();
            eprintln!("{}: still writable; left out", lib.data_dir.display());
            return;
        }
        let failed = list(&lib);
        mode(0o755).unwrap();
        assert!(failed.is_err());
        assert!(lib.inbox_dir().join("x.json").is_file(), "the note waits");
        // the next listing takes it in
        assert_eq!(names_of(&list(&lib).unwrap()), vec!["Repo", "P"]);
        assert!(!lib.inbox_dir().join("x.json").exists());
    }

    #[test]
    fn an_item_the_mcp_server_made_goes_on_top_of_its_folder() {
        let lib = test_library("list-inbox-item");
        let at = &lib.default_location();
        put(&at.join("P/a.dosik"), doc());
        put(&at.join("P/b.dosik"), doc());
        list(&lib).unwrap();
        std::fs::create_dir_all(at.join("P/New folder")).unwrap();
        put(&at.join("P/z.dosik"), doc());
        inbox(&lib, "1", &at.join("P/z.dosik"), 1);
        inbox(&lib, "2", &at.join("P/New folder"), 2);
        let listed = list(&lib).unwrap();
        let p = project(&listed, "P");
        // the empty folder shows: the note gave it an id
        assert_eq!(folder_names(p), vec!["New folder"]);
        assert_eq!(titles(p), vec!["z", "a", "b"]);
        assert_eq!(p.order[0], format!("folder:{}", p.folders[0].id));
        assert_eq!(p.order[1], format!("diagram:{}", p.diagrams[0].id));
    }

    #[test]
    fn an_item_noted_in_a_new_folder_of_the_default_location_shows() {
        let lib = test_library("list-inbox-default");
        let at = &lib.default_location();
        std::fs::create_dir_all(at.join("Bar")).unwrap();
        list(&lib).unwrap();
        // the MCP server made a folder in a folder the app has not listed yet
        put(&at.join("Foo/x.dosik"), doc());
        std::fs::create_dir_all(at.join("Foo/A")).unwrap();
        inbox(&lib, "a", &at.join("Foo/A"), 1);
        let listed = list(&lib).unwrap();
        // the folder comes in by name, the empty folder in it shows, on top
        assert_eq!(names_of(&listed), vec!["Bar", "Foo"]);
        let foo = project(&listed, "Foo");
        assert_eq!(folder_names(foo), vec!["A"]);
        assert_eq!(foo.order[0], format!("folder:{}", foo.folders[0].id));
        // a folder of the default location noted by itself (add_project): on top
        std::fs::create_dir_all(at.join("Zed")).unwrap();
        inbox(&lib, "z", &at.join("Zed"), 2);
        assert_eq!(names_of(&list(&lib).unwrap()), vec!["Zed", "Bar", "Foo"]);
        // and so does one the library has already
        inbox(&lib, "f", &at.join("Foo"), 3);
        assert_eq!(names_of(&list(&lib).unwrap()), vec!["Foo", "Zed", "Bar"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_project_spelt_another_way_is_the_same_project() {
        let lib = test_library("list-spelling");
        let at = lib.default_location();
        put(&at.join("Foo/x.dosik"), doc());
        // the folder holding the default location, by another name
        let docs = at.parent().unwrap();
        let alias = docs.parent().unwrap().join("alias");
        std::os::unix::fs::symlink(docs, &alias).unwrap();
        {
            let held = lib.lock();
            let mut st = lib.load_state(&held).unwrap();
            let record = ProjectRecord::new("p1", &alias.join("Dosik").join("Foo")).unwrap();
            st.add_project(record, Slot::First);
            lib.save_state(&held, &st).unwrap();
        }
        let listed = list(&lib).unwrap();
        assert_eq!(names_of(&listed), vec!["Foo"]);
        assert_eq!(listed[0].id, "p1");
        assert!(
            !listed[0].added,
            "in the default location, however it is spelt"
        );
        // noted by the MCP server by yet another spelling: still the one project
        inbox(&lib, "n", &alias.join("Dosik").join("Foo"), 1);
        assert_eq!(list(&lib).unwrap().len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_default_location_reached_through_a_link_is_resolved_once_and_works() {
        let base = crate::library::disk::tests::scratch("list-default-link");
        let real = base.join("Elsewhere").join("Dosik");
        put(&real.join("P/Flow.dosik"), doc());
        let link = base.join("home").join("Dosik");
        std::fs::create_dir_all(link.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let open = |default: PathBuf| {
            Library::new(
                base.join("appdata").join("library"),
                default,
                base.join("appdata").join("projects"),
                Some(base.join("home")),
            )
        };
        // as the app opens it: the link resolved
        let lib = open(crate::library::ctx::resolved_default_location(&link));
        assert_eq!(names_of(&list(&lib).unwrap()), vec!["P"]);
        crate::library::folders::create_folder(&lib, "q", "New", None, None).unwrap();
        assert!(real.join("New").is_dir());
        // not there yet: as it is spelt
        let missing = base.join("nowhere").join("Dosik");
        assert_eq!(
            crate::library::ctx::resolved_default_location(&missing),
            missing
        );
        // a real folder, however the folders holding it are reached: as it
        // is spelt — a redirected Documents folder keeps its own spelling
        let plain = base.join("Plain");
        std::fs::create_dir_all(&plain).unwrap();
        let alias = base.with_file_name(format!(
            "{}-alias",
            base.file_name().unwrap().to_string_lossy()
        ));
        std::os::unix::fs::symlink(&base, &alias).unwrap();
        let through = alias.join("Plain");
        assert_eq!(
            crate::library::ctx::resolved_default_location(&plain),
            plain
        );
        assert_eq!(
            crate::library::ctx::resolved_default_location(&through),
            through
        );
        let _ = std::fs::remove_file(alias);
    }

    /// Takes every right from `dir` — `None` when that changes nothing, as
    /// for root, who reads it all the same: the test is then left out.
    #[cfg(unix)]
    pub(crate) fn lock_out(dir: &Path) -> Option<Unlock> {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o000)).unwrap();
        let unlock = Unlock(dir.to_path_buf());
        if std::fs::read_dir(dir).is_ok() {
            eprintln!("{}: still readable without rights; left out", dir.display());
            return None;
        }
        Some(unlock)
    }

    /// gives a folder its rights back when dropped, so its temp folder can go
    #[cfg(unix)]
    pub(crate) struct Unlock(PathBuf);

    #[cfg(unix)]
    impl Drop for Unlock {
        fn drop(&mut self) {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&self.0, std::fs::Permissions::from_mode(0o755));
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_cannot_be_read_forgets_nothing() {
        let lib = test_library("list-unreadable");
        let at = &lib.default_location();
        put(&at.join("P/Keep.dosik"), doc());
        put(&at.join("P/Sub/Inner.dosik"), doc());
        std::fs::create_dir_all(at.join("P/Sub/Empty")).unwrap();
        let first = list(&lib).unwrap();
        let before = record(&lib);
        let inner = first[0].folders[0].diagrams[0].id.clone();
        let Some(_unlock) = lock_out(&at.join("P/Sub")) else {
            return;
        };
        let listed = list(&lib).unwrap();
        let p = project(&listed, "P");
        // the folder still shows, empty; what was in it is held, not forgotten
        assert_eq!(folder_names(p), vec!["Sub"]);
        assert!(p.folders[0].diagrams.is_empty());
        assert_eq!(p.held, vec![inner]);
        assert_eq!(record(&lib), before);
    }

    #[test]
    fn beside_a_diagram_held_online_only_what_is_gone_is_forgotten() {
        let lib = test_library("list-icloud-beside");
        let at = &lib.default_location();
        put(&at.join("P/Flow.dosik"), doc());
        put(&at.join("P/Gone.dosik"), doc());
        list(&lib).unwrap();
        let flow = record(&lib).projects[0].ids["Flow.dosik"].clone();
        std::fs::remove_file(at.join("P/Flow.dosik")).unwrap();
        put(&at.join("P/.Flow.dosik.icloud"), "placeholder");
        std::fs::remove_file(at.join("P/Gone.dosik")).unwrap();
        list(&lib).unwrap();
        let ids = &record(&lib).projects[0].ids;
        // the one held online only stays; the one removed beside it goes
        assert_eq!(ids.get("Flow.dosik"), Some(&flow));
        assert!(!ids.contains_key("Gone.dosik"), "{ids:?}");
    }

    #[test]
    fn a_diagram_cloud_storage_took_off_the_disk_is_not_forgotten() {
        let lib = test_library("list-icloud");
        let at = &lib.default_location();
        put(&at.join("P/Flow.dosik"), doc());
        put(&at.join("P/Keep.dosik"), doc());
        list(&lib).unwrap();
        let before = record(&lib);
        // iCloud keeps it online only, and leaves a hidden stand-in
        std::fs::remove_file(at.join("P/Flow.dosik")).unwrap();
        put(&at.join("P/.Flow.dosik.icloud"), "placeholder");
        let listed = list(&lib).unwrap();
        assert_eq!(titles(&listed[0]), vec!["Keep"]);
        assert_eq!(record(&lib), before, "its id and place are kept");
        // downloaded again: the same id
        std::fs::remove_file(at.join("P/.Flow.dosik.icloud")).unwrap();
        put(&at.join("P/Flow.dosik"), doc());
        let flow = before.projects[0].ids["Flow.dosik"].clone();
        assert!(list(&lib).unwrap()[0].diagrams.iter().any(|d| d.id == flow));
    }

    #[test]
    fn what_is_gone_from_a_folder_read_whole_is_forgotten_beside_one_that_was_not() {
        let lib = test_library("list-partly-read");
        let at = &lib.default_location();
        put(&at.join("P/Keep.dosik"), doc());
        put(&at.join("P/Gone.dosik"), doc());
        put(&at.join("P/Sub/Flow.dosik"), doc());
        put(&at.join("P/Old/Was.dosik"), doc());
        list(&lib).unwrap();
        let flow = record(&lib).projects[0].ids["Sub/Flow.dosik"].clone();
        // a diagram removed, a folder removed, and one held online only
        std::fs::remove_file(at.join("P/Gone.dosik")).unwrap();
        std::fs::remove_dir_all(at.join("P/Old")).unwrap();
        std::fs::remove_file(at.join("P/Sub/Flow.dosik")).unwrap();
        put(&at.join("P/Sub/.Flow.dosik.icloud"), "placeholder");
        list(&lib).unwrap();
        let after = record(&lib);
        let ids = &after.projects[0].ids;
        assert!(!ids.contains_key("Gone.dosik"), "{ids:?}");
        assert!(!ids.contains_key("Old"), "{ids:?}");
        assert!(!ids.contains_key("Old/Was.dosik"), "{ids:?}");
        assert_eq!(ids.get("Sub/Flow.dosik"), Some(&flow));
    }

    #[cfg(unix)]
    #[test]
    fn a_project_that_cannot_be_read_stays_and_is_not_lost() {
        let lib = test_library("list-unreadable-root");
        let at = &lib.default_location();
        put(&at.join("P/Flow.dosik"), doc());
        let first = list(&lib).unwrap();
        let before = record(&lib);
        let Some(_unlock) = lock_out(&at.join("P")) else {
            return;
        };
        let listed = list(&lib).unwrap();
        // neither not found nor gone: there, and nothing of it forgotten
        assert_eq!(names_of(&listed), vec!["P"]);
        assert!(!listed[0].missing);
        assert_eq!(listed[0].held, vec![first[0].diagrams[0].id.clone()]);
        assert_eq!(record(&lib), before);
    }

    #[cfg(unix)]
    #[test]
    fn a_default_location_that_may_not_be_read_is_an_error() {
        let lib = test_library("list-denied");
        put(&lib.default_location().join("P/Flow.dosik"), doc());
        list(&lib).unwrap();
        let before = record(&lib);
        let Some(_unlock) = lock_out(&lib.default_location()) else {
            return;
        };
        assert!(list(&lib).is_err());
        assert_eq!(record(&lib), before);
    }

    #[test]
    fn a_project_outside_that_cannot_be_found_stays_with_its_ids() {
        let lib = test_library("list-missing");
        let base = lib
            .data_dir
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();
        let outside = base.join("work").join("Repo");
        put(&outside.join("Flow.dosik"), doc());
        inbox(&lib, "x", &outside, 1);
        let first = list(&lib).unwrap();
        let ids = all_ids(&first);
        {
            let held = lib.lock();
            let mut st = lib.load_state(&held).unwrap();
            st.projects[0].board = Some(BoardSpot {
                x: 5,
                y: 6,
                collapsed: None,
            });
            lib.save_state(&held, &st).unwrap();
        }
        let away = base.join("work").join("Repo-away");
        std::fs::rename(&outside, &away).unwrap();
        let listed = list(&lib).unwrap();
        assert_eq!(listed.len(), 1);
        let repo = &listed[0];
        assert!(repo.missing && repo.added);
        assert!(repo.diagrams.is_empty() && repo.folders.is_empty());
        assert_eq!(repo.board.map(|b| (b.x, b.y)), Some((5, 6)));
        assert_eq!(repo.path.as_deref(), Some(outside.to_str().unwrap()));
        assert_eq!(record(&lib).projects[0].ids.len(), 1, "its ids are kept");
        // its diagrams are held for it: no tab of one is closed meanwhile
        assert_eq!(repo.held, vec![first[0].diagrams[0].id.clone()]);
        // back where it was: the same ids
        std::fs::rename(&away, &outside).unwrap();
        assert_eq!(all_ids(&list(&lib).unwrap()), ids);
    }

    #[test]
    fn a_project_removed_from_the_default_location_leaves_the_library() {
        let lib = test_library("list-default-gone");
        let at = &lib.default_location();
        put(&at.join("Gone/Flow.dosik"), doc());
        put(&at.join("Stays/Flow.dosik"), doc());
        list(&lib).unwrap();
        std::fs::remove_dir_all(at.join("Gone")).unwrap();
        let listed = list(&lib).unwrap();
        assert_eq!(names_of(&listed), vec!["Stays"]);
        assert_eq!(record(&lib).projects.len(), 1);
        // renamed in the file manager: a new project, by name
        let before = listed[0].id.clone();
        std::fs::rename(at.join("Stays"), at.join("Renamed")).unwrap();
        let listed = list(&lib).unwrap();
        assert_eq!(names_of(&listed), vec!["Renamed"]);
        assert_ne!(listed[0].id, before);
    }

    #[test]
    fn without_the_default_location_its_projects_are_not_found() {
        let lib = test_library("list-default-missing");
        let at = lib.default_location();
        put(&at.join("P/Flow.dosik"), doc());
        let ids = all_ids(&list(&lib).unwrap());
        let away = at.with_file_name("Dosik-away");
        std::fs::rename(&at, &away).unwrap();
        let listed = list(&lib).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].missing && !listed[0].added);
        std::fs::rename(&away, &at).unwrap();
        assert_eq!(all_ids(&list(&lib).unwrap()), ids);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_project_renamed_in_case_only_is_the_same_project() {
        let lib = test_library("list-case");
        let at = &lib.default_location();
        put(&at.join("payments/Flow.dosik"), doc());
        let first = list(&lib).unwrap();
        std::fs::rename(at.join("payments"), at.join("Payments")).unwrap();
        let listed = list(&lib).unwrap();
        assert_eq!(names_of(&listed), vec!["Payments"]);
        assert_eq!(all_ids(&listed), all_ids(&first));
    }

    #[test]
    fn a_folder_renamed_by_the_app_while_the_library_is_listed_keeps_its_id() {
        let lib = std::sync::Arc::new(test_library("list-torn"));
        let at = lib.default_location();
        put(&at.join("P/Sub/Flow.dosik"), doc());
        let first = list(&lib).unwrap();
        let sub_id = first[0].folders[0].id.clone();
        let flow_id = first[0].folders[0].diagrams[0].id.clone();
        // what the app's rename does: the folder and its keys, under the lock, counted
        let mover = lib.clone();
        let rename = move || {
            let held = mover.lock();
            let _change = mover.restructure(&held);
            std::fs::rename(at.join("P/Sub"), at.join("P/Renamed")).unwrap();
            let mut st = mover.load_state(&held).unwrap();
            st.move_subtree(0, "Sub", 0, "Renamed");
            mover.save_state(&held, &st).unwrap();
        };
        MID_LIST.with(|hook| *hook.borrow_mut() = Some(Box::new(rename)));
        let listed = list(&lib).unwrap();
        let sub = &listed[0].folders[0];
        assert_eq!(
            (sub.name.as_str(), sub.id.as_str()),
            ("Renamed", sub_id.as_str())
        );
        assert_eq!(sub.diagrams[0].id, flow_id);
    }

    #[test]
    fn an_id_given_while_the_library_is_walked_is_not_forgotten() {
        let lib = std::sync::Arc::new(test_library("list-id-meanwhile"));
        let at = lib.default_location();
        put(&at.join("P/Flow.dosik"), doc());
        list(&lib).unwrap();
        // the OS hands over a file made just now, while a listing walks
        let given = std::sync::Arc::new(std::sync::Mutex::new(None));
        let (opener, slot) = (lib.clone(), given.clone());
        let open = move || {
            let file = opener.default_location().join("P/New.dosik");
            put(&file, doc());
            let id = crate::library::ops::diagram_id_at(&opener, &file).unwrap();
            *slot.lock().unwrap() = id;
        };
        MID_LIST.with(|hook| *hook.borrow_mut() = Some(Box::new(open)));
        let listed = list(&lib).unwrap();
        let id = given.lock().unwrap().clone().expect("an id");
        assert!(listed[0].diagrams.iter().any(|d| d.id == id));
        assert_eq!(record(&lib).projects[0].ids.get("New.dosik"), Some(&id));
    }

    #[test]
    fn an_id_another_listing_gives_while_this_one_walks_is_not_forgotten() {
        let lib = std::sync::Arc::new(test_library("list-two-listings"));
        let at = lib.default_location();
        put(&at.join("P/Flow.dosik"), doc());
        list(&lib).unwrap();
        // a diagram turns up after this listing walked P; another listing
        // lists it and gives it an id meanwhile
        let given = std::sync::Arc::new(std::sync::Mutex::new(None));
        let (other, slot) = (lib.clone(), given.clone());
        let meanwhile = move || {
            put(&other.default_location().join("P/New.dosik"), doc());
            let listed = list(&other).unwrap();
            let new = listed[0]
                .diagrams
                .iter()
                .find(|d| d.title == "New")
                .unwrap();
            *slot.lock().unwrap() = Some(new.id.clone());
        };
        MID_LIST.with(|hook| *hook.borrow_mut() = Some(Box::new(meanwhile)));
        list(&lib).unwrap();
        let id = given.lock().unwrap().clone().expect("an id");
        assert_eq!(record(&lib).projects[0].ids.get("New.dosik"), Some(&id));
    }

    #[test]
    fn a_folder_noted_while_the_library_is_walked_keeps_its_id() {
        let lib = std::sync::Arc::new(test_library("list-note-meanwhile"));
        let at = lib.default_location();
        put(&at.join("P/Flow.dosik"), doc());
        list(&lib).unwrap();
        // the MCP server makes an empty folder and notes it; another listing
        // takes the note in while this one walks
        let other = lib.clone();
        let note = move || {
            let folder = other.default_location().join("P/Empty");
            std::fs::create_dir_all(&folder).unwrap();
            inbox(&other, "n", &folder, 1);
            list(&other).unwrap();
        };
        MID_LIST.with(|hook| *hook.borrow_mut() = Some(Box::new(note)));
        let listed = list(&lib).unwrap();
        assert_eq!(folder_names(&listed[0]), vec!["Empty"]);
        assert!(record(&lib).projects[0].ids.contains_key("Empty"));
    }

    #[test]
    fn the_last_walk_holds_the_lock_so_it_is_whole() {
        let lib = std::sync::Arc::new(test_library("list-last-locked"));
        let at = lib.default_location();
        put(&at.join("P/Keep.dosik"), doc());
        put(&at.join("P/Gone.dosik"), doc());
        list(&lib).unwrap();
        std::fs::remove_file(at.join("P/Gone.dosik")).unwrap();
        /// a writer that changes the library during every walk it can
        fn busy(lib: std::sync::Arc<Library>) {
            MID_LIST.with(|hook| {
                *hook.borrow_mut() = Some(Box::new(move || {
                    if let Some(held) = lib.try_lock() {
                        let _change = lib.restructure(&held);
                    }
                    busy(lib);
                }))
            });
        }
        busy(lib.clone());
        let listed = list(&lib);
        MID_LIST.with(|hook| *hook.borrow_mut() = None);
        assert_eq!(titles(&listed.unwrap()[0]), vec!["Keep"]);
        // whole at last: what is gone is forgotten
        assert!(!record(&lib).projects[0].ids.contains_key("Gone.dosik"));
    }

    #[test]
    fn a_torn_walk_forgets_nothing() {
        let lib = test_library("list-torn-last");
        let at = &lib.default_location();
        put(&at.join("P/Flow.dosik"), doc());
        let first = list(&lib).unwrap();
        // a change that never ends: every walk is torn, the last one is given
        let _under_way = lib.restructure_unguarded();
        std::fs::remove_file(at.join("P/Flow.dosik")).unwrap();
        let listed = list(&lib).unwrap();
        assert!(listed[0].diagrams.is_empty());
        assert!(record(&lib).projects[0]
            .ids
            .values()
            .any(|id| *id == first[0].diagrams[0].id));
    }

    #[test]
    fn broad_paths_are_never_projects() {
        let home = Path::new("/Users/a");
        let rules = crate::library::names::tests::rules();
        let broad = &rules["broad"];
        let home_rule = Path::new(broad["home"].as_str().unwrap());
        assert_eq!(home_rule, home);
        for case in broad["cases"].as_array().unwrap() {
            let path = Path::new(case["path"].as_str().unwrap());
            assert_eq!(
                is_broad(path, Some(home)),
                case["broad"].as_bool().unwrap(),
                "{case}"
            );
        }
    }

    #[test]
    fn a_new_project_overlaps_nothing() {
        let lib = test_library("list-overlap");
        let base = lib
            .data_dir
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();
        let repo = base.join("work").join("Repo");
        std::fs::create_dir_all(repo.join("inner")).unwrap();
        std::fs::create_dir_all(lib.default_location()).unwrap();
        let mut st = LibraryState::default();
        st.add_project(ProjectRecord::new("repo", &repo).unwrap(), Slot::First);
        let check = |p: &Path| check_new_project(&lib, &st, p, None).map_err(|r| r.to_string());
        assert!(check(&base.join("work").join("Other")).is_ok());
        assert!(check(&repo).unwrap_err().contains("already"));
        assert!(check(&repo.join("inner")).unwrap_err().contains("inside"));
        assert!(check(&base.join("work"))
            .unwrap_err()
            .contains("holds another"));
        assert!(check(&base.join("home")).unwrap_err().contains("broad"));
        assert!(check(&base.join("home").join("Docs"))
            .unwrap_err()
            .contains("library folder"));
        assert!(check(&lib.default_location().join("P").join("deeper")).is_err());
        assert!(check(&lib.default_location().join("P")).is_ok());
        assert!(check(Path::new("relative")).is_err());
        // the project being located again is no clash with itself
        assert!(check_new_project(&lib, &st, &repo, Some("repo")).is_ok());
    }

    #[test]
    fn a_path_under_the_home_folder_is_shown_from_a_tilde() {
        let home = Path::new("/Users/a");
        assert_eq!(shown_path(Path::new("/Users/a"), Some(home)), "~");
        assert_eq!(
            shown_path(
                &Path::new("/Users/a").join("Work").join("Dosik"),
                Some(home)
            ),
            "~/Work/Dosik"
        );
        assert_eq!(
            shown_path(Path::new("/Users/a2/x"), Some(home)),
            "/Users/a2/x"
        );
        assert_eq!(shown_path(Path::new("/tmp/x"), None), "/tmp/x");
    }

    #[test]
    fn what_an_app_stopped_halfway_left_of_its_writes_is_cleared_once_a_day_old() {
        let lib = test_library("list-stale-temps");
        let at = &lib.default_location();
        put(&at.join("P/Flow.dosik"), doc());
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(2 * 24 * 3600);
        let age = |path: &Path| {
            // a folder too: Windows opens one only with backup semantics and
            // asks for the right to write its attributes
            #[cfg(windows)]
            let opened = {
                use std::os::windows::fs::OpenOptionsExt;
                const FILE_WRITE_ATTRIBUTES: u32 = 0x0100;
                const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
                std::fs::OpenOptions::new()
                    .access_mode(FILE_WRITE_ATTRIBUTES)
                    .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
                    .open(path)
            };
            #[cfg(not(windows))]
            let opened = std::fs::File::open(path);
            opened.unwrap().set_modified(old).unwrap();
        };
        put(&at.join("P/.dosik-41-7.tmp"), "half");
        age(&at.join("P/.dosik-41-7.tmp"));
        put(&at.join("P/Sub/.dosik-mcp-41-2.tmp"), "half");
        age(&at.join("P/Sub/.dosik-mcp-41-2.tmp"));
        put(&at.join("P/.dosik-41-8.tmp/Copy.dosik"), "half");
        age(&at.join("P/.dosik-41-8.tmp"));
        // one written just now may be a write under way; a name not ours is the user's
        put(&at.join("P/.dosik-41-9.tmp"), "now");
        put(&at.join("P/.mine.tmp"), "theirs");
        age(&at.join("P/.mine.tmp"));
        list(&lib).unwrap();
        assert_eq!(
            crate::library::disk::tests::names_in(&at.join("P")),
            vec![".dosik-41-9.tmp", ".mine.tmp", "Flow.dosik", "Sub"]
        );
        assert!(crate::library::disk::tests::names_in(&at.join("P/Sub")).is_empty());
    }

    #[test]
    fn a_listing_is_sent_in_camel_case_with_what_it_lacks_left_out() {
        let meta = FolderMeta {
            id: "f".into(),
            name: "Sub".into(),
            updated_at: 1,
            diagrams: vec![DiagramMeta {
                id: "d".into(),
                title: "Flow".into(),
                updated_at: 2,
                readable: true,
            }],
            folders: vec![],
            order: vec!["diagram:d".into()],
            board: None,
            missing: false,
            added: false,
            path: None,
            shown: None,
            held: vec![],
        };
        assert_eq!(
            serde_json::to_value(&meta).unwrap(),
            serde_json::json!({
                "id": "f", "name": "Sub", "updatedAt": 1,
                "diagrams": [{ "id": "d", "title": "Flow", "updatedAt": 2, "readable": true }],
                "folders": [], "order": ["diagram:d"]
            })
        );
        let missing = FolderMeta {
            missing: true,
            added: true,
            path: Some("/x".into()),
            shown: Some("/x".into()),
            ..meta
        };
        let sent = serde_json::to_value(&missing).unwrap();
        assert_eq!(sent["missing"], true);
        assert_eq!(sent["added"], true);
        assert_eq!(sent["shown"], "/x");
    }
}
