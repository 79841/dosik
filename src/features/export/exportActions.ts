import { writeImage, writeText } from "@tauri-apps/plugin-clipboard-manager";

import { base64ToBytes } from "../../shared/lib/base64";
import { useDiagramStore } from "../../shared/lib/store";
import { toastError, useToastStore } from "../../shared/lib/toastStore";
import type { DiagramDoc } from "../../shared/lib/types";
import { saveBinaryFile, saveTextFile } from "./file";
import { renderPngBase64, renderSvgText } from "./image";
import { toMarkdown } from "./markdown";
import { selectionDoc } from "./selection";

/**
 * The exports — Markdown and the two images — in one place because two
 * surfaces start them: the toolbar exports the whole document, the canvas's
 * right-click menu exports what is picked (#139). Keeping one copy is what stops the two from
 * drifting on filenames, scoping or error text.
 *
 * Each returns the toast to show, or null when the user cancelled the save
 * dialog. Failures throw — the caller decides how to surface them.
 */

/** the file name, marked so a partial export is not mistaken for the whole */
export const exportFileBase = (title: string, selectionOnly = false): string =>
  `${(title || "diagram").replace(/[\\/:*?"<>|]/g, "_")}${selectionOnly ? "-selection" : ""}`;

const fileBase = (selectionOnly: boolean) =>
  exportFileBase(useDiagramStore.getState().title, selectionOnly);

/** the piece to export: the whole document, or just what is selected (#48) */
const scopedDoc = (selectionOnly: boolean): DiagramDoc | null => {
  const store = useDiagramStore.getState();
  const doc = store.toDoc();
  if (!selectionOnly) return doc;
  return selectionDoc(doc, store.nodes, store.edges);
};

const requireDoc = (selectionOnly: boolean): DiagramDoc => {
  const doc = scopedDoc(selectionOnly);
  if (!doc) throw new Error("Nothing selected");
  return doc;
};

/**
 * The nodes the image renderer measures its viewport from.
 *
 * The whole-document path keeps the live nodes on purpose: `toDoc` strips the
 * runtime fields, and the viewport is measured from them.
 */
const viewportNodes = (selectionOnly: boolean, doc: DiagramDoc) =>
  selectionOnly ? doc.nodes : useDiagramStore.getState().nodes;

export const exportPng = async (selectionOnly = false): Promise<string | null> => {
  const doc = requireDoc(selectionOnly);
  const base64 = await renderPngBase64(viewportNodes(selectionOnly, doc));
  const path = await saveBinaryFile(
    base64,
    [{ name: "PNG Image", extensions: ["png"] }],
    `${fileBase(selectionOnly)}.png`,
  );
  return path ? "Exported as PNG" : null;
};

export const exportSvg = async (selectionOnly = false): Promise<string | null> => {
  const doc = requireDoc(selectionOnly);
  const svg = await renderSvgText(viewportNodes(selectionOnly, doc));
  const path = await saveTextFile(
    svg,
    [{ name: "SVG Image", extensions: ["svg"] }],
    `${fileBase(selectionOnly)}.svg`,
  );
  return path ? "Exported as SVG" : null;
};

/**
 * The diagram as Markdown — its title and a Mermaid block (#192); a
 * selection is the picked shapes and the edges between them.
 */
const markdownOf = (selectionOnly: boolean): string => {
  const doc = requireDoc(selectionOnly);
  // a free arrow is two anchors and a line, and Mermaid draws neither: with
  // nothing else, the file would be an empty block reported as written
  if (!doc.nodes.some((n) => n.data.shape !== "anchor")) {
    throw new Error(
      `The ${selectionOnly ? "selection" : "diagram"} has no shapes to write as Markdown`,
    );
  }
  return toMarkdown(doc);
};

export const exportMarkdown = async (selectionOnly = false): Promise<string | null> => {
  const path = await saveTextFile(
    markdownOf(selectionOnly),
    [{ name: "Markdown", extensions: ["md"] }],
    `${fileBase(selectionOnly)}.md`,
  );
  return path ? "Exported as Markdown" : null;
};

/**
 * The same renders, straight onto the system clipboard (#143).
 *
 * Exporting is usually a step on the way to pasting somewhere else, and the
 * file dialog makes that a round trip through disk.
 *
 * The bytes go out through the Rust side rather than `navigator.clipboard`:
 * WKWebView only honours `ClipboardItem` writes under conditions a menu click
 * does not reliably meet, and an image write that silently does nothing is
 * worse than no button.
 */
export const copyPng = async (selectionOnly = false): Promise<string> => {
  const doc = requireDoc(selectionOnly);
  const base64 = await renderPngBase64(viewportNodes(selectionOnly, doc));
  await writeImage(base64ToBytes(base64));
  return selectionOnly ? "Selection copied as PNG" : "Copied as PNG";
};

export const copySvg = async (selectionOnly = false): Promise<string> => {
  const doc = requireDoc(selectionOnly);
  const svg = await renderSvgText(viewportNodes(selectionOnly, doc));
  await writeText(svg);
  return selectionOnly ? "Selection copied as SVG" : "Copied as SVG";
};

/** Markdown is text: a README, an issue or a chat takes it pasted (#192) */
export const copyMarkdown = async (selectionOnly = false): Promise<string> => {
  await writeText(markdownOf(selectionOnly));
  return selectionOnly ? "Selection copied as Markdown" : "Copied as Markdown";
};

/**
 * Runs one of the above and reports it the way the app reports everything:
 * a toast at the bottom, never chrome inside the surface that started it
 * (#81).
 */
export const runExport = async (task: () => Promise<string | null>): Promise<void> => {
  try {
    const message = await task();
    if (message) useToastStore.getState().pushToast(message);
  } catch (error) {
    toastError(error);
  }
};
