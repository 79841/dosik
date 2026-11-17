import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  COLOR_TOKENS,
  DARK_COLOR_TOKENS,
  FONT_MONO,
  SHAPE_STROKE_WIDTH,
  SURFACE_DARK,
  SURFACE_LIGHT,
} from "../../../shared/lib/palette";
import { layoutEdge, routingData } from "../../canvas/edgeLayout";
import { PILL } from "../../../shared/lib/labelPill";
import {
  BODY_TEXT_WEIGHT,
  NODE_LABEL,
  nodeLabelLayout,
  TEXT_SHAPE_SIZE,
} from "../../../shared/lib/nodeLayout";
import { renderVectorSvg, VectorDiagram } from "../vectorSvg";
import { useDiagramStore } from "../../../shared/lib/store";
import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { allShapesDoc } from "./fixtures/allShapes";

const parse = (svg: string) => new DOMParser().parseFromString(svg, "image/svg+xml");

describe("renderVectorSvg — a real vector SVG drawn without a window (#148)", () => {
  const doc = allShapesDoc();
  const svg = renderVectorSvg(doc);
  const dom = parse(svg);

  it("Is a valid SVG document with no <foreignObject> — not a capture wrapping HTML", () => {
    expect(dom.querySelector("parsererror")).toBeNull();
    expect(dom.documentElement.tagName).toBe("svg");
    expect(dom.documentElement.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
    expect(svg).not.toMatch(/foreignObject/i);
    expect(dom.querySelector("title")?.textContent).toBe("All shapes");
  });

  it("Every node is drawn — not a single shape kind is missing", () => {
    for (const node of doc.nodes) {
      expect(dom.querySelector(`[data-node="${node.id}"]`), node.id).not.toBeNull();
    }
  });

  it("Line paths come from the same function as the canvas (layoutEdge) — the renderer does not compute its own", () => {
    for (const edge of doc.edges) {
      const layout = layoutEdge(edge, doc.nodes, { edges: doc.edges });
      const path = dom.querySelector(`[data-edge="${edge.id}"] path.edge`);
      expect(path?.getAttribute("d"), edge.id).toBe(layout?.d);
    }
  });

  it("Drawing order matches the canvas — frames → lines → shapes → self-message", () => {
    const order = [...dom.querySelectorAll("[data-node], [data-edge]")].map(
      (el) => el.getAttribute("data-node") ?? `edge:${el.getAttribute("data-edge")}`,
    );
    const at = (key: string) => order.indexOf(key);
    expect(at("frag")).toBeLessThan(at("edge:e1"));
    expect(at("edge:e1")).toBeLessThan(at("rect"));
    // The label layer is above every line and below every shape (#91)
    const labels = [...dom.querySelectorAll("[data-node], [data-edge], [data-edge-labels]")].map(
      (el) =>
        el.getAttribute("data-node") ??
        (el.hasAttribute("data-edge")
          ? `edge:${el.getAttribute("data-edge")}`
          : `labels:${el.getAttribute("data-edge-labels")}`),
    );
    expect(labels.indexOf("labels:e1")).toBeGreaterThan(labels.indexOf("edge:free"));
    expect(labels.indexOf("labels:e1")).toBeLessThan(labels.indexOf("rect"));
    // A self-message is lifted above its own lifeline (canvasLifts, #99)
    expect(at("edge:m3")).toBeGreaterThan(at("lb"));
    // A plain self-loop is not lifted
    expect(at("edge:e7")).toBeLessThan(at("hex"));
  });

  it("Label text is included and wraps", () => {
    const rounded = dom.querySelector('[data-node="rounded"]');
    const lines = [...(rounded?.querySelectorAll("tspan, text") ?? [])]
      .map((t) => t.textContent)
      .filter(Boolean);
    expect(lines.join(" ")).toContain("Rounded box");
    expect(rounded?.querySelectorAll("text tspan").length).toBeGreaterThan(1);
    expect(svg).toContain("주문 DB");
  });

  it("Line labels are drawn as pills, including start and end labels", () => {
    // Labels are a separate layer from lines — the canvas puts the label layer above all lines
    const e2 = dom.querySelector('[data-edge-labels="e2"]');
    const texts = [...(e2?.querySelectorAll("text") ?? [])].map((t) => t.textContent);
    expect(texts).toEqual(expect.arrayContaining(["one", "1", "*"]));
    const pills = [...(e2?.querySelectorAll("rect.pill") ?? [])];
    expect(pills.length).toBe(3);
    // a canvas-coloured patch, no box (#210 D7)
    for (const p of pills) {
      expect(p.getAttribute("fill")).toBe(SURFACE_LIGHT.canvasBg);
      expect(p.getAttribute("stroke")).toBeNull();
    }
  });

  it("Label strings are escaped — they don't run in the browser of whoever opens the file", () => {
    const hostile = allShapesDoc();
    hostile.nodes[0]!.data.label = '<script>alert("x")</script>';
    const out = renderVectorSvg(hostile);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("Draws with the diagram font — not the app's screen font (Manrope) (#216)", () => {
    expect(dom.documentElement.getAttribute("font-family")).toBe(FONT_MONO);
  });

  it("No CSS variables remain — they mean nothing outside the app", () => {
    expect(svg).not.toContain("var(--");
  });

  it("Each theme uses that theme's actual colors", () => {
    const light = svg;
    const dark = renderVectorSvg(doc, { theme: "dark" });
    expect(light).toContain(SURFACE_LIGHT.canvasBg);
    expect(light).toContain(COLOR_TOKENS.blue.fill);
    expect(dark).toContain(SURFACE_DARK.canvasBg);
    expect(dark).toContain(DARK_COLOR_TOKENS.blue.fill);
    expect(dark).not.toContain(SURFACE_LIGHT.canvasBg);
  });

  it("The viewBox contains every node", () => {
    const [x, y, w, h] = (dom.documentElement.getAttribute("viewBox") ?? "").split(" ").map(Number);
    for (const node of doc.nodes) {
      expect(node.position.x).toBeGreaterThanOrEqual(x!);
      expect(node.position.y).toBeGreaterThanOrEqual(y!);
      expect(node.position.x + (node.width ?? 0)).toBeLessThanOrEqual(x! + w!);
      expect(node.position.y + (node.height ?? 0)).toBeLessThanOrEqual(y! + h!);
    }
  });

  it("Free arrow anchors are invisible, and found/lost anchors show as ●", () => {
    expect(dom.querySelector('[data-node="fa1"] circle')).toBeNull();
    const found = doc.nodes.find(
      (n) =>
        n.data.shape === "anchor" &&
        doc.edges.some((e) => e.id === "m4" && (e.source === n.id || e.target === n.id)),
    );
    expect(dom.querySelector(`[data-node="${found?.id}"] circle`)).not.toBeNull();
  });

  it("Can be exported without a background", () => {
    // No background rectangle; what the canvas colour cut is cut by masks instead (transparentCuts.test.ts, #255)
    const bare = parse(renderVectorSvg(doc, { background: false }));
    expect(bare.querySelector("svg > rect")).toBeNull();
    expect(dom.querySelector("svg > rect")?.getAttribute("fill")).toBe(SURFACE_LIGHT.canvasBg);
  });
});

describe("Dark vector SVG — tiles stay light, colors on the canvas are light tones (#216 R3)", () => {
  const tile = makeNode({ id: "tile", shape: "rect", color: "blue", label: "Orders" });
  tile.data.icon = "database";
  const icon = makeNode({ id: "icon", shape: "icon", color: "blue", label: "DB", x: 300 });
  icon.data.icon = "database";
  const edge = makeEdge({ id: "e", source: "tile", target: "icon", label: "reads" });
  edge.data!.color = "blue";
  const dark = parse(renderVectorSvg(makeDoc([tile, icon], [edge]), { theme: "dark" }));
  const node = (id: string) => dark.querySelector(`[data-node="${id}"]`)!;
  const glyphs = (el: Element) =>
    [...el.querySelectorAll("g[stroke]")].filter((g) => g.querySelector("path"));

  it("Tile fills, labels and decoration icons use the same colors as light", () => {
    expect(node("tile").querySelector(`[fill="${COLOR_TOKENS.blue.fill}"]`)).not.toBeNull();
    const label = [...node("tile").querySelectorAll("text")].find(
      (t) => t.textContent === "Orders",
    );
    expect(label?.getAttribute("fill")).toBe(COLOR_TOKENS.blue.text);
    expect(glyphs(node("tile")).map((g) => g.getAttribute("stroke"))).toEqual([
      COLOR_TOKENS.blue.glyph,
    ]);
  });

  it("Icon nodes and colored lines are light tones on the dark canvas", () => {
    expect(glyphs(node("icon")).map((g) => g.getAttribute("stroke"))).toEqual([
      DARK_COLOR_TOKENS.blue.stroke,
    ]);
    const strokes = [...dark.querySelectorAll("path[stroke]")].map((p) => p.getAttribute("stroke"));
    expect(strokes).toContain(DARK_COLOR_TOKENS.blue.stroke);
    expect(strokes).not.toContain(COLOR_TOKENS.blue.stroke);
  });
});

describe("Label dimensions are tied to the canvas classes — changing only one side breaks (#148)", () => {
  const source = (file: string) => readFileSync(join(__dirname, "../../canvas", file), "utf8");

  it("Line label — no border, 11px·500 on a canvas-colored patch (Studio #210 D7)", () => {
    // LabelPill: rounded-[2px] px-[5px] text-[11px] font-medium, line-height 1.5, no border
    const pill = source("LabelPill.tsx");
    expect(pill).toContain("rounded-[2px] px-[5px] text-[11px] font-medium");
    expect(pill).not.toMatch(/border-zinc-200/);
    expect(PILL).toEqual({
      fontSize: 11,
      fontWeight: 500,
      padX: 5,
      padY: 0,
      border: 0,
      lineHeight: 16.5,
      radius: 2,
    });
  });

  it("Shape label — 12px·600; the body of sticky note and text shapes is 400 (Studio #210 D5)", () => {
    // the canvas classes these mirror are checked on a rendered node in
    // canvas/__tests__/studioReview.test.tsx
    expect(NODE_LABEL).toMatchObject({ fontSize: 12, fontWeight: 600, lineHeight: 12 * 1.375 });
    expect(BODY_TEXT_WEIGHT).toBe(400);
  });

  it("Text shape — 13px, the same in view and editor", () => {
    const shapeNode = source("ShapeNode.tsx");
    // View and editor share one size variable — the text does not shrink when editing opens
    expect(shapeNode).toContain(
      'const labelSize = isText ? "text-[13px]" : isFragment ? "text-[11px]" : "text-[12px]";',
    );
    expect(shapeNode.match(/\$\{labelSize\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(TEXT_SHAPE_SIZE).toBe(13);
  });

  it("Shape lines — tiles have no outline; 1.5 is only the dashed group border (Studio #210 D3, D10)", () => {
    // Thin lines such as dividers and glyphs stay at 1
    expect(SHAPE_STROKE_WIDTH).toBe(1);
    // Arrowheads (marker) and lines (edge) are not shapes
    const svg = renderVectorSvg(allShapesDoc())
      .replace(/<marker[\s\S]*?<\/marker>/g, "")
      .replace(/<g data-edge[\s\S]*?<\/g>/g, "");
    const thick = [
      ...svg.matchAll(/<(?:rect|polygon|ellipse|path|line)[^>]*stroke-width="1\.5"[^>]*>/g),
    ].map((m) => m[0]);
    expect(thick.length).toBeGreaterThan(0);
    for (const el of thick) expect(el, el).toMatch(/stroke-dasharray=/);
  });
});

const docFrom = (ops: unknown[]) => {
  useDiagramStore.getState().loadDoc({ version: 1, title: "t", nodes: [], edges: [] }, null);
  const result = useDiagramStore.getState().applyOps(ops as never, true);
  if (result.errors.length) throw new Error(result.errors.join("; "));
  return useDiagramStore.getState().toDoc();
};

describe("Reinforcements (#152)", () => {
  it("A label that overflows its box still fits in the viewBox — so text visible on the canvas is not cut off in the file", () => {
    const doc = docFrom([
      {
        op: "add_node",
        node: {
          id: "t",
          label:
            "This text is very long, so it overflows below the node box — this checks that it really does overflow",
          shape: "text",
          x: 0,
          y: 220,
        },
      },
    ]);
    const dom = parse(renderVectorSvg(doc));
    const [, y, , h] = (dom.documentElement.getAttribute("viewBox") ?? "").split(" ").map(Number);
    const node = doc.nodes[0]!;
    const label = nodeLabelLayout(node, node.width ?? 0, node.height ?? 0)!;
    const bottom = node.position.y + label.centerY + (label.lines.length * label.lineHeight) / 2;
    expect(label.lines.length).toBeGreaterThan(2);
    expect(bottom).toBeLessThanOrEqual(y! + h!);
  });

  it("A frame guard wraps like on the canvas — a condition cut off with an ellipsis would read wrong", () => {
    const guard = "[order total > 10000 and the user is a long-standing member of the club]";
    const doc = docFrom([
      {
        op: "add_node",
        node: { id: "f", label: guard, shape: "fragment", x: 0, y: 0, width: 300, height: 160 },
      },
    ]);
    const svg = renderVectorSvg(doc);
    expect(svg).not.toContain("…");
    const texts = [...parse(svg).querySelectorAll('[data-node="f"] > text tspan')].map(
      (t) => t.textContent,
    );
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.join(" ")).toBe(guard);
  });

  it("Pins down the canvas rule for frame guards too", () => {
    const shapeNode = readFileSync(join(__dirname, "../../canvas", "ShapeNode.tsx"), "utf8");
    // Only the icon gets an ellipsis, the rest wraps — vectorSvg follows this rule
    expect(shapeNode).toContain('"overflow-hidden text-ellipsis whitespace-nowrap"');
    expect(shapeNode).toContain('"whitespace-pre-wrap break-words"');
    expect(shapeNode).toContain("pointer-events-auto w-max max-w-full");
  });

  it("Finds the arrowhead even when the edge id contains parentheses", () => {
    const doc = allShapesDoc();
    doc.edges[0]!.id = 'e")%20url(#x';
    const dom = parse(renderVectorSvg(doc));
    const path = dom.querySelector("[data-edge='e\")%20url(#x'] path.edge");
    const ref = path?.getAttribute("marker-end")?.match(/^url\(#(.+)\)$/)?.[1];
    expect(ref).toBeTruthy();
    expect(dom.getElementById(ref!)).not.toBeNull();
  });

  it("Canvas-only classes don't remain in the file", () => {
    expect(renderVectorSvg(allShapesDoc())).not.toContain("pointer-events");
  });
});

describe("The routing fields the canvas passes produce the same lines as the full data (#152)", () => {
  it("routingData alone gives the same path for every line — this breaks when routing fields are added", () => {
    const doc = allShapesDoc();
    for (const edge of doc.edges) {
      const full = layoutEdge(edge, doc.nodes, { edges: doc.edges });
      const picked = layoutEdge({ ...edge, data: routingData(edge.data) }, doc.nodes, {
        edges: doc.edges,
      });
      expect(picked?.d, edge.id).toBe(full?.d);
      expect(picked?.labelPoints, edge.id).toEqual(full?.labelPoints);
    }
  });
});

describe("VectorDiagram — the same renderer inlined into the DOM (#220 D13, T10)", () => {
  const sequence = () => {
    const store = useDiagramStore.getState();
    store.loadDoc(makeDoc([], []), null);
    store.applyOps([
      { op: "add_node", node: { id: "c", label: "Client", shape: "lifeline", x: 0, y: 0 } },
      { op: "add_node", node: { id: "s", label: "Server", shape: "lifeline", x: 240, y: 0 } },
      { op: "add_edge", edge: { source: "c", target: "s", label: "GET /items" } },
    ]);
    const { nodes, edges } = useDiagramStore.getState();
    return makeDoc(nodes, edges, "Sequence");
  };

  it.each([
    ["many shapes", () => allShapesDoc(), "light"],
    ["many shapes, dark", () => allShapesDoc(), "dark"],
    ["sequence", sequence, "light"],
  ] as const)(
    "%s — static markup is byte-for-byte the same as the renderVectorSvg string",
    (_, make, theme) => {
      const doc = make();
      expect(renderToStaticMarkup(createElement(VectorDiagram, { doc, theme }))).toBe(
        renderVectorSvg(doc, { theme }),
      );
      expect(
        renderToStaticMarkup(createElement(VectorDiagram, { doc, theme, background: false })),
      ).toBe(renderVectorSvg(doc, { theme, background: false }));
    },
  );

  it("background={false} means no background rect — draws straight onto the sheet", () => {
    const doc = makeDoc([makeNode({ id: "a" })], []);
    const dom = parse(
      renderToStaticMarkup(createElement(VectorDiagram, { doc, background: false })),
    );
    expect(dom.querySelector("svg > rect")).toBeNull();
    expect(dom.documentElement.getAttribute("font-family")).toBe(FONT_MONO);
  });
});
