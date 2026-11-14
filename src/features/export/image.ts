import { getNodesBounds, getViewportForBounds } from "@xyflow/react";
import { toPng, toSvg } from "html-to-image";

import { useDiagramStore } from "../../shared/lib/store";
import { surfaceTokens, useThemeStore } from "../../shared/lib/theme";
import type { DiagramNode } from "../../shared/lib/types";

const PADDING = 48;
const PIXEL_RATIO = 2;

interface RenderTarget {
  element: HTMLElement;
  width: number;
  height: number;
  transform: string;
}

const prepareViewport = (nodes: DiagramNode[]): RenderTarget => {
  const element = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!element || nodes.length === 0) {
    throw new Error("Nothing to export — the diagram is empty");
  }
  const bounds = getNodesBounds(nodes);
  const width = Math.ceil(bounds.width + PADDING * 2);
  const height = Math.ceil(bounds.height + PADDING * 2);
  // Lock zoom to 1 so the viewport is simply centered with PADDING on each side.
  const viewport = getViewportForBounds(bounds, width, height, 1, 1, 0);
  return {
    element,
    width,
    height,
    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
  };
};

const renderOptions = (target: RenderTarget) => ({
  // exports capture the on-screen appearance, so the background follows the theme
  backgroundColor: surfaceTokens(useThemeStore.getState().theme).canvasBg,
  width: target.width,
  height: target.height,
  pixelRatio: PIXEL_RATIO,
  style: {
    width: `${target.width}px`,
    height: `${target.height}px`,
    transform: target.transform,
  },
  // editing chrome that survives deselection: the flash overlay is drawn from a
  // timestamp, not from `selected`. The zoom island and the other islands sit
  // outside the viewport, so they never reach the capture (#219)
  filter: (node: HTMLElement) => !node.classList?.contains("agent-flash"),
});

/**
 * Yields long enough for React to commit the deselected DOM.
 *
 * Not for the paint: `html-to-image` clones nodes and reads computed styles, so
 * what it needs is a committed DOM/CSSOM, not pixels. zustand's
 * `useSyncExternalStore` update flushes on the microtask checkpoint, ahead of
 * any frame, so one yield would do — the double frame is slack, not the reason.
 */
const nextPaint = (): Promise<void> =>
  typeof requestAnimationFrame === "function"
    ? new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    : Promise.resolve();

/**
 * Runs `capture` with nothing selected, then puts the selection back.
 *
 * Selection is editing state, not part of the document, and it paints: rings,
 * resize handles, segment grips, and an accent stroke that *replaces* the edge's
 * own colour. That stroke is an inline style computed per edge, so neither the
 * html-to-image `filter` nor a CSS override can restore the right colour —
 * capturing while nothing is selected is the only faithful way.
 *
 * No history frame: this is not an edit the user should be able to undo.
 *
 * The edit bar is keyed off the selection, so it disappears for the duration.
 * That is safe rather than lossy: its text fields commit on blur, and blur runs
 * before the click that started the export.
 */
const withoutSelection = async <T>(capture: () => Promise<T>): Promise<T> => {
  const { nodes, edges, touched } = useDiagramStore.getState();
  const selectedNodes = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
  const selectedEdges = new Set(edges.filter((e) => e.selected).map((e) => e.id));
  const flashing = Object.keys(touched).length > 0;
  if (selectedNodes.size === 0 && selectedEdges.size === 0 && !flashing) return capture();

  useDiagramStore.getState().clearSelection();
  // the agent-edit flash is the same kind of thing: an editing signal, and it
  // borrows the very stroke colour selection does
  if (flashing) useDiagramStore.setState({ touched: {} });
  await nextPaint();
  try {
    return await capture();
  } finally {
    useDiagramStore.setState((state) => ({
      nodes: state.nodes.map((n) => (selectedNodes.has(n.id) ? { ...n, selected: true } : n)),
      edges: state.edges.map((e) => (selectedEdges.has(e.id) ? { ...e, selected: true } : e)),
      // stamps that arrived during the capture must survive; the snapshot is a
      // floor, not the whole truth
      ...(flashing ? { touched: { ...touched, ...state.touched } } : {}),
    }));
  }
};

/** Returns a base64 payload (no data: prefix) of the diagram rendered as PNG. */
export const renderPngBase64 = async (nodes: DiagramNode[]): Promise<string> => {
  const target = prepareViewport(nodes);
  const dataUrl = await withoutSelection(() => toPng(target.element, renderOptions(target)));
  return dataUrl.replace(/^data:image\/png;base64,/, "");
};

/** Returns the diagram rendered as an SVG document string. */
export const renderSvgText = async (nodes: DiagramNode[]): Promise<string> => {
  const target = prepareViewport(nodes);
  const dataUrl = await withoutSelection(() => toSvg(target.element, renderOptions(target)));
  return decodeURIComponent(dataUrl.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
};
