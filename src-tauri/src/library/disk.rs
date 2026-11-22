//! File-system helpers the folder-backed library shares: atomic writes whose
//! temp files the listing never sees, and the "real" tests that never follow
//! a symbolic link.

use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

/// what every temp file ends with — the listing and the watcher skip it
pub const TMP_EXT: &str = ".tmp";

/// A temp file's name next to its target: hidden, short whatever the target
/// is called (a long name plus a suffix could pass the file system's limit),
/// and unique per write — two writers of one file never share it.
pub fn tmp_name() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    format!(
        ".dosik-{}-{}{TMP_EXT}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

/// Whether `name` is one the library gives what it writes on the way —
/// `tmp_name`'s `.dosik-<pid>-<n>.tmp`, and the MCP server's
/// `.dosik-mcp-<pid>-<n>.tmp`: a temp file, or a folder's copy across
/// volumes, nobody else's. A name of the user's that only looks alike is not.
pub fn is_temp_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix(".dosik-") else {
        return false;
    };
    let rest = rest.strip_prefix("mcp-").unwrap_or(rest);
    let Some(rest) = rest.strip_suffix(TMP_EXT) else {
        return false;
    };
    let number = |part: &str| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
    match rest.split_once('-') {
        Some((pid, n)) => number(pid) && number(n),
        None => false,
    }
}

/// how old one of the library's temp entries is before a listing takes it
/// for one left by a write that stopped halfway, and clears it
pub const STALE_TEMP: std::time::Duration = std::time::Duration::from_secs(24 * 3600);

/// Writes `bytes` to a new temp file in `dir`, synced: the rename that
/// follows must not land before the bytes do. Returns the temp file's path.
pub fn write_tmp(dir: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let tmp = dir.join(tmp_name());
    let written = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();
    match written {
        Ok(()) => Ok(tmp),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(format!("{}: {e}", tmp.display()))
        }
    }
}

/// Writes atomically: a temp file next to the target, then a rename over it
/// — the rename itself synced too, where the system can.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("no parent folder")?;
    let tmp = write_tmp(dir, bytes)?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{}: {e}", path.display())
    })?;
    sync_dir(dir);
    Ok(())
}

/// Puts the temp file `tmp` at `dest`, never over anything there: a hard
/// link fails when `dest` is taken, where a rename would replace it. Where
/// the disk has no hard links, `dest` is looked at first and the temp file
/// renamed. `AlreadyExists` when `dest` is taken; the temp file is then
/// left for the caller to try another name or remove.
pub fn place_new(tmp: &Path, dest: &Path) -> std::io::Result<()> {
    match std::fs::hard_link(tmp, dest) {
        Ok(()) => {
            let _ = std::fs::remove_file(tmp);
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(e),
        Err(_) if exists(dest) => Err(std::io::ErrorKind::AlreadyExists.into()),
        Err(_) => std::fs::rename(tmp, dest),
    }
}

/// How an entry is renamed — `rename`, or a stand-in that fails the way a
/// move across volumes does.
pub type RenameFn = fn(&Path, &Path) -> std::io::Result<()>;

/// The rename every move makes outside a test, never over anything at `to`:
/// a file by `move_file_new`; a folder by the system's rename, which on most
/// systems replaces no folder with anything in it — an empty one that turned
/// up there just now is all it could take — and none at all on Windows.
pub fn rename(from: &Path, to: &Path) -> std::io::Result<()> {
    if is_real_file(from) {
        move_file_new(from, to)
    } else {
        std::fs::rename(from, to)
    }
}

/// Moves the file `from` to `to` within a volume, never over anything there:
/// a hard link — which fails when `to` is taken, where a rename would replace
/// it, even with something that turned up since it was looked at — then the
/// old name removed. The same file in another case is renamed; where the
/// disk has no hard links, `to` is looked at first. `AlreadyExists` when
/// `to` is taken; across volumes, the error that says so.
pub fn move_file_new(from: &Path, to: &Path) -> std::io::Result<()> {
    if same_entry(from, to) {
        // one name in two cases: nothing else can be in the way
        return std::fs::rename(from, to);
    }
    match std::fs::hard_link(from, to) {
        Ok(()) => std::fs::remove_file(from).inspect_err(|_| {
            let _ = std::fs::remove_file(to);
        }),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists || crosses_devices(&e) => Err(e),
        Err(_) if exists(to) => Err(std::io::ErrorKind::AlreadyExists.into()),
        Err(_) => std::fs::rename(from, to),
    }
}

/// whether a rename failed because `from` and `to` are on different volumes
pub fn crosses_devices(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::CrossesDevices
        || (cfg!(unix) && e.raw_os_error() == Some(18))
        || (cfg!(windows) && e.raw_os_error() == Some(17))
}

/// Moves the file or folder `from` to `to`, which must be free: a rename —
/// or, for a file across volumes, a copy put in place whole and synced, the
/// original removed after; its time is kept. A folder goes across volumes
/// by `copy_aside`, never here.
pub fn transfer(from: &Path, to: &Path, rename: RenameFn) -> Result<(), String> {
    if exists(to) {
        return Err(format!("{}: in the way", to.display()));
    }
    match rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) if crosses_devices(&e) && is_real_file(from) => copy_file_across(from, to),
        Err(e) => Err(format!("{}: {e}", from.display())),
    }
}

