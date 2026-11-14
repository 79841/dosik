import { beforeEach, describe, expect, it } from "vitest";

import {
  DECOR_SHAPES,
  keepsIcon,
  MAX_BADGE,
  MAX_DESCRIPTION,
  sanitizeBadge,
  sanitizeDescription,
  takesDecor,
} from "../nodeDecor";
import { useDiagramStore } from "../store";
import { normalizeNode } from "../store/nodeFactory";
import type { DiagramNode } from "../types";
import { makeDoc } from "./testFixtures";

const reset = () => useDiagramStore.getState().loadDoc(makeDoc([], [], "T"), null);
const node = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id)!;

describe("Shapes that take decorations (#160 D2)", () => {
  it("box shapes only", () => {
    expect([...DECOR_SHAPES].sort()).toEqual(
      [
        "cylinder",
        "diamond",
        "ellipse",
        "hexagon",
        "parallelogram",
        "rect",
        "rounded",
        "sticky",
      ].sort(),
    );
    for (const shape of [
      "class",
      "entity",
      "lifeline",
      "fragment",
      "text",
      "image",
      "icon",
      "anchor",
    ] as const) {
      expect(takesDecor(shape)).toBe(false);
    }
    expect(keepsIcon("icon")).toBe(true);
    expect(keepsIcon("rect")).toBe(true);
    expect(keepsIcon("class")).toBe(false);
  });

  it("badge and description length and whitespace (D4)", () => {
    expect(sanitizeBadge("  v2  ")).toBe("v2");
    expect(sanitizeBadge("   ")).toBeUndefined();
    expect(sanitizeBadge("x".repeat(40))).toHaveLength(MAX_BADGE);
    expect(sanitizeBadge("a\nb")).toBe("a b");
    expect(sanitizeDescription("  line 1\nline 2  ")).toBe("line 1\nline 2");
    expect(sanitizeDescription("y".repeat(400))).toHaveLength(MAX_DESCRIPTION);
    expect(sanitizeDescription(42)).toBeUndefined();
  });
});

describe("Bridge op (#160)", () => {
  beforeEach(reset);

  it("add_node: icon·badge·description on a box", () => {
    const result = useDiagramStore.getState().applyOps([
      {
        op: "add_node",
        node: {
          id: "a",
          label: "Orders",
          icon: "database",
          badge: "v2",
          description: "Postgres 16",
          x: 0,
          y: 0,
        },
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(node("a").data).toMatchObject({
      shape: "rect",
      icon: "database",
      badge: "v2",
      description: "Postgres 16",
    });
  });

  it("add_node: rejects shapes that cannot take decorations", () => {
    const result = useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "c", label: "C", shape: "class", badge: "x", x: 0, y: 0 } },
      {
        op: "add_node",
        node: { id: "t", label: "T", shape: "text", description: "d", x: 0, y: 0 },
      },
      {
        op: "add_node",
        node: { id: "l", label: "L", shape: "lifeline", icon: "server", x: 0, y: 0 },
      },
    ]);
    expect(result.errors).toHaveLength(3);
    expect(useDiagramStore.getState().nodes).toHaveLength(0);
  });

  it("add_node: rejects over-length values and wrong types", () => {
    const result = useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", badge: "x".repeat(17), x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", description: "y".repeat(301), x: 0, y: 0 } },
      // biome-ignore lint/suspicious/noExplicitAny: a wrong type, as an agent might send it
      { op: "add_node", node: { id: "c", label: "C", badge: 3 as any, x: 0, y: 0 } },
    ]);
    expect(result.errors).toHaveLength(3);
  });

  it("update_node: attaches, and an empty string clears", () => {
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    useDiagramStore
      .getState()
      .applyOps([
        { op: "update_node", id: "a", set: { badge: "new", description: "why", icon: "cloud" } },
      ]);
    expect(node("a").data).toMatchObject({ badge: "new", description: "why", icon: "cloud" });
    useDiagramStore
      .getState()
      .applyOps([{ op: "update_node", id: "a", set: { badge: "", description: "" } }]);
    expect("badge" in node("a").data).toBe(false);
    expect("description" in node("a").data).toBe(false);
  });

  it("shape switch: kept between boxes, dropped when going to class (D3)", () => {
    useDiagramStore.getState().applyOps([
      {
        op: "add_node",
        node: { id: "a", label: "A", icon: "cloud", badge: "b", description: "d", x: 0, y: 0 },
      },
      { op: "update_node", id: "a", set: { shape: "diamond" } },
    ]);
    expect(node("a").data).toMatchObject({ icon: "cloud", badge: "b", description: "d" });
    useDiagramStore.getState().applyOps([{ op: "update_node", id: "a", set: { shape: "class" } }]);
    expect(node("a").data.icon).toBeUndefined();
    expect(node("a").data.badge).toBeUndefined();
    expect(node("a").data.description).toBeUndefined();
  });

  it("icon node → rectangle keeps the glyph as the box's icon (D3)", () => {
    useDiagramStore.getState().applyOps([
      {
        op: "add_node",
        node: { id: "i", label: "DB", shape: "icon", icon: "database", x: 0, y: 0 },
      },
      { op: "update_node", id: "i", set: { shape: "rect" } },
    ]);
    expect(node("i").data).toMatchObject({ shape: "rect", icon: "database" });
  });

  it("store edits (edit bar) follow the same rules", () => {
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    useDiagramStore
      .getState()
      .updateNodeData("a", { badge: "  hi  ", description: " d ", icon: "cloud" });
    expect(node("a").data).toMatchObject({ badge: "hi", description: "d", icon: "cloud" });
    useDiagramStore.getState().updateNodeData("a", { shape: "entity" });
    expect(node("a").data.badge).toBeUndefined();
    expect(node("a").data.icon).toBeUndefined();
  });
});

