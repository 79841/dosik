import { useDiagramStore } from "../../shared/lib/store";
import {
  hasClipboardPicture,
  readClipboardText,
  writeClipboardText,
} from "../../shared/lib/systemClipboard";
import { mermaidSource } from "../mermaid/mermaidSource";
import { awaitBeforePaste, markOwnClipboardText, pasteOntoCanvas } from "./imagePaste";
import { openSelectionMenuFromKeyboard } from "./selectionMenu";

/** what a copy puts on the system clipboard: the copied shapes' labels, one per line */
const copiedLabels = (): string =>
  (useDiagramStore.getState().clipboard?.nodes ?? [])
    .map((n) => n.data.label)
    .filter((label) => label.trim() !== "")
    .join("\n");

/**
 * ⌘V pastes a picture on the system clipboard before copied shapes — copied
 * files too, if only to say they hold no picture — and Mermaid code (#200), so
 * any of them, copied earlier in another app, would win over the shapes
 * copied just now (#8). Only then is the system clipboard
 * overwritten — with the labels — and otherwise left alone: a URL copied in a
 * browser must survive copying a box to move it (#155).
 */
const supersedeClipboard = async (): Promise<void> => {
  if (!(await hasClipboardPicture())) {
    const text = await readClipboardText();
    if (!text || !mermaidSource(text)) return;
  }
  const labels = copiedLabels();
  // labels that happen to read as Mermaid ("pie chart") are still these shapes
  markOwnClipboardText(labels);
  // an empty string still replaces the picture
  await writeClipboardText(labels);
};

/**
 * Somewhere the user is typing, so the browser's own editing wins outright —
 * `Cmd+C` in a label editor must copy text, not shapes. `.nokey` is React
 * Flow's documented "send no keys into this subtree" escape hatch.
 */
export const takesAllKeys = (target: HTMLElement | null): boolean => {
  if (!target) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
  if (target.getAttribute?.("contenteditable") === "true" || target.isContentEditable) return true;
  return !!target.closest?.(".nokey");
};

/**
 * Additionally off-limits for a *bare* destructive key. A `<select>` is not text
 * entry — undo and the clipboard should still reach the canvas from one — but
 * Backspace while its dropdown has focus must not delete the shape that opened
 * the panel.
 *
 * This is React Flow's own split: `useKeyPress` defaults
 * `actInsideInputWithModifier: true`, so modifier combos fire inside inputs, and
 * only the delete key opts out with `false`.
 *
 * `.nodelete` puts a whole subtree in this grade — the AI chat panel uses it so
 * Backspace on its resize handle or a header button cannot delete the shape the
 * user is asking about, while `Cmd+Z` from there still reaches the canvas.
 */
const takesBareDestructiveKeys = (target: HTMLElement | null): boolean =>
  takesAllKeys(target) || target?.tagName === "SELECT" || !!target?.closest?.(".nodelete");

/**
 * Every canvas-level keyboard shortcut, in one place.
 *
 * Lives outside the component so it can be exercised directly — the gestures
 * themselves can't be driven in this environment, so "does the key reach the
 * action" is the one seam worth testing.
 *
 * Keystrokes aimed at a text field are left alone: the browser's own editing
 * (including text copy/paste in a label editor) must win there.
 */
export const handleCanvasKeyDown = (e: KeyboardEvent): void => {
  // a modal dialog (Settings, From Mermaid…) owns the keyboard: Backspace on
  // one of its buttons must not delete the selection behind it
  if (document.querySelector("dialog[open]")) return;
  const target = e.target as HTMLElement | null;
  if (takesAllKeys(target)) return;

  // Enter starts editing the label of the single selected (or focused) node —
  // unless it lands on a control (a bar button, a menu item), where Enter is
  // that control's own activation (#159)
  if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (target?.closest?.("button, select, [role=menu], [role=toolbar], .nodelete")) return;
    const selected = useDiagramStore
      .getState()
      // an image has no label on show to edit — same as its double-click (#8)
      .nodes.filter((n) => n.selected && n.data.shape !== "anchor" && n.data.shape !== "image");
    if (selected.length === 1) {
      e.preventDefault();
      useDiagramStore.getState().requestEditLabel(selected[0]!.id);
    }
    return;
  }

  // Delete lives here rather than on React Flow's `deleteKeyCode` because that
  // path fires triggerEdgeChanges and triggerNodeChanges *separately*, and each
  // of our change handlers commits — a node deleted together with its edges left
  // two history frames, so one Cmd+Z brought back only half of it (#110).
  // `deleteElements` is a single commit and already prunes stranded anchors.
  if (e.key === "Backspace" || e.key === "Delete") {
    if (takesBareDestructiveKeys(target)) return;
    const { nodes, edges } = useDiagramStore.getState();
    const nodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
    const edgeIds = edges.filter((edge) => edge.selected).map((edge) => edge.id);
    if (nodeIds.length === 0 && edgeIds.length === 0) return;
    e.preventDefault();
    useDiagramStore.getState().deleteElements(nodeIds, edgeIds);
    return;
  }

  // The context-menu key, where the keyboard has one. macOS does not, which is
  // why the combo below exists — without it the selection exports would be
  // reachable by mouse only (#139).
  if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
    if (openSelectionMenuFromKeyboard()) e.preventDefault();
    return;
  }

  const meta = e.metaKey || e.ctrlKey;
  if (!meta || e.altKey) return;
  const key = e.key.toLowerCase();

  // Shift+Cmd+E — the keyboard way into the selection export menu
  if (e.shiftKey && key === "e") {
    if (openSelectionMenuFromKeyboard()) e.preventDefault();
    return;
  }

  if (key === "z") {
    e.preventDefault();
    if (e.shiftKey) useDiagramStore.getState().redo();
    else useDiagramStore.getState().undo();
    return;
  }

  // Cmd+G binds the selection into a group, Shift+Cmd+G releases it (#171)
  if (key === "g") {
    const store = useDiagramStore.getState();
    if (e.shiftKey ? store.ungroupSelection() : store.groupSelection()) e.preventDefault();
    return;
  }

  // shifted variants are left to the browser/OS — only the bare combos are ours
  if (e.shiftKey) return;
  // only swallow the keystroke when the canvas actually acted on it. Cancelling
  // a Cmd+C keydown suppresses the copy command that would follow, so an empty
  // selection must leave the event alone for whatever else might want it.
  if (key === "c") {
    if (useDiagramStore.getState().copySelection()) {
      e.preventDefault();
      awaitBeforePaste(supersedeClipboard());
    }
  } else if (key === "v") {
    // always ours on the canvas: even with no shapes copied, the system
    // clipboard may hold a picture — and nothing else pastes onto the canvas
    e.preventDefault();
    void pasteOntoCanvas();
  } else if (key === "x") {
    if (useDiagramStore.getState().cutSelection()) {
      e.preventDefault();
      awaitBeforePaste(supersedeClipboard());
    }
  } else if (key === "d") {
    // Cmd+D is "bookmark" in a browser — claim it whenever the canvas can act
    if (useDiagramStore.getState().duplicateSelection()) e.preventDefault();
  }
};
