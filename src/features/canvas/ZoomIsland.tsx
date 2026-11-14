import { useReactFlow, useStore } from "@xyflow/react";

import { ZoomIsland as Island } from "../../shared/ui/ZoomIsland";

/**
 * The editor's zoom island at the canvas's bottom right (#219 D10): the
 * shared island (`shared/ui/ZoomIsland`, which the Home library board shows
 * too — #221 D23) wired to React Flow. It replaces React Flow's own vertical
 * controls and makes the same calls (`zoomIn`, `zoomOut`, a plain
 * `fitView`); the ratio puts the zoom back to 100%. It is a sibling of
 * `.react-flow` in the canvas column, never inside `.react-flow__viewport`,
 * so exports cannot capture it (`exportSafeChrome`).
 *
 * The toasts never reach it: the editor holds them on the row above its
 * bottom islands, which clears this shorter one on any canvas (#231 D18 — it used to lift them itself on a narrow one, #219).
 */
export const ZoomIsland = () => {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  // the zoom alone — panning changes the transform's x and y, not this
  const zoom = useStore((s) => s.transform[2]);
  const minZoom = useStore((s) => s.minZoom);
  const maxZoom = useStore((s) => s.maxZoom);

  return (
    <Island
      zoom={zoom}
      minZoom={minZoom}
      maxZoom={maxZoom}
      onZoomOut={() => void zoomOut()}
      onReset={() => void zoomTo(1)}
      onZoomIn={() => void zoomIn()}
      onFit={() => void fitView()}
    />
  );
};
