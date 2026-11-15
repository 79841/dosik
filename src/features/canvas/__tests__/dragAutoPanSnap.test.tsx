import { act, fireEvent, render } from "@testing-library/react";
import type { FinalConnectionState, Node, NodeChange, useStoreApi } from "@xyflow/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import type { DiagramNode } from "../../../shared/lib/types";
import { useCanvasUiStore } from "../canvasUiStore";

/**
 * #228 — a shape dragged to the canvas edge shakes while the view slides.
 *
 * While a drag's pointer is within 40px of the edge (outside the canvas
 * included), React Flow slides the view by a fraction of a pixel every frame.
 * The canvas snaps the dragged shape to the 8px grid, so the shape's place on
 * screen saws back and forth under a still pointer (measured +3·+3·−5px;
 * outside the canvas −1×7·+7px).
 *
 * jsdom cannot run a drag itself (it cannot measure nodes). So this mimics
 * what React Flow does during a drag — sends positions through
 * `onNodesChange` and calls `onNodeDrag`·`onNodeDragStop` — and pins down
 * what the canvas tells React Flow (`snapToGrid`) and what becomes of the
 * document after the drop. The mimic keeps two of React Flow's habits too:
 * on each step the browser's pointermove comes first, and React Flow reports
 * through `onNodeDrag` only the steps where a shape changed place (XYDrag
 * `updateNodes`). And React Flow copies props into its own store only after
 * it renders them (StoreUpdater) — that store is what it reads during a drag.
 */
const captured: Record<string, unknown> = {};
/** how many times the canvas rendered React Flow */
const flowRenders = { count: 0 };

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  const { useEffect } = await import("react");
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown>) => {
      Object.assign(captured, props);
      flowRenders.count++;
      const rfStore = actual.useStoreApi();
      // StoreUpdater: the prop reaches React Flow's store after the render,
      // and only when it changed
      useEffect(() => {
        rfStore.setState({ snapToGrid: props.snapToGrid as boolean });
      }, [rfStore, props.snapToGrid]);
      return <div data-testid="flow" />;
    },
  };
});

const { DiagramCanvas } = await import("../DiagramCanvas");
const { ReactFlowProvider, useStoreApi: useRfStore } = await import("@xyflow/react");

type Handlers = {
  snapToGrid: boolean;
  snapGrid: [number, number];
  onNodesChange: (changes: NodeChange<DiagramNode>[]) => void;
  onNodeDragStart: (e: MouseEvent, node: Node, nodes: Node[]) => void;
  onNodeDrag: (e: MouseEvent, node: Node, nodes: Node[]) => void;
  onNodeDragStop: (e: MouseEvent, node: Node, nodes: Node[]) => void;
  onConnectEnd: (e: MouseEvent | TouchEvent, state: FinalConnectionState) => void;
};
const flow = () => captured as unknown as Handlers;

type XY = { x: number; y: number };
const store = () => useDiagramStore.getState();
const pos = (id: string) => store().nodes.find((n) => n.id === id)!.position;
const asFlowNode = (id: string, dragging: boolean): Node => ({
  ...store().nodes.find((n) => n.id === id)!,
  dragging,
});

/** the canvas spans 1000×700 from the window's corner */
const PANE = { left: 0, top: 0, width: 1000, height: 700 };
const CENTRE: [number, number] = [500, 350];
/** under the shape strip, 20px in from the left edge */
const LEFT_EDGE: [number, number] = [20, 350];
const pointer = ([clientX, clientY]: [number, number]) =>
  new MouseEvent("mousemove", { clientX, clientY });
/**
 * The browser's pointer events of the drag's own pointer. A mouse's are
 * always primary; jsdom's are not unless told (`isPrimary` defaults to false).
 */
const PRIMARY = { isPrimary: true };
const primaryAt = ([clientX, clientY]: [number, number]) => ({ ...PRIMARY, clientX, clientY });

let rf: ReturnType<typeof useStoreApi> | null = null;
const GrabRfStore = () => {
  rf = useRfStore();
  return null;
};

