//! Opening and saving diagrams of the folder-backed library.
//!
//! A diagram is called what its file is called: opening one gives its name
//! with its contents, and saving one under a new title renames the file —
//! its id stays, and so do its place in its folder and every tab on it.
//! A new diagram takes its title as its file's name, with " 2" when that is
//! taken; an older `.dosik.json` becomes a `.dosik` the first time it is
//! saved.
//!
//! Every open or save says what the file was like — its stamp: when it was
//! written, how long it is and a hash of what it holds. A save that brings
//! the stamp its tab last saw writes only over the same contents: a file
//! changed meanwhile by someone else is never written over, and a file gone
//! is never made again.

use std::hash::Hasher;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::ctx::Library;
use super::disk::{self, child_rel, join_rel, split_rel};
use super::names::{self, diagram_stem, DIAGRAM_EXT, OLD_DIAGRAM_EXT};
use super::state::{Found, LibraryState, ProjectRecord, Slot};
use super::walk::{self, Siblings, MAX_DEPTH};

/// What a save came to.
#[derive(Serialize, Debug, PartialEq, Eq, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SaveOutcome {
    /// written — under `name`, which may differ from the title asked for
    /// (cleaned, or with " 2"); `stamp` is the file as it is now. When its
    /// folder's names could not be read to rename it, it is written where
    /// it is and `name` is the one asked for, cleaned — the next save tries
    /// the rename again
    Saved { name: String, stamp: String },
    /// not written: the file is not what the tab last saw
    ChangedOnDisk,
    /// not written: the library has the diagram, the disk does not
    Gone,
    /// Not written: the diagram cannot be reached — its project's folder
    /// not found, or the file system would not say — and may well be there.
    /// Nothing is made anywhere else for it.
    Unreachable,
}

/// A diagram as it was opened.
#[derive(Serialize, Debug, PartialEq, Eq, Clone)]
pub struct Loaded {
    pub contents: String,
    /// its file's name without the extension — the title it shows
    pub name: String,
    pub stamp: String,
}

/// A file's stamp: `<mtime ns>-<length>-<hash>`.
pub fn stamp_of(bytes: &[u8], modified: std::time::SystemTime) -> String {
    let nanos = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    hasher.write(bytes);
    format!("{nanos}-{}-{:016x}", bytes.len(), hasher.finish())
}

/// the stamp of the file at `path` and what it holds
pub fn read_stamped(path: &Path) -> Result<(Vec<u8>, String), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let modified = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .map_err(|e| format!("{}: {e}", path.display()))?;
    let stamp = stamp_of(&bytes, modified);
    Ok((bytes, stamp))
}

/// Whether two stamps are of the same contents: the length and the hash —
/// a file written again with the same bytes (a sync tool, a touch) is no
/// change of anyone's.
pub fn same_contents(a: &str, b: &str) -> bool {
    match (a.split_once('-'), b.split_once('-')) {
        (Some((_, x)), Some((_, y))) => x == y,
        _ => false,
    }
}

/// Where a diagram of the library is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiagramAt {
    pub project: usize,
    /// its project's folder
    pub root: PathBuf,
    pub rel: String,
    pub path: PathBuf,
}

impl DiagramAt {
    /// what is at its place now — through real folders only, never a link
    pub fn presence(&self) -> disk::Presence {
        disk::presence_within(&self.root, &self.rel)
    }

    /// whether its file is there, reached through real folders only
    pub fn is_there(&self) -> bool {
        self.presence() == disk::Presence::File
    }
}

/// Where a project or a folder of the library is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderAt {
    pub project: usize,
    /// `""` for the project itself
    pub rel: String,
    pub path: PathBuf,
    /// the project is 1
    pub depth: usize,
}

/// The diagram `id` — `None` when the record has no such id.
pub fn diagram_at(st: &LibraryState, id: &str) -> Result<Option<DiagramAt>, String> {
    super::state::validate_id(id)?;
    match st.find(id) {
        None => Ok(None),
        Some(Found { rel: None, .. }) => Err(format!("{id:?} is a project, not a diagram")),
        Some(Found {
            project,
            rel: Some(rel),
        }) => {
            if diagram_stem(split_rel(&rel).1).is_none() {
                return Err(format!("{id:?} is a folder, not a diagram"));
            }
            let root = st.projects[project].root();
            let path = join_rel(&root, &rel).ok_or("not inside the project")?;
            Ok(Some(DiagramAt {
                project,
                root,
                rel,
                path,
            }))
        }
    }
}

/// The project or folder `id`, there on disk.
pub fn folder_at(st: &LibraryState, id: &str) -> Result<FolderAt, String> {
    super::state::validate_id(id)?;
    let found = st
        .find(id)
        .ok_or_else(|| format!("no such folder: {id:?}"))?;
    let record = &st.projects[found.project];
    let rel = found.rel.unwrap_or_default();
    let path = join_rel(&record.root(), &rel).ok_or("not inside the project")?;
    // through real folders only: a link on the way leads outside the project
    if disk::presence_within(&record.root(), &rel) != disk::Presence::Dir {
        if rel.is_empty() {
            return Err(format!(
                "can't find the project {:?}",
                super::state::project_name(record)
            ));
        }
        return Err(format!("no such folder: {id:?}"));
    }
    let depth = if rel.is_empty() {
        1
    } else {
        rel.split('/').count() + 1
    };
    Ok(FolderAt {
        project: found.project,
        rel,
        path,
        depth,
    })
}

/// What a path is asked of: a folder (a project or one inside one) or a diagram.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Folder,
    Diagram,
}

/// The folder or the file the library keeps `id` in, there on disk — found
/// in the record, so the webview never rebuilds where things are.
pub fn item_path(lib: &Library, kind: ItemKind, id: &str) -> Result<PathBuf, String> {
    let held = lib.lock();
    let st = lib.load_state(&held)?;
    match kind {
        ItemKind::Folder => Ok(folder_at(&st, id)?.path),
        ItemKind::Diagram => match diagram_at(&st, id)? {
            Some(at) if at.is_there() => Ok(at.path),
            _ => Err(format!("no such diagram: {id:?}")),
        },
    }
}

