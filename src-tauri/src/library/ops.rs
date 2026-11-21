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
    /// (cleaned, or with " 2"); `stamp` is the file as it is now
    Saved { name: String, stamp: String },
    /// not written: the file is not what the tab last saw
    ChangedOnDisk,
    /// not written: the library has the diagram, the disk does not
    Gone,
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
    pub rel: String,
    pub path: PathBuf,
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
            let path =
                join_rel(&st.projects[project].root(), &rel).ok_or("not inside the project")?;
            Ok(Some(DiagramAt { project, rel, path }))
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
    if !disk::is_real_dir(&path) {
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
            Some(at) if disk::is_real_file(&at.path) => Ok(at.path),
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
    let names: Vec<&str> = rel.split('/').collect();
    let last = names.len() - 1;
    let shown = !rel.is_empty()
        && names.len() <= MAX_DEPTH
        && names
            .iter()
            .enumerate()
            .all(|(i, name)| match walk::classify(name, i < last) {
                walk::Entry::Folder => i < last,
                walk::Entry::Diagram(_) => i == last,
                walk::Entry::Skip | walk::Entry::Other => false,
            });
    if !shown || !disk::is_real_dir(&st.projects[project].root()) {
        return Ok(None);
    }
    if let Some(id) = st.projects[project].ids.get(&rel) {
        return Ok(Some(id.clone()));
    }
    let id = st.ensure_id(project, &rel);
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
    if !disk::is_real_file(&at.path) {
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

/// Saves the diagram `id`. One the library has is written where it is —
/// renamed first when its title is not its file's name, or when it is an
/// older `.dosik.json` — unless `base`, the stamp its tab last saw, is no
/// longer what is on disk. A new one goes into the folder `folder`, or the
/// most recently edited project, or a new "My Diagrams" when there is none;
/// it is named by its title and goes on top of its folder. One that comes
/// with a `base` was read from disk: the library no longer having it means
/// it is gone — removed outside the app and forgotten by a listing — and it
/// is never made again somewhere else.
pub fn save(
    lib: &Library,
    id: &str,
    contents: &str,
    folder: Option<&str>,
    base: Option<&str>,
) -> Result<SaveOutcome, String> {
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    let wanted = names::clean(&title_of(contents), names::UNTITLED_DIAGRAM);
    if let Some(at) = diagram_at(&st, id)? {
        if !disk::is_real_dir(&st.projects[at.project].root()) || !disk::is_real_file(&at.path) {
            return Ok(SaveOutcome::Gone);
        }
        if let Some(base) = base {
            let (_, now) = read_stamped(&at.path)?;
            if !same_contents(&now, base) {
                return Ok(SaveOutcome::ChangedOnDisk);
            }
        }
        let (parent, file) = split_rel(&at.rel);
        let (parent, file) = (parent.to_string(), file.to_string());
        let old_ext = file.to_ascii_lowercase().ends_with(OLD_DIAGRAM_EXT);
        let mut path = at.path.clone();
        if diagram_stem(&file) != Some(wanted.as_str()) || old_ext {
            let dir = path.parent().ok_or("no parent folder")?.to_path_buf();
            let name = Siblings::read(&dir)?
                .except(&file)
                .diagram_name(&wanted, DIAGRAM_EXT);
            let new_file = format!("{name}{DIAGRAM_EXT}");
            let new_path = dir.join(&new_file);
            if disk::exists(&new_path) && !disk::same_entry(&path, &new_path) {
                return Err(format!("{}: in the way", new_path.display()));
            }
            {
                let _change = lib.restructure(&held);
                std::fs::rename(&path, &new_path)
                    .map_err(|e| format!("{}: {e}", path.display()))?;
            }
            let new_rel = child_rel(&parent, &new_file);
            st.move_subtree(at.project, &at.rel, at.project, &new_rel);
            st.rename_in_order(at.project, &parent, &file, &new_file);
            lib.save_state(&held, &st)?;
            path = new_path;
        }
        disk::write_atomic(&path, contents.as_bytes())?;
        let (_, stamp) = read_stamped(&path)?;
        let file = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        return Ok(SaveOutcome::Saved {
            name: diagram_stem(&file).unwrap_or_default().to_string(),
            stamp,
        });
    }
    if base.is_some() {
        return Ok(SaveOutcome::Gone);
    }
    let target = match folder {
        Some(folder) => folder_at(&st, folder)?,
        None => default_target(lib, &held, &mut st)?,
    };
    if target.depth > MAX_DEPTH {
        return Err(format!("folders nest at most {MAX_DEPTH} levels deep"));
    }
    let file = {
        let _change = lib.restructure(&held);
        create_diagram_file(&target.path, &wanted, contents.as_bytes())?
    };
    let rel = child_rel(&target.rel, &file);
    st.insert_id(target.project, &rel, id)?;
    let present = st.visible_items(target.project, &target.rel, target.depth);
    st.place_item(target.project, &target.rel, &file, 0, &present);
    lib.save_state(&held, &st)?;
    let (_, stamp) = read_stamped(&target.path.join(&file))?;
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

/// Makes a project in the default location — the folder, and its entry on
/// top of the projects. Returns its index in the record.
pub fn make_project(
    lib: &Library,
    held: &std::sync::MutexGuard<'_, ()>,
    st: &mut LibraryState,
    id: &str,
    wanted: &str,
) -> Result<usize, String> {
    if st.id_taken(id) {
        return Err(format!("an item with id {id:?} already exists"));
    }
    let default = &lib.default_location;
    std::fs::create_dir_all(default).map_err(|e| format!("{}: {e}", default.display()))?;
    let name = {
        let _change = lib.restructure(held);
        create_folder_dir(default, wanted)?
    };
    st.add_project(ProjectRecord::new(id, &default.join(name))?, Slot::First);
    Ok(0)
}

/// Where a new diagram goes when nothing says: the project edited last —
/// by everything under it, from file times — or a new "My Diagrams".
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
        .map(|(i, p)| (walk::newest_under(&p.root(), 1), i))
        // ties go to the earlier project, the order the listing shows
        .max_by(|(a, i), (b, j)| a.cmp(b).then_with(|| j.cmp(i)))
        .map(|(_, i)| i);
    let project = match latest {
        Some(i) => i,
        None => {
            let id = st.new_id();
            make_project(lib, held, st, &id, names::MY_DIAGRAMS)?
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
        std::fs::create_dir_all(lib.default_location.join("P")).unwrap();
        let listed = list(&lib).unwrap();
        let id = listed[0].id.clone();
        (lib, id)
    }

    pub(crate) fn p_dir(lib: &Library) -> PathBuf {
        lib.default_location.join("P")
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
        put(&lib.default_location.join("Loose.dosik"), &titled("Loose"));
        let outside = lib.default_location.parent().unwrap().join("Mine.dosik");
        put(&outside, &titled("Mine"));
        for path in [
            p_dir(&lib).join("notes.txt"),
            p_dir(&lib).join(".hidden/In.dosik"),
            p_dir(&lib).join("Gone.dosik"),
            p_dir(&lib).join("Sub"),
            lib.default_location.join("Loose.dosik"),
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
        let (name, _) = saved(save(&lib, "d1", &titled(""), Some(&p), None).unwrap());
        assert_eq!(name, "Untitled Diagram");
        let (name, _) =
            saved(save(&lib, "d2", &titled("Untitled Diagram"), Some(&p), None).unwrap());
        assert_eq!(name, "Untitled Diagram 2");
        let (name, _) = saved(save(&lib, "d3", &titled("a/b: c"), Some(&p), None).unwrap());
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
        let (name, _) = saved(save(&lib, "d1", &titled("First"), None, None).unwrap());
        assert_eq!(name, "First");
        assert!(lib
            .default_location
            .join("My Diagrams/First.dosik")
            .is_file());
        // the project edited last takes the next one
        put(&lib.default_location.join("Other/x.dosik"), &titled("x"));
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(60);
        std::fs::OpenOptions::new()
            .write(true)
            .open(lib.default_location.join("Other/x.dosik"))
            .unwrap()
            .set_modified(later)
            .unwrap();
        list(&lib).unwrap();
        saved(save(&lib, "d2", &titled("Second"), None, None).unwrap());
        assert!(lib.default_location.join("Other/Second.dosik").is_file());
    }

    #[test]
    fn a_diagram_is_saved_in_place_and_renamed_with_its_title() {
        let (lib, p) = with_project("ops-rename");
        saved(save(&lib, "d1", &titled("Flow"), Some(&p), None).unwrap());
        saved(save(&lib, "d2", &titled("Other"), Some(&p), None).unwrap());
        // the same title: written where it is, whatever folder is passed
        let (name, _) = saved(save(&lib, "d1", &titled("Flow"), None, None).unwrap());
        assert_eq!(name, "Flow");
        let order_before = listed_p(&lib).order.clone();
        // a new title renames the file; the id and its place stay
        let (name, _) = saved(save(&lib, "d1", &titled("Payments"), None, None).unwrap());
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
        let (name, _) = saved(save(&lib, "d1", &titled("other"), None, None).unwrap());
        assert_eq!(name, "other 2");
        assert_eq!(load(&lib, "d1").unwrap().name, "other 2");
    }

    #[test]
    fn a_rename_in_case_only_is_no_clash() {
        let (lib, p) = with_project("ops-case");
        saved(save(&lib, "d1", &titled("flow"), Some(&p), None).unwrap());
        let (name, _) = saved(save(&lib, "d1", &titled("Flow"), None, None).unwrap());
        assert_eq!(name, "Flow");
        assert_eq!(names_in(&p_dir(&lib)), vec!["Flow.dosik"]);
        assert_eq!(listed_p(&lib).diagrams[0].id, "d1");
    }

    #[test]
    fn an_older_file_is_saved_as_a_dosik_file() {
        let (lib, _) = with_project("ops-old");
        put(&p_dir(&lib).join("Legacy.dosik.json"), &titled("Legacy"));
        let id = listed_p(&lib).diagrams[0].id.clone();
        let (name, _) = saved(save(&lib, &id, &titled("Legacy"), None, None).unwrap());
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
        let (name, _) = saved(save(&lib, &old_id, &titled("x"), None, None).unwrap());
        assert_eq!(name, "x 2");
        assert_eq!(names_in(&p_dir(&lib)), vec!["x 2.dosik", "x.dosik"]);
    }

    #[test]
    fn a_file_changed_meanwhile_is_never_written_over() {
        let (lib, p) = with_project("ops-stamp");
        let (_, first) = saved(save(&lib, "d1", &titled("Flow"), Some(&p), None).unwrap());
        let opened = load(&lib, "d1").unwrap();
        assert_eq!(opened.stamp, first);
        assert_eq!(opened.contents, titled("Flow"));
        // what the tab saw: saved
        let (_, second) = saved(save(&lib, "d1", &titled("Flow"), None, Some(&first)).unwrap());
        // someone else writes it
        let file = p_dir(&lib).join("Flow.dosik");
        std::fs::write(&file, r#"{"title":"Flow","nodes":[1],"edges":[]}"#).unwrap();
        let outcome = save(&lib, "d1", &titled("Flow"), None, Some(&second)).unwrap();
        assert_eq!(outcome, SaveOutcome::ChangedOnDisk);
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            r#"{"title":"Flow","nodes":[1],"edges":[]}"#
        );
        // with no stamp to hold to, it is written
        saved(save(&lib, "d1", &titled("Flow"), None, None).unwrap());
    }

    #[test]
    fn the_same_bytes_written_again_are_no_change() {
        let (lib, p) = with_project("ops-touch");
        let (_, stamp) = saved(save(&lib, "d1", &titled("Flow"), Some(&p), None).unwrap());
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
        saved(save(&lib, "d1", &titled("Flow"), None, Some(&stamp)).unwrap());
    }

    #[test]
    fn a_diagram_gone_from_disk_is_never_made_again() {
        let (lib, p) = with_project("ops-gone");
        let (_, stamp) = saved(save(&lib, "d1", &titled("Flow"), Some(&p), None).unwrap());
        std::fs::remove_file(p_dir(&lib).join("Flow.dosik")).unwrap();
        assert_eq!(
            save(&lib, "d1", &titled("Flow"), None, Some(&stamp)).unwrap(),
            SaveOutcome::Gone
        );
        assert_eq!(
            save(&lib, "d1", &titled("Flow"), None, None).unwrap(),
            SaveOutcome::Gone
        );
        assert!(names_in(&p_dir(&lib)).is_empty());
        assert!(load(&lib, "d1").is_err());
        // forgotten by a listing since: still gone, not made anew elsewhere
        list(&lib).unwrap();
        assert_eq!(
            save(&lib, "d1", &titled("Flow"), None, Some(&stamp)).unwrap(),
            SaveOutcome::Gone
        );
        assert!(names_in(&p_dir(&lib)).is_empty());
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
        assert!(save(&lib, &pid, &titled("x"), None, None).is_err());
    }

    #[test]
    fn a_new_diagram_into_a_folder_that_is_not_there_fails() {
        let (lib, p) = with_project("ops-missing");
        assert!(save(&lib, "d1", &titled("x"), Some("nope"), None).is_err());
        std::fs::remove_dir_all(lib.default_location.clone()).unwrap();
        assert!(save(&lib, "d1", &titled("x"), Some(&p), None).is_err());
        assert!(!lib.default_location.exists());
    }

    #[test]
    fn an_id_is_never_given_twice() {
        let (lib, p) = with_project("ops-id");
        saved(save(&lib, "d1", &titled("A"), Some(&p), None).unwrap());
        // the id of the project itself
        assert!(save(&lib, &p, &titled("B"), Some(&p), None).is_err());
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
    }
}
