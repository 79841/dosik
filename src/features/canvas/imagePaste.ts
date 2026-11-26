import { useDiagramStore } from "../../shared/lib/store";
import {
  type ClipboardPicture,
  readClipboardPicture,
  readClipboardText,
} from "../../shared/lib/systemClipboard";
import { pasteMermaid } from "../mermaid/import/pasteMermaid";
import { mermaidSource } from "../mermaid/mermaidSource";
import { pastePoint } from "./canvasViewport";
import { blobFromBase64, pastedImagePaths, readPictureFile } from "./imageFiles";
import { type PictureSource, watchDocument } from "./imageInput";
import { placeBlobs } from "./useImageFileDrop";

/** seams for tests — decoding needs `createImageBitmap` and a real `<canvas>`, which jsdom lacks */
export const imagePasteDeps = { placeBlobs };

const LEFT_BEFORE_PASTE = "You left the diagram before it was pasted — paste again";

/**
 * Each copied picture file, read (and linked) as a drop reads it — copied
 * files that hold no picture say so and paste nothing, never their icons — or
 * the one picture copied as data, which has no file to link.
 */
const pictureLoads = (picture: ClipboardPicture): (() => Promise<PictureSource>)[] =>
  picture.kind === "files"
    ? pastedImagePaths(picture.paths).map((path) => () => readPictureFile(path))
    : [async () => ({ blob: blobFromBase64(picture.base64, picture.mime) })];

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
 * node under the pointer (`pastePoint`, #200) — picture files copied in
 * Finder or Explorer one each, a step apart as when dropped; Mermaid code
 * there is drawn (#200); otherwise the in-app shape buffer pastes as before.
 * The clipboard wins because it holds the newer copy — copying shapes writes
 * their labels over a picture or Mermaid code (`canvasKeymap`), and those
 * labels, even one that reads as Mermaid, paste the shapes.
 *
 * Reading the clipboard awaits Rust: whatever it holds goes to the diagram ⌘V
 * was pressed in, or nowhere (#218).
 */
export const pasteOntoCanvas = async (): Promise<void> => {
  const pressedIn = watchDocument(LEFT_BEFORE_PASTE);
  await pendingWrite;
  const picture = await readClipboardPicture();
  if (pressedIn.left()) return;
  if (picture) {
    await imagePasteDeps.placeBlobs(pictureLoads(picture), pastePoint(), LEFT_BEFORE_PASTE);
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
