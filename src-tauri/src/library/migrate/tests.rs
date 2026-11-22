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
    assert_eq!(
        old.diagrams
            .iter()
            .map(|d| d.id.clone())
            .collect::<Vec<_>>(),
        new.diagrams
            .iter()
            .map(|d| d.id.clone())
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
    let default = lib.default_location();
    let parent = default.parent().unwrap();
    if parent.exists() {
        for name in names_in(parent) {
            assert!(
                !name.contains("migrating"),
                "{name} left in {}",
                parent.display()
            );
        }
    }
    if lib.default_location().exists() {
        for name in names_in(&lib.default_location()) {
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
    assert!(run(&lib).unwrap().is_some());
    let at_ = &lib.default_location();
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
    // what could not be opened before still cannot, and the rest can
    let pay = listed.iter().find(|p| p.id == "pay").unwrap();
    for d in &pay.diagrams {
        assert_eq!(d.readable, d.id != "bad", "{}", d.id);
    }
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
    assert!(run(&lib).unwrap().is_some());
    let listed = list(&lib).unwrap();
    assert!(run(&lib).unwrap().is_none());
    // the record lost: the marker still says it is done
    std::fs::remove_file(lib.data_dir.join(state::STATE_FILE)).unwrap();
    assert!(run(&lib).unwrap().is_none());
    // a record that cannot be read is put aside — and nothing is moved again
    std::fs::write(lib.data_dir.join(state::STATE_FILE), "{broken").unwrap();
    assert!(run(&lib).unwrap().is_none());
    assert_eq!(names_in(&lib.default_location()).len(), listed.len());
}

#[test]
fn with_nothing_to_move_nothing_is_made() {
    let lib = test_library("migrate-nothing");
    assert!(run(&lib).unwrap().is_none());
    std::fs::create_dir_all(&lib.legacy_dir).unwrap();
    assert!(run(&lib).unwrap().is_none());
    assert!(!lib.default_location().exists());
    assert!(!lib.data_dir.join(JOURNAL).exists());
    assert!(!lib.legacy_dir.join(MARKER).exists());
}

#[test]
fn a_default_location_already_there_keeps_what_is_in_it() {
    let lib = test_library("migrate-each");
    older_library(&lib);
    let mine = lib.default_location().join("Archive");
    std::fs::create_dir_all(&mine).unwrap();
    std::fs::write(mine.join("notes.txt"), "mine").unwrap();
    let old = legacy::read_only(&lib.legacy_dir).folders;
    assert!(run(&lib).unwrap().is_some());
    assert_eq!(
        names_in(&lib.default_location()),
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
    assert!(run(&lib).unwrap().is_some());
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
        None => assert!(!lib.default_location().exists(), "no default location made"),
        Some(mine) => assert_eq!(
            names_in(&lib.default_location()),
            vec![mine.file_name().unwrap().to_string_lossy().into_owned()]
        ),
    }
    assert_eq!(
        &snapshot(&lib.legacy_dir),
        before,
        "the older library untouched"
    );
    assert!(record(lib).migration.is_none());
    assert!(record(lib).projects.is_empty());
    no_leftovers(lib);
}

#[test]
fn a_failure_takes_back_everything_and_the_next_run_moves_it() {
    for each in [false, true] {
        for point in ["journal", "build", "moving", "move", "state"] {
            let lib = test_library("migrate-fail");
            older_library(&lib);
            let mine = each.then(|| {
                let mine = lib.default_location().join("Mine");
                std::fs::create_dir_all(&mine).unwrap();
                mine
            });
            let before = snapshot(&lib.legacy_dir);
            fail_at(&[(point, Inject::Fail)]);
            let error = run(&lib).unwrap_err();
            assert!(error.contains(point), "{point}: {error}");
            taken_back(&lib, &before, mine.as_deref());
            assert!(
                run(&lib).unwrap().is_some(),
                "{point}: the next run moves it"
            );
            assert_eq!(list(&lib).unwrap().len(), 4 + usize::from(each), "{point}");
            no_leftovers(&lib);
        }
    }
}

#[test]
fn a_marker_that_cannot_be_written_waits_for_the_next_start() {
    let lib = test_library("migrate-marker");
    older_library(&lib);
    fail_at(&[("marker", Inject::Fail)]);
    assert!(run(&lib).unwrap().is_some(), "the move stands");
    assert!(record(&lib).migration.is_some());
    assert!(!lib.legacy_dir.join(MARKER).exists());
    assert!(lib.data_dir.join(JOURNAL).exists());
    assert!(run(&lib).unwrap().is_none());
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
                std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
            }
            fail_at(&[(point, Inject::Crash)]);
            assert!(run(&lib).is_err(), "{point}");
            assert!(
                lib.data_dir.join(JOURNAL).exists(),
                "{point}: the journal stays"
            );
            // the next start takes it back and moves it again — or, once it
            // was building no more, finishes it
            let moved_now = run(&lib).unwrap().is_some();
            assert_eq!(moved_now, point != "marker", "{point}");
            let listed = list(&lib).unwrap();
            assert_eq!(
                listed.len(),
                4 + usize::from(each),
                "{point}: {:?}",
                listed.iter().map(|p| &p.name).collect::<Vec<_>>()
            );
            let mut names = names_in(&lib.default_location());
            names.retain(|n| n != "Mine");
            assert_eq!(
                names,
                vec!["Archive", "My Diagrams", "Payments 2", "payments"],
                "{point}"
            );
            assert!(lib.legacy_dir.join(MARKER).exists(), "{point}");
            assert!(run(&lib).unwrap().is_none(), "{point}: once");
            no_leftovers(&lib);
        }
    }
}

