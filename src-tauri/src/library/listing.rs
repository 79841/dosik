//! The listing: every project with its folders and diagrams, as the app
//! shows them, and the record brought in line with the disk on the way.
//!
//! - Folders directly in the default location are projects by themselves;
//!   a new one takes its place among the others by name.
//! - What the MCP server made while the app was away waits in the inbox
//!   (`{path, at}` files): a folder outside every project is registered on
//!   top of the projects, an item inside one goes on top of its folder. Each
//!   note is removed once read, taken or not.
//! - A new folder or diagram gets an id; an id whose item is gone is
//!   forgotten. Renaming outside the app is a removal and an addition.
//! - A project whose folder cannot be found stays, "not found", with its ids,
//!   orders and place — unless it was directly in the default location and
//!   that is still there: then the folder was removed or renamed in the file
//!   manager, and the project goes with it.
//! - The walk takes no lock; a change made meanwhile is caught by the change
//!   count, and the walk is made again.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use super::ctx::{settled, Library, LIST_ATTEMPTS};
use super::disk::{self, split_rel};
use super::names;
use super::state::{self, merge_order, BoardSpot, LibraryState, ProjectRecord, Slot};
use super::walk::{self, Entry, WalkedDir, MAX_DEPTH};

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
        if take_in(lib, &mut st) {
            lib.save_state(&held, &st)?;
        }
    }
    let mut attempt = 1;
    loop {
        let before = lib.structure();
        let roots: Vec<(String, PathBuf)> = {
            let held = lib.lock();
            let st = lib.load_state(&held)?;
            st.projects
                .iter()
                .map(|p| (p.id.clone(), p.root()))
                .collect()
        };
        let walked: HashMap<String, (PathBuf, Option<WalkedDir>)> = roots
            .into_iter()
            .map(|(id, root)| {
                let tree = walk::walk(&root);
                (id, (root, tree))
            })
            .collect();
        mid_list();
        let held = lib.lock();
        let whole = settled(before, lib.structure());
        if !whole && attempt < LIST_ATTEMPTS {
            attempt += 1;
            continue;
        }
        let mut st = lib.load_state(&held)?;
        let original = st.clone();
        let out = reconcile(lib, &mut st, &walked, whole);
        if st != original {
            lib.save_state(&held, &st)?;
        }
        return Ok(out);
    }
}

/// The inbox taken in, the default location's folders registered, the
/// default location written down — whether the record changed.
fn take_in(lib: &Library, st: &mut LibraryState) -> bool {
    let mut changed = false;
    let default = lib.default_location.to_string_lossy().into_owned();
    if st.default_location.as_deref() != Some(default.as_str()) {
        st.default_location = Some(default);
        changed = true;
    }
    changed |= accept_inbox(lib, st);
    changed |= register_default_projects(lib, st);
    changed
}

