//! Where the folder-backed library is, and what keeps its writes in turn.
//!
//! Every path comes in from outside — the app resolves the real ones, a
//! test hands in folders of its own — so nothing here can reach the user's
//! Documents or app data unless it was given them.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use super::state::{self, LibraryState};

/// The library: its places, and the lock and change count every write
/// goes through.
pub struct Library {
    /// `<app data>/library`: the record, the inbox, the migration journal
    pub data_dir: PathBuf,
    /// where new projects are made; every folder directly in it is a
    /// project of itself
    pub default_location: PathBuf,
    /// the older library, `<app data>/projects` — read once, to move it
    pub legacy_dir: PathBuf,
    /// the user's home folder, to show paths from `~`
    pub home: Option<PathBuf>,
    /// Every read-change-write of the record holds it, and so does every
    /// write that changes where folders and diagrams are: two writes landing
    /// together must not drop each other's change.
    lock: Mutex<()>,
    /// Counts the writes that change where folders and diagrams are, once as
    /// each begins and once as it ends — a seqlock. The listing walks without
    /// the lock; when this moved meanwhile, what it saw may be torn.
    structure: AtomicU64,
}

/// how many times a listing walks before it gives what it last saw
pub const LIST_ATTEMPTS: usize = 3;
pub const INBOX_DIR: &str = "inbox";

impl Library {
    pub fn new(
        data_dir: PathBuf,
        default_location: PathBuf,
        legacy_dir: PathBuf,
        home: Option<PathBuf>,
    ) -> Library {
        Library {
            data_dir,
            default_location,
            legacy_dir,
            home,
            lock: Mutex::new(()),
            structure: AtomicU64::new(0),
        }
    }

    /// The lock, held — a writer that panicked with it left nothing
    /// half-done (writes are atomic), so its poison is ignored.
    pub fn lock(&self) -> MutexGuard<'_, ()> {
        self.lock.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn structure(&self) -> u64 {
        self.structure.load(Ordering::SeqCst)
    }

    /// A change to where folders and diagrams are, under way until the value
    /// is dropped. It borrows the lock's guard, so the change cannot outlive
    /// the hold: changes never overlap, and an odd count is one under way.
    pub fn restructure<'a>(&'a self, _held: &'a MutexGuard<'a, ()>) -> Restructure<'a> {
        self.structure.fetch_add(1, Ordering::SeqCst);
        Restructure { library: self }
    }

    pub fn inbox_dir(&self) -> PathBuf {
        self.data_dir.join(INBOX_DIR)
    }

    /// The record — the lock held by the caller, which may change it.
    pub fn load_state(&self, _held: &MutexGuard<'_, ()>) -> Result<LibraryState, String> {
        state::load(&self.data_dir)
    }

    pub fn save_state(
        &self,
        _held: &MutexGuard<'_, ()>,
        state: &LibraryState,
    ) -> Result<(), String> {
        state::save(&self.data_dir, state)
    }

    /// whether `path` is a project of the default location's: directly in it
    pub fn in_default_location(&self, path: &Path) -> bool {
        path.parent() == Some(self.default_location.as_path())
    }
}

/// A change under way — see `Library::restructure`.
pub struct Restructure<'a> {
    library: &'a Library,
}