let wrapper: HTMLElement;
const paneRect = vi.fn(
  () => ({ ...PANE, x: PANE.left, y: PANE.top, right: PANE.width, bottom: PANE.height }) as DOMRect,
);
beforeEach(() => {
  rf = null;
  paneRect.mockClear();
  const { container } = render(
    <ReactFlowProvider>
      <GrabRfStore />
      <DiagramCanvas />
    </ReactFlowProvider>,
  );
  wrapper = container.firstElementChild as HTMLElement;
  // React Flow's own measure of the pane — `.react-flow`, what auto-pan reads
  const paneEl = document.createElement("div");
  paneEl.getBoundingClientRect = paneRect;
  rf!.setState({ domNode: paneEl });
});

const seed = (nodes: DiagramNode[]) => store().loadDoc(makeDoc(nodes, []), null);

/** what React Flow reads on its next move or auto-pan frame */
const rfSnaps = () => rf!.getState().snapToGrid;

/** what React Flow does over one drag of `ids` */
const startDrag = (ids: string[], at: [number, number] = CENTRE) =>
  act(() => {
    flow().onNodeDragStart(
      pointer(at),
      asFlowNode(ids[0]!, true),
      ids.map((id) => asFlowNode(id, true)),
    );
  });
/** React Flow's report of a step: the shapes moved, then `onNodeDrag` */
const report = (moves: Record<string, XY>, at: [number, number]) => {
  const ids = Object.keys(moves);
  flow().onNodesChange(
    ids.map((id) => ({ type: "position", id, position: moves[id]!, dragging: true })),
  );
  flow().onNodeDrag(
    pointer(at),
    asFlowNode(ids[0]!, true),
    ids.map((id) => asFlowNode(id, true)),
  );
};
/**
 * One pointer step of a drag. The browser's pointermove comes first, over
 * whatever is under the pointer — near the edge that is often a floating
 * panel, not the canvas. React Flow then reports the step only if a shape
 * changed place; a step that keeps every shape in its cell goes unreported.
 * Returns whether React Flow reported it.
 */
const dragTo = (moves: Record<string, XY>, at: [number, number]) => {
  const ids = Object.keys(moves);
  const moved = ids.some((id) => pos(id).x !== moves[id]!.x || pos(id).y !== moves[id]!.y);
  act(() => {
    fireEvent.pointerMove(document.body, primaryAt(at));
    if (moved) report(moves, at);
  });
  return moved;
};
/** a report with no pointer event before it — an auto-pan frame, which passes the last one */
const autoPanFrame = (moves: Record<string, XY>, last: [number, number]) =>
  act(() => report(moves, last));
const drop = (moves: Record<string, XY>, at: [number, number]) =>
  act(() => {
    const ids = Object.keys(moves);
    // the button comes up first; React Flow ends the drag on the mouseup after
    fireEvent.pointerUp(document.body, primaryAt(at));
    // the end of a drag arrives as a move to where the node is, `dragging: false`
    flow().onNodesChange(
      ids.map((id) => ({ type: "position", id, position: moves[id]!, dragging: false })),
    );
    flow().onNodeDragStop(
      pointer(at),
      asFlowNode(ids[0]!, false),
      ids.map((id) => asFlowNode(id, false)),
    );
  });

describe("no grid snapping while dragging at the edge (#228)", () => {
  it("snaps to the 8px grid otherwise", () => {
    expect(flow().snapToGrid).toBe(true);
    expect(flow().snapGrid).toEqual([8, 8]);
    expect(rfSnaps()).toBe(true);
  });

  it("turns snapping off when the pointer comes within 40px of the edge, and back on when it leaves", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    startDrag(["a"]);
    dragTo({ a: { x: 104, y: 96 } }, CENTRE);
    expect(rfSnaps()).toBe(true);

    dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    expect(rfSnaps()).toBe(false);

    dragTo({ a: { x: 104, y: 96 } }, CENTRE);
    expect(rfSnaps()).toBe(true);
  });

  it("turns it off outside the canvas too — the view slides there as well", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    startDrag(["a"]);
    dragTo({ a: { x: 13.5, y: 101.25 } }, [-30, 350]);
    expect(rfSnaps()).toBe(false);
    dragTo({ a: { x: 13.5, y: 801.25 } }, [500, 760]);
    expect(rfSnaps()).toBe(false);
  });

  it("turns it back on when the drag is cancelled", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    startDrag(["a"]);
    dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    expect(rfSnaps()).toBe(false);
    act(() => {
      fireEvent.pointerCancel(wrapper, PRIMARY);
    });
    expect(rfSnaps()).toBe(true);
  });
});

