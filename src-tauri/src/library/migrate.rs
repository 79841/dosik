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
//!   renames. A journal written before anything else says how far it got:
//!   a failure takes back what was made, and a run cut short is taken back
//!   — or, once everything is in place, finished — on the next start. The
//!   markers that say it is done (`migration` in the record and the file in
//!   the older library) are written last.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ctx::Library;
use super::disk::{self, child_rel};
use super::legacy;
use super::names::{self, DIAGRAM_EXT};
use super::state::{self, BoardSpot, LibraryState, Migration, ProjectRecord};
use super::walk::Siblings;

/// the file the older library gets once it has been moved
pub const MARKER: &str = ".migrated-to";
/// where the run writes how far it got
pub const JOURNAL: &str = "migration.json";

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

/// One rename the run makes or made: written down before it is made.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
struct Move {
    from: String,
    to: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct Journal {
    stage: Stage,
    mode: Mode,
    /// the hidden folder the copy is built in
    staging: String,
    moves: Vec<Move>,
    /// the projects as the record will have them — their paths final once
    /// placed
    #[serde(default)]
    projects: Value,
}

/// A project as the run will make it.
#[derive(Debug, Clone)]
struct Planned {
    record: ProjectRecord,
    /// its name in the staging folder
    name: String,
    /// folders to make, relative to the project, parents first
    dirs: Vec<String>,
    /// diagrams to copy: where in the project, from where
    files: Vec<(String, PathBuf)>,
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
    /// where a test makes the run fail, and how
    pub(crate) static FAIL_AT: std::cell::Cell<Option<(&'static str, Inject)>> = const { std::cell::Cell::new(None) };
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
    match FAIL_AT.with(|f| f.get()) {
        Some((at, how)) if at == point => {
            FAIL_AT.with(|f| f.set(None));
            match how {
                Inject::Fail => Err(Failure::Error(format!("failed at {point}"))),
                Inject::Crash => Err(Failure::Crash),
            }
        }
        _ => Ok(()),
    }
}

#[cfg(not(test))]
fn step(_point: &'static str) -> Result<(), Failure> {
    Ok(())
}

/// Moves the older library when it has not been moved yet — first
/// taking back or finishing a run cut short. Whether it moved it now.
pub fn run(lib: &Library) -> Result<bool, String> {
    let held = lib.lock();
    let mut st = lib.load_state(&held)?;
    resume(lib, &held, &mut st)?;
    if st.migration.is_some() || disk::exists(&lib.legacy_dir.join(MARKER)) {
        return Ok(false);
    }
    let old = legacy::read_only(&lib.legacy_dir);
    if old.folders.is_empty() {
        return Ok(false);
    }
    let mode = if disk::exists(&lib.default_location) {
        Mode::Each
    } else {
        Mode::Whole
    };
    let planned = plan(&old, &st, &lib.default_location, mode);
    let staging = staging_path(&lib.default_location, mode);
    let mut journal = Journal {
        stage: Stage::Building,
        mode,
        staging: state::path_text(&staging)?,
        moves: Vec::new(),
        projects: Value::Null,
    };
    write_journal(lib, &journal)?;
    match carry_out(lib, &held, &mut st, &mut journal, planned) {
        Ok(()) => Ok(true),
        Err(Failure::Error(e)) => {
            if let Err(undo) = take_back(lib, &journal) {
                eprintln!(
                    "library: could not take back a failed move of the older library: {undo}"
                );
            }
            Err(format!("moving the older library failed: {e}"))
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
    mut planned: Vec<Planned>,
) -> Result<(), Failure> {
    step("journal")?;
    let staging = PathBuf::from(&journal.staging);
    std::fs::create_dir_all(&staging).map_err(|e| format!("{}: {e}", staging.display()))?;
    for (n, project) in planned.iter().enumerate() {
        build(&staging, project)?;
        if n == 0 {
            step("build")?;
        }
    }
    journal.stage = Stage::Moving;
    write_journal(lib, journal)?;
    step("moving")?;
    match journal.mode {
        Mode::Whole => {
            let to = &lib.default_location;
            if disk::exists(to) {
                return Err(Failure::Error(format!("{}: made meanwhile", to.display())));
            }
            journal.moves.push(Move {
                from: journal.staging.clone(),
                to: state::path_text(to)?,
            });
            write_journal(lib, journal)?;
            {
                let _change = lib.restructure(held);
                std::fs::rename(&staging, to).map_err(|e| format!("{}: {e}", to.display()))?;
            }
            for project in planned.iter_mut() {
                project.record.path = state::path_text(&to.join(&project.name))?;
            }
            step("move")?;
        }
        Mode::Each => {
            for (n, project) in planned.iter_mut().enumerate() {
                let default = &lib.default_location;
                let name = Siblings::read(default)?.folder_name(&project.name);
                let (from, to) = (staging.join(&project.name), default.join(&name));
                journal.moves.push(Move {
                    from: state::path_text(&from)?,
                    to: state::path_text(&to)?,
                });
                write_journal(lib, journal)?;
                {
                    let _change = lib.restructure(held);
                    if disk::exists(&to) {
                        return Err(Failure::Error(format!("{}: made meanwhile", to.display())));
                    }
                    std::fs::rename(&from, &to).map_err(|e| format!("{}: {e}", to.display()))?;
                }
                project.record.path = state::path_text(&to)?;
                if n == 0 {
                    step("move")?;
                }
            }
            std::fs::remove_dir_all(&staging).map_err(|e| format!("{}: {e}", staging.display()))?;
        }
    }
    journal.stage = Stage::Placed;
    journal.projects =
        serde_json::to_value(planned.iter().map(|p| p.record.clone()).collect::<Vec<_>>())
            .map_err(|e| e.to_string())?;
    write_journal(lib, journal)?;
    step("state")?;
    finish(lib, held, st, journal)?;
    Ok(())
}

/// The record and the markers, once everything is in place.
fn finish(
    lib: &Library,
    held: &std::sync::MutexGuard<'_, ()>,
    st: &mut LibraryState,
    journal: &Journal,
) -> Result<(), Failure> {
    if st.migration.is_none() {
        let wrapped = serde_json::json!({ "projects": journal.projects });
        let projects = state::from_value(&wrapped)
            .map(|s| s.projects)
            .unwrap_or_default();
        // on top, in their order, before anything the record has already
        for (n, record) in projects.into_iter().enumerate() {
            if st.project_at(&record.root()).is_none() {
                st.projects.insert(n.min(st.projects.len()), record);
            }
        }
        st.migration = Some(Migration {
            from: state::path_text(&lib.legacy_dir)?,
            to: state::path_text(&lib.default_location)?,
            at: disk::now_ms(),
        });
        lib.save_state(held, st)?;
    }
    // from here the move stands: a marker that cannot be written is
    // written on the next start, the journal kept for it
    let marked = step("marker").and_then(|()| {
        let target = state::path_text(&lib.default_location)?;
        disk::write_atomic(&lib.legacy_dir.join(MARKER), target.as_bytes())?;
        Ok(())
    });
    match marked {
        Ok(()) => {
            let _ = std::fs::remove_file(lib.data_dir.join(JOURNAL));
            Ok(())
        }
        Err(Failure::Error(e)) => {
            eprintln!("library: the older library is moved, but not marked yet: {e}");
            Ok(())
        }
        #[cfg(test)]
        Err(Failure::Crash) => Err(Failure::Crash),
    }
}

/// A run cut short: taken back while it was building or moving — the next
/// run starts over — or finished once everything was in place.
fn resume(
    lib: &Library,
    held: &std::sync::MutexGuard<'_, ()>,
    st: &mut LibraryState,
) -> Result<(), String> {
    let file = lib.data_dir.join(JOURNAL);
    let text = match std::fs::read_to_string(&file) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("{}: {e}", file.display())),
    };
    let Ok(journal) = serde_json::from_str::<Journal>(&text) else {
        // nothing can be told from it; what it would name is hidden and stays
        eprintln!("library: {} could not be read; put aside", file.display());
        let aside = file.with_extension(format!("json.broken-{}", disk::now_ms()));
        return std::fs::rename(&file, &aside).map_err(|e| format!("{}: {e}", file.display()));
    };
    match journal.stage {
        Stage::Placed => match finish(lib, held, st, &journal) {
            Ok(()) => Ok(()),
            Err(Failure::Error(e)) => Err(e),
            #[cfg(test)]
            Err(Failure::Crash) => Err("stopped".into()),
        },
        Stage::Building | Stage::Moving => take_back(lib, &journal),
    }
}

/// Takes back what a run made: each rename it made undone, the staging
/// folder removed, the journal last. Only what the run made is touched — a
/// rename's target counts as the run's only while its source is gone.
fn take_back(lib: &Library, journal: &Journal) -> Result<(), String> {
    for done in journal.moves.iter().rev() {
        let (from, to) = (Path::new(&done.from), Path::new(&done.to));
        if !disk::exists(from) && disk::exists(to) {
            // back into the staging folder, made again if it was removed
            if let Some(parent) = from.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("{}: {e}", parent.display()))?;
            }
            std::fs::rename(to, from).map_err(|e| format!("{}: {e}", to.display()))?;
        }
    }
    let staging = Path::new(&journal.staging);
    if disk::exists(staging) {
        std::fs::remove_dir_all(staging).map_err(|e| format!("{}: {e}", staging.display()))?;
    }
    let file = lib.data_dir.join(JOURNAL);
    match std::fs::remove_file(&file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{}: {e}", file.display())),
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
        Mode::Each => default.join(format!(".dosik-migrating-{stamp}")),
    }
}

