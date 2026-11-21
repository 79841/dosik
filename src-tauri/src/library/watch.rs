//! Watching the library, so what Finder, an editor or an agent changes in a
//! project folder reaches the app while it is open — not at its next start.
//!
//! - The default location and every project outside it are watched with
//!   everything in them; the inbox, where the MCP server leaves its notes,
//!   by itself.
//! - Events come in batches, `DEBOUNCE` after the last one. Each path is
//!   sorted out against the record: hidden names and temp files are nobody's;
//!   a path that is as the record has it — gone and forgotten, or there and
//!   known — is the app's own doing; a known diagram whose contents are what
//!   the app last read or wrote is no change either.
//! - What is left is told: the ids of the diagrams whose files changed or
//!   went, for their tabs to read again or close — and, ids or not, that the
//!   library is worth listing again.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};

use super::ctx::Library;
use super::disk::{self, rel_within, split_rel};
use super::listing::{item_in_project, normalized};
use super::names::diagram_stem;
use super::ops::{read_stamped, same_contents};
use super::state::{LibraryState, ProjectRecord};
use super::walk::{self, Entry, MAX_DEPTH};

/// how long the events of one change are gathered before they are told
pub const DEBOUNCE: Duration = Duration::from_millis(300);

/// A folder watched, with everything in it or by itself.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Root {
    pub path: PathBuf,
    pub recursive: bool,
}

/// What the library's watch covers: the inbox by itself, the default
/// location and every project outside it with everything in them.
pub fn roots(lib: &Library, st: &LibraryState) -> BTreeSet<Root> {
    let mut out = BTreeSet::new();
    out.insert(Root {
        path: lib.inbox_dir(),
        recursive: false,
    });
    out.insert(Root {
        path: lib.default_location.clone(),
        recursive: true,
    });
    for record in &st.projects {
        let root = record.root();
        if !lib.in_default_location(&root) {
            out.insert(Root {
                path: root,
                recursive: true,
            });
        }
    }
    out
}

/// The file system's events, gathered into batches of paths.
pub struct Watcher {
    armed: Mutex<Armed>,
}

struct Armed {
    debouncer: Debouncer<RecommendedWatcher>,
    /// what is watched now — only folders that were there to be watched
    watched: BTreeSet<Root>,
}

impl Watcher {
    /// Starts gathering events, watching nothing yet: `on_batch` gets the
    /// paths of each batch, on a thread of the watcher's own.
    pub fn start(
        mut on_batch: impl FnMut(Vec<PathBuf>) + Send + 'static,
    ) -> Result<Watcher, String> {
        let debouncer = new_debouncer(DEBOUNCE, move |result: DebounceEventResult| match result {
            Ok(events) => on_batch(events.into_iter().map(|e| e.path).collect()),
            Err(e) => eprintln!("library: watching: {e}"),
        })
        .map_err(|e| format!("the library cannot be watched: {e}"))?;
        Ok(Watcher {
            armed: Mutex::new(Armed {
                debouncer,
                watched: BTreeSet::new(),
            }),
        })
    }

    fn armed(&self) -> MutexGuard<'_, Armed> {
        self.armed.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Watches `wanted` and nothing else: what is watched already stays, what
    /// is no longer wanted — or no longer there — is let go, and a folder not
    /// there yet is taken up by a later call, once it is.
    pub fn watch(&self, wanted: &BTreeSet<Root>) {
        let mut armed = self.armed();
        let drop: Vec<Root> = armed
            .watched
            .iter()
            .filter(|r| !wanted.contains(r) || !disk::is_real_dir(&r.path))
            .cloned()
            .collect();
        for root in drop {
            // a folder gone took its watch with it: there may be nothing to let go
            let _ = armed.debouncer.watcher().unwatch(&root.path);
            armed.watched.remove(&root);
        }
        for root in wanted {
            if armed.watched.contains(root) || !disk::is_real_dir(&root.path) {
                continue;
            }
            let mode = if root.recursive {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            };
            match armed.debouncer.watcher().watch(&root.path, mode) {
                Ok(()) => {
                    armed.watched.insert(root.clone());
                }
                Err(e) => eprintln!("library: cannot watch {}: {e}", root.path.display()),
            }
        }
    }

    /// what is watched now
    #[cfg(test)]
    pub fn watched(&self) -> BTreeSet<Root> {
        self.armed().watched.clone()
    }
}