#[test]
fn a_run_cut_short_once_moving_is_finished_and_what_came_since_stays() {
    for each in [false, true] {
        let lib = test_library("migrate-forward");
        older_library(&lib);
        if each {
            std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
        }
        fail_at(&[("move", Inject::Crash)]);
        assert!(run(&lib).is_err());
        // while the app was away: a file put in a moved project, a project
        // made beside them (the MCP server works without the app)
        put(&lib.default_location().join("Archive/notes.txt"), "mine");
        put(&lib.default_location().join("New/Plan.dosik"), &doc("Plan"));
        assert!(run(&lib).unwrap().is_some(), "finished now");
        assert_eq!(
            std::fs::read_to_string(lib.default_location().join("Archive/notes.txt")).unwrap(),
            "mine"
        );
        assert!(lib.default_location().join("New/Plan.dosik").is_file());
        let listed = list(&lib).unwrap();
        let mut names: Vec<&str> = listed.iter().map(|p| p.name.as_str()).collect();
        names.sort_unstable();
        let mut want = vec!["Archive", "My Diagrams", "New", "Payments 2", "payments"];
        if each {
            want.push("Mine");
        }
        want.sort_unstable();
        assert_eq!(names, want, "{each}");
        assert_eq!(titles_by_id(&listed)["arc"], "Archive");
        no_leftovers(&lib);
    }
}

#[test]
fn taking_back_removes_only_what_the_run_made() {
    let lib = test_library("migrate-only-ours");
    older_library(&lib);
    fail_at(&[("build", Inject::Crash)]);
    assert!(run(&lib).is_err());
    // something the run did not make, in the folder it builds in
    let mut journal: Journal =
        serde_json::from_str(&std::fs::read_to_string(lib.data_dir.join(JOURNAL)).unwrap())
            .unwrap();
    let staging = PathBuf::from(&journal.staging);
    let first = staging.join(&journal.names[0]);
    put(&first.join("not mine.txt"), "kept");
    assert!(take_back(&lib, &mut journal).is_ok());
    // what it made is gone; what it did not make is left as it was
    assert_eq!(names_in(&staging), vec![journal.names[0].clone()]);
    assert_eq!(names_in(&first), vec!["not mine.txt"]);
    assert!(!lib.data_dir.join(JOURNAL).exists());
}

#[cfg(unix)]
#[test]
fn a_diagram_that_cannot_be_read_stays_behind_and_is_counted() {
    use std::os::unix::fs::PermissionsExt;
    let lib = test_library("migrate-left");
    older_library(&lib);
    let flow = lib.legacy_dir.join("pay/flow.dosik.json");
    let mode = |m| std::fs::set_permissions(&flow, std::fs::Permissions::from_mode(m)).unwrap();
    mode(0o000);
    if std::fs::read(&flow).is_ok() {
        mode(0o644);
        eprintln!("{}: still readable; left out", flow.display());
        return;
    }
    let moved = run(&lib);
    mode(0o644);
    // the move goes on without it, and says how many it left behind
    assert_eq!(moved.unwrap(), Some(1));
    let listed = list(&lib).unwrap();
    assert!(!titles_by_id(&listed).contains_key("flow"));
    assert!(flow.is_file(), "it stays in the older library");
}

/// the stage the journal says the run got to
fn journal_stage(lib: &Library) -> Stage {
    let text = std::fs::read_to_string(lib.data_dir.join(JOURNAL)).unwrap();
    serde_json::from_str::<Journal>(&text).unwrap().stage
}

