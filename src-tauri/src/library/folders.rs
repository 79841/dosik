//! Making, renaming, moving and ordering the folders and diagrams of the
//! folder-backed library — on disk first, then in the record.
//!
//! - A new project is a folder in the default location, on top of the
//!   projects; a new folder goes on top of its parent. Both take the name
//!   asked for, cleaned, with " 2" when it is taken.
//! - A rename or a move keeps the item's id; a folder's ids, orders and
//!   everything under it go with it.

use std::path::Path;

use super::ctx::Library;
use super::disk::{self, child_rel, split_rel};
use super::names;
use super::ops::{self, folder_at};
use super::state::{self, BoardSpot, Found};
use super::walk::{self, Siblings, MAX_DEPTH};

/// Makes a project — or, with `parent`, a folder inside that project or
/// folder — called `id`, named after `name`. Returns the name it got.
/// Only a project takes a board.
pub fn create_folder(
    lib: &Library,
    id: &str,
    name: &str,
    board: Option<&BoardSpot>,
    parent: Option<&str>,
) -> Result<String, String> {
    state::validate_id(id)?;
    if let Some(board) = board {
        board.check()?;
    }
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    if st.id_taken(id) {
        return Err(format!("an item with id {id:?} already exists"));
    }
    let Some(parent) = parent else {
        let at = ops::make_project(
            lib,
            &held,
            &mut st,
            id,
            &names::clean(name, names::UNTITLED_PROJECT),
        )?;
        st.projects[at].board = board.copied();
        lib.save_state(&held, &st)?;
        return Ok(state::project_name(&st.projects[at]));
    };
    if board.is_some() {
        return Err("a folder inside a project has no place on the canvas".into());
    }
    let target = folder_at(&st, parent)?;
    if target.depth >= MAX_DEPTH {
        return Err(format!("folders nest at most {MAX_DEPTH} levels deep"));
    }
    let made = {
        let _change = lib.restructure(&held);
        ops::create_folder_dir(&target.path, &names::clean(name, names::UNTITLED_FOLDER))?
    };
    st.insert_id(target.project, &child_rel(&target.rel, &made), id)?;
    let present = st.visible_items(target.project, &target.rel, target.depth);
    st.place_item(target.project, &target.rel, &made, 0, &present);
    lib.save_state(&held, &st)?;
    Ok(made)
}

/// Renames the project or folder `id` on disk, to `name` cleaned — " 2"
/// when another item has it; a change of case alone is no clash. Its id
/// stays, and so does everything under it. Returns the name it got.
pub fn rename_folder(lib: &Library, id: &str, name: &str) -> Result<String, String> {
    state::validate_id(id)?;
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    let found = st
        .find(id)
        .ok_or_else(|| format!("no such folder: {id:?}"))?;
    let at = folder_at(&st, id)?;
    let default = if found.rel.is_none() {
        names::UNTITLED_PROJECT
    } else {
        names::UNTITLED_FOLDER
    };
    let wanted = names::clean(name, default);
    let current = at
        .path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if current == wanted {
        return Ok(current);
    }
    let dir = at.path.parent().ok_or("no parent folder")?.to_path_buf();
    let new_name = Siblings::read(&dir)?.except(&current).folder_name(&wanted);
    let new_path = dir.join(&new_name);
    rename_entry(lib, &held, &at.path, &new_path)?;
    match found {
        Found { rel: None, project } => {
            st.projects[project].path = state::path_text(&new_path)?;
        }
        Found {
            rel: Some(rel),
            project,
        } => {
            let (parent, _) = split_rel(&rel);
            let new_rel = child_rel(parent, &new_name);
            st.move_subtree(project, &rel, project, &new_rel);
            st.rename_in_order(project, parent, &current, &new_name);
        }
    }
    lib.save_state(&held, &st)?;
    Ok(new_name)
}

/// Moves the diagram `id` into the project or folder `folder`, to `index`
/// among its items — the top when left out. In the folder it is in, an
/// index changes its place and none changes nothing. Its id stays; a name
/// taken there gets " 2".
pub fn move_diagram(
    lib: &Library,
    id: &str,
    folder: &str,
    index: Option<usize>,
) -> Result<(), String> {
    move_diagram_with(lib, id, folder, index, disk::rename)
}

