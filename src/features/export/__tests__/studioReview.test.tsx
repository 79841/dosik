import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { DECOR, tagOrigin } from "../../../shared/lib/nodeDecor";
import { BORDER_TITLE, COLOR_TOKENS, SURFACE_LIGHT } from "../../../shared/lib/palette";
import { createShapeNode } from "../../../shared/lib/store/nodeFactory";
import { textWidth } from "../../../shared/lib/textLayout";
import type { DiagramNode, ShapeKind } from "../../../shared/lib/types";
import { cardHeaderPath, ClassSvg } from "../../canvas/ClassSvg";
import { ShapeSvg } from "../../canvas/ShapeSvg";
import { badgeBox, badgeLayout, nodeLabelLayout } from "../../../shared/lib/nodeLayout";
import { renderVectorSvg } from "../vectorSvg";

const node = (
  id: string,
  shape: ShapeKind,
  data: Partial<DiagramNode["data"]>,
  width = 160,
  height = 80,
): DiagramNode => {
  const n = createShapeNode(shape, { x: 0, y: 0 }, { id, label: "Server", width, height });
  return { ...n, data: { ...n.data, ...data } } as DiagramNode;
};

const svgOf = (...nodes: DiagramNode[]) =>
  new DOMParser().parseFromString(renderVectorSvg(makeDoc(nodes, [])), "image/svg+xml");

describe("faceless shapes stay visible in every colour (#210)", () => {
  it("an ink icon node draws its glyph in ink's line and its label in the page's ink", () => {
    const dom = svgOf(node("i", "icon", { icon: "server", color: "ink" }, 96, 96));
    const g = dom.querySelector('[data-node="i"]')!;
    const strokes = [...g.querySelectorAll("[stroke]")].map((e) => e.getAttribute("stroke"));
    expect(strokes).toContain(COLOR_TOKENS.ink.line);
    expect(strokes).not.toContain(COLOR_TOKENS.ink.stroke);
    expect(g.querySelector("text")?.getAttribute("fill")).toBe(SURFACE_LIGHT.ink);
  });

  it("a coloured text shape keeps its colour; an ink one is not white on the canvas", () => {
    const dom = svgOf(
      node("rose", "text", { color: "rose" }, 160, 40),
      node("ink", "text", { color: "ink" }, 160, 40),
      node("mono", "text", { color: "mono" }, 160, 40),
    );
    const fill = (id: string) =>
      dom.querySelector(`[data-node="${id}"] text`)?.getAttribute("fill");
    expect(fill("rose")).toBe(COLOR_TOKENS.rose.stroke);
    expect(fill("ink")).toBe(COLOR_TOKENS.ink.line);
    expect(fill("mono")).toBe(SURFACE_LIGHT.ink);
  });

  it("an image that lost its picture keeps a visible dashed frame in ink", () => {
    const dom = svgOf(node("img", "image", { color: "ink", src: undefined }));
    expect(dom.querySelector('[data-node="img"] rect')?.getAttribute("stroke")).toBe(
      COLOR_TOKENS.ink.line,
    );
  });
});

