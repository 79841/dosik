import { describe, expect, it } from "vitest";

import { bothEnds, placeEnds } from "../placeEnds";
import { makeEdge, makeNode } from "./testFixtures";

// store on the right; two sources on its left, one above the other
const store = makeNode({ id: "store", x: 400, y: 100, width: 160, height: 80 });
const upper = makeNode({ id: "upper", x: 0, y: 0, width: 160, height: 56 });
const lower = makeNode({ id: "lower", x: 0, y: 240, width: 160, height: 56 });
const nodes = [store, upper, lower];

const edgeTo = (id: string, from: string, targetHandle = "left") =>
  makeEdge({ id, source: from, target: "store", sourceHandle: "right", targetHandle });

describe("placeEnds", () => {
  it("leaves a lone end in the middle, as the bare side", () => {
    const edges = [edgeTo("a", "upper")];
    const out = placeEnds(nodes, edges, bothEnds(["a"]));
    expect(out[0]!.targetHandle).toBe("left");
    expect(out[0]!.sourceHandle).toBe("right");
  });

  it("spreads new ends 16px apart around the middle, in the order of where they come from", () => {
    // listed lower first: the order follows the other shape, not the array
    const edges = [edgeTo("b", "lower"), edgeTo("a", "upper")];
    const out = placeEnds(nodes, edges, bothEnds(["a", "b"]));
    const byId = Object.fromEntries(out.map((e) => [e.id, e.targetHandle]));
    expect(byId.a).toBe("left-40"); // 32px of 80
    expect(byId.b).toBe("left-60"); // 48px of 80
  });

  it("centres three ends on -16, 0, +16", () => {
    const middle = makeNode({ id: "middle", x: 0, y: 120, width: 160, height: 56 });
    const edges = [edgeTo("a", "upper"), edgeTo("m", "middle"), edgeTo("b", "lower")];
    const out = placeEnds([...nodes, middle], edges, bothEnds(["a", "m", "b"]));
    expect(out.map((e) => e.targetHandle)).toEqual(["left-30", "left", "left-70"]);
  });

  it("spreads evenly over the usable stretch when 16px apart does not fit", () => {
    const small = makeNode({ id: "store", x: 400, y: 100, width: 160, height: 40 });
    const middle = makeNode({ id: "middle", x: 0, y: 120, width: 160, height: 56 });
    const edges = [edgeTo("a", "upper"), edgeTo("m", "middle"), edgeTo("b", "lower")];
    const out = placeEnds([small, upper, lower, middle], edges, bothEnds(["a", "m", "b"]));
    // usable 8..32 of 40
    expect(out.map((e) => e.targetHandle)).toEqual(["left-20", "left", "left-80"]);
  });

  it("never moves an end it was not asked to place", () => {
    const edges = [edgeTo("a", "lower"), edgeTo("b", "upper")];
    const out = placeEnds(nodes, edges, bothEnds(["b"]));
    expect(out[0]!.targetHandle).toBe("left");
    // upper is above lower, so the new end goes above the one in the middle
    expect(out[1]!.targetHandle).toBe("left-30");
  });

  it("keeps a spacing from an existing end that is off the grid", () => {
    const edges = [edgeTo("a", "lower", "left-55"), edgeTo("b", "upper")];
    const out = placeEnds(nodes, edges, bothEnds(["b"]));
    // 44px is taken; the nearest free spot above it is 28px
    expect(out[1]!.targetHandle).toBe("left-35");
  });

  it("places new ends that share a gap together, a spacing apart from each other and the old end", () => {
    // the end in the middle comes from below; two new ones from above go above it
    const top1 = makeNode({ id: "top1", x: 0, y: -200, width: 160, height: 56 });
    const top2 = makeNode({ id: "top2", x: 0, y: -100, width: 160, height: 56 });
    const edges = [edgeTo("old", "lower"), edgeTo("a", "top1"), edgeTo("b", "top2")];
    const out = placeEnds([...nodes, top1, top2], edges, bothEnds(["a", "b"]));
    expect(out.map((e) => e.targetHandle)).toEqual(["left", "left-10", "left-30"]);
  });

  it("never stacks an end on another when the ordered gap is full", () => {
    // eight sources, each lower than the last, added one at a time
    const sources = Array.from({ length: 8 }, (_, i) =>
      makeNode({ id: `s${i}`, x: 0, y: 200 + i * 80, width: 160, height: 56 }),
    );
    let edges: ReturnType<typeof edgeTo>[] = [];
    for (let i = 0; i < 8; i += 1) {
      edges = placeEnds(
        [store, ...sources],
        [...edges, edgeTo(`e${i}`, `s${i}`)],
        bothEnds([`e${i}`]),
      );
    }
    const spots = edges.map((e) => e.targetHandle);
    expect(new Set(spots).size).toBe(8);
    const ys = spots.map((h) => Number((h ?? "").split("-")[1] ?? 50)).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i += 1) expect(ys[i]! - ys[i - 1]!).toBeGreaterThan(1);
  });

  it("never stacks ends placed together into a gap with no room between them", () => {
    // the old end at 32px leaves exactly the 48px spot below it; two new ends want it
    const lo1 = makeNode({ id: "lo1", x: 0, y: 300, width: 160, height: 56 });
    const lo2 = makeNode({ id: "lo2", x: 0, y: 400, width: 160, height: 56 });
    const small = makeNode({ id: "store", x: 400, y: 100, width: 160, height: 56 });
    const edges = [edgeTo("old", "upper", "left-57.14"), edgeTo("n1", "lo1"), edgeTo("n2", "lo2")];
    const out = placeEnds([small, upper, lo1, lo2], edges, bothEnds(["n1", "n2"]));
    const spots = out.map((e) => e.targetHandle);
    expect(new Set(spots).size).toBe(3);
    expect(spots[0]).toBe("left-57.14");
    const px = spots
      .map((h) => (Number((h ?? "").split("-")[1] ?? 50) / 100) * 56)
      .sort((a, b) => a - b);
    for (let i = 1; i < px.length; i += 1)
      expect(px[i]! - px[i - 1]!).toBeGreaterThanOrEqual(8 - 1e-6);
  });

  it("orders ends on a top or bottom side by x", () => {
    const hub = makeNode({ id: "hub", x: 200, y: 400, width: 160, height: 56 });
    const left = makeNode({ id: "l", x: 0, y: 0, width: 100, height: 56 });
    const right = makeNode({ id: "r", x: 400, y: 0, width: 100, height: 56 });
    const up = (id: string, from: string) =>
      makeEdge({ id, source: from, target: "hub", sourceHandle: "bottom", targetHandle: "top" });
    const out = placeEnds(
      [hub, left, right],
      [up("fromRight", "r"), up("fromLeft", "l")],
      bothEnds(["fromRight", "fromLeft"]),
    );
    expect(out.map((e) => e.targetHandle)).toEqual(["top-55", "top-45"]);
  });

  it("leaves self-loops, anchors and lifelines alone", () => {
    const anchor = makeNode({ id: "pt", shape: "anchor", x: 0, y: 0, width: 12, height: 12 });
    const loop = makeEdge({
      id: "loop",
      source: "store",
      target: "store",
      sourceHandle: "right",
      targetHandle: "top",
    });
    const free = makeEdge({
      id: "free",
      source: "pt",
      target: "store",
      sourceHandle: "center",
      targetHandle: "left",
    });
    const edges = [loop, free];
    const out = placeEnds([...nodes, anchor], edges, bothEnds(["loop", "free"]));
    expect(out[0]).toBe(loop);
    expect(out[1]!.sourceHandle).toBe("center");
    expect(out[1]!.targetHandle).toBe("left");
  });

  it("returns the same array when nothing moves", () => {
    const edges = [edgeTo("a", "upper")];
    expect(placeEnds(nodes, edges, bothEnds(["a"]))).toBe(edges);
    expect(placeEnds(nodes, edges, [])).toBe(edges);
  });
});