describe("Opening files (#160)", () => {
  it("drops decorations on shapes that cannot take them, and fixes lengths", () => {
    const raw = (shape: string, extra: object) =>
      ({
        id: "n",
        type: "shape",
        position: { x: 0, y: 0 },
        width: 160,
        height: 56,
        data: { label: "N", shape, color: "mono", ...extra },
      }) as unknown as DiagramNode;
    expect(
      normalizeNode(raw("class", { badge: "b", description: "d" })).data.badge,
    ).toBeUndefined();
    expect(normalizeNode(raw("rect", { badge: "x".repeat(30) })).data.badge).toHaveLength(
      MAX_BADGE,
    );
    expect(normalizeNode(raw("rect", { description: "  " })).data.description).toBeUndefined();
    expect(normalizeNode(raw("rect", { icon: "cloud" })).data.icon).toBe("cloud");
    expect(normalizeNode(raw("text", { icon: "cloud" })).data.icon).toBeUndefined();
  });
});

describe("Easily missed paths (#160)", () => {
  beforeEach(reset);

  it('a box icon clears with "", but the glyph of an icon node cannot be cleared with ""', () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "b", label: "B", icon: "cloud", x: 0, y: 0 } },
      {
        op: "add_node",
        node: { id: "i", label: "I", shape: "icon", icon: "database", x: 200, y: 0 },
      },
    ]);
    expect(
      useDiagramStore.getState().applyOps([{ op: "update_node", id: "b", set: { icon: "" } }])
        .errors,
    ).toEqual([]);
    expect(node("b").data.icon).toBeUndefined();
    const r = useDiagramStore
      .getState()
      .applyOps([{ op: "update_node", id: "i", set: { icon: "" } }]);
    expect(r.errors[0]).toContain("needs its glyph");
    expect(node("i").data.icon).toBe("database");
  });

  it('add_node rejects icon "" — there is nothing to clear', () => {
    const r = useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "x", label: "X", icon: "" as never, x: 0, y: 0 } }]);
    expect(r.errors).toHaveLength(1);
  });

  it("set_diagram also sanitizes decorations — drops them on non-boxes and truncates lengths", () => {
    const r = useDiagramStore.getState().applyOps([
      {
        op: "set_diagram",
        doc: {
          version: 1,
          title: "T",
          nodes: [
            {
              id: "a",
              type: "shape",
              position: { x: 0, y: 0 },
              data: { label: "A", badge: "x".repeat(30) },
            },
            {
              id: "c",
              type: "shape",
              position: { x: 0, y: 0 },
              data: { label: "C", shape: "class", badge: "b" },
            },
          ] as never,
          edges: [],
        },
      },
    ]);
    expect(r.errors).toEqual([]);
    expect(node("a").data.badge).toHaveLength(MAX_BADGE);
    expect(node("c").data.badge).toBeUndefined();
  });

  it("copy/paste and duplicate carry decorations as is", () => {
    useDiagramStore.getState().applyOps([
      {
        op: "add_node",
        node: { id: "a", label: "A", icon: "cloud", badge: "v2", description: "d", x: 0, y: 0 },
      },
    ]);
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
    useDiagramStore.getState().duplicateSelection();
    const copy = useDiagramStore.getState().nodes.find((n) => n.id !== "a")!;
    expect(copy.data).toMatchObject({ icon: "cloud", badge: "v2", description: "d" });
  });

  it("a box created beside via the + button does not inherit the box's icon — only icon nodes pass on their glyph", () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "b", label: "B", icon: "cloud", x: 0, y: 0 } },
      {
        op: "add_node",
        node: { id: "i", label: "I", shape: "icon", icon: "database", x: 400, y: 0 },
      },
    ]);
    const fromBox = useDiagramStore.getState().addAdjacentNode("b", "right")!;
    const fromIcon = useDiagramStore.getState().addAdjacentNode("i", "right")!;
    expect(node(fromBox).data.icon).toBeUndefined();
    expect(node(fromIcon).data.icon).toBe("database");
  });

  it("badge length is counted after collapsing whitespace — as it will be stored", () => {
    const r = useDiagramStore
      .getState()
      .applyOps([
        { op: "add_node", node: { id: "a", label: "A", badge: "a          b", x: 0, y: 0 } },
      ]);
    expect(r.errors).toEqual([]);
    expect(node("a").data.badge).toBe("a b");
  });
});

