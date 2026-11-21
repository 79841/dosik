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
    let present: Vec<String> = walk::entries(&target.path)
        .into_iter()
        .map(|(n, _)| n)
        .collect();
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

    #[test]
    fn a_project_that_cannot_be_found_is_not_renamed() {
        let (lib, p) = with_project("folders-rename-missing");
        std::fs::remove_dir_all(lib.default_location.clone()).unwrap();
        assert!(rename_folder(&lib, &p, "New").is_err());
        assert!(rename_folder(&lib, "nope", "New").is_err());
    }
}
