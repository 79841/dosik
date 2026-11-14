import { useDiagramStore } from "../../shared/lib/store";
import { readClipboardImage, readClipboardText } from "../../shared/lib/systemClipboard";
import { toastError } from "../../shared/lib/toastStore";
import { pasteMermaid } from "../mermaid/import/pasteMermaid";
import { mermaidSource } from "../mermaid/mermaidSource";
import { pastePoint } from "./canvasViewport";
import { imageFromRgba, placeImage, watchDocument } from "./imageInput";

/** seams for tests — the canvas work needs a real `<canvas>`, which jsdom lacks */
export const imagePasteDeps = {
  placeFromRgba: (
    rgba: Uint8Array,
    width: number,
    height: number,
    at: { x: number; y: number },
  ): string => placeImage(imageFromRgba(rgba, width, height), at),
};

/** the labels a canvas copy last wrote to the system clipboard (`canvasKeymap`) */
let ownText: string | null = null;
export const markOwnClipboardText = (text: string): void => {
  ownText = text;
};

/**
 * A copy's write to the system clipboard, still under way: deciding whether
 * to overwrite takes a round trip or two to Rust, and a ⌘V pressed right
 * after ⌘C must read what the copy leaves, not what it is replacing.
 */
let pendingWrite: Promise<void> = Promise.resolve();
export const awaitBeforePaste = (write: Promise<void>): void => {
  pendingWrite = write;
};

/**
 * ⌘V on the canvas (#8): a picture on the system clipboard becomes an image
 * node under the pointer (`pastePoint`, #200); Mermaid code there is drawn (#200);
 * otherwise the in-app shape buffer pastes as before. The clipboard wins
 * because it holds the newer copy — copying shapes writes their labels over a
 * picture or Mermaid code (`canvasKeymap`), and those labels, even one that
 * reads as Mermaid, paste the shapes.
 *
 * Reading the clipboard awaits Rust: whatever it holds goes to the diagram ⌘V
 * was pressed in, or nowhere (#218).
 */
export const pasteOntoCanvas = async (): Promise<void> => {
  const pressedIn = watchDocument("You left the diagram before it was pasted — paste again");
  await pendingWrite;
  const image = await readClipboardImage();
  if (pressedIn.left()) return;
  if (image) {
    try {
      imagePasteDeps.placeFromRgba(image.rgba, image.width, image.height, pastePoint());
    } catch (error) {
      toastError(error);
    }
    return;
  }
  const text = await readClipboardText();
  if (pressedIn.left()) return;
  const source = text !== null && text !== ownText ? mermaidSource(text) : null;
  if (source) {
    await pasteMermaid(source, pastePoint());
    return;
  }
  useDiagramStore.getState().paste();
};