describe("Studio decoration rules (#210)", () => {
  it("isStepBadge: only a 1–3 digit badge draws as a step circle (D23)", async () => {
    const { isStepBadge } = await import("../nodeDecor");
    for (const yes of ["2", "12", "123"]) expect(isStepBadge(yes), yes).toBe(true);
    for (const no of ["v2", "1234", "", "1.5", " 2", undefined])
      expect(isStepBadge(no), String(no)).toBe(false);
  });

  it("iconPlacement: above the label from 64px tall, beside it below that (D6)", async () => {
    const { DECOR, iconPlacement } = await import("../nodeDecor");
    expect(DECOR.iconAboveMinHeight).toBe(64);
    expect(iconPlacement(64)).toBe("above");
    expect(iconPlacement(80)).toBe("above");
    expect(iconPlacement(63)).toBe("left");
    expect(iconPlacement(56)).toBe("left");
  });

  it("an icon lays the label out with it; a badge alone does not", async () => {
    const { hasInlineDecor } = await import("../nodeDecor");
    expect(hasInlineDecor({ shape: "rect", icon: "database" })).toBe(true);
    expect(hasInlineDecor({ shape: "rect", description: "x" })).toBe(true);
    expect(hasInlineDecor({ shape: "rect" })).toBe(false);
    expect(hasInlineDecor({ shape: "class", icon: "database" })).toBe(false);
  });
});

describe("frames take a badge — a step number on the corner (#210 D23)", () => {
  beforeEach(() =>
    useDiagramStore.getState().loadDoc({ version: 1, title: "t", nodes: [], edges: [] }, null),
  );
  const frameOf = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id);

  it("add_node / update_node accept a frame's badge, still refuse its description and icon", () => {
    const store = useDiagramStore.getState();
    const ok = store.applyOps([
      { op: "add_node", node: { id: "f", label: "VPC", shape: "frame", badge: "1", x: 0, y: 0 } },
      { op: "update_node", id: "f", set: { badge: "2" } },
    ]);
    expect(ok.errors).toEqual([]);
    expect(frameOf("f")?.data.badge).toBe("2");
    const bad = store.applyOps([
      { op: "update_node", id: "f", set: { description: "nope" } },
      { op: "add_node", node: { id: "g", label: "G", shape: "frame", icon: "cloud", x: 0, y: 0 } },
    ]);
    expect(bad.errors).toHaveLength(2);
    expect(frameOf("f")?.data.description).toBeUndefined();
  });

  it("update_node refuses a badge on a shape that takes none, and leaves the node as it was", () => {
    const store = useDiagramStore.getState();
    store.applyOps([
      { op: "add_node", node: { id: "l", label: "API", shape: "lifeline", x: 0, y: 0 } },
    ]);
    const res = store.applyOps([{ op: "update_node", id: "l", set: { badge: "1" } }]);
    expect(res.errors).toEqual([expect.stringContaining("badge is only valid on box shapes")]);
    expect(res.errors[0]).toContain("and frames");
    expect(frameOf("l")?.data.badge).toBeUndefined();
  });

  it("a file keeps a frame's badge", () => {
    useDiagramStore.getState().loadDoc(
      {
        version: 1,
        title: "t",
        nodes: [
          {
            id: "f",
            type: "shape",
            position: { x: 0, y: 0 },
            width: 400,
            height: 300,
            data: { label: "VPC", shape: "frame", color: "amber", badge: "3" },
          },
        ],
        edges: [],
      },
      null,
    );
    expect(frameOf("f")?.data.badge).toBe("3");
  });
});
