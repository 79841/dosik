import { describe, expect, it } from "vitest";

import { nodeBounds } from "../../../shared/lib/edgeUtils";
import { pillSize } from "../../../shared/lib/labelPill";
import { DECOR } from "../../../shared/lib/nodeDecor";
import {
  frameBadgeLayout,
  labelBox,
  nodeDecorLayout,
  nodeLabelLayout,
} from "../../../shared/lib/nodeLayout";
import {
  BORDER_TITLE,
  DARK_COLOR_TOKENS,
  SURFACE_DARK,
  SURFACE_LIGHT,
} from "../../../shared/lib/palette";
import { useDiagramStore } from "../../../shared/lib/store";
import type { DiagramDoc } from "../../../shared/lib/types";
import { layoutEdge } from "../../canvas/edgeLayout";
import { parseSafeSvg } from "../../mcp-view/safeSvg";
import { renderVectorSvg } from "../vectorSvg";

/**
 * Every part that cuts what lies under it: line labels, hollow heads (both
 * ends, one end, on a self-message), a step badge's ring, a frame title and a
 * fragment operator set into a dashed border.
 * No class or entity card — their body is opaque, and its colour happens to be
 * the canvas's.
 */
const cuttersDoc = (): DiagramDoc => {
  const n = (id: string, shape: string, x: number, y: number, extra: object = {}) => ({
    op: "add_node",
    node: { id, label: id, shape, x, y, ...extra },
  });
  const ops = [
    n("vpc", "frame", 0, 0, { width: 760, height: 420, badge: "1", color: "blue" }),
    n("api", "rect", 60, 80, { badge: "2", color: "ink" }),
    n("db", "rect", 480, 80, { color: "teal" }),
    n("cache", "rect", 480, 260, { badge: "3" }),
    {
      op: "add_edge",
      edge: {
        id: "calls",
        source: "api",
        target: "db",
        label: "calls",
        markerStart: "diamond-open",
        markerEnd: "triangle",
      },
    },
    {
      op: "add_edge",
      edge: {
        id: "reads",
        source: "api",
        target: "cache",
        label: "reads",
        labelStart: "1",
        markerStart: "zero-one",
        markerEnd: "zero-many",
      },
    },
    {
      op: "add_edge",
      edge: {
        id: "owns",
        source: "db",
        target: "cache",
        markerStart: "diamond-open",
        markerEnd: "arrow",
      },
    },
    n("L1", "lifeline", 0, 500, { width: 120, height: 300 }),
    n("L2", "lifeline", 300, 500, { width: 120, height: 300 }),
    { op: "add_message", message: { from: "L1", to: "L2", y: 620, label: "call" } },
    {
      op: "add_message",
      message: { from: "L2", to: "L2", y: 680, label: "retry", markerEnd: "triangle" },
    },
    { op: "add_message", message: { from: "L1", to: "L1", y: 720, label: "poll" } },
    n("alt", "fragment", 0, 580, { width: 480, height: 160, fragmentKind: "alt", branches: 2 }),
  ];
  useDiagramStore.getState().loadDoc({ version: 1, title: "", nodes: [], edges: [] }, null);
  const result = useDiagramStore.getState().applyOps(ops as never, true);
  if (result.errors.length > 0) throw new Error(result.errors.join("; "));
  return useDiagramStore.getState().toDoc();
};

const parse = (svg: string) => new DOMParser().parseFromString(svg, "image/svg+xml");

/** text may be the canvas colour: a step number knocked out of its opaque ink circle */
const isText = (el: Element) => el.localName === "text" || el.localName === "tspan";

