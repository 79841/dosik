//! Reading a picture file for an image node (#8) — a file dropped from Finder
//! or picked in the palette's file dialog.
//!
//! The webview cannot read an arbitrary path itself, and a general "read any
//! file as bytes" command would be one for every file the user owns. This one
//! reads only what an image node can hold: a picture extension, under a size
//! that the frontend would then shrink anyway.

use std::path::Path;

use base64::Engine;
use serde::Serialize;

/// Past this the file is not worth reading — the node stores at most 1.5 MB,
/// and the frontend shrinks anything larger it does read (`imageInput.ts`).
const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Serialize, Debug, PartialEq)]
pub struct ImageFile {
    pub mime: &'static str,
    pub base64: String,
}

/// The MIME type for an extension this app reads, or `None`.
pub fn image_mime(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

#[tauri::command]
pub async fn read_image_file(path: String) -> Result<ImageFile, String> {
    tauri::async_runtime::spawn_blocking(move || read(Path::new(&path)))
        .await
        .map_err(|error| format!("reading the image failed: {error}"))?
}

fn read(path: &Path) -> Result<ImageFile, String> {
    let display = path.display();
    let mime =
        image_mime(path).ok_or_else(|| format!("{display}: not a png, jpeg, gif or webp image"))?;
    let metadata = std::fs::metadata(path).map_err(|e| format!("{display}: {e}"))?;
    // a document can name the path now (an image's `original`): a FIFO or a
    // folder named *.png must not hold the reading thread
    if !metadata.is_file() {
        return Err(format!("{display}: not a file"));
    }
    let size = metadata.len();
    if size > MAX_FILE_BYTES {
        return Err(format!(
            "{display}: the image is too large ({} MB; the limit is {} MB)",
            size / (1024 * 1024),
            MAX_FILE_BYTES / (1024 * 1024)
        ));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("{display}: {e}"))?;
    Ok(ImageFile {
        mime,
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_picture_extensions_are_read() {
        assert_eq!(image_mime(Path::new("a.PNG")), Some("image/png"));
        assert_eq!(image_mime(Path::new("a.jpeg")), Some("image/jpeg"));
        assert_eq!(image_mime(Path::new("a.webp")), Some("image/webp"));
        assert_eq!(image_mime(Path::new("a.svg")), None);
        assert_eq!(image_mime(Path::new("id_rsa")), None);
        assert_eq!(image_mime(Path::new("notes.txt")), None);
    }

    #[test]
    fn a_non_image_path_is_refused_before_it_is_read() {
        let error = read(Path::new("/etc/passwd")).unwrap_err();
        assert!(error.contains("not a png"), "{error}");
    }

    #[test]
    fn a_folder_named_like_a_picture_is_refused() {
        let dir = std::env::temp_dir().join(format!("dosik-image-dir-{}.png", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let error = read(&dir).unwrap_err();
        assert!(error.contains("not a file"), "{error}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reads_a_picture_as_base64() {
        let dir = std::env::temp_dir().join(format!("dosik-image-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("dot.png");
        std::fs::write(&file, [0x89, b'P', b'N', b'G']).unwrap();
        let image = read(&file).unwrap();
        assert_eq!(image.mime, "image/png");
        assert_eq!(image.base64, "iVBORw==");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