describe("snapping is written only to React Flow's store (#228)", () => {
  /*
   * A prop that followed the pause would reach React Flow's store only after
   * React renders it (StoreUpdater, a passive effect) — a render held up past
   * the next crossing writes the old value over the fresh one for a frame.
   * The prop stays on; the pause lives in the store alone.
   */
  it("keeps the prop passed to React Flow on during the drag — a render has no stale value to copy into the store", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    startDrag(["a"]);
    dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    expect(rfSnaps()).toBe(false);
    expect(flow().snapToGrid).toBe(true);
    // a later render of the canvas leaves the store as it is
    dragTo({ a: { x: 12.5, y: 101.25 } }, LEFT_EDGE);
    expect(rfSnaps()).toBe(false);
  });

  it("crossing in and out of the zone does not re-render the canvas", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    startDrag(["a"]);
    expect(dragTo({ a: { x: 16, y: 344 } }, [44, 350])).toBe(true);
    const before = flowRenders.count;
    // in and out by steps React Flow does not report: only snapping changes
    expect(dragTo({ a: { x: 16, y: 344 } }, [39, 350])).toBe(false);
    expect(rfSnaps()).toBe(false);
    expect(dragTo({ a: { x: 16, y: 344 } }, [44, 350])).toBe(false);
    expect(rfSnaps()).toBe(true);
    expect(flowRenders.count).toBe(before);
  });
});

describe("a step into the zone counts even when React Flow does not report it (#228)", () => {
  it("turns snapping off on a step in that keeps the shape in its cell", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    startDrag(["a"]);
    expect(dragTo({ a: { x: 16, y: 344 } }, [44, 350])).toBe(true);
    expect(rfSnaps()).toBe(true);
    // 4px over the zone's edge, the shape still in its cell: no onNodeDrag.
    // Snapping stayed on until an auto-pan frame bumped it a cell — one jump
    expect(dragTo({ a: { x: 16, y: 344 } }, [39, 350])).toBe(false);
    expect(rfSnaps()).toBe(false);

    // and back out the same way, unreported too
    expect(dragTo({ a: { x: 16, y: 344 } }, [44, 350])).toBe(false);
    expect(rfSnaps()).toBe(true);
  });

  it("what React Flow reads next changes on that same step — before React renders again", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    startDrag(["a"]);
    dragTo({ a: { x: 104, y: 96 } }, CENTRE);
    let next: boolean | undefined;
    act(() => {
      fireEvent.pointerMove(document.body, primaryAt(LEFT_EDGE));
      // React Flow's mousemove and its next auto-pan frame come before React
      // renders this step's state — they must already find snapping off
      next = rfSnaps();
    });
    expect(next).toBe(false);
  });

  it("a drag started inside the zone has snapping off from the start", () => {
    seed([makeNode({ id: "a", x: 0, y: 320 })]);
    startDrag(["a"], LEFT_EDGE);
    expect(rfSnaps()).toBe(false);
  });

  it("counts a React Flow report with no pointer event — a frame of the view sliding while the pointer is outside the window", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    startDrag(["a"]);
    autoPanFrame({ a: { x: 13.5, y: 101.25 } }, [-30, 350]);
    expect(rfSnaps()).toBe(false);
  });

  it("ignores pointer moves when no drag is on", () => {
    act(() => {
      fireEvent.pointerMove(document.body, primaryAt(LEFT_EDGE));
    });
    expect(rfSnaps()).toBe(true);
  });
});

