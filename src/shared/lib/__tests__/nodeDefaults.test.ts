import { beforeEach, describe, expect, it } from "vitest";

import { renderVectorSvg } from "../../../features/export/vectorSvg";
import { COLOR_TOKENS, DARK_COLOR_TOKENS, PALETTE_COLORS } from "../palette";
import { useDiagramStore } from "../store";
import { createShapeNode, DEFAULT_COLOR, DEFAULT_SHAPE, normalizeNode } from "../store/nodeFactory";
import type { DiagramNode } from "../types";
import { makeDoc } from "./testFixtures";

describe("New shapes default to square-cornered mono (#158)", () => {
  beforeEach(() => {
    useDiagramStore.getState().loadDoc(makeDoc([], [], "Untitled Diagram"), null);
  });

  it("defaults are rect · mono", () => {
    expect(DEFAULT_SHAPE).toBe("rect");
    expect(DEFAULT_COLOR).toBe("mono");
  });

  it("add_node without shape or color gives rect · mono", () => {
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "a", label: "Step", x: 0, y: 0 } }]);
    expect(result.errors).toEqual([]);
    const node = useDiagramStore.getState().nodes[0];
    expect(node?.data.shape).toBe("rect");
    expect(node?.data.color).toBe("mono");
  });

  it("sticky notes stay amber and anchors gray", () => {
    expect(createShapeNode("sticky", { x: 0, y: 0 }).data.color).toBe("amber");
    expect(createShapeNode("anchor", { x: 0, y: 0 }).data.color).toBe("gray");
    expect(createShapeNode("diamond", { x: 0, y: 0 }).data.color).toBe("mono");
  });

  it("nodes from a file missing color/shape open with the old defaults (violet · rounded)", () => {
    const raw = {
      id: "old",
      type: "shape",
      position: { x: 0, y: 0 },
      width: 160,
      height: 56,
      data: { label: "Old" },
    } as unknown as DiagramNode;
    const node = normalizeNode(raw);
    expect(node.data.shape).toBe("rounded");
    expect(node.data.color).toBe("violet");
  });

  it("mono is first in the palette and has light/dark tokens", () => {
    expect(PALETTE_COLORS[0]).toBe("mono");
    expect(COLOR_TOKENS.mono).toEqual({
      fill: "#EAE8E4",
      stroke: "#4A4743",
      text: "#1A1A1A",
      cap: "#DEDBD6",
      line: "#A9A49D",
      glyph: "#4A4743",
    });
    expect(DARK_COLOR_TOKENS.mono.stroke).toBe("#CFCAC3");
  });

  it("the bridge can set the ink color (#210)", () => {
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "h", label: "Hero", color: "ink", x: 0, y: 0 } }]);
    expect(result.errors).toEqual([]);
    expect(useDiagramStore.getState().nodes.find((n) => n.id === "h")?.data.color).toBe("ink");
  });

  it("the bridge can set the mono color", () => {
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "b", label: "B", color: "mono", x: 0, y: 0 } }]);
    expect(result.errors).toEqual([]);
  });

  it("vector SVG draws mono in the theme's actual color", () => {
    const doc = {
      version: 1 as const,
      title: "t",
      nodes: [createShapeNode("rect", { x: 0, y: 0 }, { label: "Box" })],
      edges: [],
    };
    // a Studio tile (#210): the face carries the colour, nothing is outlined
    const light = renderVectorSvg(doc);
    expect(light).toContain(`fill="${COLOR_TOKENS.mono.fill}"`);
    const dark = renderVectorSvg(doc, { theme: "dark" });
    expect(dark).toContain(`fill="${DARK_COLOR_TOKENS.mono.fill}"`);
  });
});

describe("set_diagram also follows the new defaults (#158)", () => {
  beforeEach(() => {
    useDiagramStore.getState().loadDoc(makeDoc([], [], "Untitled Diagram"), null);
  });

  const bare = { id: "a", position: { x: 0, y: 0 }, data: { label: "A" } };

  it("set_diagram — without shape or color gives rect · mono", () => {
    const result = useDiagramStore.getState().applyOps([
      // biome-ignore lint/suspicious/noExplicitAny: an agent's partial node, as sent over the wire
      { op: "set_diagram", doc: { version: 1, title: "T", nodes: [bare as any], edges: [] } },
    ]);
    expect(result.errors).toEqual([]);
    expect(useDiagramStore.getState().nodes[0]?.data).toMatchObject({
      shape: "rect",
      color: "mono",
    });
  });

  it("opening a file still uses the old defaults — the same node from a file gets violet · rounded", () => {
    // biome-ignore lint/suspicious/noExplicitAny: a node as an old file stores it
    useDiagramStore.getState().loadDoc(makeDoc([{ ...bare, type: "shape" } as any], []), null);
    expect(useDiagramStore.getState().nodes[0]?.data).toMatchObject({
      shape: "rounded",
      color: "violet",
    });
  });

  it("colors not in the palette get a fallback — drawing without tokens does not break", () => {
    const raw = {
      ...bare,
      type: "shape",
      width: 160,
      height: 56,
      data: { label: "A", shape: "rect", color: "purple" },
    } as unknown as DiagramNode;
    expect(normalizeNode(raw).data.color).toBe("violet");
  });
});
