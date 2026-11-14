import { ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ShapeNode } from "../ShapeNode";
import type { ShapeKind } from "../../../shared/lib/types";

/**
 * #70 — grabbing the resize border required aiming exactly at a 1px line.
 *
 * `NodeResizer` draws the grabbable box and the visible line as the same 1px box. The fix widens
 * that box into a 10px band and moves the visible hairline to a centered `::after`, but
 * **half of it lives only in CSS** — jsdom doesn't apply stylesheets, so a DOM test can only
 * confirm the class is attached. So App.css is read directly to pin the band width and the
 * hairline rule together. How it feels under a finger is up to the PR's How to verify.
 */

const renderNode = (shape: ShapeKind = "rounded", selected = true) =>
  render(
    <ReactFlowProvider>
      {/* @ts-expect-error passes only what ShapeNode reads, not all of NodeProps */}
      <ShapeNode
        id="n1"
        selected={selected}
        width={160}
        height={56}
        data={{ label: "A", shape, color: "violet" }}
      />
    </ReactFlowProvider>,
  ).container;

const lines = (c: Element) => Array.from(c.querySelectorAll(".react-flow__resize-control.line"));

describe("resize border hit area (#70)", () => {
  it("gives all four sides of a selected node the widened band class", () => {
    const found = lines(renderNode());
    expect(found).toHaveLength(4);
    for (const el of found) {
      expect(el.className).toContain("dosik-resize-line");
    }
    // All four sides — if one is missing, that side is 1px as before
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(found.some((el) => el.classList.contains(side))).toBe(true);
    }
  });

  it("needs a text-* class since the color follows currentColor", () => {
    // Switching to border-* makes the CSS ::after lose its color and the hairline disappears
    for (const el of lines(renderNode())) {
      expect(el.className).toMatch(/\btext-primary(?:\/\d+)?\b/);
    }
  });

  it("fragments use the band but restore pointer-events (#38)", () => {
    const found = lines(renderNode("fragment"));
    expect(found).toHaveLength(4);
    for (const el of found) {
      expect(el.className).toContain("dosik-resize-line");
      expect(el.className).toContain("!pointer-events-auto");
    }
  });

  it("unselected nodes have no controls — the band doesn't eat neighbors' clicks", () => {
    expect(lines(renderNode("rounded", false))).toHaveLength(0);
  });

  it("leaves the corner handles untouched", () => {
    const handles = renderNode().querySelectorAll(".react-flow__resize-control.handle");
    expect(handles).toHaveLength(4);
    for (const el of handles) {
      expect(el.className).toContain("!h-2.5");
      expect(el.className).toContain("!w-2.5");
    }
  });
});

describe("the band's actual dimensions live in CSS (#70)", () => {
  const css = readFileSync(join(process.cwd(), "src/App.css"), "utf8");
  /** Declarations of the block whose selector (comments and whitespace stripped) equals `selector` exactly. */
  const block = (selector: string): string => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (m[1]!.replace(/\s/g, "") === selector) return m[2]!;
    }
    return "";
  };
  const px = (decls: string, prop: string): number =>
    Number(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`).exec(decls)?.[1] ?? Number.NaN);

  it("turns off the library's 1px border — left on, there would be two hairlines", () => {
    expect(block(".dosik-resize-line").replace(/\s/g, "")).toContain("border-width:0");
  });

  it.each([
    [".dosik-resize-line.left,.dosik-resize-line.right", "width"],
    [".dosik-resize-line.top,.dosik-resize-line.bottom", "height"],
  ])("%s band is as wide as the corner handles (10px)", (needle, prop) => {
    // 10px is why the corners were easy to grab — sides need the same width to feel right
    expect(px(block(needle), prop)).toBeGreaterThanOrEqual(10);
  });

  it("draws the hairline in the band's center — pushed to the band's edge, the line floats off the shape", () => {
    const base = block(".dosik-resize-line::after");
    expect(base).toContain("currentColor");
    const vertical = block(".dosik-resize-line.left::after,.dosik-resize-line.right::after");
    expect(px(vertical, "width")).toBe(1);
    expect(vertical).toContain("left: 50%");
    expect(vertical).toContain("translateX(-50%)");
    const horizontal = block(".dosik-resize-line.top::after,.dosik-resize-line.bottom::after");
    expect(px(horizontal, "height")).toBe(1);
    expect(horizontal).toContain("top: 50%");
    expect(horizontal).toContain("translateY(-50%)");
  });
});
