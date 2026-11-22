//! Reading a project folder: what is in it as the library sees it.
//!
//! - Hidden names (a leading dot), temp files (`.tmp`) and symbolic links
//!   are never read — neither a cycle nor a write outside the project.
//! - Diagrams are `<name>.dosik` files, or `<name>.dosik.json` from before.
//!   Any other file is the user's and is left alone.
//! - Folders nest at most `MAX_DEPTH` deep, the project being 1; deeper ones
//!   are not read. A name that is not UTF-8 is skipped: the record and the
//!   webview speak JSON.
//! - A folder inside a project shows when a diagram is in it or under it, or
//!   when the app knows it (it has an id) — a project made of a repository
//!   does not show every folder of it. The project itself always shows.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::disk::{self, child_rel, TMP_EXT};
use super::names::{self, diagram_stem};

/// How deep folders nest — a project is level 1. Deeper directories made by
/// hand are not read.
pub const MAX_DEPTH: usize = 10;

/// What an entry of a folder is to the library.
#[derive(Debug, PartialEq, Eq, Clone)]
pub enum Entry {
    /// never read: hidden, a temp file
    Skip,
    Folder,
    /// a diagram, and the name it shows
    Diagram(String),
    /// a file of the user's that is not a diagram
    Other,
}

/// What the entry `name` is — `dir` when it is a real directory. Links are
/// the caller's to skip: only it knows what the entry is on disk.
pub fn classify(name: &str, dir: bool) -> Entry {
    if name.starts_with('.') || name.to_ascii_lowercase().ends_with(TMP_EXT) {
        return Entry::Skip;
    }
    if dir {
        return Entry::Folder;
    }
    match diagram_stem(name) {
        Some(stem) => Entry::Diagram(stem.to_string()),
        None => Entry::Other,
    }
}

/// Whether the item at `rel` in a project — a folder (`is_dir`) or a file —
/// is in a place the walk reads: every name on the way a folder it reads,
/// the last a folder or a diagram, no deeper than `MAX_DEPTH`. The one rule
/// for a path from outside — a note of the MCP server's, a file the OS hands
/// over, an event of the watch. (A folder shows only with a diagram under it
/// or an id: `shown` says that.)
pub fn shown_rel(rel: &str, is_dir: bool) -> bool {
    if rel.is_empty() {
        return false;
    }
    let names: Vec<&str> = rel.split('/').collect();
    let last = names.len() - 1;
    // a folder at `names` is level `names + 1`; a file is in level `names`
    let within = if is_dir {
        names.len() < MAX_DEPTH
    } else {
        names.len() <= MAX_DEPTH
    };
    within
        && names
            .iter()
            .enumerate()
            .all(|(i, name)| match classify(name, i < last || is_dir) {
                Entry::Folder => true,
                Entry::Diagram(_) => i == last,
                Entry::Skip | Entry::Other => false,
            })
}

/// `rel` in the project at `root` with each name as the folder on the way
/// stores it — what the walk, and so the record, calls it. A path from
/// outside may spell a name otherwise and still reach the entry: in another
/// case, or Korean decomposed, on a disk that ignores both (macOS). `None`
/// when a name reaches nothing.
pub fn stored_rel(root: &Path, rel: &str) -> Option<String> {
    if rel.is_empty() {
        return Some(String::new());
    }
    let mut at = root.to_path_buf();
    let mut out: Vec<String> = Vec::new();
    for name in rel.split('/') {
        let mut like = Vec::new();
        let mut exact = None;
        for entry in std::fs::read_dir(&at).ok()?.flatten() {
            let Some(stored) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if stored == name {
                exact = Some(stored);
                break;
            }
            if names::same(&stored, name) {
                like.push(stored);
            }
        }
        // spelt otherwise, it counts only where the disk itself reaches that
        // very entry so — a disk that tells case apart, not normal forms, may
        // hold a sibling alike by name that is another entry
        let stored = exact.or_else(|| {
            like.into_iter()
                .find(|stored| disk::same_entry(&at.join(stored), &at.join(name)))
        })?;
        at.push(&stored);
        out.push(stored);
    }
    Some(out.join("/"))
}

/// The name `name`, just made in `dir`, as `dir` stores it — a disk that
/// stores names decomposed (HFS+, some shares) hands back another spelling
/// than the one made, and the walk, and so the record, goes by that one.
pub fn stored_name(dir: &Path, name: &str) -> String {
    #[cfg(test)]
    if let Some(hook) = AS_STORED.with(|hook| hook.borrow_mut().take()) {
        hook(dir, name);
    }
    stored_rel(dir, name).unwrap_or_else(|| name.to_string())
}