/// `move_diagram` with the rename it makes given — a test's stand-in for a
/// move across volumes
pub fn move_diagram_with(
    lib: &Library,
    id: &str,
    folder: &str,
    index: Option<usize>,
    rename: disk::RenameFn,
) -> Result<(), String> {
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    let from = ops::diagram_at(&st, id)?.ok_or_else(|| format!("no such diagram: {id:?}"))?;
    if !disk::is_real_file(&from.path) {
        return Err(format!("no such diagram: {id:?}"));
    }
    let target = folder_at(&st, folder)?;
    let (old_parent, file) = split_rel(&from.rel);
    let (old_parent, file) = (old_parent.to_string(), file.to_string());
    if from.path.parent() == Some(target.path.as_path()) {
        return match index {
            Some(index) => {
                let present = st.visible_items(target.project, &target.rel, target.depth);
                st.place_item(target.project, &target.rel, &file, index, &present);
                lib.save_state(&held, &st)
            }
            None => Ok(()),
        };
    }
    let stem = names::diagram_stem(&file).unwrap_or(&file);
    let ext = &file[stem.len()..];
    let new_file = format!(
        "{}{ext}",
        Siblings::read(&target.path)?.diagram_name(stem, ext)
    );
    {
        let _change = lib.restructure(&held);
        disk::transfer(&from.path, &target.path.join(&new_file), rename)?;
    }
    let new_rel = child_rel(&target.rel, &new_file);
    st.move_subtree(from.project, &from.rel, target.project, &new_rel);
    st.take_from_order(from.project, &old_parent, &file);
    let present = st.visible_items(target.project, &target.rel, target.depth);
    st.place_item(
        target.project,
        &target.rel,
        &new_file,
        index.unwrap_or(0),
        &present,
    );
    lib.save_state(&held, &st)
}

/// Moves the folder `id` — never a project — with everything in it into
/// the project or folder `parent`, to `index` among its items: the top when
/// left out. Never into itself or anything under it, never so deep that
/// something in it passes `MAX_DEPTH`. Its id stays; a name taken there
/// gets " 2".
pub fn move_folder(
    lib: &Library,
    id: &str,
    parent: &str,
    index: Option<usize>,
) -> Result<(), String> {
    move_folder_with(lib, id, parent, index, disk::rename)
}

/// `move_folder` with the rename it makes given
pub fn move_folder_with(
    lib: &Library,
    id: &str,
    parent: &str,
    index: Option<usize>,
    rename: disk::RenameFn,
) -> Result<(), String> {
    state::validate_id(id)?;
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    match st.find(id) {
        None => return Err(format!("no such folder: {id:?}")),
        Some(Found { rel: None, .. }) => {
            return Err("a project cannot be moved into a folder".into())
        }
        Some(_) => {}
    }
    let from = folder_at(&st, id)?;
    let target = folder_at(&st, parent)?;
    if target.project == from.project && disk::rel_within(&target.rel, &from.rel) {
        return Err("a folder cannot go inside itself".into());
    }
    let (old_parent, name) = split_rel(&from.rel);
    let (old_parent, name) = (old_parent.to_string(), name.to_string());
    if from.path.parent() == Some(target.path.as_path()) {
        return match index {
            Some(index) => {
                let present = st.visible_items(target.project, &target.rel, target.depth);
                st.place_item(target.project, &target.rel, &name, index, &present);
                lib.save_state(&held, &st)
            }
            None => Ok(()),
        };
    }
    if target.depth + walk::height(&from.path, MAX_DEPTH) > MAX_DEPTH {
        return Err(format!("folders nest at most {MAX_DEPTH} levels deep"));
    }
    let new_name = Siblings::read(&target.path)?.folder_name(&name);
    {
        let _change = lib.restructure(&held);
        disk::transfer(&from.path, &target.path.join(&new_name), rename)?;
    }
    let new_rel = child_rel(&target.rel, &new_name);
    st.move_subtree(from.project, &from.rel, target.project, &new_rel);
    st.take_from_order(from.project, &old_parent, &name);
    let present = st.visible_items(target.project, &target.rel, target.depth);
    st.place_item(
        target.project,
        &target.rel,
        &new_name,
        index.unwrap_or(0),
        &present,
    );
    lib.save_state(&held, &st)
}

