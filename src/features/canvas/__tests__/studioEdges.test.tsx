import { type ConnectionLineComponentProps, Position, ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { COLOR_TOKENS, THEME_EDGE_STROKE } from "../../../shared/lib/palette";
import { useDiagramStore } from "../../../shared/lib/store";
import type { MarkerShape } from "../../../shared/lib/types";
import { ConnectionLine } from "../ConnectionLine";
import { edgePaint } from "../edgeLayout";
import { EdgeMarkerDef } from "../edgeMarkers";
import { LabeledEdge } from "../LabeledEdge";

const palette = { tokens: COLOR_TOKENS, stroke: "#1A1918" };

describe("Studio lines (#210 D8)", () => {
  it("an uncoloured line is the ink, and its label the line's colour", () => {
    const paint = edgePaint({ variant: "solid", arrow: true }, palette);
    expect(paint.stroke).toBe("#1A1918");
    expect(paint.labelColor).toBe("#1A1918");
  });

  it("a coloured line takes the deep tone, and its label the same", () => {
    const paint = edgePaint({ variant: "solid", arrow: true, color: "blue" }, palette);
    expect(paint.stroke).toBe(COLOR_TOKENS.blue.stroke);
    expect(paint.labelColor).toBe(COLOR_TOKENS.blue.stroke);
  });

  it("an ink line stays visible on the canvas — near-black, not the white of its tile", () => {
    const paint = edgePaint({ variant: "solid", arrow: true, color: "ink" }, palette);
    expect(paint.stroke).toBe(COLOR_TOKENS.ink.line);
  });
});

describe("a selected line lays a halo behind itself (#210 D9)", () => {
  const draw = (selected: boolean) => {
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [makeNode({ id: "a", shape: "rect" }), makeNode({ id: "b", shape: "rect", x: 400 })],
        [
          makeEdge({
            id: "e",
            source: "a",
            target: "b",
            sourceHandle: "right",
            targetHandle: "left",
          }),
        ],
      ),
      null,
    );
    const edge = useDiagramStore.getState().edges[0]!;
    return render(
      <ReactFlowProvider>
        <svg aria-label="canvas">
          <LabeledEdge
            id="e"
            source="a"
            target="b"
            sourceX={160}
            sourceY={28}
            targetX={400}
            targetY={28}
            sourcePosition={Position.Right}
            targetPosition={Position.Left}
            sourceHandleId="right"
            targetHandleId="left"
            selected={selected}
            data={edge.data}
          />
        </svg>
      </ReactFlowProvider>,
    ).container;
  };

  it("selected: one more, wider, translucent path under the line", () => {
    expect(draw(true).querySelector("path.edge-halo")).not.toBeNull();
  });

  it("not selected: no halo", () => {
    expect(draw(false).querySelector("path.edge-halo")).toBeNull();
  });
});

describe("the drawing previews end like the line they will make (#210 D24)", () => {
  const markerOf = (c: Element) => c.querySelector("marker")?.innerHTML;
  const expected = (shape: MarkerShape) =>
    markerOf(
      render(
        <svg>
          <EdgeMarkerDef
            id="md-connection-arrow"
            shape={shape}
            color={THEME_EDGE_STROKE}
            size="md"
          />
        </svg>,
      ).container,
    );
  const preview = (fromShape: string, toShape?: string) =>
    render(
      <svg>
        <ConnectionLine
          {...({
            fromX: 0,
            fromY: 0,
            toX: 120,
            toY: 0,
            fromPosition: Position.Right,
            toPosition: Position.Left,
            fromNode: { data: { shape: fromShape } },
            toNode: toShape ? { data: { shape: toShape } } : null,
          } as unknown as ConnectionLineComponentProps)}
        />
      </svg>,
    ).container;

  it("a connection dragged from a box previews the open chevron a new line gets", () => {
    useDiagramStore.setState({ lastEdgeStyle: {} });
    expect(markerOf(preview("rect"))).toBe(expected("open"));
  });

  it("one from a lifeline onto a lifeline previews the message's filled arrow (#210)", () => {
    useDiagramStore.setState({ lastEdgeStyle: {} });
    expect(markerOf(preview("lifeline", "lifeline"))).toBe(expected("arrow"));
  });

  it("one from a lifeline that has not landed on another — or lands on a box — is a plain line", () => {
    useDiagramStore.setState({ lastEdgeStyle: {} });
    expect(markerOf(preview("lifeline"))).toBe(expected("open"));
    expect(markerOf(preview("lifeline", "rect"))).toBe(expected("open"));
  });

  it("the arrow tool asks the same rule, not a hard-coded filled arrow", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(__dirname, "..", "ArrowDrawOverlay.tsx"), "utf8");
    expect(source).not.toContain("M 1.5 1.5 L 8.5 5 L 1.5 8.5 Z");
    expect(source).toContain("<EdgeMarkerDef");
    expect(source).toContain("connectionEndShape(");
  });
});