/// what a test does to a name just made before it is looked up — store it
/// decomposed, as a disk that does so would
#[cfg(test)]
pub(crate) type StoredHook = Box<dyn FnOnce(&Path, &str)>;

#[cfg(test)]
thread_local! {
    pub(crate) static AS_STORED: std::cell::RefCell<Option<StoredHook>> = const { std::cell::RefCell::new(None) };
}

/// Has the next name looked up stored decomposed, as a disk that stores
/// names so would (macOS renames the entry in place).
#[cfg(all(test, target_os = "macos"))]
pub(crate) fn store_next_name_decomposed() {
    use unicode_normalization::UnicodeNormalization;
    AS_STORED.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(|dir: &Path, name: &str| {
            let nfd: String = name.nfd().collect();
            std::fs::rename(dir.join(name), dir.join(nfd)).unwrap();
        }))
    });
}

/// One diagram the walk found.
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct WalkedDiagram {
    /// relative to the project, `/` between names
    pub rel: String,
    /// its file's name
    pub file: String,
    /// the name it shows: the file's, without the extension
    pub name: String,
    /// last modification, milliseconds since the Unix epoch
    pub modified: u64,
    /// whether the app can open it — see `is_one_canvas`
    pub readable: bool,
}

/// One folder the walk found — the project itself at the top (`rel` `""`).
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct WalkedDir {
    pub rel: String,
    pub name: String,
    /// the project is 1
    pub depth: usize,
    /// the folder's own last modification — how new an empty folder is
    pub modified: u64,
    pub dirs: Vec<WalkedDir>,
    pub diagrams: Vec<WalkedDiagram>,
    /// whether a diagram is in it or in a folder under it
    pub holds_diagrams: bool,
    /// Whether what is directly in it was all read: not when it could not
    /// be read (it shows as empty). What the record has directly in such a
    /// folder is not forgotten.
    pub listed: bool,
    /// The diagrams in it kept online only — what iCloud leaves of one in
    /// its place before macOS 14 is a hidden `.<name>.dosik.icloud` — by
    /// their files' names: there, only not on this disk, and not forgotten.
    pub online_only: Vec<String>,
    /// Whether it and every folder under it was all read (`listed`).
    pub complete: bool,
}

impl WalkedDir {
    /// every folder at or under this one, this one first
    pub fn all_dirs(&self) -> Vec<&WalkedDir> {
        let mut out = vec![self];
        for sub in &self.dirs {
            out.extend(sub.all_dirs());
        }
        out
    }

    /// every diagram at or under this one kept online only, by where it is
    pub fn online_only_rels(&self) -> Vec<String> {
        self.all_dirs()
            .into_iter()
            .flat_map(|d| d.online_only.iter().map(|f| child_rel(&d.rel, f)))
            .collect()
    }

    /// whether each folder at or under this one was all read, by where it is
    pub fn listed_dirs(&self) -> HashMap<String, bool> {
        self.all_dirs()
            .into_iter()
            .map(|d| (d.rel.clone(), d.listed))
            .collect()
    }

    /// the entry names directly in it, folders and diagrams — what an order names
    pub fn item_names(&self) -> Vec<String> {
        self.dirs
            .iter()
            .map(|d| d.name.clone())
            .chain(self.diagrams.iter().map(|d| d.file.clone()))
            .collect()
    }
}

/// The real directories and diagram files directly in `dir`, by name:
/// `(name, is_dir)`. Hidden names, temp files, links and names that are not
/// UTF-8 are left out — `file_type` does not follow links. A folder that
/// cannot be read, wholly, is an error: it is not an empty one.
pub fn entries(dir: &Path) -> std::io::Result<Vec<(String, bool)>> {
    read_entries(dir).map(|read| read.found)
}

/// What is directly in a folder, as the library reads it.
struct ReadDir {
    /// `entries`
    found: Vec<(String, bool)>,
    /// the diagrams kept online only, by their files' names — see
    /// `WalkedDir::online_only`
    online_only: Vec<String>,
    /// the library's own temp entries in it (`disk::is_temp_name`):
    /// `(name, is_dir)`
    temps: Vec<(String, bool)>,
}

fn read_entries(dir: &Path) -> std::io::Result<ReadDir> {
    let mut read = ReadDir {
        found: Vec::new(),
        online_only: Vec::new(),
        temps: Vec::new(),
    };
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let kind = entry.file_type()?;
        let is_dir = kind.is_dir();
        if !is_dir && !kind.is_file() {
            continue;
        }
        match classify(&name, is_dir) {
            Entry::Folder | Entry::Diagram(_) => read.found.push((name, is_dir)),
            Entry::Skip if disk::is_temp_name(&name) => read.temps.push((name, is_dir)),
            Entry::Skip if !is_dir => read.online_only.extend(stands_in_for_a_diagram(&name)),
            Entry::Skip | Entry::Other => {}
        }
    }
    read.found.sort();
    Ok(read)
}