#[test]
fn a_taking_back_cut_short_is_taken_back_on_the_next_start_never_finished() {
    for each in [false, true] {
        for point in ["unmove", "unbuild"] {
            let lib = test_library("migrate-take-back-cut");
            older_library(&lib);
            if each {
                std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
            }
            // placed, then the record cannot be written; the app stops while
            // what was made is being taken back
            fail_at(&[("state", Inject::Fail), (point, Inject::Crash)]);
            assert!(run(&lib).is_err(), "{point}");
            assert_eq!(journal_stage(&lib), Stage::TakingBack, "{point}");
            // the next start takes back the rest and moves it again, whole
            assert!(run(&lib).unwrap().is_some(), "{point}");
            let mut names = names_in(&lib.default_location());
            names.retain(|n| n != "Mine");
            assert_eq!(
                names,
                vec!["Archive", "My Diagrams", "Payments 2", "payments"],
                "{point}"
            );
            let listed = list(&lib).unwrap();
            assert_eq!(listed.len(), 4 + usize::from(each), "{point}");
            assert!(titles_by_id(&listed).contains_key("deep"), "{point}");
            no_leftovers(&lib);
        }
    }
}

#[test]
fn a_taking_back_that_fails_is_tried_again_never_finished() {
    for each in [false, true] {
        let lib = test_library("migrate-take-back-fails");
        older_library(&lib);
        if each {
            std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
        }
        let before = snapshot(&lib.legacy_dir);
        // placed, the record cannot be written, and a rename back fails too
        fail_at(&[("state", Inject::Fail), ("unmove", Inject::Fail)]);
        assert!(run(&lib).is_err());
        assert_eq!(journal_stage(&lib), Stage::TakingBack);
        assert!(record(&lib).migration.is_none());
        assert!(!lib.legacy_dir.join(MARKER).exists());
        // the next start takes it back — it does not put the half-moved
        // library on record — and moves it again
        assert!(run(&lib).unwrap().is_some());
        assert_eq!(list(&lib).unwrap().len(), 4 + usize::from(each));
        let mut after = snapshot(&lib.legacy_dir);
        after.remove(MARKER);
        assert_eq!(after, before);
        no_leftovers(&lib);
    }
}

#[test]
fn a_folder_there_in_another_normal_form_is_a_clash_and_the_project_takes_the_next_name() {
    let lib = test_library("migrate-nfd-project");
    // "Café", composed in the older library, decomposed as Finder made it
    put(
        &lib.legacy_dir.join("cafe/folder.json"),
        r#"{"name":"Café","createdAt":1}"#,
    );
    put(&lib.legacy_dir.join("cafe/menu.dosik.json"), &doc("Menu"));
    let theirs = lib.default_location().join("Cafe\u{301}");
    std::fs::create_dir_all(&theirs).unwrap();
    std::fs::write(theirs.join("notes.txt"), "mine").unwrap();
    assert!(run(&lib).unwrap().is_some());
    let moved = lib.default_location().join("Caf\u{e9} 2");
    assert!(moved.join("Menu.dosik").is_file());
    assert_eq!(
        std::fs::read_to_string(theirs.join("notes.txt")).unwrap(),
        "mine"
    );
    let listed = list(&lib).unwrap();
    assert_eq!(titles_by_id(&listed)["cafe"], "Caf\u{e9} 2");
    no_leftovers(&lib);
}

#[test]
fn two_titles_in_two_normal_forms_are_two_files() {
    let lib = test_library("migrate-nfd-titles");
    put(
        &lib.legacy_dir.join("p/folder.json"),
        r#"{"name":"P","createdAt":1,"order":["diagram:a","diagram:b"]}"#,
    );
    put(&lib.legacy_dir.join("p/a.dosik.json"), &doc("Caf\u{e9}"));
    put(&lib.legacy_dir.join("p/b.dosik.json"), &doc("Cafe\u{301}"));
    assert!(run(&lib).unwrap().is_some());
    let listed = list(&lib).unwrap();
    let names = titles_by_id(&listed);
    assert_eq!(names["a"], "Caf\u{e9}");
    assert_eq!(names["b"], "Cafe\u{301} 2");
    // each its own bytes: neither copy took the other's place
    let p = lib.default_location().join("P");
    assert_eq!(
        std::fs::read_to_string(p.join("Cafe\u{301} 2.dosik")).unwrap(),
        doc("Cafe\u{301}")
    );
    assert_eq!(
        std::fs::read_to_string(p.join("Caf\u{e9}.dosik")).unwrap(),
        doc("Caf\u{e9}")
    );
}