impl Drop for Restructure<'_> {
    fn drop(&mut self) {
        self.library.structure.fetch_add(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
impl Library {
    /// a change a test keeps under way with no lock held — what a change
    /// that let the lock go early would be
    pub fn restructure_unguarded(&self) -> Restructure<'_> {
        self.structure.fetch_add(1, Ordering::SeqCst);
        Restructure { library: self }
    }
}

/// The default location: the folder `DOSIK_LIBRARY_DIR` names, when it
/// names one whole; else `Dosik` in the user's Documents — `Dosik Dev` for a
/// development run, so a test instance never moves the older library into,
/// or joins, the real one.
pub fn default_location(
    env: Option<&std::ffi::OsStr>,
    dev: bool,
    documents: Option<&Path>,
    home: Option<&Path>,
) -> Result<PathBuf, String> {
    if let Some(dir) = env.filter(|d| !d.is_empty()).map(PathBuf::from) {
        if dir.is_absolute() {
            return Ok(dir);
        }
        eprintln!(
            "library: DOSIK_LIBRARY_DIR is not an absolute path ({}); left aside",
            dir.display()
        );
    }
    let documents = documents
        .map(Path::to_path_buf)
        .or_else(|| home.map(|h| h.join("Documents")))
        .ok_or("no Documents folder to keep the library in")?;
    Ok(documents.join(if dev { "Dosik Dev" } else { "Dosik" }))
}

/// Where in the app data the library keeps its record (inbox, journal) and
/// finds the older library: `library` and `projects` — or, for a
/// development run, `library-dev` and `projects-dev`. A test instance that
/// shares the app's identifier, and so its app data, then never moves the
/// real older library, marks it moved, or writes the real record.
pub fn data_places(app_data: &Path, dev: bool) -> (PathBuf, PathBuf) {
    let suffix = if dev { "-dev" } else { "" };
    (
        app_data.join(format!("library{suffix}")),
        app_data.join(format!("projects{suffix}")),
    )
}

/// Whether a walk between the counts `before` and `after` saw the library
/// whole: no change was under way as it began, none began meanwhile.
pub fn settled(before: u64, after: u64) -> bool {
    before.is_multiple_of(2) && before == after
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::library::disk::tests::scratch;

    /// A library entirely inside a fresh temp folder: app data, default
    /// location, the older library and a home folder of its own.
    pub(crate) fn test_library(tag: &str) -> Library {
        let base = scratch(tag);
        Library::new(
            base.join("appdata").join("library"),
            base.join("home").join("Docs").join("Dosik"),
            base.join("appdata").join("projects"),
            Some(base.join("home")),
        )
    }

    #[test]
    fn a_walk_counts_as_whole_only_when_no_change_was_under_way() {
        let lib = test_library("ctx-settled");
        let before = lib.structure();
        assert!(settled(before, lib.structure()));
        {
            let held = lib.lock();
            let _change = lib.restructure(&held);
            let during = lib.structure();
            assert!(!settled(during, lib.structure()), "a change under way");
        }
        assert!(!settled(before, lib.structure()), "a change came and went");
        let after = lib.structure();
        assert!(settled(after, lib.structure()));
    }

    #[test]
    fn the_default_location_is_documents_dosik_unless_told_otherwise() {
        use std::ffi::OsStr;
        let base = scratch("ctx-where");
        let docs = base.join("Docs");
        let home = base.join("home");
        let told = base.join("Elsewhere");
        let at = |env: Option<&OsStr>, dev, docs: Option<&Path>| {
            default_location(env, dev, docs, Some(&home))
        };
        assert_eq!(at(None, false, Some(&docs)).unwrap(), docs.join("Dosik"));
        // a development run keeps a library of its own
        assert_eq!(at(None, true, Some(&docs)).unwrap(), docs.join("Dosik Dev"));
        // the environment wins, a development run or not
        for dev in [false, true] {
            assert_eq!(at(Some(told.as_os_str()), dev, Some(&docs)).unwrap(), told);
        }
        // an empty or relative one is left aside
        assert_eq!(
            at(Some(OsStr::new("")), false, Some(&docs)).unwrap(),
            docs.join("Dosik")
        );
        assert_eq!(
            at(Some(OsStr::new("rel/dir")), false, Some(&docs)).unwrap(),
            docs.join("Dosik")
        );
        // no Documents folder known: the one in the home folder
        assert_eq!(
            at(None, false, None).unwrap(),
            home.join("Documents").join("Dosik")
        );
        assert!(default_location(None, false, None, None).is_err());
    }

    #[test]
    fn a_development_run_keeps_its_record_and_older_library_apart() {
        let data = Path::new("/data/app.dosik.desktop");
        assert_eq!(
            data_places(data, false),
            (data.join("library"), data.join("projects"))
        );
        let (record, older) = data_places(data, true);
        assert_eq!(record, data.join("library-dev"));
        assert_eq!(older, data.join("projects-dev"));
        // nothing a development run reads or writes is the real one's, nor inside it
        let (real_record, real_older) = data_places(data, false);
        for dev in [&record, &older] {
            for real in [&real_record, &real_older] {
                assert!(!dev.starts_with(real) && !real.starts_with(dev));
            }
        }
    }

    #[test]
    fn a_development_run_leaves_the_real_older_library_and_record_alone() {
        // the real app data: an older library not yet moved, and no record
        let base = scratch("ctx-dev-apart");
        let data = base.join("appdata");
        std::fs::create_dir_all(data.join("projects").join("pay")).unwrap();
        std::fs::write(
            data.join("projects").join("pay").join("folder.json"),
            r#"{"name":"Payments","createdAt":1}"#,
        )
        .unwrap();
        let (record, older) = data_places(&data, true);
        let lib = Library::new(
            record,
            base.join("home").join("Docs").join("Dosik Dev"),
            older,
            Some(base.join("home")),
        );
        // what a run does first: the move, then a listing, which writes the record
        assert!(!crate::library::migrate::run(&lib).unwrap());
        std::fs::create_dir_all(lib.default_location.join("Sketches")).unwrap();
        crate::library::listing::list(&lib).unwrap();
        // the real older library is not marked moved, the real record not made
        assert!(!data.join("projects").join(".migrated-to").exists());
        assert!(!data.join("library").exists());
        assert!(data.join("library-dev").join("state.json").is_file());
        // nor was the older library moved into the development location
        assert!(!lib.default_location.join("Payments").exists());
    }

    #[test]
    fn the_default_location_holds_its_projects_directly() {
        let lib = test_library("ctx-default");
        let at = lib.default_location.clone();
        assert!(lib.in_default_location(&at.join("Payments")));
        assert!(!lib.in_default_location(&at.join("Payments").join("Sub")));
        assert!(!lib.in_default_location(&at));
    }
}
