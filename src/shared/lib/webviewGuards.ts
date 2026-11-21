import { useEffect } from "react";

import { isMacPlatform } from "./windowChrome";

/** the input types a person types text into — their right click keeps the edit menu */
const TEXT_INPUTS = new Set(["", "text", "search", "email", "url", "password", "number", "tel"]);

/** a place the system's edit menu (cut, copy, paste) belongs to */
export const isTextField = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUTS.has((target.getAttribute("type") ?? "").toLowerCase());
  }
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
};

const carriesFiles = (e: DragEvent): boolean =>
  [...(e.dataTransfer?.types ?? [])].includes("Files");

/**
 * What the webview would do on its own and an app must not, off macOS (spec
 * R6, R8). WebView2 shows a browser menu (Back, Reload, Save as, Print,
 * Inspect) on any right click nothing took, and opens a file dropped where
 * nothing took it — navigating away from the app. So:
 *
 * - a right click is prevented in the capture phase unless it is on a text
 *   field, which keeps the system's edit menu. The event goes on: the app's
 *   own menus (canvas, sidebar, board) open as before;
 * - files dragged over a place that did not take them are refused there, and
 *   their drop is prevented. The canvas takes picture files itself (its
 *   `onDrop`); drags that carry no files — a shape, a tree row — are left alone.
 *
 * On macOS the native webview shows no such menu where the app has none of
 * its own, and Tauri takes file drops first, so nothing is installed.
 * Returns the cleanup.
 */
export const installWebviewGuards = (mac: boolean = isMacPlatform()): (() => void) => {
  if (mac) return () => {};
  const onContextMenu = (e: MouseEvent) => {
    if (!isTextField(e.target)) e.preventDefault();
  };
  // the bubble phase, after the page's own handlers had their say
  const onDragOver = (e: DragEvent) => {
    if (e.defaultPrevented || !carriesFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
  };
  const onDrop = (e: DragEvent) => {
    if (!e.defaultPrevented && carriesFiles(e)) e.preventDefault();
  };
  window.addEventListener("contextmenu", onContextMenu, true);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("drop", onDrop);
  return () => {
    window.removeEventListener("contextmenu", onContextMenu, true);
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("drop", onDrop);
  };
};

/** the App installs the guards once */
export const useWebviewGuards = (): void => {
  useEffect(() => installWebviewGuards(), []);
};