/// Clears what a write that stopped halfway left in `dir` — the library's
/// own temp entries a day old: one newer may be a write under way.
fn clear_stale_temps(dir: &Path, temps: &[(String, bool)]) {
    for (name, is_dir) in temps {
        let path = dir.join(name);
        let stale = std::fs::symlink_metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|at| at.elapsed().ok())
            .is_some_and(|age| age >= disk::STALE_TEMP);
        if !stale {
            continue;
        }
        let cleared = if *is_dir {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        if let Err(e) = cleared {
            eprintln!("library: {} is left: {e}", path.display());
        }
    }
}

/// The diagram file the hidden file `name` stands in for, when it is
/// iCloud's stand-in for one kept online only: `.<name>.dosik.icloud`,
/// `.<name>.dosik.json.icloud`
fn stands_in_for_a_diagram(name: &str) -> Option<String> {
    const SUFFIX: &str = ".icloud";
    let lower = name.to_ascii_lowercase();
    if name.len() <= 1 + SUFFIX.len() || !lower.starts_with('.') || !lower.ends_with(SUFFIX) {
        return None;
    }
    let file = &name[1..name.len() - SUFFIX.len()];
    diagram_stem(file).map(|_| file.to_string())
}

/// `entries`, none when the folder cannot be read — for what only looks
pub fn entries_or_none(dir: &Path) -> Vec<(String, bool)> {
    entries(dir).unwrap_or_default()
}

/// The empty project `name` — what one shows while its folder cannot be read.
pub fn unread(name: String) -> WalkedDir {
    WalkedDir {
        rel: String::new(),
        name,
        depth: 1,
        modified: 0,
        dirs: Vec::new(),
        diagrams: Vec::new(),
        holds_diagrams: false,
        listed: false,
        online_only: Vec::new(),
        complete: false,
    }
}

/// What a listing found of a diagram file: its time and length, and whether
/// it opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Seen {
    modified: SystemTime,
    len: u64,
    readable: bool,
}

/// Whether each diagram opens, from what the last listing found of it: a
/// file of the same time and length is not read again — on a library in a
/// synced folder, every file read is a download. What this walk saw is
/// what the next one starts from.
#[derive(Debug, Default)]
pub struct ReadCache {
    before: HashMap<PathBuf, Seen>,
    now: HashMap<PathBuf, Seen>,
}

impl ReadCache {
    /// starting from what the last walk saw
    pub fn from(before: HashMap<PathBuf, Seen>) -> ReadCache {
        ReadCache {
            before,
            now: HashMap::new(),
        }
    }

    /// what this walk saw — for the next one
    pub fn seen(self) -> HashMap<PathBuf, Seen> {
        self.now
    }

    /// whether the diagram file at `path`, of `meta`, opens
    fn readable(&mut self, path: &Path, meta: Option<&std::fs::Metadata>) -> bool {
        let stamp = meta.and_then(|m| Some((m.modified().ok()?, m.len())));
        let known = stamp.and_then(|(modified, len)| {
            self.before
                .get(path)
                .filter(|s| s.modified == modified && s.len == len)
        });
        let readable = match known {
            Some(seen) => seen.readable,
            None => std::fs::read_to_string(path).is_ok_and(|text| readable(&text)),
        };
        if let Some((modified, len)) = stamp {
            let seen = Seen {
                modified,
                len,
                readable,
            };
            self.now.insert(path.to_path_buf(), seen);
        }
        readable
    }
}

/// `walk_with` and a cache of its own: every diagram read
#[cfg(test)]
pub fn walk(root: &Path) -> Result<Option<WalkedDir>, String> {
    walk_with(root, &mut ReadCache::default())
}

/// Everything in the project at `root`, down to `MAX_DEPTH` — `None` when
/// no real directory is there, an error when the file system will not say.
/// Every diagram the cache does not know as it is is read, to say whether
/// it opens.
pub fn walk_with(root: &Path, cache: &mut ReadCache) -> Result<Option<WalkedDir>, String> {
    match disk::presence(root) {
        disk::Presence::Dir => {}
        disk::Presence::Unknown(kind) => return Err(format!("{}: {kind}", root.display())),
        disk::Presence::File | disk::Presence::Other | disk::Presence::Missing => return Ok(None),
    }
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(Some(walk_dir(root, String::new(), name, 1, cache)))
}

