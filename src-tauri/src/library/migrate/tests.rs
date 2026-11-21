//! The move of the older library, on a library built by the older code in a
//! temp folder — never the user's.

use super::*;
use crate::library::ctx::tests::test_library;
use crate::library::disk::tests::names_in;
use crate::library::listing::{self, list};
use std::collections::BTreeMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn doc(title: &str) -> String {
    format!(r#"{{"version":1,"title":"{title}","nodes":[],"edges":[]}}"#)
}

/// a time in the past, whole seconds — what every file system keeps exactly
fn at(secs: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(1_600_000_000 + secs)
}

fn set_mtime(path: &Path, time: SystemTime) {
    std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(time)
        .unwrap();
}

fn put(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

/// An older library, as the older build wrote it — folders and files named
/// by id, each folder's `folder.json` — with projects that clash in case, a
/// folder with a name no file system takes, diagrams with one title, a
/// slash in a title, no title, a file that is no JSON (and in no order), one
/// at the top that never made it into a project, board places, orders.
fn older_library(lib: &Library) {
    let dir = &lib.legacy_dir;
    put(
        &dir.join("folder.json"),
        r#"{"order":["folder:arc","folder:pay2","folder:pay"]}"#,
    );
    put(
        &dir.join("pay/folder.json"),
        r#"{"name":"Payments","createdAt":1,"board":{"x":100,"y":200,"collapsed":true},
            "order":["diagram:flow","diagram:slash","diagram:flow2","folder:sub"]}"#,
    );
    put(
        &dir.join("pay/sub/folder.json"),
        r#"{"name":"Sub/Folder","createdAt":1,"order":["diagram:deep"]}"#,
    );
    put(
        &dir.join("arc/folder.json"),
        r#"{"name":"Archive","createdAt":1,"board":{"x":-5,"y":6},"order":["diagram:notitle"]}"#,
    );
    put(
        &dir.join("pay2/folder.json"),
        r#"{"name":"payments","createdAt":1}"#,
    );
    let files = [
        ("pay/flow.dosik.json", doc("Flow")),
        ("pay/flow2.dosik.json", doc("Flow")),
        ("pay/slash.dosik.json", doc("a/b")),
        ("pay/sub/deep.dosik.json", doc("Deep")),
        (
            "arc/notitle.dosik.json",
            r#"{"nodes":[],"edges":[]}"#.to_string(),
        ),
        ("pay/bad.dosik.json", "{not json".to_string()),
        ("stray1.dosik.json", doc("Stray")),
    ];
    for (n, (file, text)) in files.iter().enumerate() {
        put(&dir.join(file), text);
        set_mtime(&dir.join(file), at(n as u64 * 100));
    }
}

/// every file under `dir` — what it holds and when it was written
fn snapshot(dir: &Path) -> BTreeMap<String, (Vec<u8>, SystemTime)> {
    fn walk(dir: &Path, rel: &str, out: &mut BTreeMap<String, (Vec<u8>, SystemTime)>) {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let entry_rel = child_rel(rel, &name);
            if entry.file_type().unwrap().is_dir() {
                walk(&entry.path(), &entry_rel, out);
            } else {
                let meta = entry.metadata().unwrap();
                out.insert(
                    entry_rel,
                    (
                        std::fs::read(entry.path()).unwrap(),
                        meta.modified().unwrap(),
                    ),
                );
            }
        }
    }
    let mut out = BTreeMap::new();
    if dir.exists() {
        walk(dir, "", &mut out);
    }
    out
}

fn record(lib: &Library) -> LibraryState {
    let held = lib.lock();
    lib.load_state(&held).unwrap()
}

/// the older library's tree and the new listing agree: ids, orders, boards
fn same_tree(old: &[legacy::FolderMeta], new: &[listing::FolderMeta]) {
    assert_eq!(
        old.iter().map(|f| f.id.clone()).collect::<Vec<_>>(),
        new.iter().map(|f| f.id.clone()).collect::<Vec<_>>(),
        "the projects' order"
    );
    for (o, n) in old.iter().zip(new) {
        same_folder(o, n);
        assert_eq!(
            o.board.map(|b| (b.x, b.y, b.collapsed)),
            n.board.map(|b| (b.x, b.y, b.collapsed))
        );
    }
}

