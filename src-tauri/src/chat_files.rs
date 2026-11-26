//! Files that go with an AI chat message: the ones the user attaches, and the
//! pictures of the diagram's image nodes.
//!
//! Reading: like `images.rs`, there is no "read any path" command. A file is
//! read here only when the user picked it in this module's own file dialog or
//! dropped it on the window — a drop's paths are remembered as it lands, and
//! a path not among them is refused.
//!
//! Staging: the subscription CLIs read files, not bytes. Each conversation has
//! its own folder under the app cache (`chat-attachments/<conversation>`); the
//! frontend writes a message's files into it, the Claude CLI is allowed to read
//! that folder alone, and the folder goes with New chat. Every folder is
//! cleared at startup — a CLI session does not outlive the app.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// One file at most this large — the same limit the frontend says in its toasts.
pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
const ROOT: &str = "chat-attachments";

/// A file read for the chat, or why it was not.
#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReadFile {
    pub name: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// past the room the composer has left: named, not read
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub left: bool,
}

/// The MIME type an extension stands for, as far as the chat cares; the
/// frontend looks at the bytes for the rest (pictures by their first bytes,
/// text or not).
pub fn mime_for(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" | "heif" => "image/heic",
        "tif" | "tiff" => "image/tiff",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        "txt" | "md" | "markdown" | "mmd" | "csv" | "tsv" | "log" => "text/plain",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn too_large(name: &str, size: u64) -> String {
    format!(
        "{name} is too large ({} MB; the limit is {} MB)",
        size.div_ceil(1024 * 1024),
        MAX_FILE_BYTES / (1024 * 1024)
    )
}

/// Reads one file for the chat — never a folder, never past the limit, not
/// even a file that grows while it is read.
pub fn read_one(path: &Path) -> ReadFile {
    use std::io::Read;
    let name = file_name(path);
    let refuse = |size: u64, error: String| ReadFile {
        name: name.clone(),
        size,
        error: Some(error),
        ..ReadFile::default()
    };
    let meta = match std::fs::metadata(path) {
        Ok(meta) => meta,
        Err(e) => return refuse(0, format!("Couldn't read {name}: {e}")),
    };
    if !meta.is_file() {
        return refuse(0, format!("{name} is a folder, not a file"));
    }
    if meta.len() > MAX_FILE_BYTES {
        return refuse(meta.len(), too_large(&name, meta.len()));
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    let read = std::fs::File::open(path)
        .and_then(|file| file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes));
    if let Err(e) = read {
        return refuse(meta.len(), format!("Couldn't read {name}: {e}"));
    }
    let size = bytes.len() as u64;
    if size > MAX_FILE_BYTES {
        return refuse(size, too_large(&name, size));
    }
    ReadFile {
        name,
        size,
        mime: mime_for(path),
        base64: Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
        ..ReadFile::default()
    }
}

/// Reads the first `room` of `paths`; the rest are named as left out, unread —
/// a dialog that picked two hundred photos reads ten.
pub fn read_up_to(paths: Vec<PathBuf>, room: usize) -> Vec<ReadFile> {
    paths
        .into_iter()
        .enumerate()
        .map(|(i, path)| {
            if i < room {
                read_one(&path)
            } else {
                ReadFile {
                    name: file_name(&path),
                    left: true,
                    ..ReadFile::default()
                }
            }
        })
        .collect()
}

/// The paths of the last drop on the window, until the frontend reads them.
#[derive(Default)]
pub struct DroppedFiles(Mutex<HashSet<PathBuf>>);

impl DroppedFiles {
    /// A new drop replaces the last: a drop on the canvas or the sidebar is
    /// never readable here later.
    pub fn remember(&self, paths: &[PathBuf]) {
        if let Ok(mut set) = self.0.lock() {
            *set = paths.iter().cloned().collect();
        }
    }

    /// Takes `path` out if it was dropped — a path is read once.
    pub fn take(&self, path: &Path) -> bool {
        self.0
            .lock()
            .map(|mut set| set.remove(path))
            .unwrap_or(false)
    }
}

/// Remembers what lands on `window`, for `read_dropped_files`.
pub fn watch_drops(window: &tauri::WebviewWindow) {
    let app = window.app_handle().clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
            app.state::<DroppedFiles>().remember(paths);
        }
    });
}