fn copy_file_across(from: &Path, to: &Path) -> Result<(), String> {
    let parent = to.parent().ok_or("no parent folder")?;
    let bytes = std::fs::read(from).map_err(|e| format!("{}: {e}", from.display()))?;
    let tmp = write_tmp(parent, &bytes)?;
    if let Err(e) = place_new(&tmp, to) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("{}: {e}", to.display()));
    }
    // its time once it is in place: a temp file with an old one would look
    // left behind to a listing, which clears such
    keep_mtime(from, to);
    sync_dir(parent);
    // the original stays where it cannot go: one copy, never two
    if let Err(e) = std::fs::remove_file(from) {
        let _ = std::fs::remove_file(to);
        return Err(format!("{}: {e}", from.display()));
    }
    Ok(())
}

/// One entry of a folder's fingerprint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FingerprintEntry {
    /// relative to the folder
    pub path: PathBuf,
    pub dir: bool,
    pub len: u64,
    pub modified: Option<std::time::SystemTime>,
    /// a diagram's contents, hashed — a disk that keeps times by the second
    /// does not tell a save of the same length within one
    pub hash: Option<u64>,
}

/// What a folder holds, as far as a copy of it goes: every entry under it,
/// its kind, length and time, and what each diagram holds.
pub type Fingerprint = Vec<FingerprintEntry>;

