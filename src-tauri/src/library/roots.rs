//! Where the library's projects come from: a folder added from anywhere,
//! one project of itself, and the default location, where New project
//! makes its folders and every folder in it is a project.
//!
//! - A folder added goes on top of the projects, saved where it is. One that
//!   is in the library already — a project, inside one, holding one, the
//!   default location or a folder directly in it — is not added again; a
//!   root, or the home folder or one holding it, is too broad to be one.
//! - Changing the default location changes where new projects go. Every
//!   project registered stays: the old default location's become folders
//!   added from elsewhere (a project is "added" when its folder's parent is
//!   not the default location), the new one's folders join as projects —
//!   one already added among them becomes one of its projects, not a second
//!   entry.

use std::path::Path;

use super::ctx::{resolved_default_location, Library};
use super::disk::{self, normalized};
use super::listing::{check_new_project, is_broad, register_default_projects, Refusal};
use super::state::{self, ProjectRecord, Slot};

/// What adding a folder to the library came to.
#[derive(Debug, PartialEq, Eq, Clone)]
pub enum AddOutcome {
    /// the folder is a project now, on top, with this id
    Added { id: String },
    /// it is in the library already, or inside or holding a project of it
    Already,
    /// it cannot be a project: too broad, the app's data folder, or not a
    /// whole path
    Invalid,
}

/// Whether the folder at `path` is the app's data folder — the record, the
/// older library — or is inside it or holds it: never a project nor the
/// default location.
fn touches_app_data(lib: &Library, path: &Path) -> bool {
    let Some(data) = lib.data_dir.parent() else {
        return false;
    };
    let (data, wanted) = (normalized(data), normalized(path));
    wanted.starts_with(&data) || data.starts_with(&wanted)
}

/// Adds the folder at `path` to the library as one project, on top.
pub fn add_folder_at(lib: &Library, path: &Path) -> Result<AddOutcome, String> {
    if !path.is_absolute() || touches_app_data(lib, path) {
        return Ok(AddOutcome::Invalid);
    }
    if !disk::is_real_dir(path) {
        return Err(format!("{}: not a folder", path.display()));
    }
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    // a folder directly in the default location is a project of it already,
    // listed or not yet
    if normalized(path).parent() == Some(normalized(&lib.default_location()).as_path()) {
        return Ok(AddOutcome::Already);
    }
    match check_new_project(lib, &st, path, None) {
        Ok(()) => {}
        Err(Refusal::Overlap(_)) => return Ok(AddOutcome::Already),
        Err(Refusal::Invalid(_)) => return Ok(AddOutcome::Invalid),
    }
    let id = st.new_id();
    st.add_project(ProjectRecord::new(&id, path)?, Slot::First);
    lib.save_state(&held, &st)?;
    Ok(AddOutcome::Added { id })
}

/// What changing the default location came to.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum ChangeOutcome {
    /// new projects go there from now — or went there already
    Changed,
    /// it cannot hold projects: too broad, the app's data folder, not a
    /// whole path, or a project or inside one
    Invalid,
}