/// Reads files just dropped on the window, up to `room`; any other path is refused.
#[tauri::command]
pub async fn read_dropped_files(
    paths: Vec<String>,
    room: usize,
    dropped: State<'_, DroppedFiles>,
) -> Result<Vec<ReadFile>, String> {
    let (ok, refused): (Vec<PathBuf>, Vec<PathBuf>) = paths
        .into_iter()
        .map(PathBuf::from)
        .partition(|p| dropped.take(p));
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = read_up_to(ok, room);
        out.extend(refused.into_iter().map(|path| ReadFile {
            error: Some(format!("{} was not dropped here", file_name(&path))),
            name: file_name(&path),
            ..ReadFile::default()
        }));
        out
    })
    .await
    .map_err(|e| e.to_string())
}

/// The system's file dialog, several files at once; reads up to `room` of them.
#[tauri::command]
pub async fn pick_chat_files(app: AppHandle, room: usize) -> Result<Vec<ReadFile>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(picked) = app
            .dialog()
            .file()
            .set_title("Attach files")
            .blocking_pick_files()
        else {
            return Vec::new();
        };
        read_up_to(
            picked
                .into_iter()
                .filter_map(|file| file.into_path().ok())
                .collect(),
            room,
        )
    })
    .await
    .map_err(|e| e.to_string())
}

/// A conversation id or folder name the frontend may name: letters, digits,
/// `-` and `_` — nothing that climbs out of the staging folder.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A file name safe on every system and in a CLI argument: no separators,
/// no commas (Codex splits `--image` values on them), not empty, not too long.
pub fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.');
    let mut out: String = trimmed.chars().take(80).collect();
    if out.is_empty() {
        out = "file".into();
    }
    out
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join(ROOT))
}

/// The conversation's folder under `root`, or why that id is refused.
pub fn conversation_dir(root: &Path, conversation: &str) -> Result<PathBuf, String> {
    if !valid_id(conversation) {
        return Err(format!("not a conversation id: {conversation}"));
    }
    Ok(root.join(conversation))
}

#[derive(Deserialize, Debug)]
pub struct StagedFile {
    pub name: String,
    pub base64: String,
}

/// Writes files into `<root>/<conversation>/<folder>/`, replacing what is
/// there under the same names; returns their absolute paths in order.
pub fn stage(
    root: &Path,
    conversation: &str,
    folder: &str,
    files: &[StagedFile],
    replace: bool,
) -> Result<Vec<String>, String> {
    if !valid_id(folder) {
        return Err(format!("not a folder name: {folder}"));
    }
    let dir = conversation_dir(root, conversation)?.join(folder);
    // `replace`: the folder holds these files and nothing else — the
    // diagram's pictures as they are now, none of a deleted node
    if replace {
        match std::fs::remove_dir_all(&dir) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err(format!("{}: {e}", dir.display()))
            }
            _ => {}
        }
        // nothing to hold: no folder either (none made where there was none)
        if files.is_empty() {
            return Ok(Vec::new());
        }
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut taken = HashSet::new();
    let mut paths = Vec::with_capacity(files.len());
    for file in files {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&file.base64)
            .map_err(|e| format!("{}: {e}", file.name))?;
        // the webview's word is not the limit: no file past it lands on disk
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err(too_large(&file.name, bytes.len() as u64));
        }
        let mut name = safe_name(&file.name);
        // two files of one name in one message keep both
        let mut n = 2;
        while !taken.insert(name.clone()) {
            name = format!("{n}-{}", safe_name(&file.name));
            n += 1;
        }
        let path = dir.join(&name);
        std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))?;
        paths.push(path.to_string_lossy().into_owned());
    }
    Ok(paths)
}

#[tauri::command]
pub async fn stage_chat_files(
    app: AppHandle,
    conversation: String,
    folder: String,
    files: Vec<StagedFile>,
    replace: Option<bool>,
) -> Result<Vec<String>, String> {
    let root = root(&app)?;
    let replace = replace.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        stage(&root, &conversation, &folder, &files, replace)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// New chat: that conversation's files go.
#[tauri::command]
pub async fn discard_chat_files(app: AppHandle, conversation: String) -> Result<(), String> {
    let dir = conversation_dir(&root(&app)?, &conversation)?;
    tauri::async_runtime::spawn_blocking(move || match std::fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    })
    .await
    .map_err(|e| e.to_string())?
}

/// At startup: no conversation is left to need its files.
pub fn clear_all(app: &AppHandle) {
    if let Ok(root) = root(app) {
        let _ = std::fs::remove_dir_all(root);
    }
}

