import reactFlowPackage from "@xyflow/react/package.json";
import {
  calcAutoPan,
  infiniteExtent,
  type InternalNodeBase,
  type NodeBase,
  type NodeDragItem,
  XYDrag,
  type XYDragParams,
} from "@xyflow/system";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dosikPackage from "../../../../package.json";
import { inAutoPanZone, snapDrop } from "../dragSnap";

/**
 * Pins down, on the real `XYDrag`, the React Flow drag behaviour the #228 fix
 * relies on.
 *
 * `dragAutoPanSnap.test.tsx` swaps `ReactFlow` for a mock to check what the
 * canvas does. If an upgrade changed the React Flow habits that mock mimics,
 * that test would still pass and only the app would shake again. So this
 * runs `XYDrag` (@xyflow/system), which React Flow drags with, on a fake
 * store with synthetic mouse events. If this test breaks, the fix's premise
 * has changed — look again at the drag handling in `DiagramCanvas` and at
 * `dragSnap`.
 *
 * @xyflow/react does not re-export @xyflow/system, so the same version is
 * pinned as a devDependency. The first test checks that the two match.
 */

type StoreItems = ReturnType<XYDragParams["getStoreItems"]>;
type XY = { x: number; y: number };
type Call = { event: MouseEvent | TouchEvent; node: NodeBase | undefined; nodes: NodeBase[] };

/** the canvas spans 1000×700 from the window's corner */
const PANE = { left: 0, top: 0, width: 1000, height: 700 };

/**
 * React Flow's drag of `specs` on a store of its own: each node gets an
 * `XYDrag` the way React Flow's `useDrag` sets one up, and the store records
 * what React Flow calls back.
 */
const makeFlow = (
  specs: { id: string; x: number; y: number; selected?: boolean }[],
  { snap = true, zoom = 1, tx = 0, ty = 0 } = {},
) => {
  const pane = document.createElement("div");
  pane.getBoundingClientRect = () =>
    ({ ...PANE, x: PANE.left, y: PANE.top, right: PANE.width, bottom: PANE.height }) as DOMRect;
  document.body.appendChild(pane);

  const calls = { start: [] as Call[], drag: [] as Call[], stop: [] as Call[], pans: 0 };
  const record =
    (into: Call[]) => (event: MouseEvent | TouchEvent, node: NodeBase, nodes: NodeBase[]) => {
      into.push({ event, node, nodes });
    };
  const nodeLookup = new Map<string, InternalNodeBase>();
  for (const s of specs) {
    const userNode: NodeBase = {
      id: s.id,
      position: { x: s.x, y: s.y },
      data: {},
      selected: !!s.selected,
    };
    nodeLookup.set(s.id, {
      ...userNode,
      measured: { width: 100, height: 60 },
      internals: { positionAbsolute: { x: s.x, y: s.y }, userNode, z: 0 },
    });
  }
  const state: StoreItems = {
    nodes: [],
    edges: [],
    nodeLookup,
    // React Flow's defaults — Dosik sets none of these
    nodeExtent: infiniteExtent,
    nodeOrigin: [0, 0],
    nodeDragThreshold: 1,
    autoPanSpeed: 15,
    autoPanOnNodeDrag: true,
    snapGrid: [8, 8],
    snapToGrid: snap,
    transform: [tx, ty, zoom],
    domNode: pane,
    multiSelectionActive: false,
    nodesDraggable: true,
    selectNodesOnDrag: false,
    unselectNodesAndEdges: () => {},
    onNodeDragStart: record(calls.start),
    onNodeDrag: record(calls.drag),
    onNodeDragStop: record(calls.stop),
    updateNodePositions: (items: Map<string, NodeDragItem | InternalNodeBase>) => {
      for (const [id, item] of items) {
        const node = nodeLookup.get(id);
        if (!node) continue;
        node.position = { ...item.position };
        node.internals.positionAbsolute = { ...item.internals.positionAbsolute };
        node.internals.userNode = { ...node.internals.userNode, position: { ...item.position } };
      }
    },
    panBy: async ({ x, y }: XY) => {
      const [px, py, z] = state.transform;
      state.transform = [px + x, py + y, z];
      calls.pans++;
      return true;
    },
  };

  const elements = new Map<string, HTMLElement>();
  for (const s of specs) {
    const el = document.createElement("div");
    el.className = "react-flow__node";
    pane.appendChild(el);
    elements.set(s.id, el);
    XYDrag({ getStoreItems: () => state }).update({
      domNode: el,
      nodeId: s.id,
      isSelectable: true,
    });
  }

  const mouse = (type: string, target: EventTarget, [clientX, clientY]: [number, number]) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
    // d3-drag hangs its move and up listeners on the event's view
    Object.defineProperty(event, "view", { value: window });
    target.dispatchEvent(event);
  };
  return {
    state,
    calls,
    pos: (id: string) => nodeLookup.get(id)?.position,
    press: (id: string, at: [number, number]) => mouse("mousedown", elements.get(id)!, at),
    move: (at: [number, number]) => mouse("mousemove", window, at),
    release: (at: [number, number]) => mouse("mouseup", window, at),
    /** a delete mid-drag (Delete, ⌘X, a bridge op) — React Flow's lookup loses the node */
    remove: (id: string) => nodeLookup.delete(id),
  };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.useRealTimers();
});