const same = (a: string | null | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();

describe("A drawing with no background paints nothing in the canvas colour (#255)", () => {
  const doc = cuttersDoc();

  for (const [theme, surface] of [
    ["light", SURFACE_LIGHT],
    ["dark", SURFACE_DARK],
  ] as const) {
    it(`${theme}: no label, hollow head, badge ring or set-in title is a canvas-coloured patch — it would show on a chat page that is not exactly the canvas colour`, () => {
      const dom = parse(renderVectorSvg(doc, { theme, background: false }));
      const patches = [...dom.querySelectorAll("*")]
        .filter((el) => !isText(el) && same(el.getAttribute("fill"), surface.canvasBg))
        .map((el) => el.outerHTML.slice(0, 120));
      expect(patches).toEqual([]);
    });
  }

  it("auto: nor do the dark rules paint one", () => {
    const svg = renderVectorSvg(doc, { theme: "auto", background: false });
    const css = /<style>([\s\S]*?)<\/style>/.exec(svg)?.[1] ?? "";
    const darkPaint = new Set(
      [...css.matchAll(/\.(dk[\w-]+)\s*\{([^}]*)\}/g)]
        .filter((m) =>
          (m[2] ?? "").toLowerCase().includes(`fill: ${SURFACE_DARK.canvasBg}`.toLowerCase()),
        )
        .map((m) => m[1] as string),
    );
    const patches = [...parse(svg).querySelectorAll("[class]")]
      .filter((el) => !isText(el))
      .filter((el) => (el.getAttribute("class") ?? "").split(/\s+/).some((c) => darkPaint.has(c)))
      .map((el) => el.outerHTML.slice(0, 120));
    expect(patches).toEqual([]);
  });

  it("a drawing on its canvas background still uses the patches — the file looks as it did", () => {
    const dom = parse(renderVectorSvg(doc, { theme: "light" }));
    expect(dom.querySelectorAll(`rect.pill[fill="${SURFACE_LIGHT.canvasBg}"]`).length).toBe(6);
    expect(dom.querySelector("mask")).toBeNull();
  });

  it("a self-message's label is drawn over every lifted line, as the canvas lays its labels over them", () => {
    const dom = parse(renderVectorSvg(doc, { theme: "light" }));
    const order = [...dom.querySelectorAll("[data-edge], [data-edge-labels]")].map((el) =>
      el.hasAttribute("data-edge")
        ? `line:${el.getAttribute("data-edge")}`
        : `labels:${el.getAttribute("data-edge-labels")}`,
    );
    const lifted = doc.edges.filter((e) => ["retry", "poll"].includes(e.data?.label ?? ""));
    const lastLine = Math.max(...lifted.map((e) => order.indexOf(`line:${e.id}`)));
    for (const e of lifted) expect(order.indexOf(`labels:${e.id}`)).toBeGreaterThan(lastLine);
  });
});

// ---------------------------------------------------------------- the cuts, as holes

const BLACK = new Set(["#000", "#000000", "black"]);
const isHole = (el: Element) => BLACK.has((el.getAttribute("fill") ?? "").toLowerCase());