describe("an aborted drag does not leave snapping off (#228)", () => {
  /*
   * React Flow aborts a drag whose shape is deleted mid-drag (Delete, ⌘X, a
   * bridge op) and never calls onNodeDragStop. Its store's snapToGrid also
   * drives screenToFlowPosition (line ends, drops, pastes), resizing and the
   * arrow-key nudge, so it must not stay off past the press.
   */
  it("turns it back on when the button comes up in the zone, even without onNodeDragStop", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    startDrag(["a"]);
    dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    // the shape is deleted mid-drag: React Flow aborts, no stop will come
    act(() => store().deleteElements(["a"], []));
    expect(rfSnaps()).toBe(false);
    // released over the shape strip — not on the canvas
    act(() => {
      fireEvent.pointerUp(document.body, primaryAt(LEFT_EDGE));
    });
    expect(rfSnaps()).toBe(true);
  });

  it("a release with no move after the delete brings a stop without the shape — it ends without error", () => {
    // another shape stays — with an empty page the lookup never touches the node
    seed([makeNode({ id: "a", x: 96, y: 96 }), makeNode({ id: "b", x: 400, y: 96 })]);
    startDrag(["a"]);
    dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    act(() => store().deleteElements(["a"], []));
    // no move after the delete, so React Flow never aborts: its stop comes,
    // and with the shape gone it has no node to pass (getEventHandlerParams)
    expect(() =>
      act(() => {
        fireEvent.pointerUp(document.body, primaryAt(LEFT_EDGE));
        flow().onNodeDragStop(pointer(LEFT_EDGE), undefined as unknown as Node, []);
      }),
    ).not.toThrow();
    expect(store().dragRiders).toBeNull();
    expect(store().nodes.map((n) => n.id)).toEqual(["b"]);
    expect(pos("b")).toEqual({ x: 400, y: 96 });
    expect(rfSnaps()).toBe(true);
  });

  it("ignores pointer moves after the release", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    startDrag(["a"]);
    dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    act(() => {
      fireEvent.pointerUp(document.body, primaryAt(LEFT_EDGE));
    });
    act(() => {
      fireEvent.pointerMove(document.body, primaryAt([10, 10]));
    });
    expect(rfSnaps()).toBe(true);
  });
});