describe("badges (#210)", () => {
  it("a step circle wears a canvas-coloured ring — it reads on an ink tile too", () => {
    const dom = svgOf(node("s", "rect", { badge: "2", color: "ink" }));
    const circles = [...dom.querySelectorAll('[data-node="s"] circle')];
    expect(circles).toHaveLength(2);
    expect(circles[0]?.getAttribute("r")).toBe(String(DECOR.stepRadius + DECOR.stepRing));
    expect(circles[0]?.getAttribute("fill")).toBe(SURFACE_LIGHT.canvasBg);
    expect(circles[1]?.getAttribute("r")).toBe(String(DECOR.stepRadius));
    expect(circles[1]?.getAttribute("fill")).toBe(SURFACE_LIGHT.ink);
  });

  it("the file keeps the whole ring", () => {
    const step = badgeLayout("2", "rect", 160, 80);
    const r = DECOR.stepRadius + DECOR.stepRing;
    expect(badgeBox(step)).toEqual({ x: 160 - r, y: -r, width: r * 2, height: r * 2 });
  });

  it("a diamond's step circle sits on its outline", () => {
    expect(badgeLayout("2", "diamond", 160, 80)).toMatchObject({ kind: "step", cx: 120, cy: 20 });
  });

  it("a box's tag sits inside its top-left corner, short or tall", () => {
    const width = textWidth("BETA", DECOR.tagFontSize) + DECOR.tagPadX * 2;
    for (const h of [56, 80]) {
      expect(badgeLayout("beta", "rect", 160, h)).toMatchObject({
        kind: "tag",
        x: DECOR.tagInset,
        y: DECOR.tagInset,
        width,
      });
    }
  });

  it("a diamond's tag sits where tagOrigin puts it", () => {
    const tag = badgeLayout("beta", "diamond", 160, 80);
    if (tag.kind !== "tag") throw new Error("expected a tag");
    expect({ x: tag.x, y: tag.y }).toEqual(tagOrigin("diamond", 160, 80, tag.width));
  });
});

describe("cards (#210)", () => {
  it("a header strip that reaches the bottom rounds its lower corners with the card", () => {
    const quads = (d: string) => d.match(/Q/g)?.length ?? 0;
    expect(quads(cardHeaderPath(200, 30, 120))).toBe(2);
    expect(quads(cardHeaderPath(200, 40, 40))).toBe(4);
  });

  it("the «stereotype» is the strip's own text, quietened — AA on every tint", () => {
    const { container } = render(
      <svg>
        <ClassSvg
          width={200}
          height={80}
          fill="#EEE9F8"
          body="#FFFFFF"
          border="#E2DFDA"
          text="#1A1918"
          ink="#1A1918"
          muted="#6F6C67"
          name="OrderService"
          stereotype="service"
          attributes={["- repo: Repo"]}
        />
      </svg>,
    );
    const stereo = [...container.querySelectorAll("text")].find((t) =>
      t.textContent?.includes("«service»"),
    );
    expect(stereo?.getAttribute("fill")).toBe("#1A1918");
    expect(stereo?.getAttribute("opacity")).toBe(String(DECOR.descriptionOpacity));
  });

  it("a member row keeps the space after its visibility mark in every renderer", () => {
    const { container } = render(
      <svg>
        <ClassSvg
          width={200}
          height={80}
          fill="#EEE9F8"
          body="#FFFFFF"
          border="#E2DFDA"
          text="#1A1918"
          ink="#1A1918"
          muted="#6F6C67"
          name="A"
          attributes={["- repo: Repo"]}
        />
      </svg>,
    );
    const row = [...container.querySelectorAll("text")].find((t) =>
      t.textContent?.includes("repo"),
    );
    expect(row?.getAttribute("xml:space")).toBe("preserve");
  });
});

describe("tiles and titles (#210)", () => {
  it("a tile fills its whole box — a line's arrowhead meets it with no gap", () => {
    const { container } = render(
      <svg>
        <ShapeSvg shape="rect" width={160} height={80} fill="#EEE" cap="#DDD" stroke="#333" />
      </svg>,
    );
    const rect = container.querySelector("rect")!;
    // no x/y: the tile starts at the box's corner
    expect(Number(rect.getAttribute("x") ?? 0)).toBe(0);
    expect(Number(rect.getAttribute("y") ?? 0)).toBe(0);
    expect(rect.getAttribute("width")).toBe("160");
  });

  it("a frame title leaves the same inset at the right as at the left, as on the canvas", () => {
    const f = node("f", "frame", { label: "x".repeat(200) }, 400, 300);
    const room = 400 - BORDER_TITLE.inset * 2 - BORDER_TITLE.padX * 2;
    const line = nodeLabelLayout(f, 400, 300)!.lines[0]!;
    expect(textWidth(line, BORDER_TITLE.fontSize)).toBeLessThanOrEqual(room);
    expect(textWidth(line, BORDER_TITLE.fontSize)).toBeGreaterThan(
      room - BORDER_TITLE.fontSize * 1.2,
    );
  });
});