fn walk_dir(
    path: &Path,
    rel: String,
    name: String,
    depth: usize,
    cache: &mut ReadCache,
) -> WalkedDir {
    let mut dirs = Vec::new();
    let mut diagrams = Vec::new();
    let (found, listed, online_only) = match read_entries(path) {
        Ok(read) => {
            clear_stale_temps(path, &read.temps);
            (read.found, true, read.online_only)
        }
        Err(_) => (Vec::new(), false, Vec::new()),
    };
    let mut complete = listed;
    for (entry, is_dir) in found {
        let entry_rel = child_rel(&rel, &entry);
        let entry_path = path.join(&entry);
        if is_dir {
            if depth < MAX_DEPTH {
                let sub = walk_dir(&entry_path, entry_rel, entry, depth + 1, cache);
                complete &= sub.complete;
                dirs.push(sub);
            }
        } else if let Some(stem) = diagram_stem(&entry) {
            let meta = std::fs::symlink_metadata(&entry_path).ok();
            diagrams.push(WalkedDiagram {
                rel: entry_rel,
                name: stem.to_string(),
                modified: disk::ms_of(meta.as_ref()),
                readable: cache.readable(&entry_path, meta.as_ref()),
                file: entry,
            });
        }
    }
    let holds_diagrams = !diagrams.is_empty() || dirs.iter().any(|d| d.holds_diagrams);
    WalkedDir {
        rel,
        name,
        depth,
        modified: disk::modified_ms(path),
        dirs,
        diagrams,
        holds_diagrams,
        listed,
        online_only,
        complete,
    }
}

/// Whether a diagram file's text opens: a JSON object whose `nodes` and
/// `edges` are arrays, with no `pages` key — a document with pages (never
/// shipped) is listed only so it can be deleted. The frontend's
/// `isDiagramDocShape` asks the same.
pub fn readable(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).is_ok_and(|doc| is_one_canvas(&doc))
}

pub fn is_one_canvas(doc: &serde_json::Value) -> bool {
    let Some(doc) = doc.as_object() else {
        return false;
    };
    let has = |key: &str| doc.get(key).is_some_and(|v| v.is_array());
    !doc.contains_key("pages") && has("nodes") && has("edges")
}

/// The project as it shows: a folder inside it only when a diagram is in it
/// or under it, or `known` says the app has an id for it — and every folder
/// on the way to one that shows. The project itself always shows.
pub fn shown(mut root: WalkedDir, known: &dyn Fn(&str) -> bool) -> WalkedDir {
    root.dirs = prune(root.dirs, known);
    root
}

fn prune(dirs: Vec<WalkedDir>, known: &dyn Fn(&str) -> bool) -> Vec<WalkedDir> {
    dirs.into_iter()
        .filter_map(|mut dir| {
            dir.dirs = prune(dir.dirs, known);
            (dir.holds_diagrams || known(&dir.rel) || !dir.dirs.is_empty()).then_some(dir)
        })
        .collect()
}

/// The names of the items directly in folder `dir` (at `rel`, `depth`)
/// that show — every diagram, and each folder that `shown` would keep —
/// what an index among its items counts. Read from names alone: no
/// diagram is opened.
pub fn visible_items(
    dir: &Path,
    rel: &str,
    depth: usize,
    known: &dyn Fn(&str) -> bool,
) -> Vec<String> {
    entries_or_none(dir)
        .into_iter()
        .filter(|(name, is_dir)| {
            !is_dir
                || (depth < MAX_DEPTH
                    && shows(&dir.join(name), &child_rel(rel, name), depth + 1, known))
        })
        .map(|(name, _)| name)
        .collect()
}

/// whether the folder at `path` (at `rel`, `depth`) shows: known, or a
/// diagram in it, or a folder under it that shows
fn shows(path: &Path, rel: &str, depth: usize, known: &dyn Fn(&str) -> bool) -> bool {
    if known(rel) {
        return true;
    }
    entries_or_none(path).into_iter().any(|(name, is_dir)| {
        if is_dir {
            depth < MAX_DEPTH && shows(&path.join(&name), &child_rel(rel, &name), depth + 1, known)
        } else {
            true
        }
    })
}

/// How many levels the folder at `path` takes, itself included — every real
/// folder under it counted, shown or not, no deeper than `limit`.
pub fn height(path: &Path, limit: usize) -> usize {
    if limit <= 1 {
        return 1;
    }
    1 + entries_or_none(path)
        .into_iter()
        .filter(|(_, is_dir)| *is_dir)
        .map(|(name, _)| height(&path.join(name), limit - 1))
        .max()
        .unwrap_or(0)
}

