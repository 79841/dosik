import { Position, ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { handlePointOnNode } from "../../../shared/lib/edgeUtils";
import { useDiagramStore } from "../../../shared/lib/store";
import { LabeledEdge } from "../LabeledEdge";

/**
 * React Flow reports a handle's *outer edge* as the endpoint, and Dosik's
 * connection dots are 10x10 centred on the node border, so the coordinates it
 * hands an edge component sit 5px outside the node. `OVERSHOOT` reproduces
 * that: every prop below is deliberately wrong by the same amount the real
 * measurement is, and the assertions pin that the render ignores them in
 * favour of `handlePointOnNode` (#89).
 */
const OVERSHOOT = 5;

const W = 160;
const H = 56;

/** Two boxes whose facing sides touch exactly at `x = seam`. */
const seedTouching = (seam = W) => {
  useDiagramStore.getState().loadDoc(
    makeDoc(
      [
        makeNode({ id: "a", x: 0, y: 0, width: W, height: H }),
        makeNode({ id: "b", x: seam, y: 0, width: W, height: H }),
      ],
      [
        {
          ...makeEdge({ id: "e", source: "a", target: "b" }),
          sourceHandle: "right",
          targetHandle: "left",
          data: { variant: "solid", arrow: true, pathStyle: "orthogonal" },
        },
      ],
    ),
    null,
  );
};

const renderEdge = () => {
  const edge = useDiagramStore.getState().edges[0]!;
  const nodes = useDiagramStore.getState().nodes;
  const s = handlePointOnNode(nodes[0]!, edge.sourceHandle);
  const t = handlePointOnNode(nodes[1]!, edge.targetHandle);
  const { container } = render(
    <ReactFlowProvider>
      <svg aria-label="canvas">
        <LabeledEdge
          id="e"
          source="a"
          target="b"
          // measured coordinates: each pushed outward past its own node
          sourceX={s.x + OVERSHOOT}
          sourceY={s.y}
          targetX={t.x - OVERSHOOT}
          targetY={t.y}
          sourcePosition={Position.Right}
          targetPosition={Position.Left}
          sourceHandleId={edge.sourceHandle}
          targetHandleId={edge.targetHandle}
          data={edge.data}
        />
      </svg>
    </ReactFlowProvider>,
  );
  const d = container.querySelector("path.react-flow__edge-path")?.getAttribute("d") ?? "";
  const ys = [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,]\s*(-?[\d.]+)/g)].map((m) => Number(m[2]));
  return { d, rise: Math.max(...ys) - Math.min(...ys) };
};

describe("edge endpoints come from the stored model (#89)", () => {
  beforeEach(() => {
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
  });

  it("connecting touching boxes doesn't make the line jut above the boxes", () => {
    seedTouching();
    // measured props would put source 10px past target -> negative facing
    // separation -> the router hooks up and over both boxes
    expect(renderEdge().rise).toBe(0);
  });

  it("forms no hooks on overlapping boxes either", () => {
    seedTouching(W - 24);
    expect(renderEdge().rise).toBe(0);
  });

  it("places endpoints exactly on the node border — not at measured coordinates", () => {
    seedTouching(W + 200);
    const { d } = renderEdge();
    const first = d.match(/M\s*(-?[\d.]+)[ ,]\s*(-?[\d.]+)/);
    expect(Number(first?.[1])).toBe(W); // a's right side, not W + OVERSHOOT
    expect(Number(first?.[2])).toBe(H / 2);
  });
});