describe("however a drag ends, it leaves no drag state behind (#228)", () => {
  /*
   * A drag fixes what rides on it (`dragRiders`) and an anchor drag shows the
   * snap dot of a box nearby (`snapTarget`). Both are cleared where a drag
   * ends — which, for a drag aborted by deleting its shape, is the release:
   * no stop comes. The release cannot clear them at once, since a stop that
   * does come follows it (the same press's mouseup) and still needs the
   * riders; so the abort is seen only once the stop has had its turn.
   */
  const release = (at: [number, number]) =>
    act(() => {
      fireEvent.pointerUp(document.body, primaryAt(at));
    });
  /** the turn after the release — a stop that was coming has come by now */
  const afterRelease = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  /** React Flow's arrow-key nudge: a move with `dragging: false` */
  const nudge = (id: string, dx: number) =>
    act(() =>
      flow().onNodesChange([
        { type: "position", id, position: { x: pos(id).x + dx, y: pos(id).y }, dragging: false },
      ]),
    );
  const frameWithContents = [
    makeNode({ id: "f", shape: "frame", x: 0, y: 0, width: 400, height: 300 }),
    makeNode({ id: "in", x: 40, y: 40 }),
  ];
  /** a line from `far` whose loose end `an` is dragged next to `box`'s right side */
  const seedLooseEnd = () => {
    store().loadDoc(
      makeDoc(
        [
          makeNode({ id: "box", x: 0, y: 0, width: 160, height: 56 }),
          makeNode({ id: "far", x: 600, y: 0, width: 160, height: 56 }),
          makeNode({ id: "an", shape: "anchor", x: 300, y: 20, width: 1, height: 1 }),
        ],
        [makeEdge({ id: "e", source: "far", target: "an" })],
      ),
      null,
    );
    startDrag(["an"], [300, 120]);
    act(() => report({ an: { x: 161, y: 28 } }, [161, 128]));
    expect(useCanvasUiStore.getState().snapTarget).toMatchObject({ nodeId: "box" });
  };

  it("after the release of a deleted shape's drag, a frame nudged by arrow key still takes its contents along", async () => {
    seed([makeNode({ id: "a", x: 600, y: 96 }), ...frameWithContents]);
    startDrag(["a"]);
    dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    act(() => store().deleteElements(["a"], []));
    // React Flow aborts: no stop comes
    release(LEFT_EDGE);
    await afterRelease();
    expect(store().dragRiders).toBeNull();

    nudge("f", 8);
    expect(pos("f")).toEqual({ x: 8, y: 0 });
    expect(pos("in")).toEqual({ x: 48, y: 40 });
  });

  it("no snap dot is left when a line end dragged beside a box is deleted and then released", async () => {
    seedLooseEnd();
    act(() => store().deleteElements(["an"], []));
    release([161, 128]);
    await afterRelease();
    expect(useCanvasUiStore.getState().snapTarget).toBeNull();
    expect(store().dragRiders).toBeNull();
  });

  it("clears the snap dot and drag state when a release with no move after the delete brings a stop without the shape", () => {
    seedLooseEnd();
    act(() => store().deleteElements(["an"], []));
    act(() => {
      fireEvent.pointerUp(document.body, primaryAt([161, 128]));
      flow().onNodeDragStop(pointer([161, 128]), undefined as unknown as Node, []);
    });
    // at the stop, not a turn later
    expect(useCanvasUiStore.getState().snapTarget).toBeNull();
    expect(store().dragRiders).toBeNull();
  });

  it("a cancelled drag leaves no drag state either", async () => {
    seed(frameWithContents);
    startDrag(["f"]);
    act(() => {
      fireEvent.pointerCancel(wrapper, PRIMARY);
    });
    await afterRelease();
    expect(store().dragRiders).toBeNull();
  });

  it("the previous drag's cleanup does not end a drag started right after the release", async () => {
    seed([makeNode({ id: "a", x: 600, y: 96 }), ...frameWithContents]);
    startDrag(["a"]);
    dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    act(() => store().deleteElements(["a"], []));
    release(LEFT_EDGE);
    // the next press turns into a drag before the aborted one's turn comes
    startDrag(["f"]);
    await afterRelease();
    expect(store().dragRiders).toEqual({ f: ["in"] });
    dragTo({ f: { x: 16, y: 8 } }, CENTRE);
    expect(pos("in")).toEqual({ x: 56, y: 48 });
  });

  it("a normal drag ends only after its riders are snapped along on the drop", async () => {
    seed(frameWithContents);
    startDrag(["f"]);
    dragTo({ f: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    drop({ f: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    expect(store().dragRiders).toBeNull();
    await afterRelease();
    expect(pos("in")).toEqual({ x: 56, y: 144 });
  });

  describe("a pointer other than the dragging one does not end the drag (#228)", () => {
    /*
     * On a touchscreen another finger can touch and lift while one drags a
     * shape. React Flow drags on — it aborts only when the dragging finger
     * moves while another is down — so the canvas must too. The drag's
     * pointer is the primary one: a mouse's, a pen's, the first finger's.
     */
    const otherFingerAt = ([clientX, clientY]: [number, number]) => ({
      isPrimary: false,
      clientX,
      clientY,
    });

    it("the frame's contents keep following to the end when another finger lifts", async () => {
      seed(frameWithContents);
      startDrag(["f"]);
      dragTo({ f: { x: 108, y: 100 } }, CENTRE);
      expect(pos("in")).toEqual({ x: 148, y: 140 });
      act(() => {
        fireEvent.pointerUp(document.body, otherFingerAt([700, 500]));
      });
      await afterRelease();
      expect(store().dragRiders).toEqual({ f: ["in"] });
      dragTo({ f: { x: 208, y: 100 } }, CENTRE);
      expect(pos("in")).toEqual({ x: 248, y: 140 });
    });

    it("another finger lifting during a drag at the edge leaves snapping off and auto-pan on", () => {
      seed([makeNode({ id: "a", x: 96, y: 96 })]);
      startDrag(["a"]);
      dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
      act(() => {
        fireEvent.pointerUp(document.body, otherFingerAt(CENTRE));
        fireEvent.pointerCancel(document.body, otherFingerAt(CENTRE));
      });
      expect(rfSnaps()).toBe(false);
      expect(rf!.getState().autoPanOnNodeDrag).toBe(true);
    });

    it("another finger's moves do not decide the zone", () => {
      seed([makeNode({ id: "a", x: 96, y: 96 })]);
      startDrag(["a"]);
      dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
      act(() => {
        fireEvent.pointerMove(document.body, otherFingerAt(CENTRE));
      });
      expect(rfSnaps()).toBe(false);
    });
  });
});

describe("stops the auto-pan an aborted drag leaves running (#228)", () => {
  /*
   * React Flow's abort path returns before `cancelAnimationFrame`, so the
   * auto-pan loop of a drag aborted in the zone slides the view on and on
   * after the release (measured in a browser: about 430px a second, without
   * end). The loop reads `autoPanOnNodeDrag` from the store every frame and
   * stops itself when it finds it off.
   */
  const autoPans = () => rf!.getState().autoPanOnNodeDrag;
  const release = (at: [number, number]) =>
    act(() => {
      fireEvent.pointerUp(document.body, primaryAt(at));
    });

  it("turns off React Flow's drag auto-pan when the drag's button comes up", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    startDrag(["a"]);
    dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    act(() => store().deleteElements(["a"], []));
    expect(autoPans()).toBe(true);
    release(LEFT_EDGE);
    expect(autoPans()).toBe(false);
  });

  it("turns it back on when the next drag starts", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 }), makeNode({ id: "b", x: 400, y: 96 })]);
    startDrag(["a"]);
    dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    release(LEFT_EDGE);
    startDrag(["b"]);
    expect(autoPans()).toBe(true);
  });

  it("leaves a press that was not a drag alone", () => {
    release(LEFT_EDGE);
    expect(autoPans()).toBe(true);
  });
});