fn same_folder(old: &legacy::FolderMeta, new: &listing::FolderMeta) {
    assert_eq!(old.id, new.id);
    assert_eq!(old.order, new.order, "the order of {}", old.name);
    for (o, n) in old.folders.iter().zip(&new.folders) {
        same_folder(o, n);
    }
    let readable = |d: &[legacy::ProjectMeta]| {
        d.iter()
            .map(|d| (d.id.clone(), d.readable))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        readable(&old.diagrams),
        new.diagrams
            .iter()
            .map(|d| (d.id.clone(), d.readable))
            .collect::<Vec<_>>()
    );
}

fn titles_by_id(list: &[listing::FolderMeta]) -> BTreeMap<String, String> {
    fn walk(f: &listing::FolderMeta, out: &mut BTreeMap<String, String>) {
        for d in &f.diagrams {
            out.insert(d.id.clone(), d.title.clone());
        }
        for sub in &f.folders {
            out.insert(sub.id.clone(), sub.name.clone());
            walk(sub, out);
        }
    }
    let mut out = BTreeMap::new();
    for f in list {
        out.insert(f.id.clone(), f.name.clone());
        walk(f, &mut out);
    }
    out
}

/// nothing the run made is left beside the default location or in it
fn no_leftovers(lib: &Library) {
    let parent = lib.default_location.parent().unwrap();
    if parent.exists() {
        for name in names_in(parent) {
            assert!(
                !name.contains("migrating"),
                "{name} left in {}",
                parent.display()
            );
        }
    }
    if lib.default_location.exists() {
        for name in names_in(&lib.default_location) {
            assert!(
                !name.starts_with('.'),
                "{name} left in the default location"
            );
        }
    }
    assert!(!lib.data_dir.join(JOURNAL).exists(), "the journal is gone");
}

#[test]
fn the_older_library_moves_into_real_folders_as_it_was() {
    let lib = test_library("migrate-whole");
    older_library(&lib);
    let before = snapshot(&lib.legacy_dir);
    let old = legacy::read_only(&lib.legacy_dir).folders;
    assert!(run(&lib).unwrap());
    let at_ = &lib.default_location;
    assert_eq!(
        names_in(at_),
        vec!["Archive", "My Diagrams", "Payments 2", "payments"]
    );
    assert_eq!(
        names_in(&at_.join("Payments 2")),
        vec![
            "Flow 2.dosik",
            "Flow.dosik",
            "Sub-Folder",
            "a-b.dosik",
            "bad.dosik"
        ]
    );
    assert_eq!(
        names_in(&at_.join("Payments 2/Sub-Folder")),
        vec!["Deep.dosik"]
    );
    assert_eq!(
        names_in(&at_.join("Archive")),
        vec!["Untitled Diagram.dosik"]
    );
    assert_eq!(names_in(&at_.join("My Diagrams")), vec!["Stray.dosik"]);
    // the very bytes, and when they were written
    let pairs = [
        ("pay/flow.dosik.json", "Payments 2/Flow.dosik"),
        ("pay/flow2.dosik.json", "Payments 2/Flow 2.dosik"),
        ("pay/slash.dosik.json", "Payments 2/a-b.dosik"),
        (
            "pay/sub/deep.dosik.json",
            "Payments 2/Sub-Folder/Deep.dosik",
        ),
        ("arc/notitle.dosik.json", "Archive/Untitled Diagram.dosik"),
        ("pay/bad.dosik.json", "Payments 2/bad.dosik"),
        ("stray1.dosik.json", "My Diagrams/Stray.dosik"),
    ];
    for (from, to) in pairs {
        let (bytes, time) = &before[from];
        let new = at_.join(to);
        assert_eq!(&std::fs::read(&new).unwrap(), bytes, "{to}");
        assert_eq!(
            &std::fs::metadata(&new).unwrap().modified().unwrap(),
            time,
            "{to}"
        );
    }
    // the app looks as it did: ids, orders, the projects' order, boards
    let listed = list(&lib).unwrap();
    same_tree(&old, &listed);
    let names = titles_by_id(&listed);
    assert_eq!(names["pay"], "Payments 2");
    assert_eq!(names["pay2"], "payments");
    assert_eq!(names["sub"], "Sub-Folder");
    assert_eq!(names["flow2"], "Flow 2");
    assert_eq!(names["bad"], "bad");
    assert_eq!(names["stray1"], "Stray");
    assert!(listed.iter().all(|p| !p.added && !p.missing));
    // the older library: as it was, one marker more
    let mut after = snapshot(&lib.legacy_dir);
    let (marker, _) = after.remove(MARKER).expect("the marker");
    assert_eq!(String::from_utf8(marker).unwrap(), at_.to_string_lossy());
    assert_eq!(after, before);
    let st = record(&lib);
    let migration = st.migration.expect("the record says so");
    assert_eq!(Path::new(&migration.to), at_.as_path());
    assert_eq!(Path::new(&migration.from), lib.legacy_dir.as_path());
    no_leftovers(&lib);
}

