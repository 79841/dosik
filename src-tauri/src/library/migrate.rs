//! Moving the older library — `<app data>/projects`, folders and files
//! named by id — into real folders in the default location, once.
//!
//! - Every project, folder and diagram is made there under the name it
//!   shows (cleaned, " 2" on a clash), a diagram as `<name>.dosik` with the
//!   very bytes and modification time it had; one that is no JSON is named
//!   by its id. Diagrams that never made it into a project go to "My
//!   Diagrams".
//! - Ids, the order of every folder, the projects' order and their places on
//!   the Home canvas go into the record, so the app looks as it did.
//! - The older library is only read. When it is done it gets one file,
//!   `.migrated-to`, and stays as a backup — an older build still opens it.
//! - It is built aside first, in a hidden folder next to the default
//!   location (or in it, when it is there already), and put in place with
//!   renames. A journal written before anything else says what it will make
//!   and how far it got: a failure takes back what was made — only that,
//!   never what came since: a rename only once it was made, a project put in
//!   place only while it is as the run left it (else the move is finished
//!   instead), a copy only while it holds the very bytes it copies — and a
//!   run cut short is taken back on the next start while it was still
//!   building or taking back, or else finished there: once a project is in
//!   place, files may come into it. The markers that say it is done
//!   (`migration` in the record and the file in the older library) are
//!   written last.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ctx::Library;
use super::disk::{self, child_rel};
use super::legacy;
use super::names::{self, DIAGRAM_EXT};
use super::state::{self, BoardSpot, LibraryState, Migration, ProjectRecord};
use super::walk::{self, Siblings};

/// the file the older library gets once it has been moved
pub const MARKER: &str = ".migrated-to";
/// where the run writes how far it got
pub const JOURNAL: &str = "migration.json";
/// what the staging folder inside a default location that is there starts with
const EACH_STAGING: &str = ".dosik-migrating-";

/// How far a run got.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Stage {
    /// making the copy aside
    Building,
    /// putting it in place
    Moving,
    /// in place; the record and the markers are left
    Placed,
    /// failed, and taking back what it made — a run cut short here is taken
    /// back on the next start, never finished
    TakingBack,
}

/// How the copy is put in place.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Mode {
    /// no default location yet: the copy becomes it, in one rename
    Whole,
    /// a default location already there: each project renamed into it
    Each,
}

/// One rename the run makes or made: written down before it is made, and
/// marked `done` once it is — only a rename made is ever taken back.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
struct Move {
    from: String,
    to: String,
    #[serde(default)]
    done: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct Journal {
    stage: Stage,
    mode: Mode,
    /// the hidden folder the copy is built in
    staging: String,
    moves: Vec<Move>,
    /// the projects as the record will have them — every item the run makes
    /// in each named in its ids; their paths final once placed
    #[serde(default)]
    projects: Value,
    /// each project's name in the staging folder, in the order of `projects`
    #[serde(default)]
    names: Vec<String>,
    /// how many diagrams could not be read, and stay in the older library
    #[serde(default)]
    left: usize,
    /// each project's diagrams — where in it, from which file of the older
    /// library — in the order of `projects`: what a copy is checked against
    /// before it is taken back
    #[serde(default)]
    sources: Vec<BTreeMap<String, String>>,
    /// every project of the older library the run puts on record, by id,
    /// in the user's order — those found already in place (see
    /// `adopt_whole_copies`) among them
    #[serde(default)]
    order: Vec<String>,
}

impl Journal {
    /// the projects the run makes, as the record will have them
    fn records(&self) -> Vec<ProjectRecord> {
        let wrapped = serde_json::json!({ "projects": self.projects });
        state::from_value(&wrapped)
            .map(|s| s.projects)
            .unwrap_or_default()
    }

    fn set_records(&mut self, records: &[ProjectRecord]) -> Result<(), String> {
        self.projects = serde_json::to_value(records).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// the diagrams of the project at `n`: where in it → its older file
    fn sources_of(&self, n: usize) -> BTreeMap<String, String> {
        self.sources.get(n).cloned().unwrap_or_default()
    }

    /// the last rename written down, made now: marked so
    fn mark_done(&mut self, lib: &Library) -> Result<(), String> {
        if let Some(last) = self.moves.last_mut() {
            last.done = true;
        }
        write_journal(lib, self)
    }
}

/// `planned`'s diagrams, as the journal keeps them
fn sources_of(planned: &[Planned]) -> Result<Vec<BTreeMap<String, String>>, String> {
    planned
        .iter()
        .map(|p| {
            p.files
                .iter()
                .map(|(rel, source)| Ok((rel.clone(), state::path_text(source)?)))
                .collect()
        })
        .collect()
}

/// A project as the run will make it.
#[derive(Debug, Clone)]
struct Planned {
    record: ProjectRecord,
    /// its name in the staging folder
    name: String,
    /// the name it asked for, before one taken made it " 2"
    wanted: String,
    /// folders to make, relative to the project, parents first
    dirs: Vec<String>,
    /// diagrams to copy: where in the project, from where
    files: Vec<(String, PathBuf)>,
    /// how new each folder was in the older library, ms since the epoch —
    /// the project itself at `""`: an empty one as new as when it was made,
    /// never as new as the move
    times: Vec<(String, u64)>,
}

impl Planned {
    /// The item at `from` is at `to` now — a name in the same folder —
    /// with everything under it: its folders, its diagrams, its ids and
    /// orders, and its name in its folder's order.
    fn rename(&mut self, from: &str, to: &str) {
        let moved = |key: &str| disk::rel_within(key, from);
        let rekey = |key: &str| format!("{to}{}", &key[from.len()..]);
        for dir in &mut self.dirs {
            if moved(dir) {
                *dir = rekey(dir);
            }
        }
        let rels = self
            .files
            .iter_mut()
            .map(|(rel, _)| rel)
            .chain(self.times.iter_mut().map(|(rel, _)| rel));
        for rel in rels {
            if moved(rel) {
                *rel = rekey(rel);
            }
        }
        let record = &mut self.record;
        record.ids = std::mem::take(&mut record.ids)
            .into_iter()
            .map(|(k, v)| (if moved(&k) { rekey(&k) } else { k }, v))
            .collect();
        record.order = std::mem::take(&mut record.order)
            .into_iter()
            .map(|(k, v)| {
                (
                    if !k.is_empty() && moved(&k) {
                        rekey(&k)
                    } else {
                        k
                    },
                    v,
                )
            })
            .collect();
        let (parent, old_name) = disk::split_rel(from);
        let (_, new_name) = disk::split_rel(to);
        if let Some(order) = record.order.get_mut(parent) {
            for name in order.iter_mut() {
                if name == old_name {
                    *name = new_name.to_string();
                }
            }
        }
    }

