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

/// Writes atomically: a temp file next to the target, then a rename over it.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("no parent folder")?;
    let tmp = write_tmp(dir, bytes)?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{}: {e}", path.display())
    })
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

/// How an entry is renamed — `std::fs::rename`, or a stand-in that fails
/// the way a move across volumes does.
pub type RenameFn = fn(&Path, &Path) -> std::io::Result<()>;

/// the rename every move makes outside a test
pub fn rename(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::rename(from, to)
}

/// whether a rename failed because `from` and `to` are on different volumes
pub fn crosses_devices(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::CrossesDevices
        || (cfg!(unix) && e.raw_os_error() == Some(18))
        || (cfg!(windows) && e.raw_os_error() == Some(17))
}

/// Moves the file or folder `from` to `to`, which must be free: a rename —
/// or, across volumes, a copy put in place whole and the original removed
/// after. Times of files are kept; a link inside a folder stops the move.
pub fn transfer(from: &Path, to: &Path, rename: RenameFn) -> Result<(), String> {
    if exists(to) {
        return Err(format!("{}: in the way", to.display()));
    }
    match rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) if crosses_devices(&e) => copy_across(from, to),
        Err(e) => Err(format!("{}: {e}", from.display())),
    }
}

fn copy_across(from: &Path, to: &Path) -> Result<(), String> {
    let parent = to.parent().ok_or("no parent folder")?;
    if is_real_file(from) {
        let bytes = std::fs::read(from).map_err(|e| format!("{}: {e}", from.display()))?;
        let tmp = write_tmp(parent, &bytes)?;
        keep_mtime(from, &tmp);
        if let Err(e) = place_new(&tmp, to) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("{}: {e}", to.display()));
        }
        // the original stays where it cannot go: one copy, never two
        if let Err(e) = std::fs::remove_file(from) {
            let _ = std::fs::remove_file(to);
            return Err(format!("{}: {e}", from.display()));
        }
        return Ok(());
    }
    if !is_real_dir(from) {
        return Err(format!("{}: not a file or a folder", from.display()));
    }
    let tmp = parent.join(tmp_name());
    let placed = copy_tree(from, &tmp).and_then(|()| {
        if exists(to) {
            return Err(format!("{}: in the way", to.display()));
        }
        std::fs::rename(&tmp, to).map_err(|e| format!("{}: {e}", to.display()))
    });
    if let Err(e) = placed {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }
    // the copy is whole: what of the original will not go is left behind
    if let Err(e) = std::fs::remove_dir_all(from) {
        eprintln!("library: moved, but {} stays behind: {e}", from.display());
    }
    Ok(())
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
            keep_mtime(&entry.path(), &dest);
        } else {
            return Err(format!(
                "{}: a link cannot be moved to another volume",
                entry.path().display()
            ));
        }
    }
    Ok(())
}

/// gives `to` the modification time of `from`, if it can
pub fn keep_mtime(from: &Path, to: &Path) {
    if let Ok(at) = std::fs::metadata(from).and_then(|m| m.modified()) {
        let _ = std::fs::OpenOptions::new()
            .write(true)
            .open(to)
            .and_then(|f| f.set_modified(at));
    }
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
    std::fs::symlink_metadata(path)
        .and_then(|m| m.modified())
        .ok()
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
    fn a_temp_file_is_hidden_short_and_unique() {
        let (a, b) = (tmp_name(), tmp_name());
        assert_ne!(a, b);
        assert!(a.starts_with('.') && a.ends_with(TMP_EXT), "{a}");
        assert!(a.len() < 40, "{a}");
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