#[test]
fn it_moves_once() {
    let lib = test_library("migrate-once");
    older_library(&lib);
    assert!(run(&lib).unwrap());
    let listed = list(&lib).unwrap();
    assert!(!run(&lib).unwrap());
    // the record lost: the marker still says it is done
    std::fs::remove_file(lib.data_dir.join(state::STATE_FILE)).unwrap();
    assert!(!run(&lib).unwrap());
    // a record that cannot be read is put aside — and nothing is moved again
    std::fs::write(lib.data_dir.join(state::STATE_FILE), "{broken").unwrap();
    assert!(!run(&lib).unwrap());
    assert_eq!(names_in(&lib.default_location).len(), listed.len());
}

#[test]
fn with_nothing_to_move_nothing_is_made() {
    let lib = test_library("migrate-nothing");
    assert!(!run(&lib).unwrap());
    std::fs::create_dir_all(&lib.legacy_dir).unwrap();
    assert!(!run(&lib).unwrap());
    assert!(!lib.default_location.exists());
    assert!(!lib.data_dir.join(JOURNAL).exists());
    assert!(!lib.legacy_dir.join(MARKER).exists());
}

#[test]
fn a_default_location_already_there_keeps_what_is_in_it() {
    let lib = test_library("migrate-each");
    older_library(&lib);
    let mine = lib.default_location.join("Archive");
    std::fs::create_dir_all(&mine).unwrap();
    std::fs::write(mine.join("notes.txt"), "mine").unwrap();
    let old = legacy::read_only(&lib.legacy_dir).folders;
    assert!(run(&lib).unwrap());
    assert_eq!(
        names_in(&lib.default_location),
        vec![
            "Archive",
            "Archive 2",
            "My Diagrams",
            "Payments 2",
            "payments"
        ]
    );
    assert_eq!(names_in(&mine), vec!["notes.txt"]);
    let listed = list(&lib).unwrap();
    // the moved projects in their order; the folder that was there comes in by name
    let theirs = listed.iter().position(|p| p.name == "Archive").unwrap();
    let mut moved = listed.clone();
    moved.remove(theirs);
    same_tree(&old, &moved);
    assert_eq!(titles_by_id(&listed)["arc"], "Archive 2");
    no_leftovers(&lib);
}

#[test]
fn a_folder_id_a_diagram_has_too_gives_way() {
    let lib = test_library("migrate-ids");
    put(
        &lib.legacy_dir.join("same/folder.json"),
        r#"{"name":"Project"}"#,
    );
    put(
        &lib.legacy_dir.join("other/folder.json"),
        r#"{"name":"Other"}"#,
    );
    put(&lib.legacy_dir.join("other/same.dosik.json"), &doc("Flow"));
    assert!(run(&lib).unwrap());
    let listed = list(&lib).unwrap();
    let project = listed.iter().find(|p| p.name == "Project").unwrap();
    assert_ne!(project.id, "same");
    let other = listed.iter().find(|p| p.name == "Other").unwrap();
    assert_eq!(other.diagrams[0].id, "same");
}

