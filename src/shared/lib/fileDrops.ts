/**
 * Files dropped from Finder land where the pointer is (#275). Tauri takes a
 * drop before the page sees it (macOS) and reports where it landed, in
 * physical pixels; every listener hears every drop, so a region that takes
 * files itself is marked with this attribute and the canvas leaves drops on
 * it alone.
 */
export const TAKES_FILE_DROPS = "data-takes-file-drops";

/** the element under a drop Tauri reported */
export const elementAtDrop = (position: { x: number; y: number }): Element | null => {
  const scale = window.devicePixelRatio || 1;
  return document.elementFromPoint?.(position.x / scale, position.y / scale) ?? null;
};

/** a drop on a region that takes its own files — not the canvas's */
export const dropTakenElsewhere = (position: { x: number; y: number }): boolean =>
  elementAtDrop(position)?.closest(`[${TAKES_FILE_DROPS}]`) != null;