#[test]
fn a_copy_is_never_put_over_another() {
    let base = crate::library::disk::tests::scratch("migrate-build-new");
    let one = base.join("one.json");
    std::fs::write(&one, "first").unwrap();
    let mut project = Planned {
        record: ProjectRecord::new("p", &base.join("P")).unwrap(),
        name: "P".into(),
        wanted: "P".into(),
        dirs: Vec::new(),
        files: vec![("Flow.dosik".into(), one)],
        times: Vec::new(),
    };
    project.record.ids.insert("Flow.dosik".into(), "d".into());
    let staging = base.join("staging");
    std::fs::create_dir(&staging).unwrap();
    // something there already by the name: left, and the copy takes the next
    MID_BUILD.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(|dest: &Path| {
            std::fs::write(dest, "theirs").unwrap()
        }))
    });
    build(&staging, &mut project).unwrap();
    assert_eq!(
        std::fs::read_to_string(staging.join("P/Flow.dosik")).unwrap(),
        "theirs"
    );
    assert_eq!(
        std::fs::read_to_string(staging.join("P/Flow 2.dosik")).unwrap(),
        "first"
    );
    assert_eq!(project.files[0].0, "Flow 2.dosik");
    assert_eq!(
        project.record.ids.get("Flow 2.dosik"),
        Some(&"d".to_string())
    );
    assert_eq!(
        names_in(&staging.join("P")),
        vec!["Flow 2.dosik", "Flow.dosik"],
        "no temp left"
    );
}

#[test]
fn a_folder_made_where_a_project_goes_meanwhile_is_left_and_the_next_name_taken() {
    let lib = test_library("migrate-made-meanwhile");
    older_library(&lib);
    std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
    MID_PLACE.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(|to: &Path| {
            std::fs::create_dir_all(to).unwrap();
            std::fs::write(to.join("theirs.txt"), "theirs").unwrap();
        }))
    });
    assert!(run(&lib).unwrap().is_some());
    let mut names = names_in(&lib.default_location());
    names.retain(|n| n != "Mine");
    // the first project's first name went to the folder made meanwhile
    assert_eq!(
        names,
        vec![
            "Archive",
            "Archive 2",
            "My Diagrams",
            "Payments 2",
            "payments"
        ]
    );
    assert_eq!(
        std::fs::read_to_string(lib.default_location().join("Archive/theirs.txt")).unwrap(),
        "theirs"
    );
    let listed = list(&lib).unwrap();
    assert_eq!(titles_by_id(&listed)["arc"], "Archive 2");
    no_leftovers(&lib);
}

#[test]
fn a_run_cut_short_twice_finds_where_each_project_last_went() {
    let lib = test_library("migrate-twice");
    older_library(&lib);
    std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
    // cut short as the first project was about to go to "Archive"
    fail_at(&[("placing", Inject::Crash)]);
    assert!(run(&lib).is_err());
    // meanwhile a folder of that name is made; the next start puts the
    // project beside it, and is cut short again
    let theirs = lib.default_location().join("Archive");
    put(&theirs.join("notes.txt"), "mine");
    fail_at(&[("move", Inject::Crash)]);
    assert!(run(&lib).is_err());
    assert!(run(&lib).unwrap().is_some());
    let listed = list(&lib).unwrap();
    assert_eq!(titles_by_id(&listed)["arc"], "Archive 2");
    let arc = listed.iter().find(|p| p.id == "arc").unwrap();
    assert_eq!(arc.diagrams.len(), 1);
    assert_eq!(names_in(&theirs), vec!["notes.txt"]);
    no_leftovers(&lib);
}

#[test]
fn a_staging_folder_that_will_not_go_leaves_the_move_standing() {
    let lib = test_library("migrate-staging-stays");
    older_library(&lib);
    std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
    // the system drops a file of its own into the folder the copy is built in
    MID_PLACE.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(|to: &Path| {
            let default = to.parent().unwrap();
            let staging = names_in(default)
                .into_iter()
                .find(|n| n.contains("migrating"))
                .unwrap();
            std::fs::write(default.join(staging).join(".DS_Store"), "x").unwrap();
        }))
    });
    assert!(run(&lib).unwrap().is_some(), "the move stands");
    assert!(record(&lib).migration.is_some());
    assert!(lib.legacy_dir.join(MARKER).exists());
    assert_eq!(list(&lib).unwrap().len(), 5);
}

#[cfg(unix)]
#[test]
fn a_folder_of_the_older_library_that_cannot_be_read_stays_behind_and_is_counted() {
    use std::os::unix::fs::PermissionsExt;
    let lib = test_library("migrate-folder-left");
    older_library(&lib);
    let sub = lib.legacy_dir.join("pay/sub");
    let mode = |m| std::fs::set_permissions(&sub, std::fs::Permissions::from_mode(m)).unwrap();
    mode(0o000);
    if std::fs::read_dir(&sub).is_ok() {
        mode(0o755);
        eprintln!("{}: still readable; left out", sub.display());
        return;
    }
    let moved = run(&lib);
    mode(0o755);
    // not made as an empty folder: left where it is, and counted
    assert_eq!(moved.unwrap(), Some(1));
    let listed = list(&lib).unwrap();
    assert!(!titles_by_id(&listed).contains_key("sub"));
    assert!(!lib
        .default_location()
        .join("Payments 2/Sub-Folder")
        .exists());
    assert!(
        sub.join("deep.dosik.json").is_file(),
        "it stays in the older library"
    );
}