/// How new the folder at `path` (at `rel`, `depth`) is as the listing
/// tells it — the newest of the diagrams in it and of the folders under it
/// that show; one with none of those is as new as itself — from file times
/// alone: no diagram is opened.
pub fn newest_shown(path: &Path, rel: &str, depth: usize, known: &dyn Fn(&str) -> bool) -> u64 {
    entries_or_none(path)
        .into_iter()
        .filter_map(|(name, is_dir)| {
            let at = path.join(&name);
            if !is_dir {
                return Some(disk::modified_ms(&at));
            }
            let sub = child_rel(rel, &name);
            (depth < MAX_DEPTH && shows(&at, &sub, depth + 1, known))
                .then(|| newest_shown(&at, &sub, depth + 1, known))
        })
        .max()
        .unwrap_or_else(|| disk::modified_ms(path))
}

/// The names already in a folder, for naming something new there or
/// renaming something in it: every entry counts — hidden ones, links,
/// files that are no diagram — since any of them would be in the way.
pub struct Siblings {
    /// `(name, folded name, folded diagram name)`
    entries: Vec<(String, String, Option<String>)>,
}

impl Siblings {
    /// The entries of `dir` — none when it does not exist yet.
    pub fn read(dir: &Path) -> Result<Siblings, String> {
        let read = match std::fs::read_dir(dir) {
            Ok(read) => read,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Siblings {
                    entries: Vec::new(),
                })
            }
            Err(e) => return Err(format!("{}: {e}", dir.display())),
        };
        Ok(Siblings::of(
            read.flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned()),
        ))
    }

    pub fn of(names: impl IntoIterator<Item = String>) -> Siblings {
        Siblings {
            entries: names
                .into_iter()
                .map(|name| {
                    let folded = names::fold(&name);
                    let stem = diagram_stem(&name).map(names::fold);
                    (name, folded, stem)
                })
                .collect(),
        }
    }

    /// Without the entry called exactly `name` — the item being renamed or
    /// moved, whose own name is no clash.
    pub fn except(mut self, name: &str) -> Siblings {
        if let Some(at) = self.entries.iter().position(|(n, _, _)| n == name) {
            self.entries.remove(at);
        }
        self
    }

    fn has(&self, folded: &str) -> bool {
        self.entries.iter().any(|(_, f, _)| f == folded)
    }

    /// what a new folder wanted as `wanted` is called here
    pub fn folder_name(&self, wanted: &str) -> String {
        self.folder_name_avoiding(wanted, &[])
    }

    /// `folder_name`, also clear of the names in `also` — ones found taken
    /// since this was read
    pub fn folder_name_avoiding(&self, wanted: &str, also: &[String]) -> String {
        names::unique_name(wanted, |c| {
            self.has(&names::fold(c)) || also.iter().any(|t| names::same(t, c))
        })
    }

    /// What a new diagram wanted as `wanted` is called here — its name,
    /// without the extension: no entry may have its file's name, and no
    /// diagram the name it would show.
    pub fn diagram_name(&self, wanted: &str, ext: &str) -> String {
        self.diagram_name_avoiding(wanted, ext, &[])
    }

    /// `diagram_name`, also clear of the file names in `also`
    pub fn diagram_name_avoiding(&self, wanted: &str, ext: &str, also: &[String]) -> String {
        names::unique_name(wanted, |c| {
            let folded = names::fold(c);
            let file = format!("{c}{ext}");
            self.has(&names::fold(&file))
                || also.iter().any(|t| names::same(t, &file))
                || self
                    .entries
                    .iter()
                    .any(|(_, _, stem)| stem.as_deref() == Some(folded.as_str()))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::disk::tests::scratch;
    use crate::library::names::tests::rules;

    fn doc() -> &'static str {
        r#"{"version":1,"title":"x","nodes":[],"edges":[]}"#
    }

    fn put(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn dir_rels(root: &WalkedDir) -> Vec<String> {
        root.all_dirs().iter().map(|d| d.rel.clone()).collect()
    }

    fn diagram_rels(root: &WalkedDir) -> Vec<String> {
        root.all_dirs()
            .iter()
            .flat_map(|d| d.diagrams.iter().map(|g| g.rel.clone()))
            .collect()
    }

    #[test]
    fn entries_are_told_apart_by_the_shared_rules() {
        let rules = rules();
        assert_eq!(rules["maxDepth"], MAX_DEPTH);
        for case in rules["entries"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let dir = case["dir"].as_bool().unwrap();
            let want = match case["kind"].as_str().unwrap() {
                "skip" => Entry::Skip,
                "folder" => Entry::Folder,
                "other" => Entry::Other,
                "diagram" => Entry::Diagram(case["stem"].as_str().unwrap().to_string()),
                kind => panic!("unknown kind {kind}"),
            };
            assert_eq!(classify(name, dir), want, "{case}");
        }
    }

    #[test]
    fn a_path_is_spelt_as_its_names_are_stored() {
        let root = scratch("walk-stored");
        put(&root.join("Sub/Flow.dosik"), doc());
        assert_eq!(stored_rel(&root, ""), Some(String::new()));
        assert_eq!(
            stored_rel(&root, "Sub/Flow.dosik").as_deref(),
            Some("Sub/Flow.dosik")
        );
        assert_eq!(stored_rel(&root, "Sub/Gone.dosik"), None);
        // spelt in another case: the stored names where the disk ignores case
        // (macOS, Windows), nothing where it does not
        let other = stored_rel(&root, "sub/FLOW.dosik");
        let ignores_case = root.join("sub").exists();
        assert_eq!(
            other.as_deref(),
            ignores_case.then_some("Sub/Flow.dosik"),
            "{other:?}"
        );
    }

    #[test]
    fn a_name_just_made_is_taken_as_the_folder_stores_it() {
        let root = scratch("walk-stored-name");
        std::fs::create_dir_all(root.join("Sub")).unwrap();
        assert_eq!(stored_name(&root, "Sub"), "Sub");
        // not there: as it is spelt
        assert_eq!(stored_name(&root, "Gone"), "Gone");
        #[cfg(target_os = "macos")]
        {
            // stored decomposed, asked composed: the stored spelling
            let nfd = "Cafe\u{301}";
            std::fs::create_dir_all(root.join(nfd)).unwrap();
            assert_eq!(stored_name(&root, "Caf\u{e9}"), nfd);
        }
    }

    #[test]
    fn an_item_shows_by_its_place_as_the_walk_reads_it() {
        let deepest_dir: Vec<String> = (2..=MAX_DEPTH).map(|n| format!("L{n}")).collect();
        let deepest_dir = deepest_dir.join("/");
        for (rel, dir, want) in [
            ("Flow.dosik", false, true),
            ("Old.DOSIK.JSON", false, true),
            ("Sub", true, true),
            ("Sub/In/Flow.dosik", false, true),
            ("notes.txt", false, false),
            (".hidden/Flow.dosik", false, false),
            ("Sub/.git", true, false),
            ("Flow.dosik.tmp", false, false),
            ("Flow.dosik", true, true),
            ("Sub/Flow.dosik/x.dosik", false, true),
            ("", true, false),
        ] {
            assert_eq!(shown_rel(rel, dir), want, "{rel} {dir}");
        }
        // as deep as the walk reads, and no deeper
        assert!(shown_rel(&deepest_dir, true));
        assert!(shown_rel(&format!("{deepest_dir}/x.dosik"), false));
        assert!(!shown_rel(&format!("{deepest_dir}/Deeper"), true));
        assert!(!shown_rel(&format!("{deepest_dir}/Deeper/x.dosik"), false));
    }

    #[test]
    fn a_project_is_walked_folder_by_folder() {
        let root = scratch("walk").join("Payments");
        put(&root.join("Flow.dosik"), doc());
        put(&root.join("Old.dosik.json"), doc());
        put(&root.join("notes.txt"), "mine");
        put(&root.join("Sub/In/Deep.dosik"), doc());
        put(&root.join(".git/HEAD.dosik"), doc());
        put(&root.join(".hidden.dosik"), doc());
        put(&root.join("Flow.dosik.tmp"), doc());
        let walked = walk(&root).unwrap().unwrap();
        assert_eq!(walked.name, "Payments");
        assert_eq!(walked.rel, "");
        assert_eq!(walked.depth, 1);
        assert_eq!(dir_rels(&walked), vec!["", "Sub", "Sub/In"]);
        assert_eq!(
            diagram_rels(&walked),
            vec!["Flow.dosik", "Old.dosik.json", "Sub/In/Deep.dosik"]
        );
        let flow = &walked.diagrams[0];
        assert_eq!(
            (flow.file.as_str(), flow.name.as_str()),
            ("Flow.dosik", "Flow")
        );
        assert_eq!(walked.diagrams[1].name, "Old");
        assert!(walked.holds_diagrams && walked.dirs[0].holds_diagrams);
        assert_eq!(walked.dirs[0].dirs[0].depth, 3);
        assert_eq!(
            walked.item_names(),
            vec!["Sub", "Flow.dosik", "Old.dosik.json"]
        );
    }

    #[test]
    fn a_missing_root_or_a_file_is_no_project() {
        let dir = scratch("walk-none");
        assert_eq!(walk(&dir.join("gone")), Ok(None));
        put(&dir.join("file"), "x");
        assert_eq!(walk(&dir.join("file")), Ok(None));
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_cannot_be_read_leaves_the_walk_incomplete() {
        let root = scratch("walk-unreadable");
        put(&root.join("a.dosik"), doc());
        put(&root.join("Sub/In/b.dosik"), doc());
        assert!(walk(&root).unwrap().unwrap().complete);
        let Some(_unlock) = crate::library::listing::tests::lock_out(&root.join("Sub/In")) else {
            return;
        };
        let walked = walk(&root).unwrap().unwrap();
        assert!(!walked.complete && !walked.dirs[0].complete);
        assert!(walked.dirs[0].dirs[0].diagrams.is_empty());
        assert!(
            entries(&root.join("Sub/In")).is_err(),
            "not an empty folder"
        );
        assert_eq!(walked.diagrams.len(), 1);
    }

    #[test]
    fn a_diagram_cloud_storage_took_off_the_disk_is_named_as_there() {
        let root = scratch("walk-icloud");
        put(&root.join("Keep.dosik"), doc());
        put(&root.join("Sub/In.dosik"), doc());
        // what iCloud leaves of a file it keeps only online, before macOS 14
        put(&root.join("Sub/.Flow.dosik.icloud"), "placeholder");
        let walked = walk(&root).unwrap().unwrap();
        // the folder is read whole; the diagram it stands for is there, away
        assert!(walked.complete);
        assert_eq!(walked.dirs[0].online_only, vec!["Flow.dosik"]);
        // not a diagram of its own: nothing shows for it
        assert_eq!(diagram_rels(&walked), vec!["Keep.dosik", "Sub/In.dosik"]);
        // an older diagram's too; any other file's is nothing
        let other = scratch("walk-icloud-other");
        put(&other.join(".Old.dosik.json.icloud"), "placeholder");
        assert_eq!(
            walk(&other).unwrap().unwrap().online_only,
            vec!["Old.dosik.json"]
        );
        let plain = scratch("walk-icloud-plain");
        put(&plain.join(".notes.txt.icloud"), "placeholder");
        put(&plain.join(".dosik.icloud"), "placeholder");
        put(&plain.join(".icloud"), "placeholder");
        assert!(walk(&plain).unwrap().unwrap().online_only.is_empty());
    }

    #[test]
    fn whether_a_diagram_opens_is_read_from_it() {
        let root = scratch("walk-readable");
        put(&root.join("a.dosik"), doc());
        put(
            &root.join("b.dosik"),
            r#"{"nodes":[],"edges":[],"pages":[]}"#,
        );
        put(&root.join("c.dosik"), "{not json");
        put(&root.join("d.dosik"), r#"{"nodes":{},"edges":[]}"#);
        put(&root.join("e.dosik"), "[]");
        let walked = walk(&root).unwrap().unwrap();
        let readable: Vec<(String, bool)> = walked
            .diagrams
            .iter()
            .map(|d| (d.name.clone(), d.readable))
            .collect();
        assert_eq!(
            readable,
            vec![
                ("a".into(), true),
                ("b".into(), false),
                ("c".into(), false),
                ("d".into(), false),
                ("e".into(), false)
            ]
        );
    }

    #[test]
    fn folders_deeper_than_max_depth_are_not_read() {
        let root = scratch("walk-deep");
        let mut path = root.clone();
        for level in 2..=MAX_DEPTH + 1 {
            path = path.join(format!("L{level}"));
            put(&path.join(format!("d{level}.dosik")), doc());
        }
        let walked = walk(&root).unwrap().unwrap();
        let deepest = walked.all_dirs().into_iter().map(|d| d.depth).max();
        assert_eq!(deepest, Some(MAX_DEPTH));
        let names = diagram_rels(&walked);
        assert!(names
            .iter()
            .any(|n| n.ends_with(&format!("d{MAX_DEPTH}.dosik"))));
        assert!(!names
            .iter()
            .any(|n| n.ends_with(&format!("d{}.dosik", MAX_DEPTH + 1))));
    }

    #[cfg(unix)]
    #[test]
    fn links_are_never_followed() {
        let base = scratch("walk-link");
        let outside = base.join("outside");
        put(&outside.join("x.dosik"), doc());
        let root = base.join("P");
        put(&root.join("own.dosik"), doc());
        std::os::unix::fs::symlink(&outside, root.join("linked")).unwrap();
        std::os::unix::fs::symlink(outside.join("x.dosik"), root.join("link.dosik")).unwrap();
        std::os::unix::fs::symlink(&root, root.join("loop")).unwrap();
        let walked = walk(&root).unwrap().unwrap();
        assert_eq!(dir_rels(&walked), vec![""]);
        assert_eq!(diagram_rels(&walked), vec!["own.dosik"]);
        // a project that is itself a link is no project
        std::os::unix::fs::symlink(&root, base.join("P2")).unwrap();
        assert_eq!(walk(&base.join("P2")), Ok(None));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_name_that_is_not_utf8_is_skipped() {
        use std::os::unix::ffi::OsStrExt;
        let root = scratch("walk-utf8");
        put(&root.join("ok.dosik"), doc());
        let bad = std::ffi::OsStr::from_bytes(b"bad\xff.dosik");
        std::fs::write(root.join(bad), doc()).unwrap();
        let walked = walk(&root).unwrap().unwrap();
        assert_eq!(diagram_rels(&walked), vec!["ok.dosik"]);
    }

    #[test]
    fn only_folders_with_diagrams_or_an_id_show() {
        let root = scratch("walk-shown").join("Repo");
        put(&root.join("src/main.rs"), "fn main() {}");
        put(&root.join("docs/design/Flow.dosik"), doc());
        std::fs::create_dir_all(root.join("empty")).unwrap();
        std::fs::create_dir_all(root.join("outer/known")).unwrap();
        std::fs::create_dir_all(root.join("Made in the app")).unwrap();
        let known = |rel: &str| rel == "outer/known" || rel == "Made in the app";
        let walked = shown(walk(&root).unwrap().unwrap(), &known);
        assert_eq!(
            dir_rels(&walked),
            vec![
                "",
                "Made in the app",
                "docs",
                "docs/design",
                "outer",
                "outer/known"
            ]
        );
        // the project itself shows though nothing in it does
        let bare = scratch("walk-bare");
        std::fs::create_dir_all(bare.join("nothing")).unwrap();
        assert_eq!(
            dir_rels(&shown(walk(&bare).unwrap().unwrap(), &|_| false)),
            vec![""]
        );
    }

    #[test]
    fn the_items_that_show_are_counted_from_names_alone() {
        let root = scratch("walk-visible");
        put(&root.join("b.dosik"), "not even JSON");
        put(&root.join("Docs/deep/x.dosik"), doc());
        put(&root.join("Code/main.rs"), "");
        std::fs::create_dir_all(root.join("Known/empty")).unwrap();
        std::fs::create_dir_all(root.join("Outer/Inner")).unwrap();
        let known = |rel: &str| rel == "Known" || rel == "Outer/Inner";
        assert_eq!(
            visible_items(&root, "", 1, &known),
            vec!["Docs", "Known", "Outer", "b.dosik"]
        );
        // the same as the walk shows
        let walked = shown(walk(&root).unwrap().unwrap(), &known);
        let mut names = walked.item_names();
        names.sort();
        assert_eq!(names, vec!["Docs", "Known", "Outer", "b.dosik"]);
    }

    #[test]
    fn height_counts_every_real_folder_under_one() {
        let root = scratch("walk-height");
        std::fs::create_dir_all(root.join("a/b/c")).unwrap();
        std::fs::create_dir_all(root.join("x")).unwrap();
        std::fs::create_dir_all(root.join(".hidden/1/2/3/4")).unwrap();
        assert_eq!(height(&root, MAX_DEPTH), 4);
        assert_eq!(height(&root, 2), 2);
        assert_eq!(height(&root.join("x"), MAX_DEPTH), 1);
    }

    fn siblings(names: &[&str]) -> Siblings {
        Siblings::of(names.iter().map(|n| n.to_string()))
    }

    #[test]
    fn a_new_name_clashes_with_any_entry_ignoring_case() {
        let here = siblings(&["Payments", "flow.dosik", "Old.dosik.json", ".hidden"]);
        assert_eq!(here.folder_name("payments"), "payments 2");
        assert_eq!(here.folder_name("Other"), "Other");
        // a file with the folder's name is in the way too
        assert_eq!(here.folder_name("FLOW.dosik"), "FLOW.dosik 2");
        assert_eq!(here.diagram_name("Flow", ".dosik"), "Flow 2");
        // an older file shows the same name, so it clashes as a diagram
        assert_eq!(here.diagram_name("old", ".dosik"), "old 2");
        assert_eq!(here.diagram_name("Payments", ".dosik"), "Payments");
    }

    #[test]
    fn an_items_own_name_is_no_clash() {
        let here = siblings(&["flow.dosik", "Flow 2.dosik"]).except("flow.dosik");
        assert_eq!(here.diagram_name("Flow", ".dosik"), "Flow");
        let folders = siblings(&["Docs", "docs"]).except("Docs");
        // on a case-sensitive disk the other one is still there
        assert_eq!(folders.folder_name("docs"), "docs 2");
    }

    #[test]
    fn siblings_are_read_from_disk_links_and_all() {
        let dir = scratch("walk-siblings");
        put(&dir.join("A.dosik"), doc());
        std::fs::create_dir(dir.join("B")).unwrap();
        let here = Siblings::read(&dir).unwrap();
        assert_eq!(here.diagram_name("a", ".dosik"), "a 2");
        assert_eq!(here.folder_name("b"), "b 2");
        let none = Siblings::read(&dir.join("not yet")).unwrap();
        assert_eq!(none.folder_name("b"), "b");
    }
}
