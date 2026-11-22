//! Taking things out of the folder-backed library, putting a lost project
//! back, and the projects' places on the Home canvas.
//!
//! - Delete moves a diagram, a folder or a project to the system Trash —
//!   never removed outright: these are folders people keep in Documents.
//!   When the Trash will not take it, nothing is deleted.
//! - A project outside the default location (a folder added to the
//!   library) is never deleted: it is removed from the library and its
//!   files stay.
//! - A project that cannot be found is located again: the folder picked
//!   takes its place, and every item at the same relative path gets its
//!   id, order and place back.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::ctx::Library;
use super::disk;
use super::listing::{check_new_project, Refusal};
use super::ops;
use super::state::{self, BoardSpot, Found};
use super::walk;

/// What moves things to the Trash — the system's, or a test's stand-in.
pub trait Trasher {
    fn trash(&self, path: &Path) -> Result<(), String>;
}

/// The system Trash. On macOS by the file manager's own call, not by
/// asking Finder: that would need the right to control Finder.
pub struct SystemTrash;

impl Trasher for SystemTrash {
    fn trash(&self, path: &Path) -> Result<(), String> {
        #[allow(unused_mut)]
        let mut context = ::trash::TrashContext::default();
        #[cfg(target_os = "macos")]
        {
            use trash::macos::{DeleteMethod, TrashContextExtMacos};
            context.set_delete_method(DeleteMethod::NsFileManager);
        }
        context
            .delete(path)
            .map_err(|e| format!("{}: could not be moved to the Trash: {e}", path.display()))
    }
}

/// Moves the diagram `id` to the Trash and forgets it. One already gone
/// from disk — or reached only through a link — is only forgotten; one the
/// file system will not say of is left as it is.
pub fn delete_diagram(lib: &Library, id: &str, trasher: &dyn Trasher) -> Result<(), String> {
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    let at = ops::diagram_at(&st, id)?.ok_or_else(|| format!("no such diagram: {id:?}"))?;
    match at.presence() {
        disk::Presence::File => {
            let _change = lib.restructure(&held);
            trasher.trash(&at.path)?;
        }
        disk::Presence::Unknown(kind) => return Err(format!("{}: {kind}", at.path.display())),
        disk::Presence::Dir | disk::Presence::Other | disk::Presence::Missing => {}
    }
    st.remove_subtree(at.project, &at.rel);
    lib.save_state(&held, &st)
}

/// Moves the project or folder `id`, with everything in it, to the Trash
/// and forgets it. A project outside the default location is refused: it
/// is removed from the library instead, its files left where they are.
pub fn delete_folder(lib: &Library, id: &str, trasher: &dyn Trasher) -> Result<(), String> {
    state::validate_id(id)?;
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    let found = st
        .find(id)
        .ok_or_else(|| format!("no such folder: {id:?}"))?;
    if found.rel.is_none() && !lib.in_default_location(&st.projects[found.project].root()) {
        return Err("a folder added to the library is removed from it, never deleted".into());
    }
    let at = ops::folder_at(&st, id)?;
    {
        let _change = lib.restructure(&held);
        trasher.trash(&at.path)?;
    }
    match found {
        Found { rel: None, .. } => {
            st.remove_project(id);
        }
        Found {
            rel: Some(rel),
            project,
        } => st.remove_subtree(project, &rel),
    }
    lib.save_state(&held, &st)
}

/// What the system leaves in folders on its own — not counted as a file of
/// the user's, nor are the library's own temp entries (`disk::is_temp_name`).
fn is_litter(name: &str) -> bool {
    matches!(name, ".DS_Store" | "Thumbs.db" | "desktop.ini") || name.starts_with("._")
}

