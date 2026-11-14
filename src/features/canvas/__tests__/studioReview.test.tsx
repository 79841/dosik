import { ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DECOR, stepAnchor, tagOrigin, tagWidth } from "../../../shared/lib/nodeDecor";
import {
  BODY_TEXT_WEIGHT,
  contentLift,
  frameTitleRight,
  NODE_LABEL,
  TEXT_SHAPE_SIZE,
} from "../../../shared/lib/nodeLayout";
import {
  BORDER_TITLE,
  THEME_CANVAS_BG,
  THEME_COLOR_TOKENS,
  THEME_INK,
} from "../../../shared/lib/palette";
import type { DiagramNode } from "../../../shared/lib/types";
import { ShapePreview } from "../../palette/ShapePreview";
import { ShapeNode } from "../ShapeNode";

const renderNode = (data: Partial<DiagramNode["data"]>, width = 160, height = 84) =>
  render(
    <ReactFlowProvider>
      {/* @ts-expect-error passes only what ShapeNode reads, not all of NodeProps */}
      <ShapeNode
        id="n1"
        selected={false}
        width={width}
        height={height}
        data={{ label: "Orders", shape: "rect", color: "mono", ...data }}
      />
    </ReactFlowProvider>,
  ).container;

/** the inline style as written — jsdom drops `var()` colours from `style.color` */
const styleOf = (el: Element | null | undefined) => el?.getAttribute("style") ?? "";
const labelOf = (c: Element, text: string) =>
  [...c.querySelectorAll("span")].find((s) => s.textContent === text);

describe("faceless shapes on the canvas (#210)", () => {
  it("an ink icon node's label is the page's ink, not ink's white", () => {
    const c = renderNode({ shape: "icon", icon: "server", color: "ink", label: "Server" }, 96, 96);
    expect(styleOf(labelOf(c, "Server"))).toContain(THEME_INK);
  });

  it("a coloured text shape is drawn in its colour", () => {
    const c = renderNode({ shape: "text", color: "rose", label: "Careful" }, 160, 40);
    expect(styleOf(labelOf(c, "Careful"))).toContain(THEME_COLOR_TOKENS.rose.stroke);
  });
});

describe("badges on the canvas (#210)", () => {
  const stepOf = (c: Element) => c.querySelector("span.rounded-full");
  const tagOf = (c: Element) => c.querySelector("span.uppercase");
  const ring = DECOR.stepRadius + DECOR.stepRing;

  it("a step circle wears a canvas-coloured ring — a border, which a capture keeps round", () => {
    const step = stepOf(renderNode({ badge: "2", color: "ink" }));
    expect(step?.className).toContain("border-2");
    expect(step?.className).toContain("h-6 w-6");
    expect(styleOf(step)).toContain(`border-color: ${THEME_CANVAS_BG}`);
    expect(styleOf(step)).not.toContain("box-shadow");
  });

  it("a step circle is centred on the shape's outline anchor", () => {
    const { x, y } = stepAnchor("diamond", 160, 80);
    const style = styleOf(stepOf(renderNode({ badge: "2", shape: "diamond" }, 160, 80)));
    expect(style).toContain(`left: ${x - ring}px`);
    expect(style).toContain(`top: ${y - ring}px`);
  });

  it("a box's tag sits inside its top-left corner at any height", () => {
    for (const h of [56, 84]) {
      const style = styleOf(tagOf(renderNode({ badge: "beta" }, 160, h)));
      expect(style).toContain(`left: ${DECOR.tagInset}px`);
      expect(style).toContain(`top: ${DECOR.tagInset}px`);
    }
  });

  it("a diamond's tag sits where tagOrigin puts it, inside the silhouette", () => {
    const { x, y } = tagOrigin("diamond", 160, 80, tagWidth("beta"));
    const style = styleOf(tagOf(renderNode({ badge: "beta", shape: "diamond" }, 160, 80)));
    expect(style).toContain(`left: ${Math.round(x * 100) / 100}px`);
    expect(style).toContain(`top: ${y}px`);
  });

  it("a frame's step circle and tag ride its top border", () => {
    const step = stepOf(renderNode({ shape: "frame", badge: "1", label: "VPC" }, 400, 300));
    expect(styleOf(step)).toContain(`left: ${400 - ring}px`);
    const tag = tagOf(renderNode({ shape: "frame", badge: "edge", label: "VPC" }, 400, 300));
    expect(styleOf(tag)).toContain(`right: ${BORDER_TITLE.inset}px`);
    expect(styleOf(tag)).toContain(`top: ${-DECOR.tagHeight / 2}px`);
  });

  it("a label running under the tag moves down past it, as in the exports", () => {
    const lifted = (data: Partial<DiagramNode["data"]>, w: number, h: number) => {
      const lift = contentLift({ data: { shape: "rect", color: "mono", ...data } as never }, w, h);
      expect(lift, String(data.shape)).toBeGreaterThan(0);
      const band = labelOf(renderNode(data, w, h), String(data.label))?.parentElement;
      return { lift, style: styleOf(band) };
    };
    // centred content moves half its extra top padding, a sticky's all of it,
    // a cylinder's band starts under its lid
    const rect = lifted({ badge: "beta", label: "Checkout service" }, 160, 56);
    expect(rect.style).toContain(`padding-top: ${rect.lift * 2}px`);
    const sticky = lifted({ shape: "sticky", badge: "beta", label: "Retry after 30s" }, 170, 96);
    expect(sticky.style).toContain(`padding-top: ${12 + sticky.lift}px`);
    const drum = lifted({ shape: "cylinder", badge: "beta", label: "Orders DB" }, 130, 90);
    expect(drum.style).toContain(`padding-top: ${16 + drum.lift * 2}px`);
  });
});

