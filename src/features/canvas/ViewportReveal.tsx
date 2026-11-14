import { useReactFlow, useStoreApi } from "@xyflow/react";
import { useEffect } from "react";

import { useDiagramStore } from "../../shared/lib/store";

/** where a document with nothing to fit is shown from */
const ORIGIN = { x: 0, y: 0, zoom: 1 };

/** reveal never zooms *in* past 100% — a one-node document should not fill the window */
const FIT = { maxZoom: 1 };

/**
 * The one place the viewport follows a document swap (#81, #117). Renders
 * nothing; it must sit inside the `ReactFlowProvider`.
 *
 * `fitView` is React Flow's queued one: it waits for the new nodes to be
 * measured, so acting right after the store change is safe whether this
 * effect runs before or after React Flow has adopted the nodes. The promise
 * is not awaited — nothing depends on the pan finishing. An empty document
 * goes to the origin instead, because a fit with nothing to fit never
 * resolves and would fire on the first shape added later.
 *
 * A fit already queued by an earlier swap is not cancelled. If the next swap
 * has nodes, the queued fit simply resolves against them. If the next swap
 * empties the document, React Flow never initialises an empty node set, so the
 * queued fit stays armed until the next shape is measured and fires then —
 * but reaching that needs two swaps in separate renders inside one frame,
 * which the bridge (it awaits a snapshot push per request) does not produce.
 * Clearing the queue would mean reaching into React Flow's store state; the
 * coupling is not worth a window that is not reached in practice.
 */
export const ViewportReveal = () => {
  const request = useDiagramStore((s) => s.revealRequest);
  const { fitView, setViewport } = useReactFlow();
  const flow = useStoreApi();

  useEffect(() => {
    if (!request) return;
    if (request.mode === "center" && request.bounds) {
      // a paste lands under the pointer (#200): the view stays put while all
      // of it is in sight, and otherwise brings it to the middle — at the zoom
      // the user chose, never zooming
      const { width, height, transform } = flow.getState();
      const [tx, ty, zoom] = transform;
      const b = request.bounds;
      const left = -tx / zoom;
      const top = -ty / zoom;
      const inSight =
        b.x >= left &&
        b.y >= top &&
        b.x + b.width <= left + width / zoom &&
        b.y + b.height <= top + height / zoom;
      if (!inSight) {
        void setViewport({
          x: width / 2 - (b.x + b.width / 2) * zoom,
          y: height / 2 - (b.y + b.height / 2) * zoom,
          zoom,
        });
      }
    } else if (request.mode === "viewport" && request.viewport) {
      // a tab the user comes back to opens where they left it (#218 D5)
      void setViewport(request.viewport);
    } else if (request.mode === "fit") void fitView(FIT);
    else void setViewport(ORIGIN);
    useDiagramStore.getState().consumeReveal(request.key);
  }, [request, fitView, setViewport, flow]);

  return null;
};