/// The fingerprint of the folder `dir` — two equal ones, and nothing in it
/// changed between them. Links are not followed.
pub fn fingerprint(dir: &Path) -> Result<Fingerprint, String> {
    fn walk(dir: &Path, rel: &Path, out: &mut Fingerprint) -> Result<(), String> {
        let read = std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        for entry in read {
            let entry = entry.map_err(|e| format!("{}: {e}", dir.display()))?;
            let meta = std::fs::symlink_metadata(entry.path())
                .map_err(|e| format!("{}: {e}", entry.path().display()))?;
            let at = rel.join(entry.file_name());
            let diagram = meta.is_file()
                && super::names::diagram_stem(&entry.file_name().to_string_lossy()).is_some();
            let hash = if diagram {
                let bytes = std::fs::read(entry.path())
                    .map_err(|e| format!("{}: {e}", entry.path().display()))?;
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                std::hash::Hasher::write(&mut hasher, &bytes);
                Some(std::hash::Hasher::finish(&hasher))
            } else {
                None
            };
            out.push(FingerprintEntry {
                path: at.clone(),
                dir: meta.is_dir(),
                len: meta.len(),
                modified: meta.modified().ok(),
                hash,
            });
            if meta.is_dir() {
                walk(&entry.path(), &at, out)?;
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(dir, Path::new(""), &mut out)?;
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// A whole copy of the folder `from` in `dir`, under a hidden temp name —
/// every file and folder of it synced, the times of files kept — for a move
/// across volumes to put in place. A link inside stops it; nothing of a
/// copy that stopped is left.
pub fn copy_aside(from: &Path, dir: &Path) -> Result<PathBuf, String> {
    if !is_real_dir(from) {
        return Err(format!("{}: not a folder", from.display()));
    }
    let tmp = dir.join(tmp_name());
    match copy_tree(from, &tmp) {
        Ok(()) => {
            sync_dir(dir);
            Ok(tmp)
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&tmp);
            Err(e)
        }
    }
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir(to).map_err(|e| format!("{}: {e}", to.display()))?;
    let read = std::fs::read_dir(from).map_err(|e| format!("{}: {e}", from.display()))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("{}: {e}", from.display()))?;
        let kind = entry
            .file_type()
            .map_err(|e| format!("{}: {e}", entry.path().display()))?;
        let dest = to.join(entry.file_name());
        if kind.is_dir() {
            copy_tree(&entry.path(), &dest)?;
        } else if kind.is_file() {
            std::fs::copy(entry.path(), &dest)
                .map_err(|e| format!("{}: {e}", entry.path().display()))?;
            // its time, and all of it on the disk before the original goes
            let at = std::fs::metadata(entry.path()).and_then(|m| m.modified());
            std::fs::OpenOptions::new()
                .write(true)
                .open(&dest)
                .and_then(|f| {
                    if let Ok(at) = at {
                        f.set_modified(at)?;
                    }
                    f.sync_all()
                })
                .map_err(|e| format!("{}: {e}", dest.display()))?;
        } else {
            return Err(format!(
                "{}: a link cannot be moved to another volume",
                entry.path().display()
            ));
        }
    }
    sync_dir(to);
    Ok(())
}

/// Puts what a folder lists on the disk — the names in it, made or renamed
/// just now — where the system can (not on Windows, which keeps no folder
/// open for it). Best effort: a folder that will not sync is left as it is.
pub fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    {
        if let Err(e) = std::fs::File::open(dir).and_then(|f| f.sync_all()) {
            eprintln!("library: {} not synced: {e}", dir.display());
        }
    }
    #[cfg(not(unix))]
    let _ = dir;
}

/// Gives the file or folder at `path` the modification time `at`. A folder
/// opens on Windows only with backup semantics and the right to write its
/// attributes.
pub fn set_modified(path: &Path, at: std::time::SystemTime) -> std::io::Result<()> {
    #[cfg(windows)]
    let opened = {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_WRITE_ATTRIBUTES: u32 = 0x0100;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        std::fs::OpenOptions::new()
            .access_mode(FILE_WRITE_ATTRIBUTES)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)
    };
    #[cfg(not(windows))]
    let opened = std::fs::File::open(path);
    opened?.set_modified(at)
}

/// gives `to` the modification time of `from`, if it can — synced, so the
/// time is on the disk with the bytes
pub fn keep_mtime(from: &Path, to: &Path) {
    if let Ok(at) = std::fs::metadata(from).and_then(|m| m.modified()) {
        let _ = std::fs::OpenOptions::new()
            .write(true)
            .open(to)
            .and_then(|f| f.set_modified(at).and_then(|()| f.sync_all()));
    }
}

/// What is at a path — a link at the end not followed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Presence {
    Dir,
    File,
    /// a link, a device: nothing the library reads or writes
    Other,
    /// nothing there
    Missing,
    /// the file system would not say — no permission, a disk that went away
    Unknown(std::io::ErrorKind),
}