describe("label type on the canvas — what the vector SVG mirrors (#210 D5)", () => {
  const classOf = (data: Partial<DiagramNode["data"]>, text: string) =>
    labelOf(renderNode({ ...data, label: text }, 160, 84), text)?.className ?? "";

  it("a shape's label is a small bold title: 12px · 600, as NODE_LABEL", () => {
    expect(NODE_LABEL).toMatchObject({ fontSize: 12, fontWeight: 600 });
    const cls = classOf({ shape: "rect" }, "Orders");
    expect(cls).toContain("text-[12px]");
    expect(cls).toContain("font-semibold");
    expect(cls).toContain("leading-snug");
  });

  it("a sticky note and the text shape are body text: 400, the text shape 13px", () => {
    expect(BODY_TEXT_WEIGHT).toBe(400);
    expect(classOf({ shape: "sticky" }, "Note")).toContain("font-normal");
    const text = classOf({ shape: "text" }, "Words");
    expect(text).toContain("font-normal");
    expect(text).toContain(`text-[${TEXT_SHAPE_SIZE}px]`);
  });
});

describe("titles and thumbnails (#210)", () => {
  it("a frame's title stays on one line, cut with an ellipsis — as the exports cut it", () => {
    const title = labelOf(renderNode({ shape: "frame", label: "VPC" }, 400, 300), "VPC");
    expect(title?.className).toContain("whitespace-nowrap");
    expect(title?.className).toContain("text-ellipsis");
    // two white-space classes would leave the winner to stylesheet order
    expect(title?.className).not.toContain("whitespace-pre-wrap");
  });

  it("a frame's title band stops the same inset short of the right edge — and short of a tag", () => {
    const band = (badge?: string) =>
      labelOf(renderNode({ shape: "frame", label: "VPC", badge }, 400, 300), "VPC")?.parentElement;
    expect(styleOf(band())).toContain(`right: ${BORDER_TITLE.inset}px`);
    expect(styleOf(band("edge"))).toContain(
      `right: ${frameTitleRight({ shape: "frame", badge: "edge" })}px`,
    );
  });

  it("a box's icon takes the tile's glyph colour, which dark keeps (#216)", () => {
    const strokes = [
      ...renderNode({ color: "blue", icon: "database" }).querySelectorAll("[stroke]"),
    ].map((el) => el.getAttribute("stroke"));
    expect(strokes).toContain(THEME_COLOR_TOKENS.blue.glyph);
    expect(strokes).not.toContain(THEME_COLOR_TOKENS.blue.stroke);
  });

  it("the text shape's thumbnail is the page's ink — it sits on the panel, not on a tile (#216)", () => {
    const { container } = render(<ShapePreview shape="text" />);
    expect(container.querySelector("span")?.getAttribute("style")).toContain(`color: ${THEME_INK}`);
  });

  it("palette thumbnails draw the shape a step darker so it reads on the panel", () => {
    const { container } = render(<ShapePreview shape="rect" />);
    expect(container.querySelector("rect")?.getAttribute("fill")).toBe(
      THEME_COLOR_TOKENS.mono.line,
    );
  });
});