// a file named so cannot be made on Windows at all
#[cfg(not(windows))]
#[test]
fn a_diagram_that_is_no_json_is_named_by_its_id_cleaned() {
    let lib = test_library("migrate-no-json-name");
    put(
        &lib.legacy_dir.join("p/folder.json"),
        r#"{"name":"P","createdAt":1,"order":["diagram:con"]}"#,
    );
    put(&lib.legacy_dir.join("p/con.dosik.json"), "{not json");
    assert!(run(&lib).unwrap().is_some());
    assert_eq!(
        names_in(&lib.default_location().join("P")),
        vec!["con-.dosik"]
    );
}

#[test]
fn a_run_cut_short_whose_journal_cannot_be_read_doubles_nothing() {
    // cut short while moving (some projects in place, the rest still built
    // aside) and once placed (all in place, nothing on record)
    for point in ["move", "state"] {
        let lib = test_library("migrate-journal-broken");
        older_library(&lib);
        std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
        let old = legacy::read_only(&lib.legacy_dir).folders;
        fail_at(&[(point, Inject::Crash)]);
        assert!(run(&lib).is_err(), "{point}");
        std::fs::write(lib.data_dir.join(JOURNAL), "{broken").unwrap();
        assert!(run(&lib).unwrap().is_some(), "{point}");
        let mut names = names_in(&lib.default_location());
        names.retain(|n| n != "Mine");
        assert_eq!(
            names,
            vec!["Archive", "My Diagrams", "Payments 2", "payments"],
            "{point}: no project twice"
        );
        // found whole where they were put: their ids, orders and places kept
        let mut listed = list(&lib).unwrap();
        listed.retain(|p| p.name != "Mine");
        same_tree(&old, &listed);
        assert!(lib.legacy_dir.join(MARKER).exists(), "{point}");
        no_leftovers(&lib);
    }
}

#[test]
fn a_folder_that_only_shares_a_projects_name_is_not_taken_for_its_copy() {
    let lib = test_library("migrate-journal-broken-theirs");
    older_library(&lib);
    // the user's own Archive, not what the move made
    let theirs = lib.default_location().join("Archive");
    put(&theirs.join("notes.txt"), "mine");
    std::fs::create_dir_all(&lib.data_dir).unwrap();
    std::fs::write(lib.data_dir.join(JOURNAL), "{broken").unwrap();
    assert!(run(&lib).unwrap().is_some());
    let listed = list(&lib).unwrap();
    assert_eq!(titles_by_id(&listed)["arc"], "Archive 2");
    assert_eq!(names_in(&theirs), vec!["notes.txt"]);
}

#[test]
fn a_folder_made_where_a_project_went_is_never_taken_back() {
    let lib = test_library("migrate-back-theirs");
    older_library(&lib);
    std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
    // the user's Archive turns up as the move is about to put one there —
    // with a diagram called as the move's would be
    let theirs = lib.default_location().join("Archive");
    MID_PLACE.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(|to: &Path| {
            std::fs::create_dir_all(to).unwrap();
            std::fs::write(to.join("Untitled Diagram.dosik"), "theirs").unwrap();
        }))
    });
    // placed, the record cannot be written, and a rename back fails
    fail_at(&[("state", Inject::Fail), ("unmove", Inject::Fail)]);
    assert!(run(&lib).is_err());
    assert_eq!(journal_stage(&lib), Stage::TakingBack);
    // meanwhile the move's own Archive is moved away by the user
    std::fs::remove_dir_all(lib.default_location().join("Archive 2")).unwrap();
    assert!(run(&lib).unwrap().is_some());
    // theirs is where it was, as it was
    assert_eq!(
        std::fs::read_to_string(theirs.join("Untitled Diagram.dosik")).unwrap(),
        "theirs"
    );
    let listed = list(&lib).unwrap();
    assert_eq!(titles_by_id(&listed)["arc"], "Archive 2");
    no_leftovers(&lib);
}

#[test]
fn a_project_gone_while_the_move_is_taken_back_is_passed_over() {
    let lib = test_library("migrate-back-gone");
    older_library(&lib);
    std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
    put(&lib.default_location().join("Mine/notes.txt"), "mine");
    fail_at(&[("state", Inject::Fail), ("unmove", Inject::Fail)]);
    assert!(run(&lib).is_err());
    std::fs::remove_dir_all(lib.default_location().join("My Diagrams")).unwrap();
    // taken back as far as it can be, then moved again, whole
    assert!(run(&lib).unwrap().is_some());
    let mut names = names_in(&lib.default_location());
    names.retain(|n| n != "Mine");
    assert_eq!(
        names,
        vec!["Archive", "My Diagrams", "Payments 2", "payments"]
    );
    assert_eq!(
        names_in(&lib.default_location().join("Mine")),
        vec!["notes.txt"]
    );
    no_leftovers(&lib);
}

