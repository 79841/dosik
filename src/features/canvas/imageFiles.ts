import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { toastError } from "../../shared/lib/toastStore";

/** extensions an image node can hold — the same list `images.rs` reads */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];

export const isImagePath = (path: string): boolean => {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && IMAGE_EXTENSIONS.includes(path.slice(dot + 1).toLowerCase());
};

/** a dropped file past this is not read — the limit `images.rs` reads Finder's paths with */
export const IMAGE_FILE_MAX_BYTES = 25 * 1024 * 1024;
const MB = 1024 * 1024;

/**
 * The pictures among dropped files, by name. When there were files but none
 * of them a picture (a PDF, a HEIC), says so — a drop that silently did
 * nothing left the user unsure whether dropping works at all (#155).
 */
const pickPictures = <T>(items: T[], name: (item: T) => string): T[] => {
  const images = items.filter((item) => isImagePath(name(item)));
  if (items.length > 0 && images.length === 0) {
    toastError(new Error(`Only ${IMAGE_EXTENSIONS.join(", ")} pictures can be dropped here`));
  }
  return images;
};

/** the pictures among files Tauri took from a drop, as paths (macOS) */
export const droppedImagePaths = (paths: string[]): string[] => pickPictures(paths, (p) => p);

/**
 * The pictures among files dropped on the page itself — on Windows, where the
 * webview keeps file drops so HTML5 drags work (`dragDropEnabled: false`).
 * The same rule as the paths, and the size limit Rust has for those, said in
 * its words.
 */
export const droppedImageFiles = (files: File[]): File[] =>
  pickPictures(files, (f) => f.name).filter((file) => {
    if (file.size <= IMAGE_FILE_MAX_BYTES) return true;
    toastError(
      new Error(
        `${file.name}: the image is too large (${Math.floor(file.size / MB)} MB; the limit is ${IMAGE_FILE_MAX_BYTES / MB} MB)`,
      ),
    );
    return false;
  });

/** reads a picture file through Rust — the webview cannot open a path itself (#8) */
export const readImageFile = async (path: string): Promise<Blob> => {
  const { mime, base64 } = await invoke<{ mime: string; base64: string }>("read_image_file", {
    path,
  });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

/** the palette's Image item: pick a file; null when the user cancels */
export const pickImageFile = async (): Promise<Blob | null> => {
  const path = await open({
    multiple: false,
    filters: [{ name: "Image", extensions: IMAGE_EXTENSIONS }],
  });
  return typeof path === "string" ? readImageFile(path) : null;
};