/// Takes in every note of the inbox, oldest first — the newest ends on top
/// — and removes each, whatever became of it.
fn accept_inbox(lib: &Library, st: &mut LibraryState) -> bool {
    let Ok(read) = std::fs::read_dir(lib.inbox_dir()) else {
        return false;
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
    for (_, _, file, target) in notes {
        match target {
            Some(target) => match take_one(lib, st, &target) {
                Ok(took) => changed |= took,
                Err(e) => eprintln!("library: inbox {}: {e}", target.display()),
            },
            None => eprintln!("library: inbox {}: not a note", file.display()),
        }
        if let Err(e) = std::fs::remove_file(&file) {
            eprintln!("library: inbox {}: {e}", file.display());
        }
    }
    changed
}

/// One note: an item inside a project goes on top of its folder (and gets
/// an id, so an empty folder shows); a folder outside every project is a
/// new project, on top.
fn take_one(lib: &Library, st: &mut LibraryState, target: &Path) -> Result<bool, String> {
    if !target.is_absolute() {
        return Err("not an absolute path".into());
    }
    let is_dir = disk::is_real_dir(target);
    if !is_dir && !disk::is_real_file(target) {
        return Err("not there".into());
    }
    if let Some((project, rel)) = item_in_project(st, target) {
        if rel.is_empty() {
            return Ok(false);
        }
        let depth = rel.split('/').count() + 1;
        let names: Vec<&str> = rel.split('/').collect();
        let last = names.len() - 1;
        let fits = names.iter().enumerate().all(|(i, name)| {
            match walk::classify(name, i < last || is_dir) {
                Entry::Folder => true,
                Entry::Diagram(_) => i == last,
                Entry::Skip | Entry::Other => false,
            }
        });
        let fits = fits
            && if is_dir {
                depth <= MAX_DEPTH
            } else {
                depth <= MAX_DEPTH + 1
            };
        if !fits {
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
        return Ok(true);
    }
    if !is_dir {
        return Err("not a folder".into());
    }
    check_new_project(lib, st, target, None)?;
    let id = st.new_id();
    st.add_project(ProjectRecord::new(&id, target)?, Slot::First);
    Ok(true)
}

/// The project `target` is in, and where in it (`""`: the project itself)
/// — `None` outside every project, or when a name on the way is not UTF-8.
pub fn item_in_project(st: &LibraryState, target: &Path) -> Option<(usize, String)> {
    let target_norm = normalized(target);
    st.projects.iter().enumerate().find_map(|(i, p)| {
        let root = p.root();
        let rest = target
            .strip_prefix(&root)
            .ok()
            .map(Path::to_path_buf)
            .or_else(|| {
                target_norm
                    .strip_prefix(normalized(&root))
                    .ok()
                    .map(Path::to_path_buf)
            })?;
        let mut names = Vec::new();
        for part in rest.components() {
            match part {
                Component::Normal(name) => names.push(name.to_str()?.to_string()),
                _ => return None,
            }
        }
        Some((i, names.join("/")))
    })
}

/// Registers every folder directly in the default location the record does
/// not have yet, among the projects by name. A project renamed only in case
/// is the same folder: it keeps its id and takes the new name.
fn register_default_projects(lib: &Library, st: &mut LibraryState) -> bool {
    let default = &lib.default_location;
    if !disk::is_real_dir(default) {
        return false;
    }
    let mut changed = false;
    for (name, is_dir) in walk::entries(default) {
        if !is_dir {
            continue;
        }
        let path = default.join(&name);
        if st.project_at(&path).is_some() {
            continue;
        }
        let renamed = st.projects.iter().position(|p| {
            let root = p.root();
            lib.in_default_location(&root)
                && root
                    .file_name()
                    .is_some_and(|n| names::same(&n.to_string_lossy(), &name))
                && disk::same_entry(&root, &path)
        });
        if let Some(at) = renamed {
            st.projects[at].path = path.to_string_lossy().into_owned();
            changed = true;
            continue;
        }
        if st.projects.iter().any(|p| p.root().starts_with(&path)) {
            continue;
        }
        let id = st.new_id();
        match ProjectRecord::new(&id, &path) {
            Ok(record) => {
                st.add_project(record, Slot::ByName);
                changed = true;
            }
            Err(e) => eprintln!("library: {e}"),
        }
    }
    changed
}

/// `path` as the file system has it, as far as it is there — the rest as
/// given — so two spellings of one folder compare equal, there or not.
pub fn normalized(path: &Path) -> PathBuf {
    let mut rest = Vec::new();
    let mut at = path;
    loop {
        if let Some(real) = disk::canonical(at) {
            return rest.iter().rev().fold(real, |p, name| p.join(name));
        }
        match (at.parent(), at.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_os_string());
                at = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// Too broad to be a project: a root, or the home folder or one holding it.
pub fn is_broad(path: &Path, home: Option<&Path>) -> bool {
    path.parent().is_none() || home.is_some_and(|home| home.starts_with(path))
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
) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("not an absolute path".into());
    }
    if is_broad(path, lib.home.as_deref()) {
        return Err("too broad a folder for a project".into());
    }
    let wanted = normalized(path);
    let default = normalized(&lib.default_location);
    if default.starts_with(&wanted) {
        return Err("it holds the library folder".into());
    }
    if wanted.starts_with(&default) && wanted.parent() != Some(default.as_path()) {
        return Err("it is inside a project of the library folder".into());
    }
    for project in st.projects.iter().filter(|p| Some(p.id.as_str()) != except) {
        let there = normalized(&project.root());
        if there == wanted {
            return Err("already in the library".into());
        }
        if wanted.starts_with(&there) {
            return Err("it is inside another project".into());
        }
        if there.starts_with(&wanted) {
            return Err("it holds another project".into());
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
    walked: &HashMap<String, (PathBuf, Option<WalkedDir>)>,
    whole: bool,
) -> Vec<FolderMeta> {
    let default_there = disk::is_real_dir(&lib.default_location);
    let mut out = Vec::new();
    let mut gone = Vec::new();
    for i in 0..st.projects.len() {
        let root = st.projects[i].root();
        let id = st.projects[i].id.clone();
        // a project moved meanwhile is walked where it is now
        let tree = match walked.get(&id) {
            Some((path, tree)) if *path == root => tree.clone(),
            _ => walk::walk(&root),
        };
        match tree {
            None if whole && default_there && lib.in_default_location(&root) => gone.push(id),
            None => out.push(missing_meta(lib, &st.projects[i])),
            Some(tree) => {
                let ids = &st.projects[i].ids;
                let shown = walk::shown(tree, &|rel| ids.contains_key(rel));
                sync(st, i, &shown, whole);
                out.push(project_meta(lib, &st.projects[i], &shown));
            }
        }
    }
    for id in gone {
        st.remove_project(&id);
    }
    out
}

/// An id for every item that shows; when the walk was whole, the ids and
/// orders of items that are gone forgotten.
fn sync(st: &mut LibraryState, project: usize, shown: &WalkedDir, whole: bool) {
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
    if !whole {
        return;
    }
    let keep: HashSet<&String> = present.iter().collect();
    let items: HashMap<&str, Vec<String>> = dirs
        .iter()
        .map(|d| (d.rel.as_str(), d.item_names()))
        .collect();
    let record = &mut st.projects[project];
    record.ids.retain(|k, _| keep.contains(k));
    record
        .order
        .retain(|dir, names| match items.get(dir.as_str()) {
            Some(there) => {
                names.retain(|n| there.contains(n));
                !names.is_empty()
            }
            None => false,
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
        added: !lib.in_default_location(&root),
        path: Some(record.path.clone()),
        shown: Some(shown_path(&root, lib.home.as_deref())),
    }
}

fn project_meta(lib: &Library, record: &ProjectRecord, shown: &WalkedDir) -> FolderMeta {
    let root = record.root();
    FolderMeta {
        name: state::project_name(record),
        board: record.board,
        added: !lib.in_default_location(&root),
        path: Some(record.path.clone()),
        shown: Some(shown_path(&root, lib.home.as_deref())),
        ..folder_meta(record, shown)
    }
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
    let resolved = merge_order(record.order.get(&dir.rel).map(Vec::as_slice), &names, &[]);
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
            !lib.default_location.exists(),
            "the listing makes no default location"
        );
    }

    #[test]
    fn folders_in_the_default_location_are_projects_by_name() {
        let lib = test_library("list-default");
        let at = &lib.default_location;
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
        let at = &lib.default_location;
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
        let at = &lib.default_location;
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
        let at = &lib.default_location;
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
    fn a_folder_shows_with_a_diagram_in_it_or_an_id() {
        let lib = test_library("list-shown");
        let at = &lib.default_location;
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
        let at = &lib.default_location;
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

    #[test]
    fn an_item_the_mcp_server_made_goes_on_top_of_its_folder() {
        let lib = test_library("list-inbox-item");
        let at = &lib.default_location;
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
        // back where it was: the same ids
        std::fs::rename(&away, &outside).unwrap();
        assert_eq!(all_ids(&list(&lib).unwrap()), ids);
    }

    #[test]
    fn a_project_removed_from_the_default_location_leaves_the_library() {
        let lib = test_library("list-default-gone");
        let at = &lib.default_location;
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
        let at = lib.default_location.clone();
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
        let at = &lib.default_location;
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
        let at = lib.default_location.clone();
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
    fn a_torn_walk_forgets_nothing() {
        let lib = test_library("list-torn-last");
        let at = &lib.default_location;
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
        std::fs::create_dir_all(&lib.default_location).unwrap();
        let mut st = LibraryState::default();
        st.add_project(ProjectRecord::new("repo", &repo).unwrap(), Slot::First);
        let check = |p: &Path| check_new_project(&lib, &st, p, None);
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
        assert!(check(&lib.default_location.join("P").join("deeper")).is_err());
        assert!(check(&lib.default_location.join("P")).is_ok());
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