#[test]
fn what_changed_where_the_move_put_it_is_finished_never_taken_back() {
    for each in [false, true] {
        let lib = test_library("migrate-back-edited");
        older_library(&lib);
        if each {
            std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
        }
        fail_at(&[("state", Inject::Fail), ("unmove", Inject::Fail)]);
        assert!(run(&lib).is_err(), "{each}");
        // an agent edits a diagram the move put there, and makes a project
        // beside them
        let edited = lib
            .default_location()
            .join("Archive/Untitled Diagram.dosik");
        std::fs::write(&edited, doc("Edited")).unwrap();
        put(&lib.default_location().join("New/Plan.dosik"), &doc("Plan"));
        assert!(run(&lib).unwrap().is_some(), "{each}: finished now");
        assert_eq!(std::fs::read_to_string(&edited).unwrap(), doc("Edited"));
        assert!(lib.default_location().join("New/Plan.dosik").is_file());
        let listed = list(&lib).unwrap();
        let names = titles_by_id(&listed);
        assert_eq!(names["arc"], "Archive", "{each}");
        assert_eq!(names["notitle"], "Untitled Diagram", "{each}");
        assert!(lib.legacy_dir.join(MARKER).exists());
        no_leftovers(&lib);
    }
}

#[test]
fn a_move_finished_after_a_change_passes_over_a_project_gone_since() {
    let lib = test_library("migrate-finish-gone");
    older_library(&lib);
    std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
    fail_at(&[("state", Inject::Fail), ("unmove", Inject::Fail)]);
    assert!(run(&lib).is_err());
    std::fs::write(
        lib.default_location()
            .join("Archive/Untitled Diagram.dosik"),
        doc("Edited"),
    )
    .unwrap();
    std::fs::remove_dir_all(lib.default_location().join("My Diagrams")).unwrap();
    // finished, not stuck on what is gone
    assert!(run(&lib).unwrap().is_some());
    let listed = list(&lib).unwrap();
    let mut names: Vec<&str> = listed.iter().map(|p| p.name.as_str()).collect();
    names.sort_unstable();
    assert_eq!(names, vec!["Archive", "Mine", "Payments 2", "payments"]);
    no_leftovers(&lib);
}

#[test]
fn a_rename_made_before_the_journal_could_say_so_is_finished() {
    // cut short between a rename and its mark: the next start finishes it
    for (point, each) in [("renamed", true), ("move", true), ("renamed", false)] {
        let lib = test_library("migrate-renamed-unmarked");
        older_library(&lib);
        if each {
            std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
        }
        fail_at(&[(point, Inject::Crash)]);
        assert!(run(&lib).is_err(), "{point}");
        assert!(run(&lib).unwrap().is_some(), "{point}");
        let mut names = names_in(&lib.default_location());
        names.retain(|n| n != "Mine");
        assert_eq!(
            names,
            vec!["Archive", "My Diagrams", "Payments 2", "payments"],
            "{point}"
        );
        no_leftovers(&lib);
    }
}

#[test]
fn an_empty_project_is_found_whole_only_in_an_empty_folder() {
    let lib = test_library("migrate-adopt-empty");
    older_library(&lib);
    // the user's own "payments", as named as the older library's empty project
    let theirs = lib.default_location().join("payments");
    put(&theirs.join("notes.txt"), "mine");
    std::fs::create_dir_all(&lib.data_dir).unwrap();
    std::fs::write(lib.data_dir.join(JOURNAL), "{broken").unwrap();
    assert!(run(&lib).unwrap().is_some());
    let listed = list(&lib).unwrap();
    let pay2 = listed.iter().find(|p| p.id == "pay2").unwrap();
    assert_ne!(pay2.path.as_deref(), Some(theirs.to_str().unwrap()));
    assert_eq!(names_in(&theirs), vec!["notes.txt"]);
}

#[test]
fn a_whole_move_cut_short_whose_journal_cannot_be_read_doubles_nothing() {
    // no library folder yet: the copy was being built beside where it goes
    let lib = test_library("migrate-adopt-whole");
    older_library(&lib);
    let old = legacy::read_only(&lib.legacy_dir).folders;
    fail_at(&[("build", Inject::Crash)]);
    assert!(run(&lib).is_err());
    std::fs::write(lib.data_dir.join(JOURNAL), "{broken").unwrap();
    assert!(run(&lib).unwrap().is_some());
    assert_eq!(
        names_in(&lib.default_location()),
        vec!["Archive", "My Diagrams", "Payments 2", "payments"]
    );
    same_tree(&old, &list(&lib).unwrap());
    no_leftovers(&lib);
}

