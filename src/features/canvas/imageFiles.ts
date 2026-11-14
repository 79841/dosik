import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import { toastError } from "../../shared/lib/toastStore";

/** extensions an image node can hold — the same list `images.rs` reads */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];

export const isImagePath = (path: string): boolean => {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && IMAGE_EXTENSIONS.includes(path.slice(dot + 1).toLowerCase());
};

/**
 * The pictures among dropped files. When there were files but none of them a
 * picture (a PDF, a HEIC), says so — a drop that silently did nothing left the
 * user unsure whether dropping works at all (#155).
 */
export const droppedImagePaths = (paths: string[]): string[] => {
  const images = paths.filter(isImagePath);
  if (paths.length > 0 && images.length === 0) {
    toastError(new Error(`Only ${IMAGE_EXTENSIONS.join(", ")} pictures can be dropped here`));
  }
  return images;
};

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
