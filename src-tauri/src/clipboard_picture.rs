//! A picture on the system clipboard, for ⌘V on the canvas (#8).
//!
//! The clipboard plugin hands a picture over as raw RGBA, and that crosses to
//! the webview as a JSON array of numbers: seconds for a full-screen
//! screenshot, with nothing on screen meanwhile. On macOS it also reads only
//! TIFF, which the pasteboard makes out of any picture on it — the icon
//! Finder puts beside a copied file included, so a copied picture file pasted
//! as its icon.
//!
//! Here a picture crosses as a file: the copied files themselves (the webview
//! keeps the pictures among them and reads each with `read_image_file`, under
//! its rules), or the picture's own bytes (PNG, JPEG…), which the webview
//! decodes.

use base64::Engine;
use serde::Serialize;

use crate::images::ImageFile;

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ClipboardPicture {
    /// files copied in Finder or Explorer — pictures or not
    Files { paths: Vec<String> },
    /// a picture's own bytes — a screenshot, a picture copied in an app
    Data(ImageFile),
}

fn files_picture(files: Vec<std::path::PathBuf>) -> ClipboardPicture {
    ClipboardPicture::Files {
        paths: files
            .into_iter()
            .filter_map(|path| path.to_str().map(String::from))
            .collect(),
    }
}

