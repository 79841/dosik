import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { ICON_PATHS } from "../../../shared/lib/icons";
import { DECOR } from "../../../shared/lib/nodeDecor";
import { COLOR_TOKENS } from "../../../shared/lib/palette";
import { createShapeNode } from "../../../shared/lib/store/nodeFactory";
import type { DiagramNode } from "../../../shared/lib/types";
import { textWidth } from "../../../shared/lib/textLayout";
import {
  NODE_LABEL,
  nodeDecorLayout,
  nodeLabelLayout,
  type TagLayout,
} from "../../../shared/lib/nodeLayout";
import { renderVectorSvg } from "../vectorSvg";

const box = (extra: Partial<DiagramNode["data"]>, shape: DiagramNode["data"]["shape"] = "rect") => {
  const node = createShapeNode(shape, { x: 0, y: 0 }, { label: "Orders" });
  return { ...node, data: { ...node.data, ...extra } } as DiagramNode;
};

describe("Box decoration layout — the same numbers as the canvas (#160, Studio #210)", () => {
  const source = readFileSync(join(__dirname, "../../canvas/ShapeNode.tsx"), "utf8");

  it("ShapeNode's classes and the DECOR constants are tied together", () => {
    // description text-[11px] leading-snug + gap-0.5 + opacity-65; icon above
    // h-6 w-6 + mb-1 (6px to the label with the gap), beside h-[18px] w-[18px] + gap-1.5;
    // tag 9.5px · 600 · uppercase, 15px tall, placed by `tagOrigin` (inline right/top);
    // step: a 20px circle in a 2px ring (24px), placed by `stepAnchor` (inline left/top)
    expect(source).toContain("flex w-full flex-col gap-0.5");
    expect(source).toContain("text-[11px] font-normal leading-snug");
    expect(source).toContain("opacity-65");
    expect(source).toContain('className="mb-1 h-6 w-6 shrink-0"');
    expect(source).toContain('className="h-[18px] w-[18px] shrink-0"');
    expect(source).toContain("flex w-full items-center gap-1.5");
    expect(source).toContain(
      "pointer-events-auto absolute z-10 inline-flex h-[15px] items-center whitespace-nowrap rounded-[3px] px-[5px] text-[9.5px] font-semibold uppercase leading-none",
    );
    expect(source).toContain(
      "pointer-events-auto absolute z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-bold leading-none",
    );
    expect(DECOR).toMatchObject({
      descriptionFontSize: 11,
      descriptionLineHeight: 11 * 1.375,
      descriptionGap: 2,
      descriptionOpacity: 0.65,
      // a touch larger than the mockup's 20/16
      iconSize: 24,
      iconSizeInline: 18,
      iconGap: 6,
      iconAboveMinHeight: 64,
      tagFontSize: 9.5,
      tagPadX: 5,
      tagHeight: 15,
      tagInset: 7,
      tagRadius: 3,
      stepRadius: 10,
      stepFontSize: 11,
      // h-6 w-6 border-2: the 20px circle and its 2px ring
      stepRing: 2,
    });
  });

  it("Without decoration nothing changes — the label layout stays as is", () => {
    expect(nodeDecorLayout(box({}), 160, 56)).toBeNull();
  });

  it("At 64px or more the icon sits above the label and the group is centered in the box", () => {
    const d = nodeDecorLayout(box({ icon: "database" }), 160, 80)!;
    const total = DECOR.iconSize + DECOR.iconGap + NODE_LABEL.lineHeight;
    const top = 40 - total / 2;
    expect(d.icon).toMatchObject({ id: "database", size: DECOR.iconSize });
    expect(d.icon?.x).toBeCloseTo(80 - DECOR.iconSize / 2, 5);
    expect(d.icon?.y).toBeCloseTo(top, 5);
    expect(d.label?.centerY).toBeCloseTo(
      top + DECOR.iconSize + DECOR.iconGap + NODE_LABEL.lineHeight / 2,
      5,
    );
    expect(d.label?.anchor).toBe("middle");
  });

  it("Below 64px the icon sits left of the label — the two centered on one line", () => {
    const d = nodeDecorLayout(box({ icon: "database" }), 160, 56)!;
    const rowW = DECOR.iconSizeInline + DECOR.iconGap + textWidth("Orders", NODE_LABEL.fontSize);
    const left = 80 - rowW / 2;
    expect(d.icon).toMatchObject({ size: DECOR.iconSizeInline });
    expect(d.icon?.x).toBeCloseTo(left, 5);
    expect(d.icon?.y).toBeCloseTo(28 - DECOR.iconSizeInline / 2, 5);
    expect(d.label?.x).toBeCloseTo(left + DECOR.iconSizeInline + DECOR.iconGap, 5);
    expect(d.label?.anchor).toBe("start");
    expect(d.label?.centerY).toBeCloseTo(28, 5);
  });

  it("The description sits below the label and the group is centered in the box", () => {
    const d = nodeDecorLayout(box({ description: "Postgres" }), 160, 80)!;
    const total = NODE_LABEL.lineHeight + DECOR.descriptionGap + DECOR.descriptionLineHeight;
    const top = 40 - total / 2;
    expect(d.label?.centerY).toBeCloseTo(top + NODE_LABEL.lineHeight / 2, 5);
    expect(d.description?.centerY).toBeCloseTo(
      top + NODE_LABEL.lineHeight + DECOR.descriptionGap + DECOR.descriptionLineHeight / 2,
      5,
    );
    expect(d.description?.fontSize).toBe(11);
  });

  it("A badge is an uppercase tag inside the top-left — the label layout matches the undecorated one", () => {
    const node = box({ badge: "v2" });
    const d = nodeDecorLayout(node, 160, 80)!;
    const textW = textWidth("V2", DECOR.tagFontSize);
    expect(d.badge).toMatchObject({ kind: "tag", text: "V2", height: DECOR.tagHeight });
    const tag = d.badge as TagLayout;
    expect(tag.width).toBeCloseTo(textW + DECOR.tagPadX * 2, 5);
    expect(tag.x).toBe(DECOR.tagInset);
    expect(tag.y).toBe(DECOR.tagInset);
    expect(d.label).toEqual(nodeLabelLayout(node, 160, 80));
  });

  it("A number badge is a numbered circle hung on the top-right corner", () => {
    const d = nodeDecorLayout(box({ badge: "2" }), 160, 56)!;
    expect(d.badge).toMatchObject({ kind: "step", text: "2", cx: 160, cy: 0, r: DECOR.stepRadius });
  });

  it("Below 64px with a description, it goes under the icon and label row — the group is centered in the box", () => {
    const d = nodeDecorLayout(box({ icon: "database", description: "pg" }), 160, 56)!;
    const rowH = Math.max(DECOR.iconSizeInline, NODE_LABEL.lineHeight);
    const top = 28 - (rowH + DECOR.descriptionGap + DECOR.descriptionLineHeight) / 2;
    expect(d.label?.centerY).toBeCloseTo(top + rowH / 2, 5);
    expect(d.description).toMatchObject({ x: 80, anchor: "middle" });
    expect(d.description?.centerY).toBeCloseTo(
      top + rowH + DECOR.descriptionGap + DECOR.descriptionLineHeight / 2,
      5,
    );
  });

  it("An icon without a label sits alone in the center of the box — small or large", () => {
    const small = nodeDecorLayout(box({ label: "", icon: "cloud" }), 160, 56)!;
    expect(small.label).toBeNull();
    expect(small.icon?.x).toBeCloseTo(80 - DECOR.iconSizeInline / 2, 5);
    expect(small.icon?.y).toBeCloseTo(28 - DECOR.iconSizeInline / 2, 5);
    const big = nodeDecorLayout(box({ label: "", icon: "cloud" }), 160, 80)!;
    expect(big.label).toBeNull();
    // the icon's mb-1 is all that follows it: 20 + 4, centred
    expect(big.icon?.y).toBeCloseTo(40 - (DECOR.iconSize + 4) / 2, 5);
  });

  it("The icon row of a short sticky note also starts at the top left", () => {
    const d = nodeDecorLayout(box({ icon: "cloud", description: "note" }, "sticky"), 170, 56)!;
    expect(d.icon).toMatchObject({ x: 12, size: DECOR.iconSizeInline });
    expect(d.label?.x).toBe(12 + DECOR.iconSizeInline + DECOR.iconGap);
    expect(d.description).toMatchObject({ x: 12, anchor: "start" });
  });

  it("A sticky note starts at the top left", () => {
    const d = nodeDecorLayout(box({ icon: "cloud", description: "note" }, "sticky"), 170, 120)!;
    expect(d.label?.x).toBe(12);
    expect(d.label?.anchor).toBe("start");
    expect(d.description?.x).toBe(12);
    expect(d.icon?.x).toBe(12);
  });

  it("Vector SVG draws the icon, description and badge, and the viewBox contains the number circle", () => {
    const node = box({ icon: "database", description: "Postgres 16", badge: "3" });
    const svg = renderVectorSvg(makeDoc([node], []));
    const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
    const text = dom.documentElement.textContent ?? "";
    expect(text).toContain("Orders");
    expect(text).toContain("Postgres 16");
    expect(text).toContain("3");
    expect(dom.querySelector(`circle[r="${DECOR.stepRadius}"]`)).not.toBeNull();
    expect(svg).toContain(`opacity="${DECOR.descriptionOpacity}"`);
    const [, vy] = (dom.documentElement.getAttribute("viewBox") ?? "").split(" ").map(Number);
    // the step circle hangs 10px above the box at (0,0)
    expect(vy).toBeLessThanOrEqual(-DECOR.stepRadius);
  });
});

describe("Icons in vector SVG (#210)", () => {
  it("Draws the icon in the deep tone of the node color", () => {
    const node = box({ icon: "database", color: "blue" });
    const svg = renderVectorSvg(makeDoc([node], []));
    const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
    const glyph = [...dom.querySelectorAll("g")].find(
      (g) => g.getAttribute("stroke") === COLOR_TOKENS.blue.stroke && g.querySelector("path"),
    );
    expect(glyph?.querySelectorAll("path")).toHaveLength(ICON_PATHS.database.length);
  });
});

describe("Decoration in exports (#160)", () => {
  it("Mermaid: the description goes on the line after label [badge]", async () => {
    const { toMermaid } = await import("../markdown");
    const node = box({ badge: "v2", description: "Postgres 16" });
    const out = toMermaid(makeDoc([node], []));
    expect(out).toContain('["Orders [v2]<br/>Postgres 16"]');
  });

  it("Mermaid: a box's icon is also kept as a comment, like an icon node", async () => {
    const { toMermaid } = await import("../markdown");
    expect(toMermaid(makeDoc([box({ icon: "database" })], []))).toContain("%% icon: database");
  });
});
