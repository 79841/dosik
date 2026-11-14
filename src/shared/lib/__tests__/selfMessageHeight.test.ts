import { beforeEach, describe, expect, it } from "vitest";

import { handlePointOnNode, lifelineAttachRange, SELF_MESSAGE_MIN_GAP } from "../edgeUtils";
import { useDiagramStore } from "../store";
import { makeDoc, makeEdge, makeNode } from "./testFixtures";

/**
 * #99 — there was no way to change a loop's height. Body drag already means "move the whole loop"
 * (it moves while keeping the height), so height needed a target of its own. The grips on the
 * top and bottom horizontal legs each move only their own end.
 */
const LIFE = { x: 0, y: 0, width: 120, height: 400 };

const seed = (extra: Record<string, unknown> = {}) => {
  const node = makeNode({ id: "L", shape: "lifeline", ...LIFE });
  node.data = { ...node.data, ...extra };
  useDiagramStore.getState().loadDoc(
    makeDoc(
      [node],
      [
        {
          ...makeEdge({ id: "m", source: "L", target: "L" }),
          sourceHandle: "right-30",
          targetHandle: "right-45",
        },
      ],
    ),
    null,
  );
};

const ends = () => {
  const st = useDiagramStore.getState();
  const node = st.nodes[0]!;
  const e = st.edges[0]!;
  return {
    top: handlePointOnNode(node, e.sourceHandle).y,
    bottom: handlePointOnNode(node, e.targetHandle).y,
  };
};
const move = (end: "source" | "target", y: number) =>
  useDiagramStore.getState().setSelfMessageEndYLive("m", end, y);

describe("self-message loop height (#99)", () => {
  beforeEach(() => seed());

  it("raising the top end moves only that end and leaves the bottom end alone", () => {
    const before = ends();
    move("source", before.top - 60);
    const after = ends();
    expect(after.top).toBeCloseTo(before.top - 60, 0);
    expect(after.bottom).toBeCloseTo(before.bottom, 0);
    expect(after.bottom - after.top).toBeGreaterThan(before.bottom - before.top);
  });

  it("lowering the bottom end moves only that end", () => {
    const before = ends();
    move("target", before.bottom + 50);
    const after = ends();
    expect(after.top).toBeCloseTo(before.top, 0);
    expect(after.bottom).toBeCloseTo(before.bottom + 50, 0);
  });

  it("does not shrink below the minimum height even when dragged past each other", () => {
    const before = ends();
    move("source", before.bottom + 200);
    expect(ends().bottom - ends().top).toBeGreaterThanOrEqual(SELF_MESSAGE_MIN_GAP - 0.5);
    seed();
    const b2 = ends();
    move("target", b2.top - 200);
    expect(ends().bottom - ends().top).toBeGreaterThanOrEqual(SELF_MESSAGE_MIN_GAP - 0.5);
  });

  it("does not leave the lifeline", () => {
    const range = lifelineAttachRange(useDiagramStore.getState().nodes[0]!);
    move("target", 100000);
    expect(ends().bottom).toBeLessThanOrEqual(range.max + 0.5);
    move("source", -100000);
    expect(ends().top).toBeGreaterThanOrEqual(range.min - 0.5);
  });

  it("does not attach below the destroy marker", () => {
    seed({ destroyY: 200 });
    move("target", 100000);
    const node = useDiagramStore.getState().nodes[0]!;
    expect(ends().bottom).toBeLessThanOrEqual(lifelineAttachRange(node).max + 0.5);
  });

  it("a height change is undone with a single undo", () => {
    const before = ends();
    useDiagramStore.getState().commit(); // what starting a grip drag does
    move("target", before.bottom + 80);
    expect(ends().bottom).not.toBeCloseTo(before.bottom, 0);
    useDiagramStore.getState().undo();
    expect(ends().bottom).toBeCloseTo(before.bottom, 0);
  });

  it("does nothing to an edge that is not a self-message", () => {
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
          [makeEdge({ id: "m", source: "a", target: "b" })],
        ),
        null,
      );
    const before = JSON.stringify(useDiagramStore.getState().edges);
    move("source", 500);
    expect(JSON.stringify(useDiagramStore.getState().edges)).toBe(before);
  });
});
