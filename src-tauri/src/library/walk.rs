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

use std::path::Path;

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
/// UTF-8 are left out — `file_type` does not follow links.
pub fn entries(dir: &Path) -> Vec<(String, bool)> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<(String, bool)> = read
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            let kind = entry.file_type().ok()?;
            let is_dir = kind.is_dir();
            if !is_dir && !kind.is_file() {
                return None;
            }
            match classify(&name, is_dir) {
                Entry::Folder | Entry::Diagram(_) => Some((name, is_dir)),
                Entry::Skip | Entry::Other => None,
            }
        })
        .collect();
    out.sort();
    out
}

/// Everything in the project at `root`, down to `MAX_DEPTH` — `None` when
/// `root` is not a real directory. Every diagram is read once, to say
/// whether it opens.
pub fn walk(root: &Path) -> Option<WalkedDir> {
    if !disk::is_real_dir(root) {
        return None;
    }
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Some(walk_dir(root, String::new(), name, 1))
}

fn walk_dir(path: &Path, rel: String, name: String, depth: usize) -> WalkedDir {
    let mut dirs = Vec::new();
    let mut diagrams = Vec::new();
    for (entry, is_dir) in entries(path) {
        let entry_rel = child_rel(&rel, &entry);
        let entry_path = path.join(&entry);
        if is_dir {
            if depth < MAX_DEPTH {
                dirs.push(walk_dir(&entry_path, entry_rel, entry, depth + 1));
            }
        } else if let Some(stem) = diagram_stem(&entry) {
            diagrams.push(WalkedDiagram {
                rel: entry_rel,
                name: stem.to_string(),
                modified: disk::modified_ms(&entry_path),
                readable: std::fs::read_to_string(&entry_path).is_ok_and(|text| readable(&text)),
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

/// How many levels the folder at `path` takes, itself included — every real
/// folder under it counted, shown or not, no deeper than `limit`.
pub fn height(path: &Path, limit: usize) -> usize {
    if limit <= 1 {
        return 1;
    }
    1 + entries(path)
        .into_iter()
        .filter(|(_, is_dir)| *is_dir)
        .map(|(name, _)| height(&path.join(name), limit - 1))
        .max()
        .unwrap_or(0)
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
        names::unique_name(wanted, |c| self.has(&names::fold(c)))
    }

    /// What a new diagram wanted as `wanted` is called here — its name,
    /// without the extension: no entry may have its file's name, and no
    /// diagram the name it would show.
    pub fn diagram_name(&self, wanted: &str, ext: &str) -> String {
        names::unique_name(wanted, |c| {
            let folded = names::fold(c);
            self.has(&format!("{folded}{ext}"))
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
    fn a_project_is_walked_folder_by_folder() {
        let root = scratch("walk").join("Payments");
        put(&root.join("Flow.dosik"), doc());
        put(&root.join("Old.dosik.json"), doc());
        put(&root.join("notes.txt"), "mine");
        put(&root.join("Sub/In/Deep.dosik"), doc());
        put(&root.join(".git/HEAD.dosik"), doc());
        put(&root.join(".hidden.dosik"), doc());
        put(&root.join("Flow.dosik.tmp"), doc());
        let walked = walk(&root).unwrap();
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
        assert_eq!(walk(&dir.join("gone")), None);
        put(&dir.join("file"), "x");
        assert_eq!(walk(&dir.join("file")), None);
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
        let walked = walk(&root).unwrap();
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
        let walked = walk(&root).unwrap();
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
        let walked = walk(&root).unwrap();
        assert_eq!(dir_rels(&walked), vec![""]);
        assert_eq!(diagram_rels(&walked), vec!["own.dosik"]);
        // a project that is itself a link is no project
        std::os::unix::fs::symlink(&root, base.join("P2")).unwrap();
        assert_eq!(walk(&base.join("P2")), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_name_that_is_not_utf8_is_skipped() {
        use std::os::unix::ffi::OsStrExt;
        let root = scratch("walk-utf8");
        put(&root.join("ok.dosik"), doc());
        let bad = std::ffi::OsStr::from_bytes(b"bad\xff.dosik");
        std::fs::write(root.join(bad), doc()).unwrap();
        let walked = walk(&root).unwrap();
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
        let walked = shown(walk(&root).unwrap(), &known);
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
        assert_eq!(dir_rels(&shown(walk(&bare).unwrap(), &|_| false)), vec![""]);
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