/// How many files the project or folder `id` holds, at any depth, that the
/// listing does not show as diagrams — what goes to the Trash with them when
/// it is deleted. Links count, never followed; the system's own litter
/// (`.DS_Store` and the like) does not.
pub fn other_files(lib: &Library, id: &str) -> Result<usize, String> {
    let at = {
        let held = lib.lock();
        let st = lib.load_state(&held)?;
        ops::folder_at(&st, id)?
    };
    // read without the lock: a big folder takes a while
    count_other(&at.path, at.depth, true)
}

/// the files under `dir` (at `depth`) that are no diagram the listing shows
/// — `shown`: whether the listing reads `dir` at all
fn count_other(dir: &Path, depth: usize, shown: bool) -> Result<usize, String> {
    let mut count = 0;
    let read = std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("{}: {e}", dir.display()))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if disk::is_temp_name(&name) {
            // the library's own, on the way — not a file of the user's
            continue;
        }
        let kind = entry
            .file_type()
            .map_err(|e| format!("{}: {e}", entry.path().display()))?;
        if kind.is_dir() {
            let read_too = shown
                && depth < walk::MAX_DEPTH
                && walk::classify(&name, true) == walk::Entry::Folder;
            count += count_other(&entry.path(), depth + 1, read_too)?;
        } else if !is_litter(&name) {
            let listed = shown
                && kind.is_file()
                && matches!(walk::classify(&name, false), walk::Entry::Diagram(_));
            count += usize::from(!listed);
        }
    }
    Ok(count)
}

/// Takes the project `id` out of the library, leaving its folder as it is.
/// A project in the default location that is there is refused: it would
/// be found again by the next listing.
pub fn remove_project(lib: &Library, id: &str) -> Result<(), String> {
    state::validate_id(id)?;
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    let record = st
        .project(id)
        .ok_or_else(|| format!("no such project: {id:?}"))?;
    let root = record.root();
    if lib.in_default_location(&root) && disk::is_real_dir(&root) {
        return Err("a project in the library folder is deleted, not removed".into());
    }
    st.remove_project(id);
    lib.save_state(&held, &st)
}

/// What locating a project came to.
#[derive(Serialize, Debug, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum LocateOutcome {
    /// the folder took the project's place
    Located,
    /// the folder overlaps the library — it is a project, is inside one or
    /// holds one — and was not taken
    Already,
}

/// Puts the project `id` at `path`, a folder picked for it: everything at
/// the same relative path there gets its id, order and place back with the
/// next listing.
pub fn locate_project_at(lib: &Library, id: &str, path: &Path) -> Result<LocateOutcome, String> {
    state::validate_id(id)?;
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    let at = st
        .project_index(id)
        .ok_or_else(|| format!("no such project: {id:?}"))?;
    if !disk::is_real_dir(path) {
        return Err(format!("{}: not a folder", path.display()));
    }
    match check_new_project(lib, &st, path, Some(id)) {
        Ok(()) => {}
        Err(Refusal::Overlap(_)) => return Ok(LocateOutcome::Already),
        Err(Refusal::Invalid(why)) => return Err(why),
    }
    st.projects[at].path = state::path_text(path)?;
    st.projects[at].kept_added = false;
    lib.save_state(&held, &st)?;
    Ok(LocateOutcome::Located)
}

/// One project's new place, as the Home canvas sends it.
#[derive(Deserialize, Debug, Clone)]
pub struct FolderBoard {
    pub id: String,
    pub board: BoardSpot,
}

/// A project that could not take its place, and why — as data, so the
/// frontend never reads ids back out of an error's text.
#[derive(Serialize, Debug, PartialEq, Eq, Clone)]
pub struct BoardFailure {
    pub id: String,
    pub error: String,
}