/// Makes the folder at `path` the default location. Every project stays;
/// the folders in it are projects from now.
pub fn set_default_location_at(lib: &Library, picked: &Path) -> Result<ChangeOutcome, String> {
    if !picked.is_absolute() {
        return Ok(ChangeOutcome::Invalid);
    }
    // a link to a folder is that folder, as when the app opens it — the
    // record keeps it as picked, for the next run to resolve again
    let resolved = resolved_default_location(picked);
    let path = resolved.as_path();
    let home = lib.home.as_deref().map(normalized);
    if is_broad(picked, lib.home.as_deref())
        || is_broad(path, home.as_deref())
        || touches_app_data(lib, path)
    {
        return Ok(ChangeOutcome::Invalid);
    }
    if !disk::is_real_dir(path) {
        return Err(format!("{}: not a folder", picked.display()));
    }
    // a path the record cannot write is refused before anything changes
    let text = state::path_text(path)?;
    let chosen = state::path_text(picked)?;
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    let wanted = normalized(path);
    let now = normalized(&lib.default_location());
    if wanted == now {
        // in use already — told by the environment, say: chosen from now,
        // so the next run starts there too; nothing else changes
        if st.chosen_location.as_deref() != Some(chosen.as_str()) {
            st.chosen_location = Some(chosen);
            lib.save_state(&held, &st)?;
        }
        return Ok(ChangeOutcome::Changed);
    }
    // a folder directly in the default location is a project of it, listed or not yet
    let in_a_project = wanted.parent() == Some(now.as_path())
        || st
            .projects
            .iter()
            .any(|p| wanted.starts_with(normalized(&p.root())));
    if in_a_project {
        return Ok(ChangeOutcome::Invalid);
    }
    // a folder added from there and not found now is kept one added, not
    // found — neither taken in as one of its projects nor forgotten for
    // being gone from it — until it is found, located or removed
    for record in &mut st.projects {
        let root = record.root();
        let directly_in = root
            .parent()
            .is_some_and(|parent| normalized(parent) == wanted);
        record.kept_added = directly_in
            && matches!(
                disk::presence(&root),
                disk::Presence::Missing | disk::Presence::File | disk::Presence::Other
            );
    }
    let before = lib.default_location();
    lib.set_default_location(&held, path.to_path_buf());
    st.default_location = Some(text);
    st.chosen_location = Some(chosen);
    // its folders join — one added from there already, under any spelling,
    // is one of them now and takes its spelling, never a second entry
    if let Err(why) = register_default_projects(lib, &mut st) {
        lib.set_default_location(&held, before);
        return Err(why);
    }
    if let Err(why) = lib.save_state(&held, &st) {
        lib.set_default_location(&held, before);
        return Err(why);
    }
    Ok(ChangeOutcome::Changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::ctx::tests::test_library;
    use crate::library::listing::list;
    use crate::library::listing::tests::{names_of, project, put, titles};
    use crate::library::ops::tests::titled;
    use crate::library::removal::remove_project;
    use crate::library::state::LibraryState;
    use crate::library::watch::{roots, Root};
    use std::path::PathBuf;

    fn record(lib: &Library) -> LibraryState {
        let held = lib.lock();
        lib.load_state(&held).unwrap()
    }

    /// the temp folder the test library sits in — outside its default location
    fn base(lib: &Library) -> PathBuf {
        lib.data_dir
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    }

    fn added(lib: &Library, path: &Path) -> String {
        match add_folder_at(lib, path).unwrap() {
            AddOutcome::Added { id } => id,
            other => panic!("{} not added: {other:?}", path.display()),
        }
    }

    fn watched(lib: &Library, path: &Path) -> bool {
        roots(lib, &record(lib)).contains(&Root {
            path: path.to_path_buf(),
            recursive: true,
        })
    }

    #[test]
    fn a_folder_added_is_a_project_on_top_saved_where_it_is() {
        let lib = test_library("roots-add");
        std::fs::create_dir_all(lib.default_location().join("Alpha")).unwrap();
        list(&lib).unwrap();
        let repo = base(&lib).join("work").join("client-diagrams");
        put(&repo.join("Flow.dosik"), &titled("Flow"));
        let id = added(&lib, &repo);
        let listed = list(&lib).unwrap();
        assert_eq!(names_of(&listed), vec!["client-diagrams", "Alpha"]);
        assert_eq!(listed[0].id, id);
        assert!(listed[0].added);
        assert_eq!(titles(&listed[0]), vec!["Flow"]);
        assert_eq!(listed[0].path.as_deref(), repo.to_str());
        // watched from now, with everything in it
        assert!(watched(&lib, &repo));
        // nothing of Dosik's goes into it
        assert_eq!(
            crate::library::disk::tests::names_in(&repo),
            vec!["Flow.dosik"]
        );
    }

    #[test]
    fn a_folder_in_the_library_already_is_not_added_again() {
        let lib = test_library("roots-already");
        let default = lib.default_location();
        std::fs::create_dir_all(default.join("Payments").join("docs")).unwrap();
        list(&lib).unwrap();
        let work = base(&lib).join("work");
        let repo = work.join("Repo");
        std::fs::create_dir_all(repo.join("inner")).unwrap();
        added(&lib, &repo);
        std::fs::create_dir_all(default.join("Fresh")).unwrap();
        let before = record(&lib);
        for path in [
            // a project, added or of the default location
            repo.clone(),
            default.join("Payments"),
            // inside one
            repo.join("inner"),
            default.join("Payments").join("docs"),
            // holding one
            work.clone(),
            // the default location itself, or holding it
            default.clone(),
            default.parent().unwrap().to_path_buf(),
            // directly in it, not listed yet
            default.join("Fresh"),
        ] {
            assert_eq!(
                add_folder_at(&lib, &path).unwrap(),
                AddOutcome::Already,
                "{}",
                path.display()
            );
        }
        assert_eq!(record(&lib), before);
    }

    #[test]
    fn a_folder_too_broad_or_not_whole_is_refused() {
        let lib = test_library("roots-broad");
        let home = lib.home.clone().unwrap();
        std::fs::create_dir_all(&home).unwrap();
        for path in [
            home.clone(),
            home.parent().unwrap().to_path_buf(),
            PathBuf::from("/"),
        ] {
            assert_eq!(
                add_folder_at(&lib, &path).unwrap(),
                AddOutcome::Invalid,
                "{}",
                path.display()
            );
        }
        assert_eq!(
            add_folder_at(&lib, Path::new("rel/dir")).unwrap(),
            AddOutcome::Invalid
        );
        // a file is no folder
        let file = base(&lib).join("note.txt");
        put(&file, "x");
        assert!(add_folder_at(&lib, &file).is_err());
        assert!(record(&lib).projects.is_empty());
    }

    #[test]
    fn the_app_data_folder_is_never_a_project_nor_the_default_location() {
        let base = crate::library::disk::tests::scratch("roots-app-data");
        let app_data = base.join("deep").join("appdata");
        let lib = Library::new(
            app_data.join("library"),
            base.join("home").join("Docs").join("Dosik"),
            app_data.join("projects"),
            Some(base.join("home")),
        );
        std::fs::create_dir_all(app_data.join("library")).unwrap();
        std::fs::create_dir_all(app_data.join("projects").join("old")).unwrap();
        std::fs::create_dir_all(base.join("home")).unwrap();
        list(&lib).unwrap();
        let before = record(&lib);
        for path in [
            // the app data folder, inside it, or holding it
            app_data.clone(),
            app_data.join("library"),
            app_data.join("projects").join("old"),
            base.join("deep"),
        ] {
            assert_eq!(
                add_folder_at(&lib, &path).unwrap(),
                AddOutcome::Invalid,
                "{}",
                path.display()
            );
            assert_eq!(
                set_default_location_at(&lib, &path).unwrap(),
                ChangeOutcome::Invalid,
                "{}",
                path.display()
            );
        }
        assert_eq!(record(&lib), before);
        assert_eq!(
            lib.default_location(),
            base.join("home").join("Docs").join("Dosik")
        );
    }

    #[test]
    fn a_new_default_location_keeps_every_project_and_takes_in_its_folders() {
        let lib = test_library("roots-change");
        let old = lib.default_location();
        put(&old.join("Payments").join("Flow.dosik"), &titled("Flow"));
        std::fs::create_dir_all(old.join("Sketches")).unwrap();
        let repo = base(&lib).join("work").join("Repo");
        std::fs::create_dir_all(&repo).unwrap();
        list(&lib).unwrap();
        let repo_id = added(&lib, &repo);
        let ids: Vec<String> = list(&lib).unwrap().iter().map(|p| p.id.clone()).collect();
        let next = base(&lib).join("Dropbox").join("Dosik");
        put(&next.join("Beta").join("Plan.dosik"), &titled("Plan"));
        std::fs::create_dir_all(next.join("Alpha")).unwrap();
        std::fs::create_dir_all(next.join(".hidden")).unwrap();
        put(&next.join("Loose.dosik"), &titled("Loose"));

        assert_eq!(
            set_default_location_at(&lib, &next).unwrap(),
            ChangeOutcome::Changed
        );
        // in use as the app opens it: as picked — a link itself would be resolved
        let real = resolved_default_location(&next);
        assert_eq!(lib.default_location(), real);
        assert_eq!(record(&lib).default_location.as_deref(), real.to_str());
        assert_eq!(record(&lib).chosen_location.as_deref(), next.to_str());
        let listed = list(&lib).unwrap();
        // the old ones stay, in their order and with their ids — added from
        // elsewhere now; the new location's folders join by name
        assert_eq!(
            names_of(&listed),
            vec!["Alpha", "Beta", "Repo", "Payments", "Sketches"]
        );
        for (name, was) in [("Repo", 0), ("Payments", 1), ("Sketches", 2)] {
            assert_eq!(project(&listed, name).id, ids[was]);
            assert!(project(&listed, name).added, "{name}");
        }
        assert_eq!(project(&listed, "Repo").id, repo_id);
        assert!(!project(&listed, "Alpha").added);
        assert!(!project(&listed, "Beta").added);
        assert_eq!(titles(project(&listed, "Beta")), vec!["Plan"]);
        assert_eq!(titles(project(&listed, "Payments")), vec!["Flow"]);
        // the new location watched whole, the old one's projects each
        assert!(watched(&lib, &real));
        assert!(watched(&lib, &old.join("Payments")));
        assert!(!watched(&lib, &old));
        // New project goes to the new location
        let n = crate::library::folders::create_folder(&lib, "np1", "Fresh", None, None);
        n.unwrap();
        assert!(next.join("Fresh").is_dir());
        // an old one is removed from the library now, its files left
        remove_project(&lib, &ids[1]).unwrap();
        assert!(old.join("Payments").join("Flow.dosik").is_file());
        assert!(record(&lib).project(&ids[1]).is_none());
    }

    #[test]
    fn a_new_default_location_lost_with_its_projects_is_never_made_again() {
        let lib = test_library("roots-change-lost");
        let old = lib.default_location();
        std::fs::create_dir_all(old.join("Payments")).unwrap();
        list(&lib).unwrap();
        let next = base(&lib).join("Drive").join("Dosik");
        std::fs::create_dir_all(next.join("Plans")).unwrap();
        assert_eq!(
            set_default_location_at(&lib, &next).unwrap(),
            ChangeOutcome::Changed
        );
        list(&lib).unwrap();
        // the old location gone: its projects are added ones now, and stay
        // not found — New project goes to the new location all the same
        std::fs::remove_dir_all(&old).unwrap();
        crate::library::folders::create_folder(&lib, "np1", "Fresh", None, None).unwrap();
        assert!(next.join("Fresh").is_dir());
        let listed = list(&lib).unwrap();
        assert!(project(&listed, "Payments").missing);
        // the new location gone with its projects (a drive away): it is not
        // made again, and the toast names it
        std::fs::remove_dir_all(&next).unwrap();
        list(&lib).unwrap();
        let refused = crate::library::folders::create_folder(&lib, "np2", "Other", None, None);
        let why = refused.unwrap_err();
        assert!(why.contains("Can't find the library folder"), "{why}");
        assert!(why.contains("Drive"), "{why}");
        assert!(!next.exists());
    }

    /// a folder name that is not UTF-8 — only where the file system takes one
    #[cfg(target_os = "linux")]
    #[test]
    fn a_folder_the_record_cannot_name_leaves_the_default_location_as_it_was() {
        use std::os::unix::ffi::OsStrExt;
        let lib = test_library("roots-not-utf8");
        let old = lib.default_location();
        std::fs::create_dir_all(old.join("P")).unwrap();
        list(&lib).unwrap();
        let file = lib.data_dir.join(state::STATE_FILE);
        let bytes = std::fs::read(&file).unwrap();
        let odd = base(&lib).join(std::ffi::OsStr::from_bytes(b"odd-\xff"));
        std::fs::create_dir_all(&odd).unwrap();
        assert!(set_default_location_at(&lib, &odd).is_err());
        assert_eq!(lib.default_location(), old);
        assert_eq!(std::fs::read(&file).unwrap(), bytes);
    }

    /// what a failed change must leave as it was: the location in use, the
    /// record's bytes, the folders watched
    fn untouched(lib: &Library) -> (PathBuf, Vec<u8>, std::collections::BTreeSet<Root>) {
        let bytes = std::fs::read(lib.data_dir.join(state::STATE_FILE)).unwrap();
        (lib.default_location(), bytes, roots(lib, &record(lib)))
    }

    #[cfg(unix)]
    #[test]
    fn a_new_default_location_that_cannot_be_read_changes_nothing() {
        use crate::library::listing::tests::lock_out;
        let lib = test_library("roots-change-unreadable");
        std::fs::create_dir_all(lib.default_location().join("P")).unwrap();
        let repo = base(&lib).join("work").join("Repo");
        std::fs::create_dir_all(&repo).unwrap();
        list(&lib).unwrap();
        added(&lib, &repo);
        let next = base(&lib).join("Locked");
        std::fs::create_dir_all(next.join("Q")).unwrap();
        let before = untouched(&lib);
        let Some(_unlock) = lock_out(&next) else {
            return;
        };
        let why = set_default_location_at(&lib, &next).unwrap_err();
        assert!(why.contains("may not read"), "{why}");
        assert_eq!(untouched(&lib), before);
    }

    #[cfg(unix)]
    #[test]
    fn a_record_that_cannot_be_written_changes_nothing() {
        use std::os::unix::fs::PermissionsExt;
        let lib = test_library("roots-change-unwritable");
        std::fs::create_dir_all(lib.default_location().join("P")).unwrap();
        list(&lib).unwrap();
        let next = base(&lib).join("Elsewhere");
        std::fs::create_dir_all(next.join("Q")).unwrap();
        let before = untouched(&lib);
        // the record's folder read-only: read, never written
        struct Writable(PathBuf);
        impl Drop for Writable {
            fn drop(&mut self) {
                let _ = std::fs::set_permissions(&self.0, std::fs::Permissions::from_mode(0o755));
            }
        }
        let dir = lib.data_dir.clone();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();
        let _writable = Writable(dir.clone());
        if std::fs::write(dir.join("probe"), "x").is_ok() {
            eprintln!("{}: still writable without rights; left out", dir.display());
            return;
        }
        assert!(set_default_location_at(&lib, &next).is_err());
        assert_eq!(untouched(&lib), before);
    }

    #[cfg(unix)]
    #[test]
    fn a_default_location_picked_through_a_link_is_the_folder_it_leads_to() {
        let lib = test_library("roots-change-link");
        std::fs::create_dir_all(lib.default_location().join("P")).unwrap();
        list(&lib).unwrap();
        let real = base(&lib).join("Drive").join("Dosik");
        std::fs::create_dir_all(real.join("Plans")).unwrap();
        let link = base(&lib).join("Linked");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert_eq!(
            set_default_location_at(&lib, &link).unwrap(),
            ChangeOutcome::Changed
        );
        // in use: the folder, as the app resolves a linked one it opens
        let resolved = crate::library::ctx::resolved_default_location(&link);
        assert_eq!(lib.default_location(), resolved);
        let st = record(&lib);
        assert_eq!(st.default_location.as_deref(), resolved.to_str());
        // kept as picked: the next run resolves it again, as it opens
        assert_eq!(st.chosen_location.as_deref(), link.to_str());
        let listed = list(&lib).unwrap();
        assert!(!project(&listed, "Plans").added);
        assert!(project(&listed, "P").added);
    }

    #[test]
    fn a_folder_added_whose_record_cannot_be_written_is_not_added() {
        let lib = test_library("roots-add-unsaved");
        std::fs::create_dir_all(lib.default_location().join("P")).unwrap();
        list(&lib).unwrap();
        let before = untouched(&lib);
        let repo = base(&lib).join("work").join("Repo");
        std::fs::create_dir_all(&repo).unwrap();
        crate::library::ctx::FAIL_NEXT_SAVE.with(|f| f.set(true));
        assert!(add_folder_at(&lib, &repo).is_err());
        assert_eq!(untouched(&lib), before);
        // nothing made on disk to take back, nothing of Dosik's left in it
        assert!(crate::library::disk::tests::names_in(&repo).is_empty());
        assert_eq!(names_of(&list(&lib).unwrap()), vec!["P"]);
    }

    #[test]
    fn a_default_location_whose_record_cannot_be_written_is_not_changed() {
        let lib = test_library("roots-change-unsaved");
        std::fs::create_dir_all(lib.default_location().join("P")).unwrap();
        list(&lib).unwrap();
        let before = untouched(&lib);
        let next = base(&lib).join("Elsewhere");
        std::fs::create_dir_all(next.join("Q")).unwrap();
        crate::library::ctx::FAIL_NEXT_SAVE.with(|f| f.set(true));
        assert!(set_default_location_at(&lib, &next).is_err());
        assert_eq!(untouched(&lib), before);
    }

    #[test]
    fn the_same_default_location_again_changes_nothing() {
        let lib = test_library("roots-same");
        let at = lib.default_location();
        std::fs::create_dir_all(at.join("P")).unwrap();
        list(&lib).unwrap();
        let before = record(&lib);
        let file = lib.data_dir.join(state::STATE_FILE);
        // the location in use picked: it is the one chosen from now — the
        // next run starts there even when this one was told where — and
        // nothing else changes
        assert_eq!(
            set_default_location_at(&lib, &at).unwrap(),
            ChangeOutcome::Changed
        );
        let after = record(&lib);
        assert_eq!(after.chosen_location.as_deref(), at.to_str());
        assert_eq!(
            LibraryState {
                chosen_location: None,
                ..after
            },
            before
        );
        assert_eq!(lib.default_location(), at);
        // picked again: nothing to write
        let bytes = std::fs::read(&file).unwrap();
        assert_eq!(
            set_default_location_at(&lib, &at).unwrap(),
            ChangeOutcome::Changed
        );
        assert_eq!(std::fs::read(&file).unwrap(), bytes);
    }

    #[test]
    fn a_folder_added_from_the_new_default_location_becomes_one_of_its_projects() {
        let lib = test_library("roots-absorb");
        let work = base(&lib).join("work");
        let repo = work.join("Repo");
        put(&repo.join("Flow.dosik"), &titled("Flow"));
        std::fs::create_dir_all(work.join("Other")).unwrap();
        // added under the spelling the file system gives — the new default
        // location picked under the one the test has (they differ where the
        // temp folder sits behind a link)
        let real = std::fs::canonicalize(&repo).unwrap();
        let id = added(&lib, &real);
        assert_eq!(
            set_default_location_at(&lib, &work).unwrap(),
            ChangeOutcome::Changed
        );
        let listed = list(&lib).unwrap();
        assert_eq!(names_of(&listed), vec!["Other", "Repo"]);
        let repo_now = project(&listed, "Repo");
        assert_eq!(repo_now.id, id);
        assert!(!repo_now.added, "one of the default location's now");
        assert_eq!(titles(repo_now), vec!["Flow"]);
        assert_eq!(record(&lib).projects.len(), 2);
        assert_eq!(
            repo_now.path.as_deref(),
            resolved_default_location(&work).join("Repo").to_str()
        );
    }

    #[test]
    fn a_folder_added_and_not_found_stays_not_found_in_the_new_default_location() {
        let lib = test_library("roots-absorb-lost");
        let work = base(&lib).join("work");
        let gone = work.join("Gone");
        put(&gone.join("Flow.dosik"), &titled("Flow"));
        std::fs::create_dir_all(work.join("Other")).unwrap();
        let id = added(&lib, &gone);
        list(&lib).unwrap();
        // gone from disk, a drive away, before the default location moves onto its parent
        let away = base(&lib).join("away");
        std::fs::rename(&gone, &away).unwrap();
        assert_eq!(
            set_default_location_at(&lib, &work).unwrap(),
            ChangeOutcome::Changed
        );
        // neither taken in as one of its projects nor forgotten: not found,
        // with Locate… and Remove from Library, listing after listing
        for _ in 0..2 {
            let listed = list(&lib).unwrap();
            assert_eq!(names_of(&listed), vec!["Gone", "Other"]);
            let lost = project(&listed, "Gone");
            assert_eq!(lost.id, id);
            assert!(lost.missing);
            assert!(lost.added, "removed from the library, never deleted");
        }
        // back where it was: one of the default location's projects, its ids kept
        std::fs::rename(&away, &gone).unwrap();
        let listed = list(&lib).unwrap();
        let back = project(&listed, "Gone");
        assert_eq!(back.id, id);
        assert!(!back.missing);
        assert!(!back.added);
        assert_eq!(titles(back), vec!["Flow"]);
        assert!(!record(&lib).projects.iter().any(|p| p.kept_added));
    }

    #[test]
    fn a_folder_kept_not_found_is_located_or_removed_as_any_added_one() {
        let lib = test_library("roots-absorb-lost-locate");
        let work = base(&lib).join("work");
        let gone = work.join("Gone");
        std::fs::create_dir_all(&gone).unwrap();
        let id = added(&lib, &gone);
        std::fs::remove_dir(&gone).unwrap();
        set_default_location_at(&lib, &work).unwrap();
        list(&lib).unwrap();
        let found = base(&lib).join("found").join("Gone");
        std::fs::create_dir_all(&found).unwrap();
        assert_eq!(
            crate::library::removal::locate_project_at(&lib, &id, &found).unwrap(),
            crate::library::removal::LocateOutcome::Located
        );
        assert!(!record(&lib).project(&id).unwrap().kept_added);
        std::fs::remove_dir(&found).unwrap();
        list(&lib).unwrap();
        remove_project(&lib, &id).unwrap();
        assert!(record(&lib).project(&id).is_none());
    }

    #[test]
    fn a_project_deeper_in_the_new_default_location_keeps_its_folder_out() {
        let lib = test_library("roots-deep");
        let work = base(&lib).join("work");
        let repo = work.join("clients").join("Repo");
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::create_dir_all(work.join("Notes")).unwrap();
        added(&lib, &repo);
        assert_eq!(
            set_default_location_at(&lib, &work).unwrap(),
            ChangeOutcome::Changed
        );
        let listed = list(&lib).unwrap();
        // clients holds a project: no project of itself
        assert_eq!(names_of(&listed), vec!["Notes", "Repo"]);
        assert!(project(&listed, "Repo").added);
    }

    #[test]
    fn a_default_location_inside_a_project_or_too_broad_is_refused() {
        let lib = test_library("roots-change-invalid");
        let old = lib.default_location();
        std::fs::create_dir_all(old.join("Payments").join("docs")).unwrap();
        list(&lib).unwrap();
        let repo = base(&lib).join("work").join("Repo");
        std::fs::create_dir_all(repo.join("inner")).unwrap();
        added(&lib, &repo);
        std::fs::create_dir_all(old.join("Fresh")).unwrap();
        let home = lib.home.clone().unwrap();
        let before = record(&lib);
        for path in [
            old.join("Payments"),
            old.join("Payments").join("docs"),
            repo.clone(),
            repo.join("inner"),
            // directly in the default location: a project of it, listed or not
            old.join("Fresh"),
            home.clone(),
            home.parent().unwrap().to_path_buf(),
            PathBuf::from("/"),
            PathBuf::from("rel/dir"),
        ] {
            assert_eq!(
                set_default_location_at(&lib, &path).unwrap(),
                ChangeOutcome::Invalid,
                "{}",
                path.display()
            );
        }
        assert_eq!(lib.default_location(), old);
        assert_eq!(record(&lib), before);
        let file = base(&lib).join("note.txt");
        put(&file, "x");
        assert!(set_default_location_at(&lib, &file).is_err());
    }
}