#[test]
fn looking_for_what_a_move_made_cut_short_doubles_nothing() {
    let lib = test_library("migrate-adopt-cut");
    older_library(&lib);
    std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
    let old = legacy::read_only(&lib.legacy_dir).folders;
    fail_at(&[("move", Inject::Crash)]);
    assert!(run(&lib).is_err());
    std::fs::write(lib.data_dir.join(JOURNAL), "{broken").unwrap();
    // cut short again while the projects found are put on record
    fail_at(&[("adopting", Inject::Crash)]);
    assert!(run(&lib).is_err());
    assert!(run(&lib).unwrap().is_some());
    let mut names = names_in(&lib.default_location());
    names.retain(|n| n != "Mine");
    assert_eq!(
        names,
        vec!["Archive", "My Diagrams", "Payments 2", "payments"]
    );
    let mut listed = list(&lib).unwrap();
    listed.retain(|p| p.name != "Mine");
    same_tree(&old, &listed);
    no_leftovers(&lib);
}

#[test]
fn a_copy_whose_name_turns_out_taken_takes_the_next() {
    let lib = test_library("migrate-build-taken");
    older_library(&lib);
    // the disk takes the first copy's name as taken — by its own rules
    MID_BUILD.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(|dest: &Path| std::fs::write(dest, "x").unwrap()))
    });
    assert!(run(&lib).unwrap().is_some());
    let listed = list(&lib).unwrap();
    assert_eq!(titles_by_id(&listed)["notitle"], "Untitled Diagram 2");
    assert_eq!(
        std::fs::read_to_string(
            lib.default_location()
                .join("Archive/Untitled Diagram 2.dosik")
        )
        .unwrap(),
        r#"{"nodes":[],"edges":[]}"#
    );
    no_leftovers(&lib);
}

#[cfg(target_os = "macos")]
#[test]
fn what_is_built_is_recorded_by_the_names_the_disk_stores() {
    let base = crate::library::disk::tests::scratch("migrate-stored-names");
    let root = base.join("P");
    // stored decomposed, as a disk that decomposes names hands them back
    std::fs::create_dir_all(root.join("Sub-Cafe\u{301}")).unwrap();
    std::fs::write(root.join("Sub-Cafe\u{301}/Cafe\u{301}.dosik"), "x").unwrap();
    let mut project = Planned {
        record: ProjectRecord::new("p", &root).unwrap(),
        name: "P".into(),
        wanted: "P".into(),
        dirs: vec!["Sub-Caf\u{e9}".into()],
        files: vec![("Sub-Caf\u{e9}/Caf\u{e9}.dosik".into(), base.join("source"))],
        times: Vec::new(),
    };
    project
        .record
        .ids
        .insert("Sub-Caf\u{e9}".into(), "f".into());
    project
        .record
        .ids
        .insert("Sub-Caf\u{e9}/Caf\u{e9}.dosik".into(), "d".into());
    project
        .record
        .order
        .insert(String::new(), vec!["Sub-Caf\u{e9}".into()]);
    project
        .record
        .order
        .insert("Sub-Caf\u{e9}".into(), vec!["Caf\u{e9}.dosik".into()]);
    project.take_stored_names(&root);
    let keys: Vec<&String> = project.record.ids.keys().collect();
    assert_eq!(
        keys,
        vec!["Sub-Cafe\u{301}", "Sub-Cafe\u{301}/Cafe\u{301}.dosik"]
    );
    assert_eq!(project.record.order[""], vec!["Sub-Cafe\u{301}"]);
    assert_eq!(
        project.record.order["Sub-Cafe\u{301}"],
        vec!["Cafe\u{301}.dosik"]
    );
    assert_eq!(project.dirs, vec!["Sub-Cafe\u{301}"]);
    assert_eq!(project.files[0].0, "Sub-Cafe\u{301}/Cafe\u{301}.dosik");
}

#[test]
fn a_move_taken_back_whole_but_for_its_journal_is_never_finished_on_what_came_since() {
    for each in [false, true] {
        let lib = test_library("migrate-back-unjournaled");
        older_library(&lib);
        if each {
            std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
        }
        // placed, the record cannot be written, all of it taken back — and
        // the app stops before the journal goes
        fail_at(&[("state", Inject::Fail), ("unjournal", Inject::Crash)]);
        assert!(run(&lib).is_err(), "{each}");
        assert!(lib.data_dir.join(JOURNAL).exists(), "{each}");
        // meanwhile an agent makes folders where the move had put projects
        put(&lib.default_location().join("Archive/theirs.txt"), "theirs");
        put(&lib.default_location().join("New/Plan.dosik"), &doc("Plan"));
        // the next start moves it again: nothing of theirs taken for the move's
        assert!(run(&lib).unwrap().is_some(), "{each}");
        let listed = list(&lib).unwrap();
        let names = titles_by_id(&listed);
        assert_eq!(names["arc"], "Archive 2", "{each}");
        assert_eq!(names["notitle"], "Untitled Diagram", "{each}");
        assert!(names.contains_key("deep"), "{each}");
        assert_eq!(
            names_in(&lib.default_location().join("Archive")),
            vec!["theirs.txt"],
            "{each}"
        );
        no_leftovers(&lib);
    }
}

