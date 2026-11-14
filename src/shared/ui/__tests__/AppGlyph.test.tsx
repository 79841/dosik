import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppGlyph } from "../AppGlyph";

const glyph = (container: HTMLElement) => container.querySelector("svg") as SVGSVGElement;
const attrs = (el: Element) =>
  Object.fromEntries([...el.attributes].map((a) => [a.name, a.value] as const));

describe("AppGlyph — the app icon's four shapes as an outline icon (#231 D16, T1)", () => {
  it("Lucide style — 24 viewBox, no fill, text-colored stroke, round caps and joins, hidden from screen readers", () => {
    const { container } = render(<AppGlyph />);
    const svg = glyph(container);
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("fill", "none");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("stroke-linecap", "round");
    expect(svg).toHaveAttribute("stroke-linejoin", "round");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // defaults: Lucide's 24 and the chrome's 1.75
    expect(svg).toHaveAttribute("width", "24");
    expect(svg).toHaveAttribute("height", "24");
    expect(svg).toHaveAttribute("stroke-width", "1.75");
  });

  it("Four shapes — square top left, quarter circle top right, circle bottom left, diamond bottom right (as in parts/app-glyph.svg)", () => {
    const { container } = render(<AppGlyph />);
    const shapes = [...glyph(container).children];
    expect(shapes.map((s) => s.tagName.toLowerCase())).toEqual(["rect", "path", "circle", "path"]);
    expect(shapes.map(attrs)).toEqual([
      { x: "3", y: "3", width: "7.25", height: "7.25", rx: "1.25" },
      {
        d: "M15 3a6 6 0 0 1 6 6 1.25 1.25 0 0 1-1.25 1.25H15A1.25 1.25 0 0 1 13.75 9V4.25A1.25 1.25 0 0 1 15 3Z",
      },
      { cx: "6.625", cy: "17.375", r: "3.85" },
      {
        d: "M16.98 13.53a.566 .566 0 0 1 .8 0l3.45 3.45a.566 .566 0 0 1 0 .8l-3.45 3.45a.566 .566 0 0 1-.8 0l-3.45-3.45a.566 .566 0 0 1 0-.8Z",
      },
    ]);
  });

  it("size is width and height, strokeWidth is the stroke width, className passes through — tabs use 15·1.75", () => {
    const { container } = render(<AppGlyph size={15} strokeWidth={2} className="flex-none" />);
    const svg = glyph(container);
    expect(svg).toHaveAttribute("width", "15");
    expect(svg).toHaveAttribute("height", "15");
    expect(svg).toHaveAttribute("stroke-width", "2");
    expect(svg).toHaveClass("flex-none");
    // the drawing scales with the box: the viewBox stays 24
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
  });
});