/// Puts each project's frame where the Home canvas says. One that cannot
/// take its place — a bad id or place, a folder inside a project, one the
/// library does not have — fails alone; what comes back is every one that
/// did not take it, with why. A project that cannot be found keeps a place
/// too: it comes back to it.
pub fn save_boards(lib: &Library, boards: &[FolderBoard]) -> Vec<BoardFailure> {
    let fail_all = |error: String| {
        boards
            .iter()
            .map(|b| BoardFailure {
                id: b.id.clone(),
                error: error.clone(),
            })
            .collect()
    };
    let held = lib.lock();
    let mut st = match lib.load_state(&held) {
        Ok(st) => st,
        Err(e) => return fail_all(e),
    };
    let mut failed = Vec::new();
    let mut placed = Vec::new();
    for item in boards {
        let outcome = item
            .board
            .check()
            .and_then(|()| state::validate_id(&item.id))
            .and_then(|()| match st.find(&item.id) {
                Some(Found { project, rel: None }) => Ok(project),
                Some(_) => Err("not a project".to_string()),
                None => Err(format!("no such project: {:?}", item.id)),
            });
        match outcome {
            Ok(project) => {
                st.projects[project].board = Some(item.board);
                placed.push(item.id.clone());
            }
            Err(error) => failed.push(BoardFailure {
                id: item.id.clone(),
                error,
            }),
        }
    }
    if placed.is_empty() {
        return failed;
    }
    if let Err(error) = lib.save_state(&held, &st) {
        failed.extend(placed.into_iter().map(|id| BoardFailure {
            id,
            error: error.clone(),
        }));
    }
    failed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::ctx::tests::test_library;
    use crate::library::disk::tests::{names_in, scratch};
    use crate::library::folders::create_folder;
    use crate::library::listing::list;
    use crate::library::listing::tests::{all_ids, folder_names, names_of, put, titles};
    use crate::library::ops::tests::{p_dir, saved, titled, with_project};
    use crate::library::ops::{create, load};
    use std::path::PathBuf;
    use std::sync::Mutex;

    /// A Trash of the test's own: what it takes goes into a folder of the
    /// test's temp folder — or, when it refuses, stays where it is.
    struct FakeTrash {
        bin: PathBuf,
        refuse: bool,
        took: Mutex<Vec<String>>,
    }

    impl FakeTrash {
        fn new(refuse: bool) -> FakeTrash {
            let bin = scratch("fake-trash");
            FakeTrash {
                bin,
                refuse,
                took: Mutex::new(Vec::new()),
            }
        }

        fn took(&self) -> Vec<String> {
            self.took.lock().unwrap().clone()
        }
    }

    impl Trasher for FakeTrash {
        fn trash(&self, path: &Path) -> Result<(), String> {
            if self.refuse {
                return Err("the Trash is not there".into());
            }
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            std::fs::rename(path, self.bin.join(&name)).map_err(|e| e.to_string())?;
            self.took.lock().unwrap().push(name);
            Ok(())
        }
    }

    fn record(lib: &Library) -> state::LibraryState {
        let held = lib.lock();
        lib.load_state(&held).unwrap()
    }

    /// an added project, `Repo`, outside the default location, listed
    fn with_added(tag: &str) -> (Library, String, PathBuf) {
        let lib = test_library(tag);
        let base = lib
            .data_dir
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();
        let repo = base.join("work").join("Repo");
        put(&repo.join("Flow.dosik"), &titled("Flow"));
        put(&repo.join("docs/Plan.dosik"), &titled("Plan"));
        let note = serde_json::json!({ "path": repo.to_string_lossy(), "at": 1 });
        put(&lib.inbox_dir().join("x.json"), &note.to_string());
        let listed = list(&lib).unwrap();
        let id = listed[0].id.clone();
        (lib, id, repo)
    }

    #[test]
    fn a_deleted_diagram_goes_to_the_trash_and_is_forgotten() {
        let (lib, p) = with_project("removal-diagram");
        saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        saved(create(&lib, "d2", &titled("Keep"), Some(&p)).unwrap());
        let bin = FakeTrash::new(false);
        delete_diagram(&lib, "d1", &bin).unwrap();
        assert_eq!(bin.took(), vec!["Flow.dosik"]);
        assert_eq!(names_in(&p_dir(&lib)), vec!["Keep.dosik"]);
        assert!(record(&lib).find("d1").is_none());
        assert_eq!(
            record(&lib).projects[0].order.get(""),
            Some(&vec!["Keep.dosik".to_string()])
        );
        assert!(delete_diagram(&lib, "d1", &bin).is_err());
    }

    #[test]
    fn a_diagram_gone_from_disk_is_only_forgotten() {
        let (lib, p) = with_project("removal-diagram-gone");
        saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        std::fs::remove_file(p_dir(&lib).join("Flow.dosik")).unwrap();
        let bin = FakeTrash::new(false);
        delete_diagram(&lib, "d1", &bin).unwrap();
        assert!(bin.took().is_empty());
        assert!(record(&lib).find("d1").is_none());
    }

    #[test]
    fn what_a_folder_holds_besides_its_diagrams_is_counted() {
        let (lib, p) = with_project("removal-others");
        create_folder(&lib, "f1", "docs", None, Some(&p)).unwrap();
        saved(create(&lib, "d1", &titled("Flow"), Some("f1")).unwrap());
        let docs = p_dir(&lib).join("docs");
        put(&docs.join("Old.dosik.json"), &titled("Old"));
        // the files the listing does not show: each is counted
        put(&docs.join("notes.txt"), "x");
        put(&docs.join("img/a.png"), "x");
        put(&docs.join(".git/HEAD"), "x");
        put(&docs.join(".hidden/In.dosik"), &titled("In"));
        let mut deep = docs.clone();
        for level in 3..=crate::library::walk::MAX_DEPTH {
            deep = deep.join(format!("L{level}"));
        }
        put(&deep.join("Shown.dosik"), &titled("Shown"));
        put(&deep.join("Deeper/Not shown.dosik"), &titled("Not shown"));
        // the system's own litter is not, nor what an app stopped halfway
        // left of its own writes: temp files, a temp copy
        put(&docs.join(".DS_Store"), "x");
        put(&docs.join("._notes.txt"), "x");
        put(&docs.join("Thumbs.db"), "x");
        put(&docs.join(".dosik-41-7.tmp"), "x");
        put(&docs.join(".dosik-mcp-41-2.tmp"), "x");
        put(&docs.join(".dosik-41-8.tmp/In.dosik"), "x");
        // a link counts as a file too, where one can be made
        #[cfg(unix)]
        std::os::unix::fs::symlink(&docs, docs.join("link")).unwrap();
        let want = if cfg!(unix) { 6 } else { 5 };
        assert_eq!(other_files(&lib, "f1").unwrap(), want);
        assert_eq!(other_files(&lib, &p).unwrap(), want);
        create_folder(&lib, "f2", "Empty", None, Some(&p)).unwrap();
        assert_eq!(other_files(&lib, "f2").unwrap(), 0);
        assert!(other_files(&lib, "nope").is_err());
        assert!(other_files(&lib, "d1").is_err(), "a diagram is no folder");
    }

    #[test]
    fn a_deleted_folder_goes_to_the_trash_with_everything_in_it() {
        let (lib, p) = with_project("removal-folder");
        create_folder(&lib, "f1", "Sub", None, Some(&p)).unwrap();
        saved(create(&lib, "d1", &titled("Inner"), Some("f1")).unwrap());
        let bin = FakeTrash::new(false);
        delete_folder(&lib, "f1", &bin).unwrap();
        assert_eq!(bin.took(), vec!["Sub"]);
        assert!(bin.bin.join("Sub/Inner.dosik").is_file());
        let st = record(&lib);
        assert!(st.find("f1").is_none() && st.find("d1").is_none());
        assert!(folder_names(&list(&lib).unwrap()[0]).is_empty());
    }

    #[test]
    fn a_project_in_the_default_location_goes_to_the_trash() {
        let (lib, p) = with_project("removal-project");
        let bin = FakeTrash::new(false);
        delete_folder(&lib, &p, &bin).unwrap();
        assert_eq!(bin.took(), vec!["P"]);
        assert!(list(&lib).unwrap().is_empty());
        assert!(record(&lib).projects.is_empty());
    }

    #[test]
    fn an_added_project_is_never_deleted() {
        let (lib, id, repo) = with_added("removal-added");
        let bin = FakeTrash::new(false);
        assert!(delete_folder(&lib, &id, &bin)
            .unwrap_err()
            .contains("removed"));
        assert!(bin.took().is_empty());
        assert!(repo.join("Flow.dosik").is_file());
        // its folders and diagrams go to the Trash like any other
        let docs = list(&lib).unwrap()[0].folders[0].id.clone();
        delete_folder(&lib, &docs, &bin).unwrap();
        assert_eq!(bin.took(), vec!["docs"]);
    }

    #[test]
    fn when_the_trash_refuses_nothing_is_deleted() {
        let (lib, p) = with_project("removal-refused");
        create_folder(&lib, "f1", "Sub", None, Some(&p)).unwrap();
        saved(create(&lib, "d1", &titled("Flow"), Some(&p)).unwrap());
        let before = record(&lib);
        let bin = FakeTrash::new(true);
        assert!(delete_diagram(&lib, "d1", &bin).is_err());
        assert!(delete_folder(&lib, "f1", &bin).is_err());
        assert!(delete_folder(&lib, &p, &bin).is_err());
        assert_eq!(record(&lib), before);
        assert_eq!(names_in(&p_dir(&lib)), vec!["Flow.dosik", "Sub"]);
    }

    #[test]
    fn a_project_that_cannot_be_found_is_not_deleted() {
        let (lib, id, repo) = with_added("removal-missing");
        std::fs::remove_dir_all(&repo).unwrap();
        let bin = FakeTrash::new(false);
        assert!(delete_folder(&lib, &id, &bin).is_err());
    }

    #[test]
    fn removing_a_project_leaves_its_folder() {
        let (lib, id, repo) = with_added("removal-remove");
        remove_project(&lib, &id).unwrap();
        assert!(list(&lib).unwrap().is_empty());
        assert!(repo.join("Flow.dosik").is_file());
        assert!(remove_project(&lib, &id).is_err());
    }

    #[test]
    fn a_project_in_the_default_location_is_removed_only_when_it_is_lost() {
        let (lib, p) = with_project("removal-remove-default");
        assert!(remove_project(&lib, &p).is_err());
        assert!(p_dir(&lib).is_dir());
        // the default location itself gone: the project is not found, and may go
        let away = lib.default_location().with_file_name("away");
        std::fs::rename(lib.default_location(), &away).unwrap();
        assert!(list(&lib).unwrap()[0].missing);
        remove_project(&lib, &p).unwrap();
        assert!(list(&lib).unwrap().is_empty());
    }

    #[test]
    fn a_located_project_gets_its_ids_order_and_place_back() {
        let (lib, id, repo) = with_added("removal-locate");
        let first = list(&lib).unwrap();
        save_boards(
            &lib,
            &[FolderBoard {
                id: id.clone(),
                board: BoardSpot {
                    x: 7,
                    y: 8,
                    collapsed: Some(true),
                },
            }],
        );
        let moved = repo.with_file_name("Repo moved");
        std::fs::rename(&repo, &moved).unwrap();
        assert!(list(&lib).unwrap()[0].missing);
        put(&moved.join("New.dosik"), &titled("New"));
        assert_eq!(
            locate_project_at(&lib, &id, &moved).unwrap(),
            LocateOutcome::Located
        );
        let listed = list(&lib).unwrap();
        let p = &listed[0];
        assert!(!p.missing);
        assert_eq!(p.name, "Repo moved");
        assert_eq!(
            p.board.map(|b| (b.x, b.y, b.collapsed)),
            Some((7, 8, Some(true)))
        );
        assert_eq!(titles(p), vec!["Flow", "New"]);
        // the items that were there before keep their ids
        let before = all_ids(&first);
        let after = all_ids(&listed);
        assert!(
            before.iter().all(|i| after.contains(i)),
            "{before:?} {after:?}"
        );
        assert_eq!(after.len(), before.len() + 1);
        let flow = p.diagrams.iter().find(|d| d.title == "Flow").unwrap();
        assert_eq!(load(&lib, &flow.id).unwrap().name, "Flow");
    }

    #[test]
    fn a_folder_that_overlaps_the_library_is_not_taken() {
        let (lib, id, repo) = with_added("removal-locate-overlap");
        std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
        list(&lib).unwrap();
        let away = repo.with_file_name("gone");
        std::fs::rename(&repo, &away).unwrap();
        let mine = lib.default_location().join("Mine");
        assert_eq!(
            locate_project_at(&lib, &id, &mine).unwrap(),
            LocateOutcome::Already
        );
        assert_eq!(
            locate_project_at(&lib, &id, &mine.join("..")).unwrap(),
            LocateOutcome::Already
        );
        assert!(locate_project_at(&lib, &id, Path::new("/")).is_err());
        put(&away.join("file"), "x");
        assert!(locate_project_at(&lib, &id, &away.join("file")).is_err());
        assert!(locate_project_at(&lib, "nope", &away).is_err());
        // its own old place is no clash
        std::fs::rename(&away, &repo).unwrap();
        assert_eq!(
            locate_project_at(&lib, &id, &repo).unwrap(),
            LocateOutcome::Located
        );
        // Mine came in by name, before Repo
        assert_eq!(names_of(&list(&lib).unwrap()), vec!["Mine", "Repo"]);
    }

    #[test]
    fn boards_are_placed_and_bad_ones_fail_alone() {
        let (lib, p) = with_project("removal-boards");
        create_folder(&lib, "f1", "Sub", None, Some(&p)).unwrap();
        let spot = |x| BoardSpot {
            x,
            y: 0,
            collapsed: None,
        };
        let failed = save_boards(
            &lib,
            &[
                FolderBoard {
                    id: p.clone(),
                    board: spot(30),
                },
                FolderBoard {
                    id: "f1".into(),
                    board: spot(1),
                },
                FolderBoard {
                    id: "gone".into(),
                    board: spot(1),
                },
                FolderBoard {
                    id: p.clone(),
                    board: spot(5_000_000),
                },
            ],
        );
        let why: Vec<(&str, &str)> = failed
            .iter()
            .map(|f| (f.id.as_str(), f.error.as_str()))
            .collect();
        assert_eq!(why.len(), 3, "{why:?}");
        assert_eq!(why[0], ("f1", "not a project"));
        assert!(why[1].1.contains("no such project"));
        assert!(why[2].1.contains("within"));
        assert_eq!(list(&lib).unwrap()[0].board, Some(spot(30)));
    }

    #[test]
    fn a_failure_and_an_outcome_are_sent_as_data() {
        assert_eq!(
            serde_json::to_value(vec![BoardFailure {
                id: "b".into(),
                error: "not a project".into()
            }])
            .unwrap(),
            serde_json::json!([{ "id": "b", "error": "not a project" }])
        );
        assert_eq!(
            serde_json::to_value(LocateOutcome::Located).unwrap(),
            "located"
        );
        assert_eq!(
            serde_json::to_value(LocateOutcome::Already).unwrap(),
            "already"
        );
        let board: FolderBoard =
            serde_json::from_value(serde_json::json!({ "id": "p", "board": { "x": 1, "y": 2 } }))
                .unwrap();
        assert_eq!(board.board.collapsed, None);
    }
}
