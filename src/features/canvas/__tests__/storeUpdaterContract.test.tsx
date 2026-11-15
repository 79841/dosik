import { act, fireEvent, render } from "@testing-library/react";
import { type Node, ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { DiagramCanvas } from "../DiagramCanvas";

/**
 * Pins down, on an unmocked `ReactFlow`, the React Flow StoreUpdater
 * behaviour the #228 fix relies on.
 *
 * The canvas writes the snapping pause only to React Flow's store and keeps
 * the `snapToGrid` prop on. It turns drag auto-pan off in the store on the
 * release and passes no prop for it. Both rely on two habits of StoreUpdater
 * (the effect in which React Flow copies props into its own store after
 * rendering them):
 * - it writes only props that changed — a render during a drag does not let
 *   the always-on prop overwrite the paused value
 * - it never writes a prop that is not passed — a render after the release
 *   leaves auto-pan off
 *
 * The mock in `dragAutoPanSnap.test.tsx` only mimics these habits. If React
 * Flow changed to write every prop each time, that test would still pass and
 * only the app would shake again. If this test breaks, look again at
 * `setSnap` in `DiagramCanvas` and at the window's release handling.
 */

type RfStore = ReturnType<typeof useStoreApi>;
let rf: RfStore | null = null;
const GrabRfStore = () => {
  rf = useStoreApi();
  return null;
};
const rfState = () => rf!.getState();

/** the canvas spans 1000×700 from the window's corner */
const PANE = { left: 0, top: 0, width: 1000, height: 700 };
const CENTRE: [number, number] = [500, 350];
/** 20px in from the left edge — where React Flow slides the view */
const LEFT_EDGE: [number, number] = [20, 350];
const pointer = ([clientX, clientY]: [number, number]) =>
  new MouseEvent("mousemove", { clientX, clientY });
const primaryAt = ([clientX, clientY]: [number, number]) => ({ isPrimary: true, clientX, clientY });

/** the editor as the app has it: one provider above, the canvas mounted and unmounted below */
const Editor = ({ shown }: { shown: boolean }) => (
  <ReactFlowProvider>
    <GrabRfStore />
    {shown && <DiagramCanvas />}
  </ReactFlowProvider>
);
const mount = () => {
  const view = render(<Editor shown />);
  // jsdom lays nothing out: give React Flow's pane, which the drag measures, a size
  rfState().domNode!.getBoundingClientRect = () =>
    ({ ...PANE, x: PANE.left, y: PANE.top, right: PANE.width, bottom: PANE.height }) as DOMRect;
  return view;
};

const store = () => useDiagramStore.getState();
const asFlowNode = (id: string, dragging: boolean): Node => ({
  ...store().nodes.find((n) => n.id === id)!,
  dragging,
});
const rfPosition = (id: string) => rfState().nodes.find((n) => n.id === id)?.position;
/** a move React Flow reports — the canvas takes it into the document and renders again */
const move = (id: string, x: number, y: number, dragging: boolean) =>
  act(() => rfState().onNodesChange!([{ type: "position", id, position: { x, y }, dragging }]));

describe("React Flow's StoreUpdater does not fight the fix (#228)", () => {
  it("store snapping stays off however many times the canvas renders during the drag", () => {
    store().loadDoc(makeDoc([makeNode({ id: "a", x: 96, y: 96 })], []), null);
    mount();
    expect(rfState().snapToGrid).toBe(true);

    act(() =>
      rfState().onNodeDragStart!(pointer(CENTRE), asFlowNode("a", true), [asFlowNode("a", true)]),
    );
    act(() => {
      fireEvent.pointerMove(document.body, primaryAt(LEFT_EDGE));
    });
    expect(rfState().snapToGrid).toBe(false);

    let snapsBackOn = 0;
    const unsubscribe = rf!.subscribe((state, previous) => {
      if (state.snapToGrid && !previous.snapToGrid) snapsBackOn++;
    });
    for (let i = 0; i < 10; i++) {
      move("a", 13.5 - i, 101.25, true);
      act(() =>
        rfState().onNodeDrag!(pointer(LEFT_EDGE), asFlowNode("a", true), [asFlowNode("a", true)]),
      );
    }
    unsubscribe();
    // the renders did reach React Flow's store — StoreUpdater ran on each
    expect(rfPosition("a")).toEqual({ x: 4.5, y: 101.25 });
    expect(snapsBackOn).toBe(0);
    expect(rfState().snapToGrid).toBe(false);
  });

  it("drag auto-pan turned off on the release stays off through later renders", () => {
    store().loadDoc(
      makeDoc([makeNode({ id: "a", x: 96, y: 96 }), makeNode({ id: "b", x: 400, y: 96 })], []),
      null,
    );
    mount();
    act(() =>
      rfState().onNodeDragStart!(pointer(CENTRE), asFlowNode("a", true), [asFlowNode("a", true)]),
    );
    move("a", 104, 96, true);
    act(() => {
      fireEvent.pointerUp(document.body, primaryAt(CENTRE));
    });
    move("a", 104, 96, false);
    act(() =>
      rfState().onNodeDragStop!(pointer(CENTRE), asFlowNode("a", false), [asFlowNode("a", false)]),
    );
    expect(rfState().autoPanOnNodeDrag).toBe(false);
    expect(rfState().snapToGrid).toBe(true);

    for (let x = 408; x <= 440; x += 8) move("b", x, 96, false);
    expect(rfPosition("b")).toEqual({ x: 440, y: 96 });
    expect(rfState().autoPanOnNodeDrag).toBe(false);
  });

  it("reopening the editor starts with both snapping and drag auto-pan on", () => {
    store().loadDoc(makeDoc([makeNode({ id: "a", x: 96, y: 96 })], []), null);
    const view = mount();
    // what a drag left behind — paused snapping, auto-pan off after a release
    act(() => rf!.setState({ snapToGrid: false, autoPanOnNodeDrag: false }));
    view.rerender(<Editor shown={false} />);
    view.rerender(<Editor shown />);
    expect(rfState().snapToGrid).toBe(true);
    expect(rfState().autoPanOnNodeDrag).toBe(true);
  });
});