/// the journal as the last run left it
fn journal_of(lib: &Library) -> Journal {
    serde_json::from_str(&std::fs::read_to_string(lib.data_dir.join(JOURNAL)).unwrap()).unwrap()
}

#[test]
fn a_project_renamed_unmarked_and_removed_since_does_not_stop_the_move() {
    let lib = test_library("migrate-unmarked-removed");
    older_library(&lib);
    std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
    // cut short between the first rename and its mark; the user removes
    // what it put there
    fail_at(&[("renamed", Inject::Crash)]);
    assert!(run(&lib).is_err());
    let journal = journal_of(&lib);
    let first = journal.moves.last().unwrap().to.clone();
    std::fs::remove_dir_all(&first).unwrap();
    // finished on the next start, and the one after does nothing more
    assert!(run(&lib).unwrap().is_some());
    assert!(run(&lib).unwrap().is_none());
    let mut names = names_in(&lib.default_location());
    names.retain(|n| n != "Mine");
    assert_eq!(names, vec!["My Diagrams", "Payments 2", "payments"]);
    no_leftovers(&lib);
}

#[test]
fn finishing_after_a_taking_back_takes_an_unmarked_rename_only_as_it_was_left() {
    for touched in [false, true] {
        let lib = test_library("migrate-unmarked-finish");
        older_library(&lib);
        std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
        fail_at(&[("renamed", Inject::Crash)]);
        assert!(run(&lib).is_err());
        // the journal as a taking back would leave it, finishing instead
        let mut journal = journal_of(&lib);
        journal.stage = Stage::TakingBack;
        let placed = PathBuf::from(&journal.moves.last().unwrap().to);
        if touched {
            put(&placed.join("theirs.txt"), "theirs");
        }
        let held = lib.lock();
        let mut st = lib.load_state(&held).unwrap();
        let finished = place(&lib, &held, &mut st, &mut journal);
        drop(held);
        if touched {
            // not as the run left it: not the run's to finish with
            assert!(finished.is_err());
            assert_eq!(
                std::fs::read_to_string(placed.join("theirs.txt")).unwrap(),
                "theirs"
            );
        } else {
            assert!(finished.is_ok());
            assert!(journal.moves.iter().all(|m| m.done));
            let listed = list(&lib).unwrap();
            assert_eq!(titles_by_id(&listed)["arc"], "Archive");
        }
    }
}

#[test]
fn a_rename_undone_before_the_journal_could_say_so_is_never_taken_for_made_again() {
    let lib = test_library("migrate-unmoved-unmarked");
    older_library(&lib);
    std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
    // placed, the record cannot be written; the first rename back is made
    // and the app stops before the journal says so
    fail_at(&[("state", Inject::Fail), ("unmoved", Inject::Crash)]);
    assert!(run(&lib).is_err());
    let undone = PathBuf::from(&journal_of(&lib).moves.last().unwrap().to);
    // the next start takes back the rest, and stops before the journal goes
    fail_at(&[("unjournal", Inject::Crash)]);
    assert!(run(&lib).is_err());
    // a folder of the user's turns up where that rename had put a project
    put(&undone.join("theirs.txt"), "theirs");
    assert!(run(&lib).unwrap().is_some());
    assert_eq!(names_in(&undone), vec!["theirs.txt"]);
    // the move made again beside it, never on it
    let listed = list(&lib).unwrap();
    let names = titles_by_id(&listed);
    assert_eq!(undone.file_name().unwrap(), "My Diagrams");
    assert_eq!(names["my-diagrams"], "My Diagrams 2");
    assert_eq!(names["stray1"], "Stray");
    no_leftovers(&lib);
}

#[test]
fn an_empty_project_moved_is_not_taken_for_the_one_edited_last() {
    for each in [false, true] {
        let lib = test_library("migrate-empty-newest");
        older_library(&lib);
        if each {
            std::fs::create_dir_all(lib.default_location().join("Mine")).unwrap();
            let mine = lib.default_location().join("Mine");
            crate::library::disk::set_modified(&mine, at(0)).unwrap();
        }
        assert!(run(&lib).unwrap().is_some());
        let listed = list(&lib).unwrap();
        // "payments" holds nothing: as new as the older library said it was
        let empty = listed.iter().find(|p| p.id == "pay2").unwrap();
        assert!(empty.updated_at < 1_000_000_000_000, "{}", empty.updated_at);
        // a new diagram goes where the newest diagram is, as before the move
        crate::library::ops::create(&lib, "d-new", &doc("Next"), None).unwrap();
        assert!(
            lib.default_location()
                .join("My Diagrams/Next.dosik")
                .is_file(),
            "{each}"
        );
    }
}