/// What a batch of event paths comes to — `None` when each was the app's
/// own doing or nobody's; else the ids of the diagrams whose files changed
/// or went (maybe none: something new turned up). `seen` holds the stamp the
/// app last read or wrote of each diagram, and takes the new stamps of those
/// told as changed.
pub fn sort_out(
    lib: &Library,
    st: &LibraryState,
    seen: &mut HashMap<String, String>,
    paths: &[PathBuf],
) -> Option<Vec<String>> {
    let inbox = normalized(&lib.inbox_dir());
    let default = normalized(&lib.default_location);
    let mut tell = false;
    let mut changed = BTreeSet::new();
    for path in paths {
        let at = normalized(path);
        let name = at
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if at.parent() == Some(inbox.as_path()) {
            // a note from the MCP server: the listing takes it in
            tell |= walk::classify(&name, false) != Entry::Skip && name.ends_with(".json");
            continue;
        }
        if let Some((project, rel)) = item_in_project(st, path) {
            if let Some(ids) = sort_item(&st.projects[project], seen, &rel, path) {
                tell = true;
                changed.extend(ids);
            }
            continue;
        }
        if at == default {
            // the default location itself went: its projects' own events say which
            tell |= !disk::is_real_dir(path);
        } else if at.parent() == Some(default.as_path()) {
            // a folder in the default location the record does not have yet:
            // a new project. Anything else there is outside every project
            tell |= walk::classify(&name, true) != Entry::Skip && disk::is_real_dir(path);
        }
    }
    (tell || !changed.is_empty()).then(|| changed.into_iter().collect())
}

/// One path inside a project — `None` when it tells nothing, else the ids of
/// the diagrams it changed or took away.
fn sort_item(
    record: &ProjectRecord,
    seen: &mut HashMap<String, String>,
    rel: &str,
    path: &Path,
) -> Option<Vec<String>> {
    if rel
        .split('/')
        .any(|n| walk::classify(n, true) == Entry::Skip)
    {
        return None;
    }
    if rel.is_empty() {
        // the project's own folder: gone, its diagrams with it
        return (!disk::is_real_dir(path)).then(|| diagrams_under(record, ""));
    }
    let is_file = disk::is_real_file(path);
    let there = is_file || disk::is_real_dir(path);
    match (record.ids.get(rel), there) {
        // gone and forgotten: moved, renamed or deleted by the app — or never shown
        (None, false) => None,
        // not in the record yet: something the listing will show, or nothing it would
        (None, true) => shows_when_new(path, rel, is_file).then(Vec::new),
        // in the record, gone from disk: removed or renamed outside the app
        (Some(_), false) => Some(diagrams_under(record, rel)),
        (Some(id), true) => {
            if !is_file || diagram_stem(split_rel(rel).1).is_none() {
                return None;
            }
            let (_, stamp) = read_stamped(path).ok()?;
            if seen.get(id).is_some_and(|last| same_contents(last, &stamp)) {
                return None;
            }
            seen.insert(id.clone(), stamp);
            Some(vec![id.clone()])
        }
    }
}

/// the ids of the diagrams at or under `rel` (`""`: the whole project)
fn diagrams_under(record: &ProjectRecord, rel: &str) -> Vec<String> {
    record
        .ids
        .iter()
        .filter(|(key, _)| rel_within(key, rel) && diagram_stem(split_rel(key).1).is_some())
        .map(|(_, id)| id.clone())
        .collect()
}

/// Whether something new at `rel` would show: a diagram no deeper than the
/// listing reads, or a folder with a diagram somewhere in it.
fn shows_when_new(path: &Path, rel: &str, is_file: bool) -> bool {
    let names = rel.split('/').count();
    if is_file {
        let name = split_rel(rel).1;
        return names <= MAX_DEPTH && matches!(walk::classify(name, false), Entry::Diagram(_));
    }
    names < MAX_DEPTH && holds_diagram(path, names + 1)
}