/// Puts `item` (`folder:<id>`, `diagram:<id>`) at `index` among the items
/// of the project or folder `parent` it is in — or among the projects, for
/// none.
pub fn reorder(
    lib: &Library,
    parent: Option<&str>,
    item: &str,
    index: usize,
) -> Result<(), String> {
    let bad = || format!("invalid item: {item:?}");
    let (kind, id) = item.split_once(':').ok_or_else(bad)?;
    state::validate_id(id).map_err(|_| bad())?;
    if kind != "folder" && kind != "diagram" {
        return Err(bad());
    }
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    let not_there = || format!("{item:?} is not in {:?}", parent.unwrap_or("the library"));
    let Some(parent) = parent else {
        if kind != "folder" || st.project(id).is_none() {
            return Err(not_there());
        }
        st.move_project(id, index)?;
        return lib.save_state(&held, &st);
    };
    let target = folder_at(&st, parent)?;
    let rel = match st.find(id) {
        Some(Found {
            project,
            rel: Some(rel),
        }) if project == target.project => rel,
        _ => return Err(not_there()),
    };
    let (in_dir, name) = split_rel(&rel);
    let is_diagram =
        names::diagram_stem(name).is_some() && disk::is_real_file(&target.path.join(name));
    let present = st.visible_items(target.project, &target.rel, target.depth);
    if in_dir != target.rel
        || (kind == "diagram") != is_diagram
        || !present.iter().any(|n| n == name)
    {
        return Err(not_there());
    }
    let name = name.to_string();
    st.place_item(target.project, &target.rel, &name, index, &present);
    lib.save_state(&held, &st)
}

