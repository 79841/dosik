import { readImage, readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * The OS clipboard, through the Tauri plugin (#8).
 *
 * Read through Rust rather than a DOM `paste` event: WebKit only dispatches
 * one when an editable element has focus, and the canvas is not editable.
 * Outside Tauri (`pnpm dev`) the plugin is absent and these quietly do nothing.
 */
type ClipboardImage = Awaited<ReturnType<typeof readImage>>;

/**
 * Every `readImage()` leaves a Rust resource holding the picture's full RGBA
 * (a Retina screenshot is ~30 MB) until it is closed — nothing collects it
 * otherwise, short of closing the window (#155). Closing must not fail
 * the read it follows.
 */
const release = async (image: ClipboardImage | undefined): Promise<void> => {
  await image?.close().catch(() => undefined);
};

export const readClipboardImage = async (): Promise<{
  rgba: Uint8Array;
  width: number;
  height: number;
} | null> => {
  let image: ClipboardImage | undefined;
  try {
    image = await readImage();
    const { width, height } = await image.size();
    return { rgba: await image.rgba(), width, height };
  } catch {
    // no picture on the clipboard (text, files, nothing) or no Tauri
    return null;
  } finally {
    await release(image);
  }
};

/** whether a picture is on the clipboard — without carrying its pixels over (#155) */
export const hasClipboardImage = async (): Promise<boolean> => {
  let image: ClipboardImage | undefined;
  try {
    image = await readImage();
    return true;
  } catch {
    return false;
  } finally {
    await release(image);
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
