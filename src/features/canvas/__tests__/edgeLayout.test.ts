import { describe, expect, it } from "vitest";

import { makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { edgeSiblings, layoutEdge, obstaclesFor } from "../edgeLayout";

describe("edgeLayout — edge layout shared by the canvas and SVG (#148)", () => {
  const nodes = [
    makeNode({ id: "a" }),
    makeNode({ id: "b", x: 400 }),
    makeNode({ id: "c", x: 200, y: 200 }),
  ];

  it("computes obstacles once per node array — so every edge doesn't recompute during a drag", () => {
    expect(obstaclesFor(nodes)).toBe(obstaclesFor(nodes));
    expect(obstaclesFor([...nodes])).not.toBe(obstaclesFor(nodes));
  });

  it("computes parallel spacing and self-loop index separately — path computation reacts only to those numbers", () => {
    const edges = [
      makeEdge({ id: "e1", source: "a", target: "b" }),
      makeEdge({ id: "e2", source: "a", target: "b" }),
      makeEdge({ id: "l1", source: "c", target: "c" }),
      makeEdge({ id: "l2", source: "c", target: "c" }),
    ];
    expect(edgeSiblings(edges[0]!, nodes, edges).parallelOffset).toBe(-9);
    expect(edgeSiblings(edges[1]!, nodes, edges).parallelOffset).toBe(9);
    expect(edgeSiblings(edges[3]!, nodes, edges).selfLoopIndex).toBe(1);
  });

  it("gives the same result when passed precomputed sibling info", () => {
    const edges = [
      makeEdge({ id: "e1", source: "a", target: "b" }),
      makeEdge({ id: "e2", source: "a", target: "b" }),
    ];
    const edge = edges[1]!;
    const direct = layoutEdge(edge, nodes, { edges });
    const split = layoutEdge(edge, nodes, { siblings: edgeSiblings(edge, nodes, edges) });
    expect(split?.d).toBe(direct?.d);
  });

  it("draws nothing when an end node is missing and there is no fallback point", () => {
    expect(
      layoutEdge(makeEdge({ id: "x", source: "a", target: "nope" }), nodes, { edges: [] }),
    ).toBeNull();
  });
});