/// whether an error says nothing is there, rather than that it cannot tell
pub fn is_absent(e: &std::io::Error) -> bool {
    matches!(
        e.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
    )
}

/// what is at `path`, the last name not followed when it is a link
pub fn presence(path: &Path) -> Presence {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => Presence::Dir,
        Ok(m) if m.is_file() => Presence::File,
        Ok(_) => Presence::Other,
        Err(e) if is_absent(&e) => Presence::Missing,
        Err(e) => Presence::Unknown(e.kind()),
    }
}

/// What is at `rel` inside the folder `root` as the library sees it: every
/// name on the way looked at without following it — a link, or a file,
/// where a folder should be is nothing there — so no path through a link
/// ever reaches outside the project. `""` is `root` itself.
pub fn presence_within(root: &Path, rel: &str) -> Presence {
    let names: Vec<&str> = if rel.is_empty() {
        Vec::new()
    } else if valid_rel(rel) {
        rel.split('/').collect()
    } else {
        return Presence::Missing;
    };
    let mut at = root.to_path_buf();
    let mut here = presence(&at);
    for name in names {
        match here {
            Presence::Dir => {}
            Presence::Unknown(kind) => return Presence::Unknown(kind),
            Presence::File | Presence::Other | Presence::Missing => return Presence::Missing,
        }
        at.push(name);
        here = presence(&at);
    }
    here
}

/// a real directory — a symbolic link to one is not
pub fn is_real_dir(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|m| m.is_dir())
}

/// a real file — a symbolic link to one is not
pub fn is_real_file(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|m| m.is_file())
}