fn data_picture(mime: &'static str, bytes: &[u8]) -> ClipboardPicture {
    ClipboardPicture::Data(ImageFile {
        mime,
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[tauri::command]
pub async fn read_clipboard_picture() -> Option<ClipboardPicture> {
    tauri::async_runtime::spawn_blocking(platform::read)
        .await
        .ok()
        .flatten()
}

/// Whether ⌘V would take the clipboard rather than the shapes copied in the
/// app — a picture, or copied files — so a copy on the canvas overwrites it
/// (`canvasKeymap.ts`) and the shapes copied just now paste instead.
#[tauri::command]
pub async fn clipboard_has_picture() -> bool {
    tauri::async_runtime::spawn_blocking(platform::has)
        .await
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
mod platform {
    use std::path::PathBuf;

    use objc2::rc::autoreleasepool;
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSArray, NSString, NSURL};

    use super::{data_picture, files_picture, ClipboardPicture};
    use crate::images::image_mime;

    /// Kinds handed over as they are, first to last: the webview keeps PNG,
    /// JPEG and GIF as they arrive and redraws WebP (`imageInput.ts`).
    const AS_THEY_ARE: [(&str, &str); 4] = [
        ("public.png", "image/png"),
        ("public.jpeg", "image/jpeg"),
        ("com.compuserve.gif", "image/gif"),
        ("org.webmproject.webp", "image/webp"),
    ];
    /// Other pictures a copy may declare; they cross as TIFF.
    const OTHER_PICTURES: [&str; 4] = [
        "public.tiff",
        "public.heic",
        "public.heif",
        "com.microsoft.bmp",
    ];
    /// What the pasteboard makes out of any picture on it — Finder's icons
    /// too. The webview decodes TIFF.
    const TIFF: &str = "public.tiff";
    const FILE_URL: &str = "public.file-url";

    enum Source {
        Files(Vec<PathBuf>),
        Kind(&'static str, &'static str),
    }

    /// Picture files first, then a picture the copy declared, then the
    /// copied files that hold none (the webview says so). The pasteboard's
    /// own TIFF only when no file was copied: with files, it is their icon.
    fn source(pasteboard: &NSPasteboard) -> Option<Source> {
        let items = pasteboard.pasteboardItems()?;
        let file_url = NSString::from_str(FILE_URL);
        let urls: Vec<_> = items
            .iter()
            .filter_map(|item| item.stringForType(&file_url))
            .collect();
        let files: Vec<PathBuf> = urls
            .iter()
            // Finder writes file reference URLs (file:///.file/id=…)
            .filter_map(|url| NSURL::URLWithString(url)?.filePathURL()?.path())
            .map(|path| PathBuf::from(path.to_string()))
            .collect();
        if files.iter().any(|path| image_mime(path).is_some()) {
            return Some(Source::Files(files));
        }
        // what the copy declared, not what the pasteboard would convert it to
        let declared = items.firstObject()?.types();
        let declares = |kind: &str| declared.containsObject(&NSString::from_str(kind));
        if let Some(&(kind, mime)) = AS_THEY_ARE.iter().find(|(kind, _)| declares(kind)) {
            return Some(Source::Kind(kind, mime));
        }
        if OTHER_PICTURES.iter().any(|kind| declares(kind)) {
            return Some(Source::Kind(TIFF, "image/tiff"));
        }
        // a file gone since it was copied is still no reason to paste its icon
        if !urls.is_empty() {
            return Some(Source::Files(files));
        }
        let tiff = NSString::from_str(TIFF);
        pasteboard
            .availableTypeFromArray(&NSArray::from_slice(&[&*tiff]))
            .map(|_| Source::Kind(TIFF, "image/tiff"))
    }

    pub(super) fn read_from(pasteboard: &NSPasteboard) -> Option<ClipboardPicture> {
        match source(pasteboard)? {
            Source::Files(paths) => Some(files_picture(paths)),
            Source::Kind(kind, mime) => {
                let data = pasteboard.dataForType(&NSString::from_str(kind))?;
                Some(data_picture(mime, &data.to_vec()))
            }
        }
    }

    pub(super) fn has_in(pasteboard: &NSPasteboard) -> bool {
        source(pasteboard).is_some()
    }

    pub(super) fn read() -> Option<ClipboardPicture> {
        autoreleasepool(|_| read_from(&NSPasteboard::generalPasteboard()))
    }

    pub(super) fn has() -> bool {
        autoreleasepool(|_| has_in(&NSPasteboard::generalPasteboard()))
    }
}

/// Off macOS: copied files first — Explorer leaves no picture of them, and a
/// Linux file manager may leave an icon — then a bitmap (PrintScreen, Paint…)
/// or a PNG, which arrives decoded and goes back to PNG, so it crosses as a
/// file and not as pixels.
#[cfg(any(not(target_os = "macos"), test))]
fn from_parts(
    files: Option<Vec<std::path::PathBuf>>,
    bitmap: impl FnOnce() -> Option<Vec<u8>>,
) -> Option<ClipboardPicture> {
    match files {
        Some(files) => Some(files_picture(files)),
        None => bitmap().map(|png| data_picture("image/png", &png)),
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use std::path::PathBuf;

    use super::{encode_png, from_parts, ClipboardPicture};

    fn copied_files(clipboard: &mut arboard::Clipboard) -> Option<Vec<PathBuf>> {
        let files = clipboard.get().file_list().ok()?;
        // arboard splits a Linux uri-list on \n alone; GTK and Qt end lines with \r\n
        let files: Vec<PathBuf> = files
            .into_iter()
            .map(|path| match path.to_str() {
                Some(text) => PathBuf::from(text.trim_end_matches('\r')),
                None => path,
            })
            .collect();
        (!files.is_empty()).then_some(files)
    }

    pub(super) fn read() -> Option<ClipboardPicture> {
        let mut clipboard = arboard::Clipboard::new().ok()?;
        let files = copied_files(&mut clipboard);
        from_parts(files, || {
            let image = clipboard.get().image().ok()?;
            encode_png(&image.bytes, image.width as u32, image.height as u32).ok()
        })
    }

    pub(super) fn has() -> bool {
        let Ok(mut clipboard) = arboard::Clipboard::new() else {
            return false;
        };
        copied_files(&mut clipboard).is_some() || clipboard.get().image().is_ok()
    }
}

/// RGBA pixels as a PNG file — fast compression: the webview redraws a big
/// picture anyway (`imageInput.ts`).
#[cfg(not(target_os = "macos"))]
fn encode_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, png::EncodingError> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Fast);
    let mut writer = encoder.write_header()?;
    writer.write_image_data(rgba)?;
    writer.finish()?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::path::PathBuf;

    #[test]
    fn copied_files_win_over_a_bitmap_and_all_of_them_cross() {
        let files = ["/a/shot.png", "/a/report.pdf"].map(PathBuf::from).to_vec();
        let picture = from_parts(Some(files), || panic!("the bitmap is not read"));
        assert_eq!(
            picture,
            Some(ClipboardPicture::Files {
                paths: vec!["/a/shot.png".into(), "/a/report.pdf".into()]
            })
        );
    }

    #[test]
    fn without_files_the_bitmap_crosses_as_png() {
        let picture = from_parts(None, || Some(vec![0x89, b'P', b'N', b'G']));
        assert_eq!(
            picture,
            Some(data_picture("image/png", &[0x89, b'P', b'N', b'G']))
        );
        assert_eq!(from_parts(None, || None), None);
    }

    #[test]
    fn crosses_as_kind_and_file() {
        let json =
            serde_json::to_value(data_picture("image/png", &[0x89, b'P', b'N', b'G'])).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "data", "mime": "image/png", "base64": "iVBORw==" })
        );
        let json = serde_json::to_value(ClipboardPicture::Files {
            paths: vec!["/a/b.png".into()],
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "files", "paths": ["/a/b.png"] })
        );
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn pixels_come_back_from_the_png() {
        let rgba = [255, 0, 0, 255, 0, 0, 255, 128];
        let png = encode_png(&rgba, 2, 1).unwrap();
        let mut reader = png::Decoder::new(std::io::Cursor::new(png))
            .read_info()
            .unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut pixels).unwrap();
        assert_eq!((info.width, info.height), (2, 1));
        assert_eq!(&pixels[..info.buffer_size()], &rgba);
    }

    /// A private pasteboard per test — the user's clipboard is never touched.
    #[cfg(target_os = "macos")]
    mod pasteboard {
        use objc2::rc::Retained;
        use objc2::runtime::ProtocolObject;
        use objc2_app_kit::{NSPasteboard, NSPasteboardItem};
        use objc2_foundation::{NSArray, NSData, NSString, NSURL};

        use super::super::platform::{has_in, read_from};
        use super::super::ClipboardPicture;

        struct Board(Retained<NSPasteboard>);

        impl Drop for Board {
            fn drop(&mut self) {
                // not in the generated bindings; takes no arguments, returns nothing
                unsafe {
                    let () = objc2::msg_send![&*self.0, releaseGlobally];
                }
            }
        }

        /// one copied item holding these kinds of data
        fn board(entries: &[(&str, &[u8])]) -> Board {
            let pasteboard = NSPasteboard::pasteboardWithUniqueName();
            pasteboard.clearContents();
            let item = NSPasteboardItem::new();
            for (kind, bytes) in entries {
                item.setData_forType(&NSData::with_bytes(bytes), &NSString::from_str(kind));
            }
            let writer = ProtocolObject::from_retained(item);
            assert!(pasteboard.writeObjects(&NSArray::from_retained_slice(&[writer])));
            Board(pasteboard)
        }

        /// as Finder writes it: a file reference URL (file:///.file/id=…)
        fn file_url(path: &std::path::Path) -> Vec<u8> {
            let url = NSURL::fileURLWithPath(&NSString::from_str(path.to_str().unwrap()));
            let reference = url.fileReferenceURL().unwrap();
            let text = reference.absoluteString().unwrap().to_string();
            assert!(text.starts_with("file:///.file/id="), "{text}");
            text.into_bytes()
        }

        const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 1, 2, 3];
        /// stands for the icon Finder puts beside a copied file
        const ICON: &[u8] = b"icns-bytes";

        /// a file in a folder of its own, gone with the test
        struct TempFile(std::path::PathBuf);

        impl TempFile {
            fn new(name: &str) -> Self {
                let dir =
                    std::env::temp_dir().join(format!("dosik-clip-{}-{name}", std::process::id()));
                std::fs::create_dir_all(&dir).unwrap();
                let path = dir.join(name);
                std::fs::write(&path, PNG).unwrap();
                TempFile(path)
            }
        }

        impl Drop for TempFile {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(self.0.parent().unwrap());
            }
        }

        /// the paths as a file reference URL resolves them (/var is /private/var)
        fn files(paths: &[&std::path::Path]) -> Option<ClipboardPicture> {
            Some(ClipboardPicture::Files {
                paths: paths
                    .iter()
                    .map(|p| std::fs::canonicalize(p).unwrap().to_str().unwrap().into())
                    .collect(),
            })
        }

        #[test]
        fn a_picture_file_copied_in_finder_is_read_from_the_file_not_its_icon() {
            let file = TempFile::new("copied.png");
            let board = board(&[
                ("public.file-url", &file_url(&file.0)),
                ("com.apple.icns", ICON),
            ]);
            assert_eq!(read_from(&board.0), files(&[&file.0]));
            assert!(has_in(&board.0));
        }

        #[test]
        fn a_copied_file_that_is_no_picture_crosses_as_that_file_not_its_icon() {
            // the webview says only pictures paste; a copy on the canvas overwrites it
            let file = TempFile::new("report.pdf");
            let board = board(&[
                ("public.file-url", &file_url(&file.0)),
                ("com.apple.icns", ICON),
            ]);
            assert_eq!(read_from(&board.0), files(&[&file.0]));
            assert!(has_in(&board.0));
        }

        #[test]
        fn a_picture_declared_beside_a_file_that_is_none_still_pastes() {
            let file = TempFile::new("original.heic");
            let board = board(&[
                ("public.file-url", &file_url(&file.0)),
                ("public.jpeg", &[0xff, 0xd8, 0xff]),
            ]);
            let Some(ClipboardPicture::Data(image)) = read_from(&board.0) else {
                panic!("no picture");
            };
            assert_eq!(image.mime, "image/jpeg");
        }

        #[test]
        fn a_screenshot_crosses_as_its_png() {
            let board = board(&[("public.png", PNG)]);
            let Some(ClipboardPicture::Data(image)) = read_from(&board.0) else {
                panic!("no picture");
            };
            assert_eq!(image.mime, "image/png");
            assert_eq!(image.base64, "iVBORwECAw==");
            assert!(has_in(&board.0));
        }

        #[test]
        fn a_jpeg_crosses_as_it_is_even_beside_a_tiff() {
            let board = board(&[
                ("public.tiff", b"II*\0"),
                ("public.jpeg", &[0xff, 0xd8, 0xff]),
            ]);
            let Some(ClipboardPicture::Data(image)) = read_from(&board.0) else {
                panic!("no picture");
            };
            assert_eq!(image.mime, "image/jpeg");
        }

        #[test]
        fn other_pictures_cross_as_tiff() {
            let board = board(&[("public.tiff", b"II*\0rest")]);
            let Some(ClipboardPicture::Data(image)) = read_from(&board.0) else {
                panic!("no picture");
            };
            assert_eq!(image.mime, "image/tiff");
            assert_eq!(image.base64, "SUkqAHJlc3Q=");
        }

        #[test]
        fn text_is_no_picture() {
            let board = board(&[("public.utf8-plain-text", b"flowchart LR")]);
            assert_eq!(read_from(&board.0), None);
            assert!(!has_in(&board.0));
        }
    }
}
