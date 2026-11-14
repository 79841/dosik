import { useDiagramStore } from "../../shared/lib/store";
import { hasExportableSelection } from "../export/selection";
import { takesAllKeys } from "./canvasKeymap";
import { useCanvasUiStore } from "./canvasUiStore";

/**
 * A right-click on a shape, decided before anything is shown (#139).
 *
 * `settle` says whether the click still has to decide the selection. A click
 * on a single shape does; one that arrives through React Flow's
 * multi-selection rectangle does not — that selection is already made.
 *
 * Two clicks are refused outright, and refusing means *changing nothing*:
 *
 * - inside a label editor, where the browser's own cut/copy/paste menu wins,
 *   the same rule the keymap follows
 * - on a bare anchor, which has nothing to export. Settling the selection
 *   first would have thrown away the user's pick to then show no menu — a
 *   right-click that shows nothing must change nothing (#139)
 *
 * Returns whether the menu opened, so the caller knows whether to swallow the
 * browser's own context menu.
 */
export const openShapeMenu = (args: {
  target: HTMLElement | null;
  nodeId: string;
  settle: boolean;
  clientX: number;
  clientY: number;
}): boolean => {
  const store = useDiagramStore.getState();
  if (takesAllKeys(args.target)) return false;
  if (args.settle && store.nodes.find((n) => n.id === args.nodeId)?.data.shape === "anchor")
    return false;
  if (args.settle) store.selectForContextMenu(args.nodeId);
  useCanvasUiStore
    .getState()
    .setNodeMenu({ nodeId: args.nodeId, clientX: args.clientX, clientY: args.clientY });
  return true;
};

/**
 * Opens the shape menu (editing and exporting the selection) without a pointer (#139, #159).
 *
 * The menu is anchored to the selection's own centre rather than to the mouse,
 * because there is no mouse — and the React Flow container is the frame the
 * canvas measures everything else in, so the menu lands over the shapes the
 * user just picked rather than in a screen corner.
 *
 * Returns whether it opened, so the caller only swallows the keystroke when
 * the canvas actually acted on it.
 */
export const openSelectionMenuFromKeyboard = (): boolean => {
  const { nodes, edges } = useDiagramStore.getState();
  if (!hasExportableSelection(nodes, edges)) return false;
  // A free arrow selected on its own puts nothing in `nodes` — only the edge
  // is picked — so fall back to a node that edge holds. The id has to name a
  // node that exists: the cleanup subscription uses it to close the menu when
  // the shape goes away (#139).
  const picked = nodes.find((n) => n.selected);
  const held = edges.find((e) => e.selected);
  const anchorId =
    picked?.id ?? [held?.source, held?.target].find((id) => id && nodes.some((n) => n.id === id));
  if (!anchorId) return false;

  const box = document.querySelector(".react-flow")?.getBoundingClientRect();
  useCanvasUiStore.getState().setNodeMenu({
    nodeId: anchorId,
    clientX: box ? box.left + box.width / 2 : 0,
    clientY: box ? box.top + box.height / 2 : 0,
    fromKeyboard: true,
  });
  return true;
};