/// whether anything — a file, a folder, a dangling link — is at `path`
pub fn exists(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok()
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn modified_ms(path: &Path) -> u64 {
    ms_of(std::fs::symlink_metadata(path).ok().as_ref())
}

/// when an entry of `meta` was last modified, ms since the Unix epoch — 0 unknown
pub fn ms_of(meta: Option<&std::fs::Metadata>) -> u64 {
    meta.and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Whether two paths are one entry on disk — one name in two cases on a
/// disk that ignores case, say. Links are not followed.
pub fn same_entry(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (std::fs::symlink_metadata(a), std::fs::symlink_metadata(b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        match (canonical(a), canonical(b)) {
            (Some(x), Some(y)) => x == y,
            _ => false,
        }
    }
}

/// `path` with links resolved and `.`/`..` gone, as the file system has it
/// — on Windows without the `\\?\` the standard library adds — or `None`
/// when it is not there.
pub fn canonical(path: &Path) -> Option<PathBuf> {
    let real = std::fs::canonicalize(path).ok()?;
    #[cfg(windows)]
    {
        let text = real.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            if !rest.starts_with("UNC\\") {
                return Some(PathBuf::from(rest));
            }
        }
    }
    Some(real)
}

/// `path` as the file system has it, as far as it is there — the rest as
/// given — so two spellings of one folder compare equal, there or not.
pub fn normalized(path: &Path) -> PathBuf {
    let mut rest = Vec::new();
    let mut at = path;
    loop {
        if let Some(real) = canonical(at) {
            return rest.iter().rev().fold(real, |p, name| p.join(name));
        }
        match (at.parent(), at.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_os_string());
                at = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// whether two paths name one folder: the same as given, or as the file
/// system has them
pub fn same_place(a: &Path, b: &Path) -> bool {
    a == b || normalized(a) == normalized(b)
}

/// Whether `rel` — a path relative to a project, `/` between its names, as
/// the record keeps it — names something inside the project: every part one
/// plain name on this platform. No `..`, no root, no drive (`C:` on Windows),
/// no backslash where it separates.
pub fn valid_rel(rel: &str) -> bool {
    !rel.is_empty() && rel.split('/').all(one_name)
}

/// whether `name` is one plain name here: what `Path::join` would never
/// turn into a step up, a root or a drive
pub fn one_name(name: &str) -> bool {
    let mut parts = Path::new(name).components();
    matches!(parts.next(), Some(Component::Normal(part)) if part == name) && parts.next().is_none()
}

/// `root` joined with `rel` (`""` is the root itself) — `None` for a `rel`
/// that could step outside it
pub fn join_rel(root: &Path, rel: &str) -> Option<PathBuf> {
    if rel.is_empty() {
        return Some(root.to_path_buf());
    }
    valid_rel(rel).then(|| rel.split('/').fold(root.to_path_buf(), |p, n| p.join(n)))
}

/// `parent` and `name` as a relative path — `""` is the project's root
pub fn child_rel(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

/// the folder a relative path is in, and its own name: `("A/B", "c")` for `A/B/c`
pub fn split_rel(rel: &str) -> (&str, &str) {
    match rel.rsplit_once('/') {
        Some((parent, name)) => (parent, name),
        None => ("", rel),
    }
}

/// whether `rel` is `prefix` or inside it — by whole names, so `AB` is not in `A`
pub fn rel_within(rel: &str, prefix: &str) -> bool {
    prefix.is_empty()
        || rel == prefix
        || (rel.len() > prefix.len()
            && rel.starts_with(prefix)
            && rel.as_bytes()[prefix.len()] == b'/')
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    /// a fresh, empty directory of the system's temp folder — never one of
    /// the user's — made
    pub(crate) fn scratch(tag: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("dosik-folders-{tag}-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// the names in `dir`, sorted, hidden ones included
    pub(crate) fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn an_atomic_write_replaces_the_file_and_leaves_no_temp() {
        let dir = scratch("disk");
        let file = dir.join("state.json");
        write_atomic(&file, b"one").unwrap();
        write_atomic(&file, b"two").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "two");
        assert_eq!(names_in(&dir), vec!["state.json"]);
    }

    #[test]
    fn a_file_is_moved_only_where_nothing_is() {
        let dir = scratch("disk-move-new");
        std::fs::write(dir.join("a"), "one").unwrap();
        std::fs::write(dir.join("b"), "two").unwrap();
        let taken = move_file_new(&dir.join("a"), &dir.join("b")).unwrap_err();
        assert_eq!(taken.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read_to_string(dir.join("a")).unwrap(), "one");
        assert_eq!(std::fs::read_to_string(dir.join("b")).unwrap(), "two");
        move_file_new(&dir.join("a"), &dir.join("c")).unwrap();
        assert_eq!(names_in(&dir), vec!["b", "c"]);
        assert_eq!(std::fs::read_to_string(dir.join("c")).unwrap(), "one");
        // a file moves by it, a folder by the system's rename
        std::fs::create_dir(dir.join("D")).unwrap();
        rename(&dir.join("D"), &dir.join("E")).unwrap();
        assert!(rename(&dir.join("c"), &dir.join("b")).is_err());
        assert_eq!(names_in(&dir), vec!["E", "b", "c"]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_file_renamed_in_case_only_is_no_clash() {
        let dir = scratch("disk-move-case");
        std::fs::write(dir.join("flow"), "x").unwrap();
        move_file_new(&dir.join("flow"), &dir.join("Flow")).unwrap();
        assert_eq!(names_in(&dir), vec!["Flow"]);
    }

    #[test]
    fn a_temp_file_is_hidden_short_and_unique() {
        let (a, b) = (tmp_name(), tmp_name());
        assert_ne!(a, b);
        assert!(a.starts_with('.') && a.ends_with(TMP_EXT), "{a}");
        assert!(a.len() < 40, "{a}");
        assert!(is_temp_name(&a));
        assert!(is_temp_name(".dosik-mcp-41-2.tmp"));
        // only the names the app and the MCP server make: a user's own stays theirs
        for name in [
            ".mine.tmp",
            "build.tmp",
            ".dosik-migrating-1",
            ".dosik",
            ".dosik-backup.tmp",
            ".dosik-41.tmp",
            ".dosik-41-7-1.tmp",
            ".dosik-mcp-x-2.tmp",
            ".dosik--7.tmp",
            ".dosik-41-7.TMP",
        ] {
            assert!(!is_temp_name(name), "{name}");
        }
    }

    #[test]
    fn a_relative_path_never_steps_outside() {
        for rel in ["A", "A/B", "A/b.dosik", "x y/z", "a.b"] {
            assert!(valid_rel(rel), "{rel}");
        }
        for rel in ["", "/A", "A/", "A//B", "..", "A/../B", ".", "A/./B"] {
            assert!(!valid_rel(rel), "{rel}");
        }
        #[cfg(windows)]
        for rel in ["C:", "C:x", "a\\b", "A/C:/x"] {
            assert!(!valid_rel(rel), "{rel}");
        }
        let root = Path::new("root");
        assert_eq!(join_rel(root, ""), Some(root.to_path_buf()));
        assert_eq!(join_rel(root, "A/b"), Some(root.join("A").join("b")));
        assert_eq!(join_rel(root, "../b"), None);
    }

    #[test]
    fn relative_paths_split_and_nest_by_whole_names() {
        assert_eq!(child_rel("", "a"), "a");
        assert_eq!(child_rel("A/B", "c"), "A/B/c");
        assert_eq!(split_rel("A/B/c"), ("A/B", "c"));
        assert_eq!(split_rel("c"), ("", "c"));
        assert!(rel_within("A", "A"));
        assert!(rel_within("A/B", "A"));
        assert!(!rel_within("AB", "A"));
        assert!(!rel_within("A", "A/B"));
        assert!(rel_within("anything", ""));
    }

    #[test]
    fn what_is_inside_a_folder_is_looked_at_name_by_name() {
        let root = scratch("disk-within");
        std::fs::create_dir_all(root.join("A/B")).unwrap();
        std::fs::write(root.join("A/B/f.dosik"), "x").unwrap();
        std::fs::write(root.join("A/file"), "x").unwrap();
        assert_eq!(presence_within(&root, ""), Presence::Dir);
        assert_eq!(presence_within(&root, "A/B"), Presence::Dir);
        assert_eq!(presence_within(&root, "A/B/f.dosik"), Presence::File);
        assert_eq!(presence_within(&root, "A/nope/f.dosik"), Presence::Missing);
        assert_eq!(presence_within(&root, "A/file/f.dosik"), Presence::Missing);
        assert_eq!(presence_within(&root, "../A"), Presence::Missing);
        assert_eq!(presence_within(&root.join("gone"), "A"), Presence::Missing);
        #[cfg(unix)]
        {
            let outside = scratch("disk-within-outside");
            std::fs::write(outside.join("f.dosik"), "x").unwrap();
            std::os::unix::fs::symlink(&outside, root.join("A/link")).unwrap();
            assert_eq!(presence_within(&root, "A/link"), Presence::Other);
            assert_eq!(presence_within(&root, "A/link/f.dosik"), Presence::Missing);
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_neither_a_real_folder_nor_a_real_file() {
        let dir = scratch("disk-link");
        std::fs::create_dir(dir.join("real")).unwrap();
        std::fs::write(dir.join("f"), "x").unwrap();
        std::os::unix::fs::symlink(dir.join("real"), dir.join("to-dir")).unwrap();
        std::os::unix::fs::symlink(dir.join("f"), dir.join("to-file")).unwrap();
        assert!(is_real_dir(&dir.join("real")));
        assert!(!is_real_dir(&dir.join("to-dir")));
        assert!(is_real_file(&dir.join("f")));
        assert!(!is_real_file(&dir.join("to-file")));
        assert!(exists(&dir.join("to-dir")));
    }
}