const frames = (n: number) => vi.advanceTimersByTimeAsync(16 * n);

describe("React Flow drag contract — the behaviour the #228 fix relies on", () => {
  it("the @xyflow/system this test runs is the version @xyflow/react uses", () => {
    // when upgrading React Flow, bump the @xyflow/system devDependency to the same version
    expect(dosikPackage.devDependencies["@xyflow/system"]).toBe(
      reactFlowPackage.dependencies["@xyflow/system"],
    );
  });

  it("the zone check matches where calcAutoPan slides the view — not at the 40px boundary", () => {
    const panes = [
      PANE,
      { left: 37.5, top: 12.25, width: 640, height: 480 },
      // so small the zones of opposite edges overlap
      { left: 0, top: 0, width: 70, height: 70 },
    ];
    let checked = 0;
    for (const p of panes) {
      const ys = [
        p.top - 10,
        p.top + 20,
        p.top + 39.75,
        p.top + 40,
        p.top + p.height / 2,
        p.top + p.height - 40,
        p.top + p.height - 39.75,
        p.top + p.height + 5,
      ];
      for (let x = p.left - 60; x <= p.left + p.width + 60; x += 0.25) {
        for (const y of ys) {
          const [sx, sy] = calcAutoPan({ x: x - p.left, y: y - p.top }, p);
          if (inAutoPanZone({ x, y }, p) !== (sx !== 0 || sy !== 0)) {
            throw new Error(`zone rule differs at (${x}, ${y}) on ${JSON.stringify(p)}`);
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  describe("snapping on the drop turns React Flow's grid-off result into its grid-on result", () => {
    /** the nodes React Flow's stop passes after one drag along `path` */
    const dropAfter = (snap: boolean, several: boolean, zoom: number, path: [number, number][]) => {
      const flow = makeFlow(
        several
          ? [
              { id: "a", x: 96, y: 96, selected: true },
              // off the grid from the start
              { id: "b", x: 299.3, y: 203.7, selected: true },
              { id: "c", x: 50.5, y: 400.25, selected: true },
            ]
          : [{ id: "a", x: 96, y: 96 }],
        { snap, zoom, tx: 13.3, ty: -7.7 },
      );
      // the pointer stays clear of the edges: this is about rounding alone
      flow.state.autoPanOnNodeDrag = false;
      flow.press("a", [140, 120]);
      for (const at of path) flow.move(at);
      flow.release(path[path.length - 1]!);
      expect(flow.calls.stop).toHaveLength(1);
      return flow.calls.stop[0]!.nodes.map(({ id, position }) => ({ id, position }));
    };
    // −0 and +0 differ only in sign; both are written as 0
    const plain = (nodes: { id: string; position: XY }[]) =>
      nodes.map(({ id, position }) => ({ id, position: { x: position.x + 0, y: position.y + 0 } }));

    for (const several of [false, true]) {
      for (const zoom of [1, 1.37, 0.6]) {
        it(`${several ? "several shapes" : "one shape"}, zoom ${zoom}`, () => {
          let seed = 7;
          const random = () => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
          };
          for (let trial = 0; trial < 100; trial++) {
            const path: [number, number][] = [];
            for (let k = 0; k < 4; k++) path.push([100 + random() * 700, 100 + random() * 450]);
            const snapped = dropAfter(true, several, zoom, path);
            const free = dropAfter(false, several, zoom, path);
            const moves = new Map(snapDrop(free, [8, 8]).map((m) => [m.id, m.position]));
            const dropped = free.map(({ id, position }) => ({
              id,
              position: moves.get(id) ?? position,
            }));
            expect(plain(dropped)).toEqual(plain(snapped));
          }
        });
      }
    }
  });

  it("a step that keeps the shape in its cell gets no onNodeDrag, and the very next step reads snapping turned off in the store", () => {
    const flow = makeFlow([{ id: "a", x: 0, y: 320 }]);
    flow.state.autoPanOnNodeDrag = false;
    flow.press("a", [50, 350]);
    flow.move([48, 350]); // past the threshold: the drag starts
    flow.move([41, 350]); // −7 → the −8 cell, reported
    expect(flow.pos("a")!.x).toBe(-8);
    const reported = flow.calls.drag.length;

    flow.move([39, 350]); // into the zone: −9 → still −8
    flow.move([39.5, 350]); // −8.5 → −8
    expect(flow.calls.drag).toHaveLength(reported);
    expect(flow.pos("a")!.x).toBe(-8);

    // what the canvas does on the window's pointermove, before this mousemove
    flow.state.snapToGrid = false;
    flow.move([39, 350]);
    expect(flow.pos("a")!.x).toBe(-9);
    expect(flow.calls.drag).toHaveLength(reported + 1);
    flow.release([39, 350]);
  });

  it("an aborted drag keeps sliding the view with no stop, and halts from the next frame once autoPanOnNodeDrag is off", async () => {
    const flow = makeFlow([
      { id: "a", x: 96, y: 96 },
      { id: "b", x: 400, y: 96 },
    ]);
    flow.press("a", [140, 120]);
    flow.move([130, 120]);
    flow.move([20, 350]); // into the left zone
    await frames(3);
    expect(flow.calls.pans).toBeGreaterThan(0);

    flow.remove("a");
    flow.move([22, 350]); // the next drag event finds the node gone: aborted
    flow.release([22, 350]);
    // the only end an aborted drag has is the release
    expect(flow.calls.stop).toHaveLength(0);
    const released = flow.calls.pans;
    await frames(10);
    // React Flow's abort leaves its loop running
    expect(flow.calls.pans - released).toBeGreaterThanOrEqual(9);

    // what the canvas does on the release
    flow.state.autoPanOnNodeDrag = false;
    const off = flow.calls.pans;
    await frames(10);
    expect(flow.calls.pans).toBe(off);
  });

  it("a release with no move after the delete is not aborted, and the stop comes without the shape", () => {
    const flow = makeFlow([
      { id: "a", x: 96, y: 96 },
      { id: "b", x: 400, y: 96 },
    ]);
    flow.state.autoPanOnNodeDrag = false;
    flow.press("a", [140, 120]);
    flow.move([150, 120]);
    flow.remove("a");
    flow.release([150, 120]);
    expect(flow.calls.stop).toHaveLength(1);
    expect(flow.calls.stop[0]!.node).toBeUndefined();
    expect(flow.calls.stop[0]!.nodes).toEqual([]);
  });
});