/// what is left of a failed run in either mode: nothing it made
fn taken_back(
    lib: &Library,
    before: &BTreeMap<String, (Vec<u8>, SystemTime)>,
    mine: Option<&Path>,
) {
    match mine {
        None => assert!(!lib.default_location.exists(), "no default location made"),
        Some(mine) => assert_eq!(
            names_in(&lib.default_location),
            vec![mine.file_name().unwrap().to_string_lossy().into_owned()]
        ),
    }
    assert_eq!(
        &snapshot(&lib.legacy_dir),
        before,
        "the older library untouched"
    );
    assert!(record(&lib).migration.is_none());
    assert!(record(&lib).projects.is_empty());
    no_leftovers(lib);
}

#[test]
fn a_failure_takes_back_everything_and_the_next_run_moves_it() {
    for each in [false, true] {
        for point in ["journal", "build", "moving", "move", "state"] {
            let lib = test_library("migrate-fail");
            older_library(&lib);
            let mine = each.then(|| {
                let mine = lib.default_location.join("Mine");
                std::fs::create_dir_all(&mine).unwrap();
                mine
            });
            let before = snapshot(&lib.legacy_dir);
            FAIL_AT.with(|f| f.set(Some((point, Inject::Fail))));
            let error = run(&lib).unwrap_err();
            assert!(error.contains(point), "{point}: {error}");
            taken_back(&lib, &before, mine.as_deref());
            assert!(run(&lib).unwrap(), "{point}: the next run moves it");
            assert_eq!(list(&lib).unwrap().len(), 4 + usize::from(each), "{point}");
            no_leftovers(&lib);
        }
    }
}

#[test]
fn a_marker_that_cannot_be_written_waits_for_the_next_start() {
    let lib = test_library("migrate-marker");
    older_library(&lib);
    FAIL_AT.with(|f| f.set(Some(("marker", Inject::Fail))));
    assert!(run(&lib).unwrap(), "the move stands");
    assert!(record(&lib).migration.is_some());
    assert!(!lib.legacy_dir.join(MARKER).exists());
    assert!(lib.data_dir.join(JOURNAL).exists());
    assert!(!run(&lib).unwrap());
    assert!(lib.legacy_dir.join(MARKER).exists());
    assert_eq!(list(&lib).unwrap().len(), 4);
    no_leftovers(&lib);
}

#[test]
fn a_run_cut_short_is_taken_back_or_finished_never_doubled() {
    for each in [false, true] {
        for point in ["journal", "build", "moving", "move", "state", "marker"] {
            let lib = test_library("migrate-crash");
            older_library(&lib);
            if each {
                std::fs::create_dir_all(lib.default_location.join("Mine")).unwrap();
            }
            FAIL_AT.with(|f| f.set(Some((point, Inject::Crash))));
            assert!(run(&lib).is_err(), "{point}");
            assert!(
                lib.data_dir.join(JOURNAL).exists(),
                "{point}: the journal stays"
            );
            // the next start takes it back and moves it again — or finishes it
            let moved_now = run(&lib).unwrap();
            assert_eq!(moved_now, !matches!(point, "state" | "marker"), "{point}");
            let listed = list(&lib).unwrap();
            assert_eq!(
                listed.len(),
                4 + usize::from(each),
                "{point}: {:?}",
                listed.iter().map(|p| &p.name).collect::<Vec<_>>()
            );
            let mut names = names_in(&lib.default_location);
            names.retain(|n| n != "Mine");
            assert_eq!(
                names,
                vec!["Archive", "My Diagrams", "Payments 2", "payments"],
                "{point}"
            );
            assert!(lib.legacy_dir.join(MARKER).exists(), "{point}");
            assert!(!run(&lib).unwrap(), "{point}: once");
            no_leftovers(&lib);
        }
    }
}