    /// Each folder and diagram built of it in `root` named as the disk
    /// stores it — a disk that stores names decomposed (HFS+, some shares)
    /// hands back another spelling than the one made, and the record must
    /// go by that one.
    fn take_stored_names(&mut self, root: &Path) {
        for n in 0..self.dirs.len() + self.files.len() {
            // parents first: by now only its own name can be spelt otherwise
            let rel = if n < self.dirs.len() {
                self.dirs[n].clone()
            } else {
                self.files[n - self.dirs.len()].0.clone()
            };
            if let Some(stored) = walk::stored_rel(root, &rel) {
                if stored != rel {
                    self.rename(&rel, &stored);
                }
            }
        }
    }
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Inject {
    /// the step fails: the run takes back what it made
    Fail,
    /// the app stops there: nothing is taken back until the next run
    Crash,
}

#[cfg(test)]
thread_local! {
    /// where a test makes the run fail, and how — each point once
    pub(crate) static FAIL_AT: std::cell::RefCell<Vec<(&'static str, Inject)>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// makes the run fail at each of `points`, the way each says, once
#[cfg(test)]
pub(crate) fn fail_at(points: &[(&'static str, Inject)]) {
    FAIL_AT.with(|f| *f.borrow_mut() = points.to_vec());
}

/// What a failed step is.
enum Failure {
    /// an error: what was made is taken back
    Error(String),
    /// a test stopping the run as if the app had quit
    #[cfg(test)]
    Crash,
}

impl From<String> for Failure {
    fn from(e: String) -> Self {
        Failure::Error(e)
    }
}

#[cfg(test)]
fn step(point: &'static str) -> Result<(), Failure> {
    let how = FAIL_AT.with(|f| {
        let mut points = f.borrow_mut();
        let at = points.iter().position(|(at, _)| *at == point)?;
        Some(points.remove(at).1)
    });
    match how {
        Some(Inject::Fail) => Err(Failure::Error(format!("failed at {point}"))),
        Some(Inject::Crash) => Err(Failure::Crash),
        None => Ok(()),
    }
}

#[cfg(not(test))]
fn step(_point: &'static str) -> Result<(), Failure> {
    Ok(())
}

/// what a test does just before a project is renamed into place, with
/// where it goes — make something there, say
#[cfg(test)]
pub(crate) type PlaceHook = Box<dyn FnOnce(&Path)>;

#[cfg(test)]
thread_local! {
    pub(crate) static MID_PLACE: std::cell::RefCell<Option<PlaceHook>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn mid_place(to: &Path) {
    if let Some(hook) = MID_PLACE.with(|hook| hook.borrow_mut().take()) {
        hook(to);
    }
}

#[cfg(not(test))]
fn mid_place(_to: &Path) {}

#[cfg(test)]
thread_local! {
    /// what a test does just before the first copy is put in the staging
    /// folder, with where it goes
    pub(crate) static MID_BUILD: std::cell::RefCell<Option<PlaceHook>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn mid_build(dest: &Path) {
    if let Some(hook) = MID_BUILD.with(|hook| hook.borrow_mut().take()) {
        hook(dest);
    }
}

#[cfg(not(test))]
fn mid_build(_dest: &Path) {}

/// how many names a project tries before its move gives up
const NAME_ATTEMPTS: usize = 100;

/// Moves the older library when it has not been moved yet — first
/// taking back or finishing a run cut short. When it moved it now —
/// finishing one cut short included — how many diagrams it could not read
/// and left behind in the older library.
pub fn run(lib: &Library) -> Result<Option<usize>, String> {
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    let (finished, unreadable) = resume(lib, &held, &mut st)?;
    if st.migration.is_some() || disk::exists(&lib.legacy_dir.join(MARKER)) {
        return Ok(finished);
    }
    let mut old = legacy::read_only(&lib.legacy_dir);
    if old.folders.is_empty() {
        return Ok(None);
    }
    // found whole and put on record by a run before (`adopt_whole_copies`):
    // not moved again
    old.folders.retain(|f| st.project(&f.id).is_none());
    let mode = if disk::exists(&lib.default_location()) {
        Mode::Each
    } else {
        Mode::Whole
    };
    let (mut planned, left) = plan(&old, &st, &lib.default_location(), mode);
    let order: Vec<String> = planned.iter().map(|p| p.record.id.clone()).collect();
    if unreadable {
        planned = match adopt_whole_copies(lib, &held, &mut st, planned) {
            Ok(left) => left,
            Err(Failure::Error(e)) => return Err(e),
            #[cfg(test)]
            Err(Failure::Crash) => return Err("stopped".into()),
        };
        // what it named is on record now: the journal goes aside
        let file = lib.data_dir.join(JOURNAL);
        let aside = file.with_extension(format!("json.broken-{}", disk::now_ms()));
        std::fs::rename(&file, &aside).map_err(|e| format!("{}: {e}", file.display()))?;
    }
    let staging = staging_path(&lib.default_location(), mode);
    let mut journal = Journal {
        stage: Stage::Building,
        mode,
        staging: state::path_text(&staging)?,
        moves: Vec::new(),
        projects: Value::Null,
        names: planned.iter().map(|p| p.name.clone()).collect(),
        left,
        sources: sources_of(&planned)?,
        order,
    };
    let records: Vec<ProjectRecord> = planned.iter().map(|p| p.record.clone()).collect();
    journal.set_records(&records)?;
    write_journal(lib, &journal)?;
    match carry_out(lib, &held, &mut st, &mut journal, planned) {
        Ok(_) => Ok(Some(journal.left)),
        Err(Failure::Error(e)) => {
            give_up(lib, &mut journal)?;
            Err(format!("moving the older library failed: {e}"))
        }
        #[cfg(test)]
        Err(Failure::Crash) => Err("stopped".into()),
    }
}

/// A run that failed takes back what it made — the journal saying so first,
/// so a start after one cut short takes back the rest rather than finishing
/// a library half taken back. A taking back that fails leaves the journal
/// for the next start to try again. When the journal cannot say so, a run
/// that was still building is taken back all the same (the next start would
/// do so too), one further on is left for the next start to finish.
fn give_up(lib: &Library, journal: &mut Journal) -> Result<(), String> {
    let was = journal.stage;
    journal.stage = Stage::TakingBack;
    if let Err(e) = write_journal(lib, journal) {
        eprintln!("library: the move of the older library failed and cannot say so: {e}");
        if was != Stage::Building {
            return Ok(());
        }
    }
    match take_back(lib, journal) {
        Ok(TakenBack::Whole) => Ok(()),
        Ok(TakenBack::Changed) => {
            eprintln!(
                "library: what the move put in place has changed; the next start finishes it"
            );
            Ok(())
        }
        Err(Failure::Error(undo)) => {
            eprintln!("library: could not take back a failed move of the older library: {undo}");
            Ok(())
        }
        #[cfg(test)]
        Err(Failure::Crash) => Err("stopped".into()),
    }
}

fn carry_out(
    lib: &Library,
    held: &std::sync::MutexGuard<'_, ()>,
    st: &mut LibraryState,
    journal: &mut Journal,
    planned: Vec<Planned>,
) -> Result<bool, Failure> {
    step("journal")?;
    let staging = PathBuf::from(&journal.staging);
    std::fs::create_dir_all(&staging).map_err(|e| format!("{}: {e}", staging.display()))?;
    let mut planned = planned;
    for n in 0..planned.len() {
        build(&staging, &mut planned[n])?;
        // as built: a name the disk took for another's took the next, and
        // a name it stores otherwise is recorded so
        let records: Vec<ProjectRecord> = planned.iter().map(|p| p.record.clone()).collect();
        journal.set_records(&records)?;
        journal.sources = sources_of(&planned)?;
        write_journal(lib, journal)?;
        if n == 0 {
            step("build")?;
        }
    }
    // every copy on the disk before it is put where people see it
    disk::sync_dir(&staging);
    journal.stage = Stage::Moving;
    write_journal(lib, journal)?;
    step("moving")?;
    place(lib, held, st, journal)
}

/// Puts the copy built in the staging folder in place — what a run cut short
/// left unmoved too — then writes the record and the markers. Whether it
/// wrote the record.
fn place(
    lib: &Library,
    held: &std::sync::MutexGuard<'_, ()>,
    st: &mut LibraryState,
    journal: &mut Journal,
) -> Result<bool, Failure> {
    let staging = PathBuf::from(&journal.staging);
    let mut records = journal.records();
    if records.len() != journal.names.len() {
        return Err(Failure::Error(
            "the journal does not say what to move".into(),
        ));
    }
    let to = &lib.default_location();
    // a rename not marked made counts as made only while the run was
    // putting things in place — cut short before it could say so; after a
    // taking back, what is there is somebody else's
    let moving = journal.stage == Stage::Moving;
    let whole_done = journal
        .moves
        .iter()
        .any(|m| Path::new(&m.from) == staging && (m.done || moving))
        && !disk::exists(&staging)
        && disk::exists(to);
    if journal.mode == Mode::Whole && (whole_done || !disk::exists(to)) {
        if whole_done {
            // made by a run cut short before it could say so
            if journal.moves.last().is_some_and(|m| !m.done) {
                journal.mark_done(lib)?;
            }
        } else {
            journal.moves.push(Move {
                from: journal.staging.clone(),
                to: state::path_text(to)?,
                done: false,
            });
            write_journal(lib, journal)?;
            {
                let _change = lib.restructure(held);
                std::fs::rename(&staging, to).map_err(|e| format!("{}: {e}", to.display()))?;
            }
            step("renamed")?;
            journal.mark_done(lib)?;
            if let Some(parent) = to.parent() {
                disk::sync_dir(parent);
            }
        }
        for (record, name) in records.iter_mut().zip(&journal.names) {
            record.path = state::path_text(&to.join(name))?;
        }
        step("move")?;
    } else {
        // project by project — a default location made meanwhile too
        place_each(lib, held, journal, &mut records)?;
    }
    journal.stage = Stage::Placed;
    journal.set_records(&records)?;
    write_journal(lib, journal)?;
    step("state")?;
    finish(lib, held, st, journal)
}

/// Renames each project from the staging folder into the default location,
/// under a name free there — the next one when something turns up under
/// the first meanwhile, the rename written down for it struck out; one
/// moved before, by a run cut short, stays where its last rename took it —
/// and removes the staging folder once it is empty.
fn place_each(
    lib: &Library,
    held: &std::sync::MutexGuard<'_, ()>,
    journal: &mut Journal,
    records: &mut [ProjectRecord],
) -> Result<(), Failure> {
    let staging = PathBuf::from(&journal.staging);
    let default = &lib.default_location();
    for (n, name) in journal.names.clone().iter().enumerate() {
        let from = staging.join(name);
        if !disk::exists(&from) {
            // moved by a run cut short: where the last rename written down
            // for it took it — a run cut short twice may have tried one
            // name, then another
            let Some(i) = journal
                .moves
                .iter()
                .rposition(|m| Path::new(&m.from) == from)
            else {
                return Err(Failure::Error(format!(
                    "{}: not where the move left it",
                    from.display()
                )));
            };
            let to = journal.moves[i].to.clone();
            let there = disk::exists(Path::new(&to));
            // not marked made: made before it could say so while the run was
            // putting things in place; after a taking back, only while what
            // is there is just as the run left it
            let made = journal.moves[i].done
                || journal.stage == Stage::Moving
                || (there && as_placed(&journal.moves[i], journal));
            if !made {
                return Err(Failure::Error(format!(
                    "{}: not where the move left it",
                    from.display()
                )));
            }
            if !journal.moves[i].done {
                journal.moves[i].done = true;
                write_journal(lib, journal)?;
            }
            if !there {
                // put there, and gone since — the listing lets it go
                eprintln!("library: {to} is gone since the move put it there");
            }
            records[n].path = to;
            continue;
        }
        let mut taken: Vec<String> = Vec::new();
        let to = loop {
            if taken.len() == NAME_ATTEMPTS {
                write_journal(lib, journal)?;
                return Err(Failure::Error(format!(
                    "{}: no free name for {name:?}",
                    default.display()
                )));
            }
            let free = Siblings::read(default)?.folder_name_avoiding(name, &taken);
            let to = default.join(&free);
            journal.moves.push(Move {
                from: state::path_text(&from)?,
                to: state::path_text(&to)?,
                done: false,
            });
            write_journal(lib, journal)?;
            step("placing")?;
            mid_place(&to);
            let _change = lib.restructure(held);
            if disk::exists(&to) {
                // made meanwhile, or the same name in another form: not the
                // run's — struck out of the journal — and the next name
                journal.moves.pop();
                taken.push(free);
                continue;
            }
            std::fs::rename(&from, &to).map_err(|e| format!("{}: {e}", to.display()))?;
            step("renamed")?;
            journal.mark_done(lib)?;
            break to;
        };
        records[n].path = state::path_text(&to)?;
        if n == 0 {
            step("move")?;
        }
    }
    disk::sync_dir(default);
    // emptied by the renames — but for what the system may have dropped in
    // it: the move stands either way, and what is left stays hidden
    match std::fs::remove_dir(&staging) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => eprintln!("library: {} is left where it is: {e}", staging.display()),
    }
    Ok(())
}

/// The record and the markers, once everything is in place. Whether it
/// wrote the record — not when a run before it had.
fn finish(
    lib: &Library,
    held: &std::sync::MutexGuard<'_, ()>,
    st: &mut LibraryState,
    journal: &Journal,
) -> Result<bool, Failure> {
    let recorded = st.migration.is_none();
    if recorded {
        // on top, in their order, before anything the record has already
        for (n, record) in journal.records().into_iter().enumerate() {
            if st.project_at(&record.root()).is_none() {
                st.projects.insert(n.min(st.projects.len()), record);
            }
        }
        // with those found in place already, in the user's order
        let place = |id: &str| journal.order.iter().position(|o| o == id);
        let (mut ours, rest): (Vec<ProjectRecord>, Vec<ProjectRecord>) =
            std::mem::take(&mut st.projects)
                .into_iter()
                .partition(|p| place(&p.id).is_some());
        ours.sort_by_key(|p| place(&p.id));
        st.projects = ours.into_iter().chain(rest).collect();
        st.migration = Some(Migration {
            from: state::path_text(&lib.legacy_dir)?,
            to: state::path_text(&lib.default_location())?,
            at: disk::now_ms(),
        });
        lib.save_state(held, st)?;
    }
    // from here the move stands: a marker that cannot be written is
    // written on the next start, the journal kept for it
    let marked = step("marker").and_then(|()| {
        let target = state::path_text(&lib.default_location())?;
        disk::write_atomic(&lib.legacy_dir.join(MARKER), target.as_bytes())?;
        Ok(())
    });
    match marked {
        Ok(()) => {
            let _ = std::fs::remove_file(lib.data_dir.join(JOURNAL));
            Ok(recorded)
        }
        Err(Failure::Error(e)) => {
            eprintln!("library: the older library is moved, but not marked yet: {e}");
            Ok(recorded)
        }
        #[cfg(test)]
        Err(Failure::Crash) => Err(Failure::Crash),
    }
}

/// A run cut short: taken back while it was building or taking back — the
/// next run starts over — or else finished: once a project is in place,
/// files may have come into it since, and taking it back would take them
/// along. One taking back finds out first whether what it put in place is
/// still as it was, and finishes instead when it is not.
fn resume(
    lib: &Library,
    held: &std::sync::MutexGuard<'_, ()>,
    st: &mut LibraryState,
) -> Result<(Option<usize>, bool), String> {
    let file = lib.data_dir.join(JOURNAL);
    let text = match std::fs::read_to_string(&file) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((None, false)),
        Err(e) => return Err(format!("{}: {e}", file.display())),
    };
    let Ok(mut journal) = serde_json::from_str::<Journal>(&text) else {
        // nothing can be told from it: the run looks for what it made, and
        // puts it aside only once what it found is on record
        eprintln!("library: {} could not be read", file.display());
        return Ok((None, true));
    };
    let finished = match journal.stage {
        Stage::Building | Stage::TakingBack => match take_back(lib, &mut journal) {
            Ok(TakenBack::Whole) => return Ok((None, false)),
            // changed where it was put — edited, added to: finished instead
            Ok(TakenBack::Changed) => place(lib, held, st, &mut journal),
            Err(Failure::Error(e)) => {
                return Err(format!("taking back the move of the older library: {e}"))
            }
            #[cfg(test)]
            Err(Failure::Crash) => return Err("stopped".into()),
        },
        Stage::Moving => place(lib, held, st, &mut journal),
        Stage::Placed => finish(lib, held, st, &journal),
    };
    match finished {
        Ok(recorded) => Ok((recorded.then_some(journal.left), false)),
        Err(Failure::Error(e)) => Err(format!("finishing the move of the older library: {e}")),
        #[cfg(test)]
        Err(Failure::Crash) => Err("stopped".into()),
    }
}

/// A run whose journal could not be read may have put projects in place
/// already, or left them built in its staging folder — inside the default
/// location, or beside it when there was none. Each planned project found
/// whole there — a folder by the name it asks for or that name with a
/// number, holding every one of its folders and diagrams with the very
/// bytes (an empty project, an empty folder) — is taken as moved (one in a
/// staging folder put in place first) and goes on record with its ids,
/// rather than copied a second time. What is left to move is returned. Cut
/// short, it is looked for again: the journal goes aside only after.
fn adopt_whole_copies(
    lib: &Library,
    held: &std::sync::MutexGuard<'_, ()>,
    st: &mut LibraryState,
    planned: Vec<Planned>,
) -> Result<Vec<Planned>, Failure> {
    let default = &lib.default_location();
    let beside = format!(
        ".{}-migrating-",
        default
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    );
    let mut stagings: Vec<PathBuf> = hidden_dirs(default)
        .into_iter()
        .filter(|(name, _)| name.starts_with(EACH_STAGING))
        .map(|(name, _)| default.join(name))
        .collect();
    if let Some(parent) = default.parent() {
        stagings.extend(
            hidden_dirs(parent)
                .into_iter()
                .filter(|(name, _)| name.starts_with(&beside))
                .map(|(name, _)| parent.join(name)),
        );
    }
    let mut left = Vec::new();
    let mut adopted = Vec::new();
    for project in planned {
        let in_place = whole_copy_in(default, &project).filter(|at| st.project_at(at).is_none());
        let found = match in_place {
            Some(at) => Some(at),
            None => match stagings.iter().find_map(|s| whole_copy_in(s, &project)) {
                Some(staged) => {
                    std::fs::create_dir_all(default)
                        .map_err(|e| format!("{}: {e}", default.display()))?;
                    let free = Siblings::read(default)?.folder_name(&project.wanted);
                    let to = default.join(free);
                    {
                        let _change = lib.restructure(held);
                        std::fs::rename(&staged, &to)
                            .map_err(|e| format!("{}: {e}", to.display()))?;
                    }
                    step("adopting")?;
                    Some(to)
                }
                None => None,
            },
        };
        match found {
            Some(at) => {
                let mut record = project.record;
                record.path = state::path_text(&at)?;
                adopted.push(record);
            }
            None => left.push(project),
        }
    }
    for staging in stagings {
        // emptied, or what is left in it stays hidden
        let _ = std::fs::remove_dir(staging);
    }
    if !adopted.is_empty() {
        // on top, in their order, as a finished move puts them
        for (n, record) in adopted.into_iter().enumerate() {
            st.projects.insert(n.min(st.projects.len()), record);
        }
        lib.save_state(held, st)?;
    }
    Ok(left)
}

/// the hidden folders directly in `dir` — `walk::entries` leaves them out
fn hidden_dirs(dir: &Path) -> Vec<(String, bool)> {
    std::fs::read_dir(dir)
        .map(|read| {
            read.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_str()?.to_string();
                    let is_dir = e.file_type().ok()?.is_dir();
                    (name.starts_with('.') && is_dir).then_some((name, true))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A folder in `dir` that holds `project` whole: called what it asks for,
/// or that with a number, every one of its folders there and every diagram
/// with the very bytes of the one it copies — for a project with nothing in
/// it, a folder with nothing in it: any folder of the name would do else.
fn whole_copy_in(dir: &Path, project: &Planned) -> Option<PathBuf> {
    let empty = project.dirs.is_empty() && project.files.is_empty();
    (1..=100)
        .map(|n| dir.join(names::numbered(&project.wanted, n)))
        .find(|at| {
            disk::is_real_dir(at)
                && (!empty || all_names(at).is_some_and(|names| names.is_empty()))
                && project
                    .dirs
                    .iter()
                    .all(|rel| disk::join_rel(at, rel).is_some_and(|d| disk::is_real_dir(&d)))
                && project.files.iter().all(|(rel, source)| {
                    let copy = disk::join_rel(at, rel).and_then(|f| std::fs::read(f).ok());
                    copy.is_some() && copy == std::fs::read(source).ok()
                })
        })
}

/// What taking back came to.
enum TakenBack {
    /// all of it — the journal gone
    Whole,
    /// nothing: what the run put in place is no longer as it left it, and
    /// is not the run's alone to take back — the move is to be finished
    Changed,
}

/// Takes back what a run made: each rename it made undone, then what it
/// built removed, the journal last. Only what the run made is touched: a
/// rename only once it was made (`done`) and while what it put in place is
/// as the run left it — a folder there edited, added to or missing anything
/// is no longer the run's alone, and nothing is taken back (`Changed`) — and
/// of what it built only the files that hold the very bytes they copy, and
/// folders left empty; anything else stays.
fn take_back(lib: &Library, journal: &mut Journal) -> Result<TakenBack, Failure> {
    let made =
        |m: &Move| m.done && !disk::exists(Path::new(&m.from)) && disk::exists(Path::new(&m.to));
    if !journal
        .moves
        .iter()
        .filter(|m| made(m))
        .all(|m| as_placed(m, journal))
    {
        return Ok(TakenBack::Changed);
    }
    for n in (0..journal.moves.len()).rev() {
        if !made(&journal.moves[n]) {
            continue;
        }
        let (from, to) = (
            PathBuf::from(&journal.moves[n].from),
            PathBuf::from(&journal.moves[n].to),
        );
        step("unmove")?;
        // back into the staging folder, made again if it was removed
        if let Some(parent) = from.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        std::fs::rename(&to, &from).map_err(|e| format!("{}: {e}", to.display()))?;
        step("unmoved")?;
        // undone, and the journal says so: whatever turns up there from now
        // is not the run's
        journal.moves[n].done = false;
        write_journal(lib, journal)?;
    }
    // a rename back made before the journal could say so — by a start cut
    // short — said now, before the copies go: what turns up where it had
    // put a project from now is not the run's
    let mut undone = false;
    for m in &mut journal.moves {
        if m.done && disk::exists(Path::new(&m.from)) {
            m.done = false;
            undone = true;
        }
    }
    if undone {
        write_journal(lib, journal)?;
    }
    step("unbuild")?;
    let staging = PathBuf::from(&journal.staging);
    if disk::exists(&staging) {
        remove_made(&staging, journal);
    }
    step("unjournal")?;
    let file = lib.data_dir.join(JOURNAL);
    match std::fs::remove_file(&file) {
        Ok(()) => Ok(TakenBack::Whole),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(TakenBack::Whole),
        Err(e) => Err(Failure::Error(format!("{}: {e}", file.display()))),
    }
}

/// Whether what the rename `m` put in place is still as the run left it:
/// one project's folder — or, for the whole staging folder become the
/// default location, every project's and nothing else beside them.
fn as_placed(m: &Move, journal: &Journal) -> bool {
    let records = journal.records();
    let to = Path::new(&m.to);
    if Path::new(&m.from) == Path::new(&journal.staging) {
        let mut there: Vec<String> = all_names(to).unwrap_or_default();
        let mut ours = journal.names.clone();
        there.sort();
        ours.sort();
        return there == ours
            && journal.names.iter().enumerate().all(|(n, name)| {
                records
                    .get(n)
                    .is_some_and(|r| as_built(&to.join(name), r, &journal.sources_of(n)))
            });
    }
    let staging = Path::new(&journal.staging);
    journal
        .names
        .iter()
        .position(|name| staging.join(name) == Path::new(&m.from))
        .and_then(|n| Some((records.get(n)?, journal.sources_of(n))))
        .is_some_and(|(record, sources)| as_built(to, record, &sources))
}

/// every name in `dir`, hidden ones too — `None` when it cannot be read
fn all_names(dir: &Path) -> Option<Vec<String>> {
    let read = std::fs::read_dir(dir).ok()?;
    read.map(|e| Some(e.ok()?.file_name().to_string_lossy().into_owned()))
        .collect()
}

/// Whether the folder `dir` holds just what the run built of `record`:
/// each of its folders, each of its diagrams with the very bytes of its
/// older file (`sources`), and nothing else — no link, no file of anyone's.
fn as_built(dir: &Path, record: &ProjectRecord, sources: &BTreeMap<String, String>) -> bool {
    fn walk(dir: &Path, rel: &str, out: &mut Vec<(String, bool)>) -> Option<()> {
        for name in all_names(dir)? {
            let at = dir.join(&name);
            let entry_rel = child_rel(rel, &name);
            match disk::presence(&at) {
                disk::Presence::Dir => {
                    out.push((entry_rel.clone(), true));
                    walk(&at, &entry_rel, out)?;
                }
                disk::Presence::File => out.push((entry_rel, false)),
                _ => return None,
            }
        }
        Some(())
    }
    let mut found = Vec::new();
    if !disk::is_real_dir(dir) || walk(dir, "", &mut found).is_none() {
        return false;
    }
    found.len() == record.ids.len()
        && found.iter().all(|(rel, is_dir)| {
            record.ids.contains_key(rel)
                && match sources.get(rel) {
                    Some(source) => !is_dir && same_bytes(&dir.join(rel), Path::new(source)),
                    None => *is_dir,
                }
        })
}

/// whether the files at `a` and `b` hold the very same bytes
fn same_bytes(a: &Path, b: &Path) -> bool {
    match (std::fs::read(a), std::fs::read(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

/// Removes from the staging folder what the run built there — each file
/// that still holds the very bytes it copies, and each folder once it is
/// empty, deepest first — and the staging folder last, when nothing else
/// is left in it. Anything else stays, said.
fn remove_made(staging: &Path, journal: &Journal) {
    for (n, (record, name)) in journal.records().iter().zip(&journal.names).enumerate() {
        let root = staging.join(name);
        let sources = journal.sources_of(n);
        let mut made: Vec<&String> = record.ids.keys().collect();
        made.sort_by_key(|rel| std::cmp::Reverse(rel.matches('/').count()));
        for rel in made {
            let Some(path) = disk::join_rel(&root, rel) else {
                continue;
            };
            match disk::presence(&path) {
                disk::Presence::File => {
                    let copied = sources
                        .get(rel)
                        .is_some_and(|source| same_bytes(&path, Path::new(source)));
                    if copied {
                        let _ = std::fs::remove_file(&path);
                    } else {
                        eprintln!(
                            "library: {} is left — it is not the copy the move made",
                            path.display()
                        );
                    }
                }
                disk::Presence::Dir => {
                    let _ = std::fs::remove_dir(&path);
                }
                _ => {}
            }
        }
        let _ = std::fs::remove_dir(&root);
    }
    match std::fs::remove_dir(staging) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => eprintln!(
            "library: {} is left as it is — it holds what the move did not make: {e}",
            staging.display()
        ),
    }
}

fn write_journal(lib: &Library, journal: &Journal) -> Result<(), String> {
    std::fs::create_dir_all(&lib.data_dir)
        .map_err(|e| format!("{}: {e}", lib.data_dir.display()))?;
    let text = serde_json::to_string_pretty(journal).map_err(|e| e.to_string())?;
    disk::write_atomic(&lib.data_dir.join(JOURNAL), text.as_bytes())
}

/// The hidden folder the copy is built in: next to the default location
/// when that is not there — the copy then becomes it — or inside it.
fn staging_path(default: &Path, mode: Mode) -> PathBuf {
    let stamp = disk::now_ms();
    match mode {
        Mode::Whole => {
            let name = default
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            default.with_file_name(format!(".{name}-migrating-{stamp}"))
        }
        Mode::Each => default.join(format!("{EACH_STAGING}{stamp}")),
    }
}

/// how many names a folder or a copy tries in the staging folder
const BUILD_ATTEMPTS: u64 = 100;

/// Makes one project's folders and copies its diagrams into `staging` —
/// never one over another: a name the disk takes as taken by its own rules
/// (a fold of case it makes otherwise) takes the next number, and the plan
/// with it — then names everything as the disk stores it.
fn build(staging: &Path, project: &mut Planned) -> Result<(), String> {
    let root = staging.join(&project.name);
    std::fs::create_dir(&root).map_err(|e| format!("{}: {e}", root.display()))?;
    for n in 0..project.dirs.len() {
        let rel = project.dirs[n].clone();
        let (parent, name) = disk::split_rel(&rel);
        let (parent, name) = (parent.to_string(), name.to_string());
        let made = (1..=BUILD_ATTEMPTS).find_map(|attempt| {
            let candidate = names::numbered(&name, attempt);
            let dir = disk::join_rel(&root, &child_rel(&parent, &candidate))?;
            mid_build(&dir);
            match std::fs::create_dir(&dir) {
                Ok(()) => Some(Ok(candidate)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => None,
                Err(e) => Some(Err(format!("{}: {e}", dir.display()))),
            }
        });
        let made =
            made.ok_or_else(|| format!("{}: no free name for {name:?}", root.display()))??;
        if made != name {
            project.rename(&rel, &child_rel(&parent, &made));
        }
    }
    for n in 0..project.files.len() {
        let (rel, source) = project.files[n].clone();
        let (parent, file) = disk::split_rel(&rel);
        let (parent, file) = (parent.to_string(), file.to_string());
        let stem = names::diagram_stem(&file).unwrap_or(&file).to_string();
        let ext = file[stem.len()..].to_string();
        let dir = disk::join_rel(&root, &parent).ok_or("a name that is not one")?;
        let bytes = std::fs::read(&source).map_err(|e| format!("{}: {e}", source.display()))?;
        let tmp = disk::write_tmp(&dir, &bytes)?;
        let placed = (1..=BUILD_ATTEMPTS).find_map(|attempt| {
            let candidate = format!("{}{ext}", names::numbered(&stem, attempt));
            let dest = dir.join(&candidate);
            mid_build(&dest);
            // never over another copy — two names one file on this disk
            match disk::place_new(&tmp, &dest) {
                Ok(()) => Some(Ok((candidate, dest))),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => None,
                Err(e) => Some(Err(format!("{}: {e}", dest.display()))),
            }
        });
        let _ = std::fs::remove_file(&tmp);
        let (made, dest) =
            placed.ok_or_else(|| format!("{}: no free name for {file:?}", dir.display()))??;
        disk::keep_mtime(&source, &dest);
        if made != file {
            project.rename(&rel, &child_rel(&parent, &made));
        }
    }
    project.take_stored_names(&root);
    // each folder as new as it was — deepest first, as a folder's time moves
    // with what is made in it — whether or not that can be kept
    for (rel, ms) in project.times.iter().rev() {
        let at = std::time::UNIX_EPOCH + std::time::Duration::from_millis(*ms);
        if let Some(dir) = disk::join_rel(&root, rel) {
            if let Err(e) = disk::set_modified(&dir, at) {
                eprintln!("library: {} keeps the time of the move: {e}", dir.display());
            }
        }
    }
    // the copies are synced as they are written; their names, folder by folder
    for rel in &project.dirs {
        if let Some(dir) = disk::join_rel(&root, rel) {
            disk::sync_dir(&dir);
        }
    }
    disk::sync_dir(&root);
    Ok(())
}

/// What the run will make of the older library: a project for each, named
/// to clash with nothing, ids kept unless the record has them already — and
/// how many diagrams it cannot read, which stay behind.
fn plan(
    old: &legacy::ReadOnly,
    st: &LibraryState,
    default: &Path,
    mode: Mode,
) -> (Vec<Planned>, usize) {
    let mut ids = Ids {
        taken: st
            .projects
            .iter()
            .flat_map(|p| std::iter::once(p.id.clone()).chain(p.ids.values().cloned()))
            .collect(),
        diagrams: HashMap::new(),
        fresh: LibraryState::default(),
        left: 0,
    };
    // diagrams keep their ids first — tabs and sessions name them
    let mut diagram_ids: Vec<&String> = old.diagram_paths.keys().collect();
    diagram_ids.sort();
    for id in diagram_ids {
        let kept = ids.keep_or_new(id);
        ids.diagrams.insert(id.clone(), kept);
    }
    let mut project_names: Vec<String> = match mode {
        Mode::Each => std::fs::read_dir(default)
            .map(|r| {
                r.flatten()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default(),
        Mode::Whole => Vec::new(),
    };
    let mut out = Vec::new();
    for folder in &old.folders {
        if old.unread.contains(&folder.id) {
            // what is in it cannot be told: it stays in the older library
            ids.left += 1;
            continue;
        }
        let wanted = names::clean_folder(&folder.name, names::UNTITLED_PROJECT);
        let name = Siblings::of(project_names.clone()).folder_name(&wanted);
        project_names.push(name.clone());
        let mut planned = Planned {
            record: ProjectRecord {
                id: ids.keep_or_new(&folder.id),
                path: state::path_text(&default.join(&name)).unwrap_or_default(),
                board: folder.board.map(|b| BoardSpot {
                    x: b.x,
                    y: b.y,
                    collapsed: b.collapsed,
                }),
                ids: BTreeMap::new(),
                order: BTreeMap::new(),
                kept_added: false,
            },
            name,
            wanted,
            dirs: Vec::new(),
            files: Vec::new(),
            times: vec![(String::new(), folder.updated_at)],
        };
        plan_folder(old, folder, "", &mut planned, &mut ids);
        out.push(planned);
    }
    (out, ids.left)
}

/// The ids the run gives out: none twice, none the record has.
struct Ids {
    taken: std::collections::HashSet<String>,
    /// each older diagram's id → its id from now on
    diagrams: HashMap<String, String>,
    fresh: LibraryState,
    /// diagrams that could not be read: left in the older library
    left: usize,
}

impl Ids {
    /// `id` kept when nothing has it yet, else a new one
    fn keep_or_new(&mut self, id: &str) -> String {
        if state::validate_id(id).is_ok() && self.taken.insert(id.to_string()) {
            return id.to_string();
        }
        loop {
            let new = self.fresh.new_id();
            if self.taken.insert(new.clone()) {
                return new;
            }
        }
    }
}

/// An older folder's items into `planned` at `rel`, in its order.
fn plan_folder(
    old: &legacy::ReadOnly,
    folder: &legacy::FolderMeta,
    rel: &str,
    planned: &mut Planned,
    ids: &mut Ids,
) {
    let folders: HashMap<&str, &legacy::FolderMeta> =
        folder.folders.iter().map(|f| (f.id.as_str(), f)).collect();
    let mut entries: Vec<String> = Vec::new();
    let mut order: Vec<String> = Vec::new();
    for key in &folder.order {
        let Some((kind, id)) = key.split_once(':') else {
            continue;
        };
        match kind {
            "folder" => {
                let Some(sub) = folders.get(id) else {
                    continue;
                };
                if old.unread.contains(&sub.id) {
                    // what is in it cannot be told: it stays in the older library
                    eprintln!(
                        "library: the older folder {} could not be read; left there",
                        sub.id
                    );
                    ids.left += 1;
                    continue;
                }
                let name = Siblings::of(entries.clone())
                    .folder_name(&names::clean_folder(&sub.name, names::UNTITLED_FOLDER));
                entries.push(name.clone());
                order.push(name.clone());
                let sub_rel = child_rel(rel, &name);
                let new_id = ids.keep_or_new(&sub.id);
                planned.record.ids.insert(sub_rel.clone(), new_id);
                planned.dirs.push(sub_rel.clone());
                planned.times.push((sub_rel.clone(), sub.updated_at));
                plan_folder(old, sub, &sub_rel, planned, ids);
            }
            "diagram" => {
                let (Some(new_id), Some(source)) =
                    (ids.diagrams.get(id), old.diagram_paths.get(id))
                else {
                    continue;
                };
                let Ok(bytes) = std::fs::read(source) else {
                    eprintln!(
                        "library: {} could not be read; left in the older library",
                        source.display()
                    );
                    ids.left += 1;
                    continue;
                };
                let wanted = match serde_json::from_slice::<Value>(&bytes) {
                    Ok(doc) => names::clean(
                        doc.get("title").and_then(Value::as_str).unwrap_or_default(),
                        names::UNTITLED_DIAGRAM,
                    ),
                    // no title to read: its id, cleaned — `con` is a device on Windows
                    Err(_) => names::clean(id, names::UNTITLED_DIAGRAM),
                };
                let name = Siblings::of(entries.clone()).diagram_name(&wanted, DIAGRAM_EXT);
                let file = format!("{name}{DIAGRAM_EXT}");
                entries.push(file.clone());
                order.push(file.clone());
                let file_rel = child_rel(rel, &file);
                planned.record.ids.insert(file_rel.clone(), new_id.clone());
                planned.files.push((file_rel, source.clone()));
            }
            _ => {}
        }
    }
    if !order.is_empty() {
        planned.record.order.insert(rel.to_string(), order);
    }
}

#[cfg(test)]
mod tests;