/// The library diagram the file at `path` is, when it is one: a diagram
/// file in a project of the library, no deeper than the listing reads and
/// with no hidden name on the way. One the record has no id for yet — made
/// just now, by an agent say — gets one, as the next listing would give it.
pub fn diagram_id_at(lib: &Library, path: &Path) -> Result<Option<String>, String> {
    if !disk::is_real_file(path) {
        return Ok(None);
    }
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    let Some((project, rel)) = super::listing::item_in_project(&st, path) else {
        return Ok(None);
    };
    // each name as it is stored — the record knows it so — and through real
    // folders only: a link on the way leads outside the project
    let root = st.projects[project].root();
    let Some(rel) = walk::stored_rel(&root, &rel) else {
        return Ok(None);
    };
    if !walk::shown_rel(&rel, false) || disk::presence_within(&root, &rel) != disk::Presence::File {
        return Ok(None);
    }
    if let Some(id) = st.projects[project].ids.get(&rel) {
        return Ok(Some(id.clone()));
    }
    let id = st.ensure_id(project, &rel);
    // counted as a change: a listing walking meanwhile did not see the file,
    // and must not forget its id
    let _change = lib.restructure(&held);
    lib.save_state(&held, &st)?;
    Ok(Some(id))
}

/// the title a diagram's JSON gives, or none
fn title_of(contents: &str) -> String {
    serde_json::from_str::<serde_json::Value>(contents)
        .ok()
        .and_then(|doc| {
            doc.get("title")
                .and_then(|t| t.as_str())
                .map(str::to_string)
        })
        .unwrap_or_default()
}

/// Opens the diagram `id`: what it holds, the name it shows, its stamp.
pub fn load(lib: &Library, id: &str) -> Result<Loaded, String> {
    let held = lib.lock();
    let st = lib.load_state(&held)?;
    let at = diagram_at(&st, id)?.ok_or_else(|| format!("no such diagram: {id:?}"))?;
    if !at.is_there() {
        return Err(format!("no such diagram: {id:?}"));
    }
    let (bytes, stamp) = read_stamped(&at.path)?;
    let contents =
        String::from_utf8(bytes).map_err(|_| format!("{}: not UTF-8 text", at.path.display()))?;
    Ok(Loaded {
        contents,
        name: diagram_stem(split_rel(&at.rel).1)
            .unwrap_or_default()
            .to_string(),
        stamp,
    })
}

/// Saves the diagram `id` where it is — renamed first when its title is not
/// its file's name, or when it is an older `.dosik.json` — unless `base`,
/// the stamp its tab last saw, is no longer what is on disk, or it cannot be
/// reached. One the library does not have is gone — removed outside the app
/// and forgotten by a listing — and is never made again somewhere else: only
/// `create` makes a diagram.
pub fn save(
    lib: &Library,
    id: &str,
    contents: &str,
    base: Option<&str>,
) -> Result<SaveOutcome, String> {
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    let wanted = names::clean(&title_of(contents), names::UNTITLED_DIAGRAM);
    let Some(at) = diagram_at(&st, id)? else {
        return Ok(SaveOutcome::Gone);
    };
    if disk::presence(&st.projects[at.project].root()) != disk::Presence::Dir {
        return Ok(SaveOutcome::Unreachable);
    }
    match at.presence() {
        disk::Presence::File => {}
        disk::Presence::Unknown(_) => return Ok(SaveOutcome::Unreachable),
        _ => return Ok(SaveOutcome::Gone),
    }
    if let Some(base) = base {
        let Ok((_, now)) = read_stamped(&at.path) else {
            return Ok(SaveOutcome::Unreachable);
        };
        if !same_contents(&now, base) {
            return Ok(SaveOutcome::ChangedOnDisk);
        }
    }
    let (parent, file) = split_rel(&at.rel);
    let (parent, file) = (parent.to_string(), file.to_string());
    let old_ext = file.to_ascii_lowercase().ends_with(OLD_DIAGRAM_EXT);
    let renamed = diagram_stem(&file) != Some(wanted.as_str()) || old_ext;
    let dir = at.path.parent().ok_or("no parent folder")?.to_path_buf();
    // a rename worked out before anything is written, and what the file
    // was, to put back when the rename cannot be made or recorded: the
    // tab's stamp then still holds. Its folder's names not to be read now,
    // it is saved where it is for now, and the title stays as asked: the
    // next save tries the rename again
    let siblings = if renamed {
        Siblings::read(&dir)
            .inspect_err(|e| eprintln!("library: {e}; renamed on a later save"))
            .ok()
    } else {
        None
    };
    let rename_later = renamed && siblings.is_none();
    let rename = match siblings {
        Some(siblings) => Some((siblings.except(&file), Previous::read(&at.path)?)),
        None => None,
    };
    // the contents first, where the record has the file: a rename that fails
    // after, or an app that stops halfway, never loses them
    disk::write_atomic(&at.path, contents.as_bytes())?;
    let written = contents.as_bytes();
    let mut path = at.path.clone();
    if let Some((siblings, was)) = rename {
        let mut taken: Vec<String> = Vec::new();
        let new_file = loop {
            if taken.len() == RENAME_ATTEMPTS {
                // every name taken as it was tried: saved under its own, as
                // it is — the title takes it, and nothing is tried again
                eprintln!("library: {}: no free name for {wanted:?}", dir.display());
                break None;
            }
            let name = siblings.diagram_name_avoiding(&wanted, DIAGRAM_EXT, &taken);
            let new_file = format!("{name}{DIAGRAM_EXT}");
            let new_path = dir.join(&new_file);
            mid_rename(&new_path);
            let moved = {
                let _change = lib.restructure(&held);
                // never over a file that turned up there since it was looked at
                disk::move_file_new(&path, &new_path)
            };
            match moved {
                Ok(()) => break Some(new_file),
                // taken meanwhile, or the same name by the disk's rules: the next
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => taken.push(new_file),
                Err(e) => {
                    was.put_back(&path, written);
                    return Err(format!("{}: {e}", path.display()));
                }
            }
        };
        if let Some(new_file) = new_file {
            // recorded as the folder stores it, as the walk will find it
            let new_file = walk::stored_name(&dir, &new_file);
            let new_path = dir.join(&new_file);
            let new_rel = child_rel(&parent, &new_file);
            st.move_subtree(at.project, &at.rel, at.project, &new_rel);
            st.rename_in_order(at.project, &parent, &file, &new_file);
            if let Err(e) = lib.save_state(&held, &st) {
                {
                    let _change = lib.restructure(&held);
                    if let Err(back) = disk::move_file_new(&new_path, &path) {
                        eprintln!("library: {} stays renamed: {back}", new_path.display());
                        return Err(e);
                    }
                }
                was.put_back(&path, written);
                return Err(e);
            }
            path = new_path;
        }
    }
    let (_, stamp) = read_stamped(&path)?;
    let file = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let name = if rename_later {
        wanted
    } else {
        diagram_stem(&file).unwrap_or_default().to_string()
    };
    Ok(SaveOutcome::Saved { name, stamp })
}

