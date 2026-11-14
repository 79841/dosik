import type { DiagramState } from "./state";
import type { RevealRequest } from "./reveal";

/**
 * Open documents as tabs (#218 D1, D2). The store stays one store — the
 * active tab's document — and every other tab carries its document as a
 * snapshot of the store's document fields, swapped back in with one
 * `setState` when the tab is activated. Nothing here knows about tabs as
 * such; the tab list is the app's (`features/library/tabActions`).
 *
 * Every field of the store that is not a function sits in exactly one of the
 * three lists below — a test holds it to that, so a new field cannot leak
 * across tabs, or be lost on a switch, without a decision.
 */

/** what a tab carries: the document, where it lives, its selection and its undo history (D2, D6) */
export const DOC_KEYS = [
  "title",
  "nodes",
  "edges",
  "past",
  "future",
  "filePath",
  "projectId",
  "enteredGroup",
] as const satisfies readonly (keyof DiagramState)[];

/**
 * What starts over on every swap — gestures and highlights that belong to the
 * moment, not the document — and the view request the swap leaves for
 * `ViewportReveal` (D5).
 */
export const RESET_KEYS = [
  "touched",
  "editRequestId",
  "pasteCount",
  "dragRiders",
  "groupResizing",
  "revealRequest",
] as const satisfies readonly (keyof DiagramState)[];

/**
 * The app's, whichever tab is active: the copy buffer (pasting across
 * documents is the point, as with `loadDoc`), the last edge style, and the
 * two swap counters — moved on, never restored, so a number a tab once had
 * can never come back and pass for another document (D17).
 */
export const GLOBAL_KEYS = [
  "clipboard",
  "lastEdgeStyle",
  "docVersion",
  "docSession",
] as const satisfies readonly (keyof DiagramState)[];

export type DocKey = (typeof DOC_KEYS)[number];
export type DocSnapshot = Pick<DiagramState, DocKey>;

/**
 * The document on screen, by reference (D2): the store updates immutably and
 * history frames are copies already, so nothing needs cloning.
 */
export const takeDocument = (state: DiagramState): DocSnapshot =>
  Object.fromEntries(DOC_KEYS.map((key) => [key, state[key]])) as DocSnapshot;

/**
 * The one `setState` that puts `snapshot` on screen: its fields, the reset
 * ones cleared, both counters past the live ones — the canvas UI closes its
 * editors and menus on `docVersion` (canvas-ui-state-lifecycle), a chat turn
 * stops on `docSession` (chat-target) — and `reveal` for the viewport.
 */
export const documentPatch = (
  snapshot: DocSnapshot,
  live: Pick<DiagramState, "docVersion" | "docSession">,
  reveal: RevealRequest,
): Partial<DiagramState> => ({
  ...snapshot,
  touched: {},
  editRequestId: null,
  pasteCount: 0,
  dragRiders: null,
  groupResizing: null,
  revealRequest: reveal,
  docVersion: live.docVersion + 1,
  docSession: live.docSession + 1,
});