describe("canvas size for the zone check (#228)", () => {
  it("is measured once, when the drag starts — React Flow slides the view by the size measured then too", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    startDrag(["a"]);
    const atStart = paneRect.mock.calls.length;
    dragTo({ a: { x: 104, y: 96 } }, CENTRE);
    dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    dragTo({ a: { x: 12.5, y: 101.25 } }, LEFT_EDGE);
    dragTo({ a: { x: 104, y: 96 } }, CENTRE);
    // layout read once per drag, not once per frame
    expect(atStart).toBe(1);
    expect(paneRect).toHaveBeenCalledTimes(1);
  });
});

describe("a shape dropped at the edge lands on the grid (#228)", () => {
  it("snaps the drop to the 8px grid, in the same undo step as the drag", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    const pastBefore = store().past.length;
    startDrag(["a"]);
    dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    drop({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);

    expect(pos("a")).toEqual({ x: 16, y: 104 });
    expect(store().nodes.find((n) => n.id === "a")!.dragging).toBeFalsy();
    expect(rfSnaps()).toBe(true);
    // the drag's own frame, nothing more — one ⌘Z takes the whole move back
    expect(store().past.length).toBe(pastBefore + 1);
    act(() => store().undo());
    expect(pos("a")).toEqual({ x: 96, y: 96 });
  });

  it("the same for several shapes dragged together — their spacing is kept", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 }), makeNode({ id: "b", x: 296, y: 200 })]);
    startDrag(["a", "b"]);
    const moves = { a: { x: 13.5, y: 101.25 }, b: { x: 213.5, y: 205.25 } };
    dragTo(moves, LEFT_EDGE);
    expect(rfSnaps()).toBe(false);
    drop(moves, LEFT_EDGE);

    expect(pos("a")).toEqual({ x: 16, y: 104 });
    expect(pos("b")).toEqual({ x: 216, y: 208 });
  });

  it("lands on the grid when dropped further in after passing through the zone", () => {
    // the step just out of the zone is computed before snapping comes back on
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    startDrag(["a"]);
    dragTo({ a: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    dragTo({ a: { x: 61.5, y: 101.25 } }, [68, 350]);
    drop({ a: { x: 61.5, y: 101.25 } }, [68, 350]);
    expect(pos("a")).toEqual({ x: 64, y: 104 });
  });

  it("shapes inside a frame are snapped along by the same amount", () => {
    seed([
      makeNode({ id: "f", shape: "frame", x: 0, y: 0, width: 400, height: 300 }),
      makeNode({ id: "in", x: 40, y: 40 }),
    ]);
    startDrag(["f"]);
    dragTo({ f: { x: 13.5, y: 101.25 } }, LEFT_EDGE);
    expect(pos("in")).toEqual({ x: 53.5, y: 141.25 });
    drop({ f: { x: 13.5, y: 101.25 } }, LEFT_EDGE);

    expect(pos("f")).toEqual({ x: 16, y: 104 });
    expect(pos("in")).toEqual({ x: 56, y: 144 });
    expect(store().nodes.some((n) => n.dragging)).toBe(false);
  });

  it("leaves the drop alone when the drag never reached the edge", () => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    startDrag(["a"]);
    // whatever React Flow placed stays put — the usual drag is its own
    dragTo({ a: { x: 101, y: 97 } }, CENTRE);
    drop({ a: { x: 101, y: 97 } }, CENTRE);
    expect(pos("a")).toEqual({ x: 101, y: 97 });
  });
});

