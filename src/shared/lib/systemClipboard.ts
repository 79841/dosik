import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * The OS clipboard, through Rust rather than DOM clipboard events (#8): WebKit
 * only dispatches `paste` when an editable element has focus, and the canvas
 * is not editable. Outside Tauri (`pnpm dev`) these quietly do nothing.
 */

/**
 * A picture on the clipboard, as a file (`clipboard_picture.rs`): picture
 * files copied in Finder or Explorer, or a picture's own bytes — never its
 * raw pixels, which take seconds to cross for a full-screen screenshot.
 */
export type ClipboardPicture =
  | { kind: "files"; paths: string[] }
  | { kind: "data"; mime: string; base64: string };

/** the picture ⌘V would paste, or null when the clipboard holds none */
export const readClipboardPicture = async (): Promise<ClipboardPicture | null> => {
  try {
    return await invoke<ClipboardPicture | null>("read_clipboard_picture");
  } catch {
    // no Tauri
    return null;
  }
};

/** whether a picture is on the clipboard — without carrying it over */
export const hasClipboardPicture = async (): Promise<boolean> => {
  try {
    return await invoke<boolean>("clipboard_has_picture");
  } catch {
    return false;
  }
};

/** the clipboard's text — Mermaid code to draw (#200) — or null when it holds none */
export const readClipboardText = async (): Promise<string | null> => {
  try {
    return await readText();
  } catch {
    // a picture, files, nothing, or no Tauri
    return null;
  }
};

/**
 * Writes `text` to the OS clipboard and says whether it went (#238 — Copy Path
 * tells the user); never throws. The canvas's copy ignores the answer: its
 * in-app copy already happened.
 */
export const writeClipboardText = async (text: string): Promise<boolean> => {
  try {
    await writeText(text);
    return true;
  } catch {
    return false;
  }
};