/// Renames `from` to `to` in one folder, counted as a change — never over
/// another entry, though `to` may be `from` in another case.
fn rename_entry(
    lib: &Library,
    held: &std::sync::MutexGuard<'_, ()>,
    from: &Path,
    to: &Path,
) -> Result<(), String> {
    if disk::exists(to) && !disk::same_entry(from, to) {
        return Err(format!("{}: in the way", to.display()));
    }
    let _change = lib.restructure(held);
    std::fs::rename(from, to).map_err(|e| format!("{}: {e}", from.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::ctx::tests::test_library;
    use crate::library::disk::tests::names_in;
    use crate::library::listing::list;
    use crate::library::listing::tests::{folder_names, names_of, project, put};
    use crate::library::ops::tests::{p_dir, saved, titled, with_project};
    use crate::library::ops::{load, save};

    fn spot(x: i64, y: i64) -> BoardSpot {
        BoardSpot {
            x,
            y,
            collapsed: None,
        }
    }

    #[test]
    fn a_new_project_is_a_folder_in_the_default_location_on_top() {
        let lib = test_library("folders-project");
        std::fs::create_dir_all(lib.default_location.join("Older")).unwrap();
        list(&lib).unwrap();
        let name = create_folder(&lib, "p1", "Payments", Some(&spot(40, 80)), None).unwrap();
        assert_eq!(name, "Payments");
        assert!(lib.default_location.join("Payments").is_dir());
        let listed = list(&lib).unwrap();
        assert_eq!(names_of(&listed), vec!["Payments", "Older"]);
        assert_eq!(listed[0].id, "p1");
        assert_eq!(listed[0].board, Some(spot(40, 80)));
        // a clash in another case gets " 2"; a name is cleaned
        assert_eq!(
            create_folder(&lib, "p2", "payments", None, None).unwrap(),
            "payments 2"
        );
        assert_eq!(
            create_folder(&lib, "p3", " a/b ", None, None).unwrap(),
            "a-b"
        );
        assert_eq!(
            create_folder(&lib, "p4", "...", None, None).unwrap(),
            "Untitled Project"
        );
    }

    #[test]
    fn the_default_location_is_made_for_the_first_project() {
        let lib = test_library("folders-first");
        assert!(!lib.default_location.exists());
        create_folder(&lib, "p1", "First", None, None).unwrap();
        assert_eq!(names_in(&lib.default_location), vec!["First"]);
    }

    #[test]
    fn a_new_folder_is_refused_a_taken_id_a_bad_board_or_a_board_at_all() {
        let (lib, p) = with_project("folders-refuse");
        assert!(create_folder(&lib, &p, "Again", None, None).is_err());
        assert!(create_folder(&lib, "bad id", "X", None, None).is_err());
        assert!(create_folder(&lib, "p9", "X", Some(&spot(2_000_000, 0)), None).is_err());
        assert!(create_folder(&lib, "f1", "Sub", Some(&spot(0, 0)), Some(&p)).is_err());
        assert!(create_folder(&lib, "f1", "Sub", None, Some("nope")).is_err());
        assert_eq!(names_in(&p_dir(&lib)), Vec::<String>::new());
    }

    #[test]
    fn a_folder_goes_on_top_of_its_parent_and_shows_though_empty() {
        let (lib, p) = with_project("folders-sub");
        put(&p_dir(&lib).join("a.dosik"), &titled("a"));
        list(&lib).unwrap();
        assert_eq!(
            create_folder(&lib, "f1", "Zeta", None, Some(&p)).unwrap(),
            "Zeta"
        );
        assert_eq!(
            create_folder(&lib, "f2", "Inner", None, Some("f1")).unwrap(),
            "Inner"
        );
        let listed = list(&lib).unwrap();
        let pm = project(&listed, "P");
        assert_eq!(pm.order[0], "folder:f1");
        assert_eq!(folder_names(pm), vec!["Zeta"]);
        assert_eq!(folder_names(&pm.folders[0]), vec!["Inner"]);
        assert!(p_dir(&lib).join("Zeta/Inner").is_dir());
    }

    #[test]
    fn folders_nest_at_most_max_depth() {
        let (lib, p) = with_project("folders-depth");
        let mut parent = p;
        for level in 2..=MAX_DEPTH {
            let id = format!("f{level}");
            create_folder(&lib, &id, &format!("L{level}"), None, Some(&parent)).unwrap();
            parent = id;
        }
        assert!(create_folder(&lib, "deeper", "Too deep", None, Some(&parent)).is_err());
    }

    #[test]
    fn a_renamed_project_keeps_its_id_place_and_items() {
        let (lib, p) = with_project("folders-rename-project");
        saved(save(&lib, "d1", &titled("Flow"), Some(&p), None).unwrap());
        create_folder(&lib, "q", "Other", Some(&spot(1, 2)), None).unwrap();
        assert_eq!(rename_folder(&lib, &p, "Renamed").unwrap(), "Renamed");
        assert!(lib.default_location.join("Renamed/Flow.dosik").is_file());
        let listed = list(&lib).unwrap();
        assert_eq!(names_of(&listed), vec!["Other", "Renamed"]);
        assert_eq!(listed[1].id, p);
        assert_eq!(listed[1].diagrams[0].id, "d1");
        assert_eq!(load(&lib, "d1").unwrap().name, "Flow");
        // into another's name: " 2"; in case only: no clash
        assert_eq!(rename_folder(&lib, &p, "other").unwrap(), "other 2");
        assert_eq!(rename_folder(&lib, "q", "OTHER").unwrap(), "OTHER");
        assert_eq!(list(&lib).unwrap()[0].board, Some(spot(1, 2)));
        // the same name changes nothing
        assert_eq!(rename_folder(&lib, "q", "OTHER").unwrap(), "OTHER");
    }

    #[test]
    fn a_renamed_folder_takes_everything_under_it_along() {
        let (lib, p) = with_project("folders-rename-sub");
        create_folder(&lib, "f1", "Sub", None, Some(&p)).unwrap();
        create_folder(&lib, "f2", "Inner", None, Some("f1")).unwrap();
        saved(save(&lib, "d1", &titled("Deep"), Some("f2"), None).unwrap());
        saved(save(&lib, "d2", &titled("Top"), Some(&p), None).unwrap());
        let before = list(&lib).unwrap()[0].order.clone();
        assert_eq!(rename_folder(&lib, "f1", "Renamed").unwrap(), "Renamed");
        let listed = list(&lib).unwrap();
        assert_eq!(listed[0].order, before, "its place stays");
        assert_eq!(folder_names(&listed[0]), vec!["Renamed"]);
        assert_eq!(listed[0].folders[0].folders[0].diagrams[0].id, "d1");
        assert_eq!(load(&lib, "d1").unwrap().name, "Deep");
        let st = {
            let held = lib.lock();
            lib.load_state(&held).unwrap()
        };
        let keys: Vec<&String> = st.projects[0].ids.keys().collect();
        assert_eq!(
            keys,
            vec![
                "Renamed",
                "Renamed/Inner",
                "Renamed/Inner/Deep.dosik",
                "Top.dosik"
            ]
        );
    }

    /// what a rename across volumes does
    fn across_volumes(_: &Path, _: &Path) -> std::io::Result<()> {
        Err(std::io::ErrorKind::CrossesDevices.into())
    }

    fn ids_of(lib: &Library) -> Vec<(String, String)> {
        let held = lib.lock();
        let st = lib.load_state(&held).unwrap();
        st.projects
            .iter()
            .flat_map(|p| p.ids.iter().map(|(k, v)| (v.clone(), k.clone())))
            .collect()
    }

    /// a project `P` with folders `A` and `B`, `Flow` in `A`, `Top` in `P`
    fn two_folders(tag: &str) -> (Library, String) {
        let (lib, p) = with_project(tag);
        create_folder(&lib, "fb", "B", None, Some(&p)).unwrap();
        create_folder(&lib, "fa", "A", None, Some(&p)).unwrap();
        saved(save(&lib, "flow", &titled("Flow"), Some("fa"), None).unwrap());
        saved(save(&lib, "top", &titled("Top"), Some(&p), None).unwrap());
        (lib, p)
    }

    #[test]
    fn a_diagram_moves_between_folders_and_keeps_its_id() {
        let (lib, p) = two_folders("folders-move");
        saved(save(&lib, "other", &titled("Other"), Some("fb"), None).unwrap());
        move_diagram(&lib, "flow", "fb", None).unwrap();
        assert!(p_dir(&lib).join("B/Flow.dosik").is_file());
        assert!(!p_dir(&lib).join("A/Flow.dosik").exists());
        let listed = list(&lib).unwrap();
        let b = listed[0].folders.iter().find(|f| f.id == "fb").unwrap();
        assert_eq!(b.order, vec!["diagram:flow", "diagram:other"]);
        let a = listed[0].folders.iter().find(|f| f.id == "fa").unwrap();
        assert!(a.diagrams.is_empty());
        assert_eq!(load(&lib, "flow").unwrap().name, "Flow");
        // to an index; then to the project's top with " 2" when its name is taken
        move_diagram(&lib, "flow", "fb", Some(1)).unwrap();
        let listed = list(&lib).unwrap();
        let b = listed[0].folders.iter().find(|f| f.id == "fb").unwrap();
        assert_eq!(b.order, vec!["diagram:other", "diagram:flow"]);
        saved(save(&lib, "flow", &titled("Top"), None, None).unwrap());
        move_diagram(&lib, "flow", &p, None).unwrap();
        assert_eq!(load(&lib, "flow").unwrap().name, "Top 2");
        assert_eq!(list(&lib).unwrap()[0].order[0], "diagram:flow");
    }

    #[test]
    fn a_diagram_moves_to_another_project_with_its_id() {
        let (lib, _) = two_folders("folders-move-project");
        create_folder(&lib, "q", "Q", None, None).unwrap();
        move_diagram(&lib, "flow", "q", None).unwrap();
        assert!(lib.default_location.join("Q/Flow.dosik").is_file());
        let ids = ids_of(&lib);
        assert!(ids.contains(&("flow".to_string(), "Flow.dosik".to_string())));
        let listed = list(&lib).unwrap();
        assert_eq!(project(&listed, "Q").diagrams[0].id, "flow");
    }

    #[test]
    fn an_older_file_moves_with_its_own_extension() {
        let (lib, p) = with_project("folders-move-old");
        create_folder(&lib, "fa", "A", None, Some(&p)).unwrap();
        put(&p_dir(&lib).join("Legacy.dosik.json"), &titled("Legacy"));
        list(&lib).unwrap();
        let id = ids_of(&lib)
            .into_iter()
            .find(|(_, k)| k == "Legacy.dosik.json")
            .unwrap()
            .0;
        move_diagram(&lib, &id, "fa", None).unwrap();
        assert!(p_dir(&lib).join("A/Legacy.dosik.json").is_file());
    }

    #[test]
    fn a_move_within_its_folder_only_changes_its_place() {
        let (lib, p) = two_folders("folders-move-same");
        let before = list(&lib).unwrap()[0].order.clone();
        move_diagram(&lib, "top", &p, None).unwrap();
        assert_eq!(list(&lib).unwrap()[0].order, before);
        move_diagram(&lib, "top", &p, Some(2)).unwrap();
        let after = list(&lib).unwrap()[0].order.clone();
        assert_eq!(after[2], "diagram:top");
        assert!(p_dir(&lib).join("Top.dosik").is_file());
    }

    #[test]
    fn a_folder_moves_with_everything_in_it() {
        let (lib, p) = two_folders("folders-move-folder");
        create_folder(&lib, "fin", "Inner", None, Some("fa")).unwrap();
        put(&p_dir(&lib).join("A/notes.txt"), "mine");
        move_folder(&lib, "fa", "fb", None).unwrap();
        assert!(p_dir(&lib).join("B/A/Flow.dosik").is_file());
        assert!(p_dir(&lib).join("B/A/Inner").is_dir());
        assert!(p_dir(&lib).join("B/A/notes.txt").is_file());
        let ids = ids_of(&lib);
        assert!(ids.contains(&("fa".into(), "B/A".into())));
        assert!(ids.contains(&("fin".into(), "B/A/Inner".into())));
        assert!(ids.contains(&("flow".into(), "B/A/Flow.dosik".into())));
        let listed = list(&lib).unwrap();
        assert_eq!(folder_names(&listed[0]), vec!["B"]);
        // back to the project, its name taken: " 2"
        create_folder(&lib, "fa2", "A", None, Some(&p)).unwrap();
        move_folder(&lib, "fa", &p, Some(1)).unwrap();
        assert!(p_dir(&lib).join("A 2/Flow.dosik").is_file());
        assert_eq!(list(&lib).unwrap()[0].order[1], "folder:fa");
    }

    #[test]
    fn a_folder_never_goes_inside_itself_and_a_project_stays_a_project() {
        let (lib, p) = two_folders("folders-move-self");
        create_folder(&lib, "fin", "Inner", None, Some("fa")).unwrap();
        assert!(move_folder(&lib, "fa", "fa", None)
            .unwrap_err()
            .contains("itself"));
        assert!(move_folder(&lib, "fa", "fin", None)
            .unwrap_err()
            .contains("itself"));
        assert!(move_folder(&lib, &p, "fb", None)
            .unwrap_err()
            .contains("project"));
        assert!(move_folder(&lib, "flow", "fb", None).is_err());
        assert!(move_diagram(&lib, "fa", "fb", None).is_err());
        assert!(p_dir(&lib).join("A/Inner").is_dir());
    }

    #[test]
    fn a_moved_folder_stays_within_max_depth() {
        let (lib, p) = with_project("folders-move-depth");
        let mut parent = p.clone();
        for level in 2..=MAX_DEPTH {
            let id = format!("f{level}");
            create_folder(&lib, &id, &format!("L{level}"), None, Some(&parent)).unwrap();
            parent = id;
        }
        create_folder(&lib, "tall", "Tall", None, Some(&p)).unwrap();
        create_folder(&lib, "tall2", "Tall 2", None, Some("tall")).unwrap();
        let deepest_but_one = format!("f{}", MAX_DEPTH - 1);
        assert!(move_folder(&lib, "tall", &deepest_but_one, None).is_err());
        assert!(move_folder(&lib, "tall2", &deepest_but_one, None).is_ok());
    }

    #[test]
    fn a_diagram_moved_across_volumes_is_copied_whole_then_removed() {
        let (lib, _) = two_folders("folders-exdev-file");
        let from = p_dir(&lib).join("A/Flow.dosik");
        let at = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000);
        std::fs::OpenOptions::new()
            .write(true)
            .open(&from)
            .unwrap()
            .set_modified(at)
            .unwrap();
        move_diagram_with(&lib, "flow", "fb", None, across_volumes).unwrap();
        let to = p_dir(&lib).join("B/Flow.dosik");
        assert_eq!(std::fs::read_to_string(&to).unwrap(), titled("Flow"));
        assert_eq!(std::fs::metadata(&to).unwrap().modified().unwrap(), at);
        assert!(!from.exists());
        assert_eq!(names_in(&p_dir(&lib).join("B")), vec!["Flow.dosik"]);
        assert_eq!(load(&lib, "flow").unwrap().name, "Flow");
    }

    #[test]
    fn a_folder_moved_across_volumes_is_copied_whole_then_removed() {
        let (lib, _) = two_folders("folders-exdev-folder");
        put(&p_dir(&lib).join("A/.hidden"), "kept");
        put(&p_dir(&lib).join("A/Deep/x.dosik"), &titled("x"));
        move_folder_with(&lib, "fa", "fb", None, across_volumes).unwrap();
        let to = p_dir(&lib).join("B/A");
        assert_eq!(names_in(&to), vec![".hidden", "Deep", "Flow.dosik"]);
        assert!(to.join("Deep/x.dosik").is_file());
        assert!(!p_dir(&lib).join("A").exists());
        assert_eq!(names_in(&p_dir(&lib).join("B")), vec!["A"], "no temp left");
        assert_eq!(load(&lib, "flow").unwrap().name, "Flow");
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_with_a_link_in_it_is_not_moved_across_volumes() {
        let (lib, _) = two_folders("folders-exdev-link");
        std::os::unix::fs::symlink(p_dir(&lib).join("B"), p_dir(&lib).join("A/link")).unwrap();
        assert!(move_folder_with(&lib, "fa", "fb", None, across_volumes).is_err());
        assert!(p_dir(&lib).join("A/Flow.dosik").is_file());
        assert!(names_in(&p_dir(&lib).join("B")).is_empty());
        assert!(ids_of(&lib).contains(&("fa".into(), "A".into())));
    }

    #[test]
    fn a_failed_rename_changes_nothing() {
        fn refused(_: &Path, _: &Path) -> std::io::Result<()> {
            Err(std::io::ErrorKind::PermissionDenied.into())
        }
        let (lib, _) = two_folders("folders-move-refused");
        let before = ids_of(&lib);
        assert!(move_diagram_with(&lib, "flow", "fb", None, refused).is_err());
        assert!(move_folder_with(&lib, "fa", "fb", None, refused).is_err());
        assert_eq!(ids_of(&lib), before);
        assert!(p_dir(&lib).join("A/Flow.dosik").is_file());
    }

    #[test]
    fn an_item_takes_its_new_place_among_its_siblings() {
        let (lib, p) = two_folders("folders-reorder");
        let order = list(&lib).unwrap()[0].order.clone();
        assert_eq!(order, vec!["diagram:top", "folder:fa", "folder:fb"]);
        reorder(&lib, Some(&p), "diagram:top", 2).unwrap();
        assert_eq!(
            list(&lib).unwrap()[0].order,
            vec!["folder:fa", "folder:fb", "diagram:top"]
        );
        reorder(&lib, Some(&p), "folder:fb", 0).unwrap();
        assert_eq!(
            list(&lib).unwrap()[0].order,
            vec!["folder:fb", "folder:fa", "diagram:top"]
        );
        // the projects themselves
        create_folder(&lib, "q", "Q", None, None).unwrap();
        reorder(&lib, None, &format!("folder:{p}"), 0).unwrap();
        assert_eq!(names_of(&list(&lib).unwrap()), vec!["P", "Q"]);
    }

    #[test]
    fn an_index_counts_only_the_items_that_show() {
        let (lib, p) = two_folders("folders-reorder-shown");
        // a folder made outside with nothing in it does not show
        std::fs::create_dir_all(p_dir(&lib).join("AA empty")).unwrap();
        reorder(&lib, Some(&p), "diagram:top", 1).unwrap();
        assert_eq!(
            list(&lib).unwrap()[0].order,
            vec!["folder:fa", "diagram:top", "folder:fb"]
        );
    }

    #[test]
    fn reordering_refuses_what_is_not_there() {
        let (lib, p) = two_folders("folders-reorder-refuse");
        assert!(
            reorder(&lib, Some(&p), "diagram:flow", 0).is_err(),
            "in A, not in P"
        );
        assert!(
            reorder(&lib, Some(&p), "folder:top", 0).is_err(),
            "a diagram, not a folder"
        );
        assert!(reorder(&lib, Some(&p), "diagram:nope", 0).is_err());
        assert!(
            reorder(&lib, None, "folder:fa", 0).is_err(),
            "a folder, not a project"
        );
        assert!(reorder(&lib, None, "page:x", 0).is_err());
        assert!(reorder(&lib, Some(&p), "diagram:../x", 0).is_err());
    }

    #[test]
    fn a_project_that_cannot_be_found_is_not_renamed() {
        let (lib, p) = with_project("folders-rename-missing");
        std::fs::remove_dir_all(lib.default_location.clone()).unwrap();
        assert!(rename_folder(&lib, &p, "New").is_err());
        assert!(rename_folder(&lib, "nope", "New").is_err());
    }
}