/// how many names a save's rename tries before it keeps the file's own
const RENAME_ATTEMPTS: usize = 100;

#[cfg(test)]
thread_local! {
    /// what a test does just before a save renames its file, with where to
    pub(crate) static MID_RENAME: std::cell::RefCell<Option<super::migrate::PlaceHook>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn mid_rename(to: &Path) {
    if let Some(hook) = MID_RENAME.with(|hook| hook.borrow_mut().take()) {
        hook(to);
    }
}

#[cfg(not(test))]
fn mid_rename(_to: &Path) {}

/// A file as it was before a save wrote it: what it held and when.
struct Previous {
    bytes: Vec<u8>,
    modified: Option<std::time::SystemTime>,
}

impl Previous {
    fn read(path: &Path) -> Result<Previous, String> {
        let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let modified = std::fs::metadata(path).and_then(|m| m.modified()).ok();
        Ok(Previous { bytes, modified })
    }

    /// back at `path`, as it was — only while it holds what the save wrote,
    /// `written`: what someone wrote there since stays; when it cannot be
    /// put back, said
    fn put_back(&self, path: &Path, written: &[u8]) {
        if std::fs::read(path).ok().as_deref() != Some(written) {
            eprintln!(
                "library: {} was written meanwhile; left as it is",
                path.display()
            );
            return;
        }
        let restored = disk::write_atomic(path, &self.bytes).and_then(|()| {
            if let Some(at) = self.modified {
                std::fs::OpenOptions::new()
                    .write(true)
                    .open(path)
                    .and_then(|f| f.set_modified(at))
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        });
        if let Err(e) = restored {
            eprintln!("library: {} keeps what was saved: {e}", path.display());
        }
    }
}

/// Makes the new diagram `id` in the folder `folder` — or the most recently
/// edited project, or a new "My Diagrams" when there is none — named by its
/// title and on top of its folder. An id the library has already is refused.
pub fn create(
    lib: &Library,
    id: &str,
    contents: &str,
    folder: Option<&str>,
) -> Result<SaveOutcome, String> {
    super::state::validate_id(id)?;
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    if st.id_taken(id) {
        return Err(format!("an item with id {id:?} already exists"));
    }
    let wanted = names::clean(&title_of(contents), names::UNTITLED_DIAGRAM);
    let projects = st.projects.len();
    let target = match folder {
        Some(folder) => folder_at(&st, folder)?,
        None => default_target(lib, &held, &mut st)?,
    };
    // a "My Diagrams" made for it just now
    let new_project = st.projects.len() > projects;
    if target.depth > MAX_DEPTH {
        return Err(format!("folders nest at most {MAX_DEPTH} levels deep"));
    }
    let file = {
        let _change = lib.restructure(&held);
        create_diagram_file(&target.path, &wanted, contents.as_bytes())?
    };
    // recorded as the folder stores it, as the walk will find it
    let file = walk::stored_name(&target.path, &file);
    let made = target.path.join(&file);
    let rel = child_rel(&target.rel, &file);
    let recorded = st.insert_id(target.project, &rel, id).and_then(|()| {
        let present = st.visible_items(target.project, &target.rel, target.depth);
        st.place_item(target.project, &target.rel, &file, 0, &present);
        lib.save_state(&held, &st)
    });
    if let Err(e) = recorded {
        // made just now, and by nobody else: no file the record does not know
        let _change = lib.restructure(&held);
        let _ = std::fs::remove_file(&made);
        if new_project {
            let _ = std::fs::remove_dir(&target.path);
        }
        return Err(e);
    }
    let (_, stamp) = read_stamped(&made)?;
    Ok(SaveOutcome::Saved {
        name: diagram_stem(&file).unwrap_or_default().to_string(),
        stamp,
    })
}

/// Puts `bytes` into a new diagram file in `dir`, named `wanted` or the
/// first free " 2", " 3" — never over anything there, even something that
/// turned up meanwhile. Returns the file's name.
pub fn create_diagram_file(dir: &Path, wanted: &str, bytes: &[u8]) -> Result<String, String> {
    let tmp = disk::write_tmp(dir, bytes)?;
    let mut taken: Vec<String> = Vec::new();
    let result = (|| {
        let siblings = Siblings::read(dir)?;
        for _ in 0..100 {
            let name = siblings.diagram_name_avoiding(wanted, DIAGRAM_EXT, &taken);
            let file = format!("{name}{DIAGRAM_EXT}");
            match disk::place_new(&tmp, &dir.join(&file)) {
                Ok(()) => return Ok(file),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => taken.push(file),
                Err(e) => return Err(format!("{}: {e}", dir.join(&file).display())),
            }
        }
        Err(format!("{}: no free name for {wanted:?}", dir.display()))
    })();
    let _ = std::fs::remove_file(&tmp);
    result
}

/// Makes a new folder in `dir` named `wanted` or the first free " 2", " 3"
/// — never one that is there already. Returns its name.
pub fn create_folder_dir(dir: &Path, wanted: &str) -> Result<String, String> {
    let siblings = Siblings::read(dir)?;
    let mut taken: Vec<String> = Vec::new();
    for _ in 0..100 {
        let name = siblings.folder_name_avoiding(wanted, &taken);
        match std::fs::create_dir(dir.join(&name)) {
            Ok(()) => return Ok(name),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => taken.push(name),
            Err(e) => return Err(format!("{}: {e}", dir.join(&name).display())),
        }
    }
    Err(format!("{}: no free name for {wanted:?}", dir.display()))
}

/// The default location, made when it is not there yet — refused while the
/// record has projects in it that cannot be found: made anew it would hold
/// none of them, and the next listing would forget them all.
pub fn ensure_default_location(lib: &Library, st: &LibraryState) -> Result<(), String> {
    let default = &lib.default_location();
    match disk::presence(default) {
        disk::Presence::Dir => return Ok(()),
        disk::Presence::Unknown(kind) => return Err(format!("{}: {kind}", default.display())),
        disk::Presence::Missing | disk::Presence::File | disk::Presence::Other => {}
    }
    if st
        .projects
        .iter()
        .any(|p| lib.in_default_location(&p.root()))
    {
        return Err(format!(
            "Can't find the library folder {}",
            super::listing::shown_path(default, lib.home.as_deref())
        ));
    }
    std::fs::create_dir_all(default).map_err(|e| format!("{}: {e}", default.display()))
}

/// Makes the project `id` in the default location — the folder, and its
/// entry on top of the projects.
pub fn make_project(
    lib: &Library,
    held: &std::sync::MutexGuard<'_, ()>,
    st: &mut LibraryState,
    id: &str,
    wanted: &str,
) -> Result<(), String> {
    if st.id_taken(id) {
        return Err(format!("an item with id {id:?} already exists"));
    }
    ensure_default_location(lib, st)?;
    let default = &lib.default_location();
    let name = {
        let _change = lib.restructure(held);
        create_folder_dir(default, wanted)?
    };
    st.add_project(ProjectRecord::new(id, &default.join(name))?, Slot::First);
    Ok(())
}

/// Where a new diagram goes when nothing says: the project edited last, by
/// what shows of it as the listing tells it (and the window, which asks for
/// the same) — or a new "My Diagrams".
fn default_target(
    lib: &Library,
    held: &std::sync::MutexGuard<'_, ()>,
    st: &mut LibraryState,
) -> Result<FolderAt, String> {
    let latest = st
        .projects
        .iter()
        .enumerate()
        .filter(|(_, p)| disk::is_real_dir(&p.root()))
        .map(|(i, p)| {
            let known = |rel: &str| p.ids.contains_key(rel);
            (walk::newest_shown(&p.root(), "", 1, &known), i)
        })
        // ties go to the earlier project, the order the listing shows
        .max_by(|(a, i), (b, j)| a.cmp(b).then_with(|| j.cmp(i)))
        .map(|(_, i)| i);
    let project = match latest {
        Some(i) => i,
        None => {
            let id = st.new_id();
            make_project(lib, held, st, &id, names::MY_DIAGRAMS)?;
            st.project_index(&id)
                .ok_or("the new project is not in the record")?
        }
    };
    Ok(FolderAt {
        project,
        rel: String::new(),
        path: st.projects[project].root(),
        depth: 1,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::library::ctx::tests::test_library;
    use crate::library::disk::tests::names_in;
    use crate::library::listing::tests::{project, put, titles};
    use crate::library::listing::{list, FolderMeta};

    pub(crate) fn titled(title: &str) -> String {
        format!(r#"{{"version":1,"title":"{title}","nodes":[],"edges":[]}}"#)
    }

    pub(crate) fn saved(outcome: SaveOutcome) -> (String, String) {
        match outcome {
            SaveOutcome::Saved { name, stamp } => (name, stamp),
            other => panic!("not saved: {other:?}"),
        }
    }

    /// a library with one project, `P`, in its default location, listed
    pub(crate) fn with_project(tag: &str) -> (Library, String) {
        let lib = test_library(tag);
        std::fs::create_dir_all(lib.default_location().join("P")).unwrap();
        let listed = list(&lib).unwrap();
        let id = listed[0].id.clone();
        (lib, id)
    }

    pub(crate) fn p_dir(lib: &Library) -> PathBuf {
        lib.default_location().join("P")
    }

    fn listed_p(lib: &Library) -> FolderMeta {
        project(&list(lib).unwrap(), "P").clone()
    }

    #[test]
    fn an_items_path_is_where_the_record_says() {
        let (lib, p) = with_project("ops-path");
        std::fs::create_dir_all(p_dir(&lib).join("Sub")).unwrap();
        put(&p_dir(&lib).join("Sub/Flow.dosik"), &titled("Flow"));
        let listed = listed_p(&lib);
        let sub = listed.folders[0].id.clone();
        let flow = listed.folders[0].diagrams[0].id.clone();
        assert_eq!(item_path(&lib, ItemKind::Folder, &p).unwrap(), p_dir(&lib));
        assert_eq!(
            item_path(&lib, ItemKind::Folder, &sub).unwrap(),
            p_dir(&lib).join("Sub")
        );
        assert_eq!(
            item_path(&lib, ItemKind::Diagram, &flow).unwrap(),
            p_dir(&lib).join("Sub").join("Flow.dosik")
        );
        // none such, a bad id, one kind asked for as the other
        assert!(item_path(&lib, ItemKind::Folder, "nope").is_err());
        assert!(item_path(&lib, ItemKind::Diagram, "../x").is_err());
        assert!(item_path(&lib, ItemKind::Diagram, &sub).is_err());
        assert!(item_path(&lib, ItemKind::Diagram, &p).is_err());
        // a file gone from disk, a folder gone from disk
        std::fs::remove_file(p_dir(&lib).join("Sub/Flow.dosik")).unwrap();
        assert!(item_path(&lib, ItemKind::Diagram, &flow).is_err());
        std::fs::remove_dir(p_dir(&lib).join("Sub")).unwrap();
        assert!(item_path(&lib, ItemKind::Folder, &sub).is_err());
    }

    #[test]
    fn a_file_opened_from_outside_is_the_library_diagram_it_is() {
        let (lib, _) = with_project("ops-open-at");
        put(&p_dir(&lib).join("Sub/Flow.dosik"), &titled("Flow"));
        put(&p_dir(&lib).join("Old.DOSIK.JSON"), &titled("Old"));
        let listed = listed_p(&lib);
        let flow = listed.folders[0].diagrams[0].id.clone();
        let old = listed.diagrams[0].id.clone();
        let at = |p: PathBuf| diagram_id_at(&lib, &p).unwrap();
        assert_eq!(at(p_dir(&lib).join("Sub/Flow.dosik")), Some(flow));
        assert_eq!(at(p_dir(&lib).join("Old.DOSIK.JSON")), Some(old));
        // made just now, not listed yet: an id now, the same the listing keeps
        put(&p_dir(&lib).join("New.dosik"), &titled("New"));
        let new = at(p_dir(&lib).join("New.dosik")).expect("an id");
        assert_eq!(at(p_dir(&lib).join("New.dosik")), Some(new.clone()));
        let listed = listed_p(&lib);
        assert!(listed
            .diagrams
            .iter()
            .any(|d| d.id == new && d.title == "New"));
        // no diagram of the library's
        put(&p_dir(&lib).join("notes.txt"), "x");
        put(&p_dir(&lib).join(".hidden/In.dosik"), &titled("In"));
        put(
            &lib.default_location().join("Loose.dosik"),
            &titled("Loose"),
        );
        let outside = lib.default_location().parent().unwrap().join("Mine.dosik");
        put(&outside, &titled("Mine"));
        for path in [
            p_dir(&lib).join("notes.txt"),
            p_dir(&lib).join(".hidden/In.dosik"),
            p_dir(&lib).join("Gone.dosik"),
            p_dir(&lib).join("Sub"),
            lib.default_location().join("Loose.dosik"),
            outside,
        ] {
            assert_eq!(at(path.clone()), None, "{}", path.display());
        }
        // deeper than the listing reads
        let mut deep = p_dir(&lib);
        for n in 0..MAX_DEPTH {
            deep = deep.join(format!("d{n}"));
        }
        put(&deep.join("Deep.dosik"), &titled("Deep"));
        assert_eq!(at(deep.join("Deep.dosik")), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_path_spelt_otherwise_is_the_item_as_its_names_are_stored() {
        let (lib, _) = with_project("ops-stored-names");
        put(&p_dir(&lib).join("Sub/Flow.dosik"), &titled("Flow"));
        // a Korean name as the app writes it, composed
        let composed = "\u{D55C}\u{AE00}.dosik";
        put(&p_dir(&lib).join(composed), &titled("K"));
        let listed = listed_p(&lib);
        let flow = listed.folders[0].diagrams[0].id.clone();
        let korean = listed.diagrams[0].id.clone();
        let keys = |lib: &Library| {
            let held = lib.lock();
            lib.load_state(&held).unwrap().projects[0].ids.len()
        };
        let before = keys(&lib);
        // in another case, and decomposed as Finder may hand it over: the same items
        let at = |p: PathBuf| diagram_id_at(&lib, &p).unwrap();
        assert_eq!(at(p_dir(&lib).join("sub/FLOW.dosik")), Some(flow.clone()));
        let decomposed = "\u{1112}\u{1161}\u{11AB}\u{1100}\u{1173}\u{11AF}.dosik";
        assert_eq!(at(p_dir(&lib).join(decomposed)), Some(korean));
        // noted by the MCP server so: no second id for the same file
        let note =
            serde_json::json!({ "path": p_dir(&lib).join("SUB").to_string_lossy(), "at": 1 });
        put(&lib.inbox_dir().join("n.json"), &note.to_string());
        list(&lib).unwrap();
        assert_eq!(keys(&lib), before);
        assert_eq!(listed_p(&lib).folders[0].diagrams[0].id, flow);
    }

    #[test]
    fn an_item_kind_is_folder_or_diagram_in_lower_case() {
        let kind: ItemKind = serde_json::from_str(r#""diagram""#).unwrap();
        assert_eq!(kind, ItemKind::Diagram);
        assert!(serde_json::from_str::<ItemKind>(r#""Folder""#).is_err());
    }

    #[test]
    fn a_new_diagram_is_named_by_its_title_and_goes_on_top() {
        let (lib, p) = with_project("ops-new");
        put(&p_dir(&lib).join("a.dosik"), &titled("a"));
        list(&lib).unwrap();
        let (name, _) = saved(create(&lib, "d1", &titled(""), Some(&p)).unwrap());
        assert_eq!(name, "Untitled Diagram");
        let (name, _) = saved(create(&lib, "d2", &titled("Untitled Diagram"), Some(&p)).unwrap());
        assert_eq!(name, "Untitled Diagram 2");
        let (name, _) = saved(create(&lib, "d3", &titled("a/b: c"), Some(&p)).unwrap());
        assert_eq!(name, "a-b- c");
        assert_eq!(
            names_in(&p_dir(&lib)),
            vec![
                "Untitled Diagram 2.dosik",
                "Untitled Diagram.dosik",
                "a-b- c.dosik",
                "a.dosik"
            ]
        );
        let listed = listed_p(&lib);
        assert_eq!(
            titles(&listed),
            vec!["a-b- c", "Untitled Diagram 2", "Untitled Diagram", "a"]
        );
        assert_eq!(listed.diagrams[0].id, "d3");
        // the bytes are the document's, as sent
        let text = std::fs::read_to_string(p_dir(&lib).join("a-b- c.dosik")).unwrap();
        assert_eq!(text, titled("a/b: c"));
    }

    #[test]
    fn a_new_diagram_without_a_folder_goes_to_the_latest_project_or_my_diagrams() {
        let lib = test_library("ops-default");
        let (name, _) = saved(create(&lib, "d1", &titled("First"), None).unwrap());
        assert_eq!(name, "First");
        assert!(lib
            .default_location()
            .join("My Diagrams/First.dosik")
            .is_file());
        // the project edited last takes the next one
        put(&lib.default_location().join("Other/x.dosik"), &titled("x"));
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(60);
        std::fs::OpenOptions::new()
            .write(true)
            .open(lib.default_location().join("Other/x.dosik"))
            .unwrap()
            .set_modified(later)
            .unwrap();
        list(&lib).unwrap();
        saved(create(&lib, "d2", &titled("Second"), None).unwrap());
        assert!(lib.default_location().join("Other/Second.dosik").is_file());
    }

    #[test]
    fn the_library_folder_is_not_made_again_while_its_projects_are_not_found() {
        let (lib, p) = with_project("ops-default-gone");
        saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        let away = lib.default_location().with_file_name("away");
        std::fs::rename(lib.default_location(), &away).unwrap();
        // made anew, it would hold none of them: the next listing would forget them all
        let refused = crate::library::folders::create_folder(&lib, "p2", "New", None, None);
        assert!(refused.unwrap_err().contains("library folder"));
        assert!(create(&lib, "d2", &titled("Loose"), None).is_err());
        {
            let held = lib.lock();
            let st = lib.load_state(&held).unwrap();
            assert!(ensure_default_location(&lib, &st).is_err());
        }
        assert!(!lib.default_location().exists());
        // back: its project and diagram are there, ids and all
        std::fs::rename(&away, lib.default_location()).unwrap();
        let listed = listed_p(&lib);
        assert_eq!(
            (listed.id.as_str(), listed.diagrams[0].id.as_str()),
            (p.as_str(), "d1")
        );
        // gone again and removed from the library: nothing is lost by making it
        std::fs::rename(lib.default_location(), &away).unwrap();
        crate::library::removal::remove_project(&lib, &p).unwrap();
        crate::library::folders::create_folder(&lib, "p2", "New", None, None).unwrap();
        assert!(lib.default_location().join("New").is_dir());
    }

    #[test]
    fn the_latest_project_is_told_by_what_shows_as_the_app_tells_it() {
        let lib = test_library("ops-default-shown");
        let set = |path: &Path, secs: u64| {
            let at = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000 + secs);
            // a folder too: Windows opens one only with backup semantics and asks for the right
            // to write its attributes
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
            opened.unwrap().set_modified(at).unwrap();
        };
        put(&lib.default_location().join("A/a.dosik"), &titled("a"));
        put(&lib.default_location().join("B/b.dosik"), &titled("b"));
        // A has a folder made outside, newest of all, with nothing in it: it does not show
        std::fs::create_dir_all(lib.default_location().join("A/build")).unwrap();
        set(&lib.default_location().join("A/a.dosik"), 10);
        set(&lib.default_location().join("B/b.dosik"), 20);
        set(&lib.default_location().join("A/build"), 30);
        let listed = list(&lib).unwrap();
        let newest = listed.iter().max_by_key(|p| p.updated_at).unwrap();
        assert_eq!(newest.name, "B");
        saved(create(&lib, "d1", &titled("Next"), None).unwrap());
        assert!(lib.default_location().join("B/Next.dosik").is_file());
    }

    #[test]
    fn a_diagram_is_saved_in_place_and_renamed_with_its_title() {
        let (lib, p) = with_project("ops-rename");
        saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        saved(create(&lib, "d2", &titled("Other"), Some(&p)).unwrap());
        // the same title: written where it is, whatever folder is passed
        let (name, _) = saved(save(&lib, "d1", &titled("Flow"), None).unwrap());
        assert_eq!(name, "Flow");
        let order_before = listed_p(&lib).order.clone();
        // a new title renames the file; the id and its place stay
        let (name, _) = saved(save(&lib, "d1", &titled("Payments"), None).unwrap());
        assert_eq!(name, "Payments");
        assert_eq!(
            names_in(&p_dir(&lib)),
            vec!["Other.dosik", "Payments.dosik"]
        );
        let listed = listed_p(&lib);
        assert_eq!(listed.order, order_before);
        assert!(listed
            .diagrams
            .iter()
            .any(|d| d.id == "d1" && d.title == "Payments"));
        // a title another diagram has gets " 2"
        let (name, _) = saved(save(&lib, "d1", &titled("other"), None).unwrap());
        assert_eq!(name, "other 2");
        assert_eq!(load(&lib, "d1").unwrap().name, "other 2");
    }

    /// the record's next write fails, as on a full disk
    pub(crate) fn fail_next_record_write() {
        crate::library::ctx::FAIL_NEXT_SAVE.with(|f| f.set(true));
    }

    #[test]
    fn a_rename_the_record_cannot_take_is_undone() {
        let (lib, p) = with_project("ops-rename-unrecorded");
        let (_, stamp) = saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        fail_next_record_write();
        assert!(save(&lib, "d1", &titled("Payments"), Some(&stamp)).is_err());
        // the file where the record has it, as it was: the tab's stamp still holds
        assert_eq!(names_in(&p_dir(&lib)), vec!["Flow.dosik"]);
        assert_eq!(
            std::fs::read_to_string(p_dir(&lib).join("Flow.dosik")).unwrap(),
            titled("Flow")
        );
        let (name, _) = saved(save(&lib, "d1", &titled("Payments"), Some(&stamp)).unwrap());
        assert_eq!(name, "Payments");
        assert_eq!(names_in(&p_dir(&lib)), vec!["Payments.dosik"]);
        assert_eq!(listed_p(&lib).diagrams[0].id, "d1");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_diagram_renamed_by_its_save_is_recorded_as_the_disk_stores_it() {
        let (lib, p) = with_project("ops-rename-stored");
        let (_, stamp) = saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        crate::library::walk::store_next_name_decomposed();
        let (name, _) = saved(save(&lib, "d1", &titled("Caf\u{e9}"), Some(&stamp)).unwrap());
        assert_eq!(name, "Cafe\u{301}");
        let held = lib.lock();
        let st = lib.load_state(&held).unwrap();
        assert_eq!(
            st.projects[0].ids.get("Cafe\u{301}.dosik"),
            Some(&"d1".to_string())
        );
        drop(held);
        assert_eq!(listed_p(&lib).diagrams[0].id, "d1");
    }

    #[test]
    fn a_name_taken_as_a_save_renames_is_passed_for_the_next() {
        let (lib, p) = with_project("ops-rename-taken");
        let (_, stamp) = saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        // someone's file turns up under the new name just as it is taken
        MID_RENAME.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(|to: &Path| std::fs::write(to, "theirs").unwrap()))
        });
        let (name, _) = saved(save(&lib, "d1", &titled("Payments"), Some(&stamp)).unwrap());
        assert_eq!(name, "Payments 2");
        assert_eq!(
            std::fs::read_to_string(p_dir(&lib).join("Payments.dosik")).unwrap(),
            "theirs"
        );
        assert_eq!(
            names_in(&p_dir(&lib)),
            vec!["Payments 2.dosik", "Payments.dosik"]
        );
    }

    #[test]
    fn what_someone_wrote_meanwhile_is_not_taken_back_by_a_failed_rename() {
        let (lib, p) = with_project("ops-put-back-theirs");
        let (_, stamp) = saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        let file = p_dir(&lib).join("Flow.dosik");
        let theirs = file.clone();
        MID_RENAME.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move |_: &Path| {
                std::fs::write(&theirs, "theirs").unwrap()
            }))
        });
        fail_next_record_write();
        assert!(save(&lib, "d1", &titled("Payments"), Some(&stamp)).is_err());
        assert_eq!(names_in(&p_dir(&lib)), vec!["Flow.dosik"]);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "theirs");
    }

    #[cfg(unix)]
    #[test]
    fn a_rename_that_cannot_be_worked_out_saves_in_place() {
        use std::os::unix::fs::PermissionsExt;
        let (lib, p) = with_project("ops-rename-unread");
        let (_, stamp) = saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        // the folder may be written to, not read: no name can be worked out
        let dir = p_dir(&lib);
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o300)).unwrap();
        if std::fs::read_dir(&dir).is_ok() {
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
            return;
        }
        let outcome = save(&lib, "d1", &titled("Payments"), Some(&stamp));
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        // the edits are on disk, under the name it had; the title stays as
        // asked, for the next save to rename it
        let (name, stamp) = saved(outcome.unwrap());
        assert_eq!(name, "Payments");
        assert_eq!(
            std::fs::read_to_string(dir.join("Flow.dosik")).unwrap(),
            titled("Payments")
        );
        assert_eq!(names_in(&dir), vec!["Flow.dosik"]);
        let (name, _) = saved(save(&lib, "d1", &titled("Payments"), Some(&stamp)).unwrap());
        assert_eq!(name, "Payments");
        assert_eq!(names_in(&dir), vec!["Payments.dosik"]);
    }

    #[test]
    fn a_new_diagram_or_project_the_record_cannot_take_is_not_left_behind() {
        let (lib, p) = with_project("ops-create-unrecorded");
        fail_next_record_write();
        assert!(create(&lib, "d1", &titled("Flow"), Some(&p)).is_err());
        assert!(names_in(&p_dir(&lib)).is_empty());
        fail_next_record_write();
        assert!(crate::library::folders::create_folder(&lib, "f1", "Sub", None, Some(&p)).is_err());
        assert!(names_in(&p_dir(&lib)).is_empty());
        fail_next_record_write();
        assert!(crate::library::folders::create_folder(&lib, "q", "New", None, None).is_err());
        assert_eq!(names_in(&lib.default_location()), vec!["P"]);
    }

    #[test]
    fn a_rename_in_case_only_is_no_clash() {
        let (lib, p) = with_project("ops-case");
        saved(create(&lib, "d1", &titled("flow"), Some(&p)).unwrap());
        let (name, _) = saved(save(&lib, "d1", &titled("Flow"), None).unwrap());
        assert_eq!(name, "Flow");
        assert_eq!(names_in(&p_dir(&lib)), vec!["Flow.dosik"]);
        assert_eq!(listed_p(&lib).diagrams[0].id, "d1");
    }

    #[test]
    fn an_older_file_is_saved_as_a_dosik_file() {
        let (lib, _) = with_project("ops-old");
        put(&p_dir(&lib).join("Legacy.dosik.json"), &titled("Legacy"));
        let id = listed_p(&lib).diagrams[0].id.clone();
        let (name, _) = saved(save(&lib, &id, &titled("Legacy"), None).unwrap());
        assert_eq!(name, "Legacy");
        assert_eq!(names_in(&p_dir(&lib)), vec!["Legacy.dosik"]);
        assert_eq!(listed_p(&lib).diagrams[0].id, id);
    }

    #[test]
    fn an_older_file_beside_a_new_one_of_its_name_takes_a_2() {
        let (lib, _) = with_project("ops-both");
        put(&p_dir(&lib).join("x.dosik"), &titled("x"));
        put(&p_dir(&lib).join("x.dosik.json"), &titled("x"));
        assert_eq!(titles(&listed_p(&lib)), vec!["x", "x"]);
        let old_id = {
            let held = lib.lock();
            let st = lib.load_state(&held).unwrap();
            st.projects[0].ids.get("x.dosik.json").unwrap().clone()
        };
        let (name, _) = saved(save(&lib, &old_id, &titled("x"), None).unwrap());
        assert_eq!(name, "x 2");
        assert_eq!(names_in(&p_dir(&lib)), vec!["x 2.dosik", "x.dosik"]);
    }

    #[test]
    fn a_file_changed_meanwhile_is_never_written_over() {
        let (lib, p) = with_project("ops-stamp");
        let (_, first) = saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        let opened = load(&lib, "d1").unwrap();
        assert_eq!(opened.stamp, first);
        assert_eq!(opened.contents, titled("Flow"));
        // what the tab saw: saved
        let (_, second) = saved(save(&lib, "d1", &titled("Flow"), Some(&first)).unwrap());
        // someone else writes it
        let file = p_dir(&lib).join("Flow.dosik");
        std::fs::write(&file, r#"{"title":"Flow","nodes":[1],"edges":[]}"#).unwrap();
        let outcome = save(&lib, "d1", &titled("Flow"), Some(&second)).unwrap();
        assert_eq!(outcome, SaveOutcome::ChangedOnDisk);
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            r#"{"title":"Flow","nodes":[1],"edges":[]}"#
        );
        // with no stamp to hold to, it is written
        saved(save(&lib, "d1", &titled("Flow"), None).unwrap());
    }

    #[test]
    fn the_same_bytes_written_again_are_no_change() {
        let (lib, p) = with_project("ops-touch");
        let (_, stamp) = saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        let file = p_dir(&lib).join("Flow.dosik");
        std::fs::OpenOptions::new()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(90))
            .unwrap();
        let now = read_stamped(&file).unwrap().1;
        assert_ne!(now, stamp);
        assert!(same_contents(&now, &stamp));
        saved(save(&lib, "d1", &titled("Flow"), Some(&stamp)).unwrap());
    }

    #[test]
    fn only_a_save_that_says_so_makes_a_diagram() {
        let (lib, p) = with_project("ops-create");
        // the library has no such diagram: a save in place makes nothing, folder or not
        assert_eq!(
            save(&lib, "d1", &titled("Flow"), None).unwrap(),
            SaveOutcome::Gone
        );
        assert!(names_in(&p_dir(&lib)).is_empty());
        let (name, _) = saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        assert_eq!(name, "Flow");
        // made already: it is not made again
        assert!(create(&lib, "d1", &titled("Again"), Some(&p)).is_err());
        assert_eq!(names_in(&p_dir(&lib)), vec!["Flow.dosik"]);
    }

    #[test]
    fn a_diagram_gone_from_disk_is_never_made_again() {
        let (lib, p) = with_project("ops-gone");
        let (_, stamp) = saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        std::fs::remove_file(p_dir(&lib).join("Flow.dosik")).unwrap();
        assert_eq!(
            save(&lib, "d1", &titled("Flow"), Some(&stamp)).unwrap(),
            SaveOutcome::Gone
        );
        assert_eq!(
            save(&lib, "d1", &titled("Flow"), None).unwrap(),
            SaveOutcome::Gone
        );
        assert!(names_in(&p_dir(&lib)).is_empty());
        assert!(load(&lib, "d1").is_err());
        // forgotten by a listing since: still gone, not made anew elsewhere
        list(&lib).unwrap();
        assert_eq!(
            save(&lib, "d1", &titled("Flow"), Some(&stamp)).unwrap(),
            SaveOutcome::Gone
        );
        assert!(names_in(&p_dir(&lib)).is_empty());
    }

    #[test]
    fn a_diagram_whose_project_cannot_be_reached_waits_for_it() {
        let (lib, p) = with_project("ops-unreachable");
        let (_, stamp) = saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        // the whole library folder gone — a drive away, say: not written, not gone
        let away = lib.default_location().with_file_name("away");
        std::fs::rename(lib.default_location(), &away).unwrap();
        assert_eq!(
            save(&lib, "d1", &titled("Flow 2"), Some(&stamp)).unwrap(),
            SaveOutcome::Unreachable
        );
        assert!(
            !lib.default_location().exists(),
            "nothing made where it was"
        );
        // back: saved, as the tab last saw it
        std::fs::rename(&away, lib.default_location()).unwrap();
        let (name, _) = saved(save(&lib, "d1", &titled("Flow"), Some(&stamp)).unwrap());
        assert_eq!(name, "Flow");
    }

    #[cfg(unix)]
    #[test]
    fn a_diagram_in_a_folder_that_cannot_be_read_is_out_of_reach_not_gone() {
        let (lib, p) = with_project("ops-unreachable-folder");
        crate::library::folders::create_folder(&lib, "f1", "Sub", None, Some(&p)).unwrap();
        let (_, stamp) = saved(create(&lib, "d1", &titled("Flow"), Some("f1")).unwrap());
        let Some(_unlock) = crate::library::listing::tests::lock_out(&p_dir(&lib).join("Sub"))
        else {
            return;
        };
        assert_eq!(
            save(&lib, "d1", &titled("Flow"), Some(&stamp)).unwrap(),
            SaveOutcome::Unreachable
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_link_in_place_of_a_folder_is_never_followed() {
        struct NoTrash;
        impl crate::library::removal::Trasher for NoTrash {
            fn trash(&self, path: &Path) -> Result<(), String> {
                panic!("{} would have gone to the Trash", path.display())
            }
        }
        let (lib, p) = with_project("ops-link");
        crate::library::folders::create_folder(&lib, "f1", "Sub", None, Some(&p)).unwrap();
        saved(create(&lib, "d1", &titled("Flow"), Some("f1")).unwrap());
        let outside = lib.default_location().parent().unwrap().join("outside");
        put(&outside.join("Flow.dosik"), "theirs");
        // the folder replaced by a link to another, outside the app
        std::fs::remove_dir_all(p_dir(&lib).join("Sub")).unwrap();
        std::os::unix::fs::symlink(&outside, p_dir(&lib).join("Sub")).unwrap();
        assert_eq!(
            save(&lib, "d1", &titled("Flow"), None).unwrap(),
            SaveOutcome::Gone
        );
        assert_eq!(
            std::fs::read_to_string(outside.join("Flow.dosik")).unwrap(),
            "theirs"
        );
        assert!(load(&lib, "d1").is_err());
        assert!(item_path(&lib, ItemKind::Diagram, "d1").is_err());
        assert!(item_path(&lib, ItemKind::Folder, "f1").is_err());
        assert!(crate::library::folders::create_folder(&lib, "f2", "X", None, Some("f1")).is_err());
        assert!(create(&lib, "d2", &titled("New"), Some("f1")).is_err());
        crate::library::removal::delete_diagram(&lib, "d1", &NoTrash).unwrap();
        assert!(outside.join("Flow.dosik").is_file());
        // a file through the link — handed over by the OS, or noted by the
        // MCP server — is no diagram of the library
        put(&outside.join("New.dosik"), &titled("New"));
        let through = p_dir(&lib).join("Sub").join("New.dosik");
        assert_eq!(diagram_id_at(&lib, &through).unwrap(), None);
        let note = serde_json::json!({ "path": through.to_string_lossy(), "at": 1 });
        put(&lib.inbox_dir().join("n.json"), &note.to_string());
        list(&lib).unwrap();
        let held = lib.lock();
        let st = lib.load_state(&held).unwrap();
        assert!(
            !st.projects[0].ids.keys().any(|k| k.starts_with("Sub/")),
            "{:?}",
            st.projects[0].ids
        );
        assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 2);
    }

    #[test]
    fn opening_names_a_diagram_by_its_file() {
        let (lib, _) = with_project("ops-load");
        put(
            &p_dir(&lib).join("Payments.dosik"),
            &titled("Something else"),
        );
        let id = listed_p(&lib).diagrams[0].id.clone();
        let opened = load(&lib, &id).unwrap();
        assert_eq!(opened.name, "Payments");
        assert_eq!(opened.contents, titled("Something else"));
        assert!(load(&lib, "unknown").is_err());
        assert!(load(&lib, "../x").is_err());
        // a folder's or a project's id is no diagram's
        let pid = listed_p(&lib).id;
        assert!(load(&lib, &pid).is_err());
        assert!(save(&lib, &pid, &titled("x"), None).is_err());
    }

    #[test]
    fn a_new_diagram_into_a_folder_that_is_not_there_fails() {
        let (lib, p) = with_project("ops-missing");
        assert!(create(&lib, "d1", &titled("x"), Some("nope")).is_err());
        std::fs::remove_dir_all(lib.default_location()).unwrap();
        assert!(create(&lib, "d1", &titled("x"), Some(&p)).is_err());
        assert!(!lib.default_location().exists());
    }

    #[test]
    fn an_id_is_never_given_twice() {
        let (lib, p) = with_project("ops-id");
        saved(create(&lib, "d1", &titled("A"), Some(&p)).unwrap());
        // the id of the project itself
        assert!(create(&lib, &p, &titled("B"), Some(&p)).is_err());
    }

    #[test]
    fn a_stamp_is_time_length_and_hash() {
        let at = std::time::UNIX_EPOCH + std::time::Duration::from_nanos(1_500);
        let stamp = stamp_of(b"abc", at);
        assert!(stamp.starts_with("1500-3-"), "{stamp}");
        assert_eq!(stamp, stamp_of(b"abc", at));
        assert_ne!(stamp, stamp_of(b"abd", at));
        assert!(same_contents(
            &stamp,
            &stamp_of(b"abc", std::time::UNIX_EPOCH)
        ));
        assert!(!same_contents(&stamp, "garbage"));
    }

    #[test]
    fn an_outcome_is_sent_tagged_in_camel_case() {
        let sent = |o: SaveOutcome| serde_json::to_value(o).unwrap();
        assert_eq!(
            sent(SaveOutcome::Saved {
                name: "Flow".into(),
                stamp: "1-2-3".into()
            }),
            serde_json::json!({ "kind": "saved", "name": "Flow", "stamp": "1-2-3" })
        );
        assert_eq!(
            sent(SaveOutcome::ChangedOnDisk),
            serde_json::json!({ "kind": "changedOnDisk" })
        );
        assert_eq!(
            sent(SaveOutcome::Gone),
            serde_json::json!({ "kind": "gone" })
        );
        assert_eq!(
            sent(SaveOutcome::Unreachable),
            serde_json::json!({ "kind": "unreachable" })
        );
    }
}