describe("the pointer's place is read by one rule for mouse and touch (#228)", () => {
  const at = (clientX: number, clientY: number) => ({ clientX, clientY });
  /** only what the canvas reads off a touch event */
  const touchEvent = (touches: XY[], changedTouches: XY[]) =>
    ({
      touches: touches.map(({ x, y }) => at(x, y)),
      changedTouches: changedTouches.map(({ x, y }) => at(x, y)),
    }) as unknown as TouchEvent;
  /** a new line let go on empty canvas — the menu of what to put there opens */
  const dropLine = (event: MouseEvent | TouchEvent) => {
    act(() =>
      flow().onConnectEnd(event, {
        isValid: false,
        fromNode: { id: "a" },
        fromHandle: { id: "right" },
        toNode: null,
        toHandle: null,
      } as unknown as FinalConnectionState),
    );
    const menu = useCanvasUiStore.getState().dropMenu;
    return menu && [menu.clientX, menu.clientY];
  };

  beforeEach(() => {
    seed([makeNode({ id: "a", x: 96, y: 96 })]);
    useCanvasUiStore.getState().setDropMenu(null);
  });

  it("a line let go with the mouse opens the menu at the mouse", () => {
    expect(dropLine(pointer([300, 200]))).toEqual([300, 200]);
  });

  it("a line let go with a finger opens it where that finger lifted — even with another finger still down", () => {
    expect(dropLine(touchEvent([{ x: 900, y: 600 }], [{ x: 300, y: 200 }]))).toEqual([300, 200]);
  });

  it("sees the zone during a finger drag too", () => {
    startDrag(["a"]);
    act(() => {
      flow().onNodesChange([
        { type: "position", id: "a", position: { x: 13.5, y: 101.25 }, dragging: true },
      ]);
      flow().onNodeDrag(
        touchEvent([{ x: 20, y: 350 }], [{ x: 20, y: 350 }]) as unknown as MouseEvent,
        asFlowNode("a", true),
        [asFlowNode("a", true)],
      );
    });
    expect(rfSnaps()).toBe(false);
  });
});