/** the masks over `el`: its own and every ancestor's */
const masksOver = (el: Element): Element[] => {
  const masks: Element[] = [];
  for (let at: Element | null = el; at; at = at.parentElement) {
    const id = /^url\(#(.+)\)$/.exec(at.getAttribute("mask") ?? "")?.[1];
    const mask = id ? el.ownerDocument.querySelector(`mask[id="${id}"]`) : null;
    if (mask) masks.push(mask);
  }
  return masks;
};

/** the shapes that cut `el`: black in a mask over it */
const holesOver = (el: Element): Element[] =>
  masksOver(el).flatMap((mask) => [...mask.querySelectorAll("*")].filter(isHole));

const near = (a: string | null, b: number) => Math.abs(Number(a) - b) < 0.01;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const isRectAt = (el: Element, box: Box) =>
  el.localName === "rect" &&
  near(el.getAttribute("x"), box.x) &&
  near(el.getAttribute("y"), box.y) &&
  near(el.getAttribute("width"), box.width) &&
  near(el.getAttribute("height"), box.height);

const isCircleAt = (el: Element, cx: number, cy: number, r: number) =>
  el.localName === "circle" &&
  near(el.getAttribute("cx"), cx) &&
  near(el.getAttribute("cy"), cy) &&
  near(el.getAttribute("r"), r);

describe("On no background the cuts are holes the page shows through (#255)", () => {
  const doc = cuttersDoc();
  const svg = renderVectorSvg(doc, { theme: "dark", background: false });
  const dom = parse(svg);
  const edgeLabelled = (label: string) => {
    const edge = doc.edges.find((e) => e.data?.label === label);
    if (!edge) throw new Error(`no edge labelled ${label}`);
    return edge;
  };
  const pillBox = (label: string): Box => {
    const edge = edgeLabelled(label);
    const point = layoutEdge(edge, doc.nodes, { edges: doc.edges })?.labelPoints.center;
    if (!point) throw new Error(`no layout for ${label}`);
    const { width, height } = pillSize(label);
    return { x: point.x - width / 2, y: point.y - height / 2, width, height };
  };
  const node = (id: string) => {
    const found = doc.nodes.find((n) => n.id === id);
    if (!found) throw new Error(`no node ${id}`);
    return found;
  };

  it("a label cuts the line under it — its box is a hole in a mask over the line, a self-message's too", () => {
    for (const label of ["calls", "reads", "retry"]) {
      const line = dom.querySelector(`[data-edge="${edgeLabelled(label).id}"] path.edge`);
      if (!line) throw new Error(`no line for ${label}`);
      const box = pillBox(label);
      expect(
        holesOver(line).some((hole) => isRectAt(hole, box)),
        label,
      ).toBe(true);
    }
  });

  it("a label cuts the other lines under it too, as its patch did on the canvas", () => {
    // the frame is below the label layer: its dashes under a label are cut with the line
    const frame = dom.querySelector('[data-node="vpc"] rect[stroke-dasharray]');
    if (!frame) throw new Error("no frame outline");
    expect(holesOver(frame).some((hole) => isRectAt(hole, pillBox("calls")))).toBe(true);
  });

  it("no label text is cut by its own hole", () => {
    for (const label of ["calls", "reads", "retry", "call"]) {
      const text = [...dom.querySelectorAll("[data-edge-labels] text")].find(
        (t) => t.textContent === label,
      );
      if (!text) throw new Error(`no text ${label}`);
      const box = pillBox(label);
      expect(
        holesOver(text).some((hole) => isRectAt(hole, box)),
        label,
      ).toBe(false);
    }
  });

  it("a hollow head stays open: drawn with no fill, and the line under it is cut by the same shape", () => {
    const edge = edgeLabelled("calls");
    const line = dom.querySelector(`[data-edge="${edge.id}"] path.edge`);
    if (!line) throw new Error("no line");
    for (const end of ["marker-start", "marker-end"]) {
      const id = /^url\(#(.+)\)$/.exec(line.getAttribute(end) ?? "")?.[1];
      const glyph = dom.querySelector(`marker[id="${id}"] path`);
      expect(glyph?.getAttribute("fill"), end).toBe("none");
    }
    // the hole: the same line, invisible, carrying the heads' bodies in black
    const d = layoutEdge(edge, doc.nodes, { edges: doc.edges })?.d;
    const ghost = masksOver(line)
      .flatMap((mask) => [...mask.querySelectorAll("path")])
      .find((p) => p.getAttribute("d") === d);
    expect(ghost?.getAttribute("stroke")).toBe("none");
    for (const end of ["marker-start", "marker-end"]) {
      const id = /^url\(#(.+)\)$/.exec(ghost?.getAttribute(end) ?? "")?.[1];
      const body = dom.querySelector(`marker[id="${id}"] path`);
      expect(body && isHole(body), end).toBe(true);
      // its outline stays white: the head's own stroke is not cut
      expect(body?.getAttribute("stroke")?.toLowerCase(), end).toMatch(/^(#fff|#ffffff|white)$/);
    }
  });

  it("a hollow ring of a crow's foot stays open the same way", () => {
    const line = dom.querySelector(`[data-edge="${edgeLabelled("reads").id}"] path.edge`);
    if (!line) throw new Error("no line");
    const rings = masksOver(line)
      .flatMap((mask) => [...mask.querySelectorAll("path")])
      .flatMap((p) => ["marker-start", "marker-end"].map((end) => p.getAttribute(end)))
      .map((ref) => /^url\(#(.+)\)$/.exec(ref ?? "")?.[1])
      .flatMap((id) => [...dom.querySelectorAll(`marker[id="${id}"] circle`)]);
    expect(rings.length).toBe(2);
    for (const ring of rings) expect(isHole(ring)).toBe(true);
  });

  it("a step badge's ring is cut out of the tile it sits on — and the badge is not", () => {
    const api = node("api");
    const b = nodeBounds(api);
    const badge = nodeDecorLayout(api, b.width, b.height)?.badge;
    if (badge?.kind !== "step") throw new Error("api should carry a step badge");
    const group = dom.querySelector('[data-node="api"]');
    const tile = [...(group?.querySelectorAll("*") ?? [])].find(
      (el) => el.getAttribute("fill") === DARK_COLOR_TOKENS.ink.fill,
    );
    if (!tile) throw new Error("no ink tile");
    const r = badge.r + DECOR.stepRing;
    expect(holesOver(tile).some((hole) => isCircleAt(hole, badge.cx, badge.cy, r))).toBe(true);
    const disc = [...(group?.querySelectorAll("circle") ?? [])].find(
      (c) => c.getAttribute("fill") === SURFACE_DARK.ink,
    );
    if (!disc) throw new Error("no badge disc");
    expect(holesOver(disc).some((hole) => isCircleAt(hole, badge.cx, badge.cy, r))).toBe(false);
  });

  it("a frame's title and its step badge cut its dashed border — the title is not cut", () => {
    const vpc = node("vpc");
    const b = nodeBounds(vpc);
    const label = nodeLabelLayout(vpc, b.width, b.height);
    if (!label) throw new Error("no frame title");
    const title = labelBox(label);
    const box = {
      x: title.x - BORDER_TITLE.padX,
      y: -BORDER_TITLE.height / 2,
      width: title.width + BORDER_TITLE.padX * 2,
      height: BORDER_TITLE.height,
    };
    const outline = dom.querySelector('[data-node="vpc"] rect[stroke-dasharray]');
    if (!outline) throw new Error("no frame outline");
    const holes = holesOver(outline);
    expect(holes.some((hole) => isRectAt(hole, box))).toBe(true);
    const badge = frameBadgeLayout(vpc, b.width, b.height);
    if (badge?.kind !== "step") throw new Error("vpc should carry a step badge");
    expect(
      holes.some((hole) => isCircleAt(hole, badge.cx, badge.cy, badge.r + DECOR.stepRing)),
    ).toBe(true);
    const text = [...dom.querySelectorAll('[data-node="vpc"] text')].find(
      (t) => t.textContent === "vpc",
    );
    if (!text) throw new Error("no title text");
    expect(holesOver(text).some((hole) => isRectAt(hole, box))).toBe(false);
  });

  it("a fragment's operator cuts its dashed border — the operator is not cut", () => {
    const outline = dom.querySelector('[data-node="alt"] rect[stroke-dasharray]');
    if (!outline) throw new Error("no fragment outline");
    const isTab = (hole: Element) =>
      hole.localName === "rect" &&
      near(hole.getAttribute("x"), BORDER_TITLE.inset) &&
      near(hole.getAttribute("y"), -BORDER_TITLE.height / 2) &&
      near(hole.getAttribute("height"), BORDER_TITLE.height);
    const tab = holesOver(outline).find(isTab);
    expect(Number(tab?.getAttribute("width"))).toBeGreaterThan(0);
    const operator = [...dom.querySelectorAll('[data-node="alt"] text')].find(
      (t) => t.textContent === "alt",
    );
    if (!operator) throw new Error("no operator");
    expect(holesOver(operator).some(isTab)).toBe(false);
  });

  it("every mask the drawing names is in it, and no id is named twice", () => {
    const ids = [...dom.querySelectorAll("[id]")].map((el) => el.getAttribute("id"));
    expect(new Set(ids).size).toBe(ids.length);
    for (const el of dom.querySelectorAll("[mask]")) {
      expect(masksOver(el).length, el.getAttribute("mask") ?? "").toBeGreaterThan(0);
    }
  });

  it("theme auto still pairs the light and dark drawings — the masks are the same in both", () => {
    const auto = renderVectorSvg(doc, { theme: "auto", background: false });
    expect(auto).toContain("<style");
    const light = renderVectorSvg(doc, { theme: "light", background: false });
    expect(parse(auto).querySelectorAll("mask").length).toBe(
      parse(light).querySelectorAll("mask").length,
    );
  });

  it("a line with one hollow end cuts only that end — the filled head is drawn whole", () => {
    const edge = doc.edges.find((e) => e.id === "owns");
    if (!edge) throw new Error("no edge owns");
    const line = dom.querySelector('[data-edge="owns"] path.edge');
    if (!line) throw new Error("no line");
    const d = layoutEdge(edge, doc.nodes, { edges: doc.edges })?.d;
    const ghost = masksOver(line)
      .flatMap((mask) => [...mask.querySelectorAll("path")])
      .find((p) => p.getAttribute("d") === d);
    expect(ghost?.getAttribute("marker-start")).toBeTruthy();
    expect(ghost?.hasAttribute("marker-end")).toBe(false);
    const arrow = /^url\(#(.+)\)$/.exec(line.getAttribute("marker-end") ?? "")?.[1];
    const head = dom.querySelector(`marker[id="${arrow}"] path`);
    expect(head?.getAttribute("fill")).not.toBe("none");
  });

  it("a hollow head's hole is one marker per shape and size, however many lines carry it", () => {
    // `calls` and `owns` both start with an aggregation diamond
    const holes = [...dom.querySelectorAll("mask marker")].filter((m) =>
      [...m.querySelectorAll("path")].some((p) => p.getAttribute("d")?.startsWith("M 5 1.2")),
    );
    expect(holes.length).toBe(1);
  });

  it("a self-message's hollow head is cut too", () => {
    const edge = edgeLabelled("retry");
    const line = dom.querySelector(`[data-edge="${edge.id}"] path.edge`);
    if (!line) throw new Error("no line");
    const d = layoutEdge(edge, doc.nodes, { edges: doc.edges })?.d;
    const ghost = masksOver(line)
      .flatMap((mask) => [...mask.querySelectorAll("path")])
      .find((p) => p.getAttribute("d") === d);
    const id = /^url\(#(.+)\)$/.exec(ghost?.getAttribute("marker-end") ?? "")?.[1];
    const body = dom.querySelector(`marker[id="${id}"] path`);
    expect(body && isHole(body)).toBe(true);
  });

  it("each part carries its own masks — no mask is on a group round several parts, which Chrome blurs drawn inline", () => {
    const translucent = cuttersDoc();
    for (const edge of translucent.edges) {
      if (edge.id === "calls" && edge.data) edge.data.opacity = 0.6;
    }
    const page = parse(renderVectorSvg(translucent, { theme: "dark", background: false }));
    expect(page.querySelector('[data-edge="calls"] path.edge')?.getAttribute("opacity")).toBe(
      "0.6",
    );
    const masked = [...page.querySelectorAll("[mask]")];
    expect(masked.length).toBeGreaterThan(0);
    for (const group of masked) {
      const parts = [...group.children].filter((el) => el.localName !== "mask");
      expect(parts.length, group.getAttribute("mask") ?? "").toBeLessThanOrEqual(1);
    }
    // nor is a mask over another: one hole set per part (below the label layer, every label's)
    for (const group of masked) {
      let above = group.parentElement;
      while (above && !above.hasAttribute("mask")) above = above.parentElement;
      // a node's own mask may sit inside a page mask — it cuts only that node's drawing
      if (above)
        expect(group.closest("[data-node]"), group.getAttribute("mask") ?? "").not.toBeNull();
    }
  });

  it("the in-chat view's allow-list keeps the masks", () => {
    const safe = parseSafeSvg(svg, document);
    if (!safe) throw new Error("the view refused the drawing");
    expect(safe.querySelectorAll("mask").length).toBe(dom.querySelectorAll("mask").length);
    expect(safe.querySelectorAll("[mask]").length).toBe(dom.querySelectorAll("[mask]").length);
  });
});

describe("Ids on no background (#255)", () => {
  it("a drawing with nothing to cut has no mask", () => {
    const n = (id: string, x: number) => ({
      op: "add_node",
      node: { id, label: id, shape: "rect", x, y: 0 },
    });
    useDiagramStore.getState().loadDoc({ version: 1, title: "", nodes: [], edges: [] }, null);
    useDiagramStore
      .getState()
      .applyOps(
        [
          n("a", 0),
          n("b", 300),
          { op: "add_edge", edge: { id: "ab", source: "a", target: "b" } },
        ] as never,
        true,
      );
    const svg = renderVectorSvg(useDiagramStore.getState().toDoc(), { background: false });
    expect(svg).not.toContain("<mask");
    expect(svg).not.toContain(" mask=");
  });

  it("an agent's ids with brackets and quotes still find every mask and marker (#152)", () => {
    const doc = cuttersDoc();
    for (const node of doc.nodes) node.id = `${node.id}")%20url(#x`;
    for (const edge of doc.edges) {
      edge.id = `${edge.id}")%20url(#x`;
      edge.source = `${edge.source}")%20url(#x`;
      edge.target = `${edge.target}")%20url(#x`;
    }
    const dom = parse(renderVectorSvg(doc, { background: false }));
    const refs = [...dom.querySelectorAll("[mask], [marker-start], [marker-end]")].flatMap((el) =>
      ["mask", "marker-start", "marker-end"]
        .map((name) => el.getAttribute(name))
        .filter((ref): ref is string => ref !== null),
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const id = /^url\(#(.+)\)$/.exec(ref)?.[1];
      expect(id && dom.querySelector(`[id="${id}"]`), ref).toBeTruthy();
    }
  });

  it("two drawings inline on one page name no id in common — one's masks would cut the other", () => {
    const ids = (svg: string) => [...parse(svg).querySelectorAll("[id]")].map((el) => el.id);
    const first = ids(renderVectorSvg(cuttersDoc(), { background: false }));
    const other = cuttersDoc();
    other.title = "Another";
    const second = ids(renderVectorSvg(other, { background: false }));
    expect(first.filter((id) => second.includes(id))).toEqual([]);
  });

  it("the light and dark drawings of one document name the same ids — so the two pair", () => {
    const doc = cuttersDoc();
    const ids = (svg: string) => [...parse(svg).querySelectorAll("[id]")].map((el) => el.id);
    expect(ids(renderVectorSvg(doc, { theme: "dark", background: false }))).toEqual(
      ids(renderVectorSvg(doc, { theme: "light", background: false })),
    );
  });
});
