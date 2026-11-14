import { describe, expect, it } from "vitest";

import { DECOR, tagWidth } from "../nodeDecor";
import {
  badgeBox,
  badgeLayout,
  contentLift,
  frameTitleRight,
  labelBox,
  NODE_LABEL,
  nodeDecorLayout,
  nodeLabelLayout,
} from "../nodeLayout";
import { BORDER_TITLE } from "../palette";
import { createShapeNode } from "../store/nodeFactory";
import { textWidth } from "../textLayout";
import type { DiagramNode, ShapeKind } from "../types";

const node = (
  shape: ShapeKind,
  data: Partial<DiagramNode["data"]>,
  width = 160,
  height = 56,
): DiagramNode => {
  const n = createShapeNode(shape, { x: 0, y: 0 }, { label: "Checkout service", width, height });
  return { ...n, data: { ...n.data, ...data } } as DiagramNode;
};

/** the gap kept between a badge and the content it moves */
const GAP = 3;

describe("content moves down to clear its tag (#210)", () => {
  it("a label running under the tag of a short box moves down just past it", () => {
    const n = node("rect", { badge: "beta" });
    const lift = contentLift(n, 160, 56);
    const tag = badgeBox(badgeLayout("beta", "rect", 160, 56));
    // centred, the line would start at 28 - 16.5/2
    expect(lift).toBeCloseTo(tag.y + tag.height + GAP - (28 - NODE_LABEL.lineHeight / 2), 5);
    const label = nodeLabelLayout(n, 160, 56)!;
    expect(label.centerY).toBeCloseTo(28 + lift, 5);
    expect(labelBox(label).y).toBeCloseTo(tag.y + tag.height + GAP, 5);
  });

  it("only what runs under the badge counts — an icon beside it and a label below it stay put", () => {
    // 160×80: the icon sits centred over the label, clear of the corner tag,
    // and the label is far below the tag
    const n = node("rect", { badge: "beta", icon: "cloud" }, 160, 80);
    expect(contentLift(n, 160, 80)).toBe(0);
  });

  it("on a diamond the content moves only as far as the outline keeps it inside", () => {
    const n = node("diamond", { badge: "beta", label: "Checkout service" }, 140, 56);
    const label = nodeLabelLayout(n, 140, 56)!;
    const box = labelBox(label);
    // every line's lower corners stay inside |x-70|/70 + |y-28|/28 <= 1
    label.lines.forEach((line, i) => {
      const y = box.y + (i + 1) * label.lineHeight;
      const half = textWidth(line, label.fontSize) / 2;
      expect(Math.abs(half) / 70 + Math.abs(y - 28) / 28, line).toBeLessThanOrEqual(1);
    });
  });

  it("a short label clear of the tag stays centred", () => {
    const n = node("rect", { badge: "beta", label: "API" });
    expect(contentLift(n, 160, 56)).toBe(0);
    expect(nodeLabelLayout(n, 160, 56)!.centerY).toBe(28);
  });

  it("a tall box keeps its content centred — it already clears the tag", () => {
    expect(contentLift(node("rect", { badge: "beta" }), 160, 84)).toBe(0);
  });

  it("content that does not fit its shape even where it is stays there", () => {
    // three lines in a short diamond already cross its outline
    const n = node("diamond", { badge: "2", label: "Payment approved by bank?" }, 140, 70);
    expect(contentLift(n, 140, 70)).toBe(0);
  });

  it("no badge, or a step circle on the corner, moves nothing", () => {
    expect(contentLift(node("rect", {}), 160, 56)).toBe(0);
    expect(contentLift(node("rect", { badge: "2" }), 160, 56)).toBe(0);
  });

  it("a step circle that reaches into the label moves it too", () => {
    // a diamond's circle rides its top-right edge, near the first line
    const n = node("diamond", { badge: "2", label: "Payment approved?" }, 140, 90);
    expect(contentLift(n, 140, 90)).toBeGreaterThan(0);
  });

  it("the move stops where the box's bottom begins", () => {
    // two lines: room for part of the move only
    const two = node("rect", { badge: "beta", label: "Checkout service and more" }, 160, 56);
    const box = labelBox(nodeLabelLayout(two, 160, 56)!);
    expect(box.y + box.height).toBeCloseTo(56 - 4, 5);
    // three lines already fill the box: nothing moves
    const three = node("rect", { badge: "beta", label: "A label long enough to need three lines" });
    expect(contentLift(three, 160, 56)).toBe(0);
  });

  it("a box with nothing but its badge has nothing to move", () => {
    expect(contentLift(node("rect", { badge: "beta", label: "" }), 160, 56)).toBe(0);
  });

  it("a description alone under the label moves with it", () => {
    const n = node("rect", { badge: "beta", label: "Checkout service", description: "edge" });
    const lift = contentLift(n, 160, 56);
    expect(lift).toBeGreaterThan(0);
    const moved = nodeDecorLayout(n, 160, 56)!;
    const still = nodeDecorLayout({ ...n, data: { ...n.data, badge: undefined } }, 160, 56)!;
    expect(moved.icon).toBeNull();
    expect(moved.label!.centerY).toBeCloseTo(still.label!.centerY + lift, 5);
    expect(moved.description!.centerY).toBeCloseTo(still.description!.centerY + lift, 5);
  });

  it("a decorated box moves its icon, label and description together", () => {
    const n = node("rect", {
      badge: "beta",
      label: "Checkout",
      icon: "cloud",
      description: "edge",
    });
    const lift = contentLift(n, 160, 56);
    expect(lift).toBeGreaterThan(0);
    const moved = nodeDecorLayout(n, 160, 56)!;
    const still = nodeDecorLayout({ ...n, data: { ...n.data, badge: undefined } }, 160, 56)!;
    expect(moved.icon!.y).toBeCloseTo(still.icon!.y + lift, 5);
    expect(moved.label!.centerY).toBeCloseTo(still.label!.centerY + lift, 5);
    expect(moved.description!.centerY).toBeCloseTo(still.description!.centerY + lift, 5);
  });
});

describe("a frame's title leaves room for its tag (#210)", () => {
  it("the title band stops short of a tag set into the border", () => {
    expect(frameTitleRight({ shape: "frame", badge: undefined })).toBe(BORDER_TITLE.inset);
    expect(frameTitleRight({ shape: "frame", badge: "2" })).toBe(BORDER_TITLE.inset);
    // the title's patch reaches the tag: no stray dash between them
    expect(frameTitleRight({ shape: "frame", badge: "edge" })).toBe(
      BORDER_TITLE.inset + tagWidth("edge"),
    );
  });

  it("a long title is cut before the tag", () => {
    const f = node("frame", { label: "x".repeat(200), badge: "edge" }, 400, 300);
    const title = labelBox(nodeLabelLayout(f, 400, 300)!);
    const tag = badgeBox(badgeLayout("edge", "frame", 400, 300));
    expect(title.x + title.width).toBeLessThanOrEqual(tag.x - BORDER_TITLE.padX + 1e-9);
    expect(tag.height).toBe(DECOR.tagHeight);
  });
});