/// whether a diagram is in the folder at `path`, `depth` deep, or under it
fn holds_diagram(path: &Path, depth: usize) -> bool {
    walk::entries(path).into_iter().any(|(name, is_dir)| {
        if is_dir {
            depth < MAX_DEPTH && holds_diagram(&path.join(name), depth + 1)
        } else {
            true
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::ctx::tests::test_library;
    use crate::library::listing::tests::put;
    use crate::library::listing::{list, FolderMeta};
    use crate::library::ops::{self, tests::titled};

    /// a library with the project P (Flow, Sub/Deep) in its default location
    /// and the added project Ext (Far), listed
    fn library(tag: &str) -> (Library, Vec<FolderMeta>) {
        let lib = test_library(tag);
        let p = lib.default_location.join("P");
        put(&p.join("Flow.dosik"), &titled("Flow"));
        put(&p.join("Sub/Deep.dosik"), &titled("Deep"));
        let ext = lib.default_location.parent().unwrap().join("Ext");
        put(&ext.join("Far.dosik"), &titled("Far"));
        list(&lib).unwrap();
        let note = serde_json::json!({ "path": ext.to_string_lossy(), "at": 1 });
        put(&lib.inbox_dir().join("n.json"), &note.to_string());
        let listed = list(&lib).unwrap();
        (lib, listed)
    }

    fn record(lib: &Library) -> LibraryState {
        let held = lib.lock();
        lib.load_state(&held).unwrap()
    }

    fn id_of(listed: &[FolderMeta], title: &str) -> String {
        fn find(f: &FolderMeta, title: &str) -> Option<String> {
            f.diagrams
                .iter()
                .find(|d| d.title == title)
                .map(|d| d.id.clone())
                .or_else(|| f.folders.iter().find_map(|s| find(s, title)))
        }
        listed
            .iter()
            .find_map(|f| find(f, title))
            .unwrap_or_else(|| panic!("no diagram {title}"))
    }

    fn sort(
        lib: &Library,
        seen: &mut HashMap<String, String>,
        paths: &[PathBuf],
    ) -> Option<Vec<String>> {
        sort_out(lib, &record(lib), seen, paths)
    }

    fn p(lib: &Library) -> PathBuf {
        lib.default_location.join("P")
    }

    #[test]
    fn the_inbox_the_default_location_and_projects_outside_it_are_watched() {
        let (lib, listed) = library("watch-roots");
        assert_eq!(listed.len(), 2);
        let ext = lib.default_location.parent().unwrap().join("Ext");
        let roots: Vec<(PathBuf, bool)> = roots(&lib, &record(&lib))
            .into_iter()
            .map(|r| (r.path, r.recursive))
            .collect();
        let mut expected = vec![
            (lib.inbox_dir(), false),
            (lib.default_location.clone(), true),
            (ext, true),
        ];
        expected.sort();
        assert_eq!(roots, expected);
    }

    #[test]
    fn a_diagram_changed_outside_is_told_once() {
        let (lib, listed) = library("watch-changed");
        let flow = id_of(&listed, "Flow");
        let mut seen = HashMap::new();
        let file = p(&lib).join("Flow.dosik");
        // what the app read
        seen.insert(flow.clone(), ops::load(&lib, &flow).unwrap().stamp);
        assert_eq!(
            sort(&lib, &mut seen, &[file.clone()]),
            None,
            "as the app read it"
        );
        std::fs::write(&file, titled("Flow, edited")).unwrap();
        assert_eq!(
            sort(&lib, &mut seen, &[file.clone()]),
            Some(vec![flow.clone()])
        );
        // the same change told twice is told once
        assert_eq!(sort(&lib, &mut seen, &[file.clone()]), None);
        // written again with the same bytes: no change of anyone's
        std::fs::write(&file, titled("Flow, edited")).unwrap();
        assert_eq!(sort(&lib, &mut seen, &[file]), None);
    }

    #[test]
    fn the_apps_own_saves_moves_and_deletes_are_not_told() {
        let (lib, listed) = library("watch-own");
        let flow = id_of(&listed, "Flow");
        let pid = listed.iter().find(|f| f.name == "P").unwrap().id.clone();
        let mut seen = HashMap::new();
        let base = ops::load(&lib, &flow).unwrap().stamp;
        // a save under a new title: the file is renamed and written
        let outcome = ops::save(&lib, &flow, &titled("Renamed"), None, Some(&base)).unwrap();
        let ops::SaveOutcome::Saved { stamp, .. } = outcome else {
            panic!("not saved: {outcome:?}")
        };
        seen.insert(flow.clone(), stamp);
        let paths = [p(&lib).join("Flow.dosik"), p(&lib).join("Renamed.dosik")];
        assert_eq!(sort(&lib, &mut seen, &paths), None);
        // a new diagram and a new folder the app made
        let outcome = ops::save(&lib, "newone", &titled("New"), Some(&pid), None).unwrap();
        let ops::SaveOutcome::Saved { stamp, .. } = outcome else {
            panic!("not saved")
        };
        seen.insert("newone".into(), stamp);
        crate::library::folders::create_folder(&lib, "fold", "Made", None, Some(&pid)).unwrap();
        let paths = [p(&lib).join("New.dosik"), p(&lib).join("Made")];
        assert_eq!(sort(&lib, &mut seen, &paths), None);
        // a folder the app renamed, and one it moved to the Trash
        crate::library::folders::rename_folder(&lib, "fold", "Kept").unwrap();
        assert_eq!(
            sort(
                &lib,
                &mut seen,
                &[p(&lib).join("Made"), p(&lib).join("Kept")]
            ),
            None
        );
        struct Gone;
        impl crate::library::removal::Trasher for Gone {
            fn trash(&self, path: &Path) -> Result<(), String> {
                std::fs::remove_dir_all(path).map_err(|e| e.to_string())
            }
        }
        crate::library::removal::delete_folder(&lib, "fold", &Gone).unwrap();
        assert_eq!(sort(&lib, &mut seen, &[p(&lib).join("Kept")]), None);
    }

    #[test]
    fn a_diagram_removed_outside_is_told_and_so_is_a_folder_with_its_diagrams() {
        let (lib, listed) = library("watch-removed");
        let flow = id_of(&listed, "Flow");
        let deep = id_of(&listed, "Deep");
        let mut seen = HashMap::new();
        std::fs::remove_file(p(&lib).join("Flow.dosik")).unwrap();
        assert_eq!(
            sort(&lib, &mut seen, &[p(&lib).join("Flow.dosik")]),
            Some(vec![flow])
        );
        std::fs::remove_dir_all(p(&lib).join("Sub")).unwrap();
        assert_eq!(
            sort(&lib, &mut seen, &[p(&lib).join("Sub")]),
            Some(vec![deep])
        );
    }

    #[test]
    fn a_project_folder_gone_takes_its_diagrams() {
        let (lib, listed) = library("watch-project-gone");
        let far = id_of(&listed, "Far");
        let ext = lib.default_location.parent().unwrap().join("Ext");
        std::fs::remove_dir_all(&ext).unwrap();
        assert_eq!(sort(&lib, &mut HashMap::new(), &[ext]), Some(vec![far]));
    }

    #[test]
    fn what_turns_up_is_told_when_the_listing_would_show_it() {
        let (lib, _) = library("watch-new");
        let mut seen = HashMap::new();
        // a new diagram, and a folder moved in with one
        put(&p(&lib).join("Fresh.dosik"), &titled("Fresh"));
        assert_eq!(
            sort(&lib, &mut seen, &[p(&lib).join("Fresh.dosik")]),
            Some(vec![])
        );
        put(&p(&lib).join("Moved/In/It.dosik"), &titled("It"));
        assert_eq!(
            sort(&lib, &mut seen, &[p(&lib).join("Moved")]),
            Some(vec![])
        );
        // a new project in the default location
        std::fs::create_dir_all(lib.default_location.join("Q")).unwrap();
        assert_eq!(
            sort(&lib, &mut seen, &[lib.default_location.join("Q")]),
            Some(vec![])
        );
        // a note in the inbox
        put(&lib.inbox_dir().join("x.json"), "{}");
        assert_eq!(
            sort(&lib, &mut seen, &[lib.inbox_dir().join("x.json")]),
            Some(vec![])
        );
    }

    #[test]
    fn what_nobody_shows_is_not_told() {
        let (lib, _) = library("watch-nobody");
        let mut seen = HashMap::new();
        let quiet = [
            // hidden names and temp files, wherever they are
            p(&lib).join(".DS_Store"),
            p(&lib).join(".dosik-1-2.tmp"),
            p(&lib).join(".git").join("index"),
            lib.default_location.join(".hidden"),
            lib.inbox_dir().join(".note.tmp"),
            // a file of the user's that is no diagram, an empty folder
            p(&lib).join("notes.txt"),
            p(&lib).join("Empty"),
            // a diagram directly in the default location: outside every project
            lib.default_location.join("Loose.dosik"),
            // outside the library altogether
            lib.default_location.parent().unwrap().join("Other.dosik"),
            // the project's own folder, there
            p(&lib),
        ];
        put(&p(&lib).join("notes.txt"), "x");
        std::fs::create_dir_all(p(&lib).join("Empty")).unwrap();
        put(&p(&lib).join(".git/index"), "x");
        put(&lib.default_location.join("Loose.dosik"), &titled("Loose"));
        assert_eq!(sort(&lib, &mut seen, &quiet), None);
        // a diagram deeper than the listing reads
        let mut deep = p(&lib);
        for n in 0..MAX_DEPTH {
            deep = deep.join(format!("d{n}"));
        }
        put(&deep.join("Deep.dosik"), &titled("Deep"));
        assert_eq!(sort(&lib, &mut seen, &[deep.join("Deep.dosik")]), None);
        assert_eq!(sort(&lib, &mut seen, &[p(&lib).join("d0")]), None);
    }

    #[test]
    fn a_batch_tells_every_change_in_it_once() {
        let (lib, listed) = library("watch-batch");
        let flow = id_of(&listed, "Flow");
        let far = id_of(&listed, "Far");
        let ext = lib.default_location.parent().unwrap().join("Ext");
        std::fs::write(p(&lib).join("Flow.dosik"), titled("Flow 2")).unwrap();
        std::fs::write(ext.join("Far.dosik"), titled("Far 2")).unwrap();
        let mut told = sort(
            &lib,
            &mut HashMap::new(),
            &[
                p(&lib).join("Flow.dosik"),
                ext.join("Far.dosik"),
                p(&lib).join("Flow.dosik"),
                p(&lib).join(".DS_Store"),
            ],
        )
        .unwrap();
        told.sort();
        let mut expected = vec![flow, far];
        expected.sort();
        assert_eq!(told, expected);
    }

    #[test]
    fn the_watch_follows_the_folders_that_are_there() {
        let (lib, _) = library("watch-follow");
        let watcher = Watcher::start(|_| {}).unwrap();
        let wanted = roots(&lib, &record(&lib));
        watcher.watch(&wanted);
        assert_eq!(watcher.watched(), wanted);
        // a folder gone is let go; back, it is taken up again
        let ext = lib.default_location.parent().unwrap().join("Ext");
        std::fs::rename(&ext, ext.with_extension("away")).unwrap();
        watcher.watch(&wanted);
        assert!(!watcher.watched().iter().any(|r| r.path == ext));
        std::fs::rename(ext.with_extension("away"), &ext).unwrap();
        watcher.watch(&wanted);
        assert_eq!(watcher.watched(), wanted);
        // no longer wanted: let go
        let fewer: BTreeSet<Root> = wanted.iter().filter(|r| r.path != ext).cloned().collect();
        watcher.watch(&fewer);
        assert_eq!(watcher.watched(), fewer);
    }

    #[test]
    fn an_edit_on_disk_reaches_the_watch() {
        // the one test on the real file system's events: generous with time
        let (lib, listed) = library("watch-real");
        let flow = id_of(&listed, "Flow");
        let lib = std::sync::Arc::new(lib);
        let seen = std::sync::Arc::new(Mutex::new(HashMap::new()));
        let (tx, rx) = std::sync::mpsc::channel::<Vec<String>>();
        let watcher = {
            let (lib, seen) = (lib.clone(), seen.clone());
            Watcher::start(move |paths| {
                let st = record(&lib);
                let mut seen = seen.lock().unwrap();
                if let Some(changed) = sort_out(&lib, &st, &mut seen, &paths) {
                    let _ = tx.send(changed);
                }
            })
            .unwrap()
        };
        watcher.watch(&roots(&lib, &record(&lib)));
        // give the watch a moment to take hold before the edit
        std::thread::sleep(Duration::from_millis(500));
        std::fs::write(p(&lib).join("Flow.dosik"), titled("Edited outside")).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            match rx.recv_timeout(left) {
                Ok(changed) if changed.contains(&flow) => break,
                Ok(_) => continue,
                Err(e) => panic!("no word of the edit: {e}"),
            }
        }
    }
}