/// Makes one project's folders and copies its diagrams into `staging`.
fn build(staging: &Path, project: &Planned) -> Result<(), String> {
    let root = staging.join(&project.name);
    std::fs::create_dir(&root).map_err(|e| format!("{}: {e}", root.display()))?;
    for rel in &project.dirs {
        let dir = disk::join_rel(&root, rel).ok_or("a name that is not one")?;
        std::fs::create_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    for (rel, source) in &project.files {
        let dest = disk::join_rel(&root, rel).ok_or("a name that is not one")?;
        std::fs::copy(source, &dest).map_err(|e| format!("{}: {e}", source.display()))?;
        disk::keep_mtime(source, &dest);
    }
    Ok(())
}

/// What the run will make of the older library: a project for each, named
/// to clash with nothing, ids kept unless the record has them already.
fn plan(old: &legacy::ReadOnly, st: &LibraryState, default: &Path, mode: Mode) -> Vec<Planned> {
    let mut ids = Ids {
        taken: st
            .projects
            .iter()
            .flat_map(|p| std::iter::once(p.id.clone()).chain(p.ids.values().cloned()))
            .collect(),
        diagrams: HashMap::new(),
        fresh: LibraryState::default(),
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
        let name = Siblings::of(project_names.clone())
            .folder_name(&names::clean(&folder.name, names::UNTITLED_PROJECT));
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
            },
            name,
            dirs: Vec::new(),
            files: Vec::new(),
        };
        plan_folder(old, folder, "", &mut planned, &mut ids);
        out.push(planned);
    }
    out
}

/// The ids the run gives out: none twice, none the record has.
struct Ids {
    taken: std::collections::HashSet<String>,
    /// each older diagram's id → its id from now on
    diagrams: HashMap<String, String>,
    fresh: LibraryState,
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
                let name = Siblings::of(entries.clone())
                    .folder_name(&names::clean(&sub.name, names::UNTITLED_FOLDER));
                entries.push(name.clone());
                order.push(name.clone());
                let sub_rel = child_rel(rel, &name);
                let new_id = ids.keep_or_new(&sub.id);
                planned.record.ids.insert(sub_rel.clone(), new_id);
                planned.dirs.push(sub_rel.clone());
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
                    continue;
                };
                let wanted = match serde_json::from_slice::<Value>(&bytes) {
                    Ok(doc) => names::clean(
                        doc.get("title").and_then(Value::as_str).unwrap_or_default(),
                        names::UNTITLED_DIAGRAM,
                    ),
                    Err(_) => id.to_string(),
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