/// The conversation's folder when it holds anything a CLI may read — what the
/// Claude CLI is allowed into and Codex's pictures must come from.
pub fn existing_dir(
    app: &AppHandle,
    conversation: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let Some(conversation) = conversation else {
        return Ok(None);
    };
    let dir = conversation_dir(&root(app)?, conversation)?;
    Ok(dir.is_dir().then_some(dir))
}

/// `Read(//…/**)` for the Claude CLI — its permission rules take an absolute
/// path after `//`, in POSIX form (`C:\x` is `//c/x`).
pub fn read_rule(dir: &Path) -> String {
    let raw = dir.to_string_lossy().replace('\\', "/");
    let posix = match raw.as_bytes() {
        [drive, b':', ..] if drive.is_ascii_alphabetic() => {
            format!("{}{}", (*drive as char).to_ascii_lowercase(), &raw[2..])
        }
        _ => raw.trim_start_matches('/').to_string(),
    };
    format!("Read(//{}/**)", posix.trim_end_matches('/'))
}

/// `paths` that lie inside `dir` — the only pictures Codex is handed.
pub fn inside(dir: &Path, paths: &[String]) -> Result<Vec<PathBuf>, String> {
    let base = dir.canonicalize().map_err(|e| e.to_string())?;
    paths
        .iter()
        .map(|p| {
            let path = Path::new(p)
                .canonicalize()
                .map_err(|e| format!("{p}: {e}"))?;
            if path.starts_with(&base) {
                Ok(path)
            } else {
                Err(format!("{p} is not one of this conversation's files"))
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("dosik-chat-files-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_a_file_as_base64_with_its_type() {
        let dir = temp("read");
        let path = dir.join("notes.md");
        std::fs::write(&path, "# hi").unwrap();
        let read = read_one(&path);
        assert_eq!(read.name, "notes.md");
        assert_eq!(read.size, 4);
        assert_eq!(read.mime, Some("text/plain"));
        assert_eq!(read.base64.as_deref(), Some("IyBoaQ=="));
        assert_eq!(read.error, None);
    }

    #[test]
    fn an_unknown_extension_reads_without_a_type() {
        let dir = temp("unknown");
        let path = dir.join("flows.sketch");
        std::fs::write(&path, [0u8, 1, 2]).unwrap();
        let read = read_one(&path);
        assert_eq!(read.mime, None);
        assert!(read.base64.is_some());
    }

    #[test]
    fn refuses_a_folder_and_a_missing_file() {
        let dir = temp("refuse");
        assert!(read_one(&dir).error.unwrap().contains("is a folder"));
        assert!(read_one(&dir.join("gone.txt"))
            .error
            .unwrap()
            .starts_with("Couldn't read gone.txt"));
    }

    #[test]
    fn refuses_a_file_past_the_limit_without_reading_it() {
        let dir = temp("big");
        let path = dir.join("big.bin");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_FILE_BYTES + 1).unwrap();
        let read = read_one(&path);
        assert_eq!(read.base64, None);
        assert_eq!(
            read.error.as_deref(),
            Some("big.bin is too large (21 MB; the limit is 20 MB)")
        );
    }

    #[test]
    fn a_dropped_path_reads_once_and_no_other_path_reads() {
        let dropped = DroppedFiles::default();
        let a = PathBuf::from("/x/a.png");
        dropped.remember(std::slice::from_ref(&a));
        assert!(!dropped.take(Path::new("/x/b.png")));
        assert!(dropped.take(&a));
        assert!(!dropped.take(&a));
    }

    #[test]
    fn a_new_drop_replaces_the_last() {
        let dropped = DroppedFiles::default();
        let canvas = PathBuf::from("/x/on-canvas.png");
        let chat = PathBuf::from("/x/on-chat.png");
        dropped.remember(std::slice::from_ref(&canvas));
        dropped.remember(std::slice::from_ref(&chat));
        assert!(!dropped.take(&canvas));
        assert!(dropped.take(&chat));
    }

    #[test]
    fn reads_only_as_many_as_there_is_room_for() {
        let dir = temp("room");
        let paths: Vec<PathBuf> = (0..3)
            .map(|i| {
                let p = dir.join(format!("{i}.txt"));
                std::fs::write(&p, "x").unwrap();
                p
            })
            .collect();
        let read = read_up_to(paths, 2);
        assert!(read[0].base64.is_some() && read[1].base64.is_some());
        assert_eq!(read[2].name, "2.txt");
        assert!(read[2].left);
        assert_eq!(read[2].base64, None);
    }

    #[test]
    fn replacing_staging_leaves_only_the_new_files() {
        let root = temp("replace");
        let one = |name: &str| {
            [StagedFile {
                name: name.into(),
                base64: "aGk=".into(),
            }]
        };
        stage(&root, "c1", "diagram-images", &one("old.png"), true).unwrap();
        stage(&root, "c1", "diagram-images", &one("new.png"), true).unwrap();
        let dir = root.join("c1").join("diagram-images");
        assert!(!dir.join("old.png").exists());
        assert!(dir.join("new.png").exists());
        stage(&root, "c1", "diagram-images", &one("more.png"), false).unwrap();
        assert!(dir.join("new.png").exists());
        // the last picture gone: the folder goes, and none is made for nothing
        assert!(stage(&root, "c1", "diagram-images", &[], true)
            .unwrap()
            .is_empty());
        assert!(!dir.exists());
        stage(&root, "c9", "diagram-images", &[], true).unwrap();
        assert!(!root.join("c9").exists());
    }

    #[test]
    fn staging_refuses_a_file_past_the_limit() {
        let root = temp("stage-big");
        let big =
            base64::engine::general_purpose::STANDARD
                .encode(vec![0u8; (MAX_FILE_BYTES + 1) as usize]);
        let err = stage(
            &root,
            "c1",
            "m1",
            &[StagedFile {
                name: "big.bin".into(),
                base64: big,
            }],
            false,
        )
        .unwrap_err();
        assert_eq!(err, "big.bin is too large (21 MB; the limit is 20 MB)");
    }

    #[test]
    fn ids_and_names_cannot_climb_out() {
        assert!(valid_id("k3J_a-9"));
        for bad in ["", "..", "a/b", "a\\b", "a.b", &"x".repeat(65)] {
            assert!(!valid_id(bad), "{bad}");
        }
        assert_eq!(safe_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_name("a,b.png"), "a_b.png");
        assert_eq!(safe_name("..."), "file");
        assert_eq!(safe_name("café 日本.png"), "café 日本.png");
        assert_eq!(safe_name(&"y".repeat(100)).len(), 80);
    }

    #[test]
    fn stages_a_message_and_keeps_two_files_of_one_name() {
        let root = temp("stage");
        let files = [
            StagedFile {
                name: "a.txt".into(),
                base64: "aGk=".into(),
            },
            StagedFile {
                name: "a.txt".into(),
                base64: "eW8=".into(),
            },
        ];
        let paths = stage(&root, "conv1", "msg1", &files, false).unwrap();
        assert_eq!(paths.len(), 2);
        // by components: a Windows path is joined with `\\`
        let tail = |name: &str| Path::new("conv1").join("msg1").join(name);
        assert!(Path::new(&paths[0]).ends_with(tail("a.txt")));
        assert!(Path::new(&paths[1]).ends_with(tail("2-a.txt")));
        assert_eq!(std::fs::read_to_string(&paths[1]).unwrap(), "yo");
        assert!(stage(&root, "../up", "msg1", &files, false).is_err());
        assert!(stage(&root, "conv1", "../up", &files, false).is_err());
    }

    #[test]
    fn the_read_rule_is_an_absolute_posix_path() {
        assert_eq!(
            read_rule(Path::new("/var/cache/app/chat-attachments/c1")),
            "Read(//var/cache/app/chat-attachments/c1/**)"
        );
        assert_eq!(
            read_rule(Path::new(r"C:\Cache\app\chat-attachments\c1")),
            "Read(//c/Cache/app/chat-attachments/c1/**)"
        );
    }

    #[test]
    fn only_pictures_inside_the_conversation_folder_are_handed_on() {
        let root = temp("inside");
        let paths = stage(
            &root,
            "c1",
            "m1",
            &[StagedFile {
                name: "a.png".into(),
                base64: "aGk=".into(),
            }],
            false,
        )
        .unwrap();
        let dir = root.join("c1");
        assert_eq!(inside(&dir, &paths).unwrap().len(), 1);
        let outside = root.join("elsewhere.png");
        std::fs::write(&outside, "x").unwrap();
        assert!(inside(&dir, &[outside.to_string_lossy().into_owned()]).is_err());
    }
}
