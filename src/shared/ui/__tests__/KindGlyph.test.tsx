import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiagramGlyph, FolderGlyph } from "../KindGlyph";

const svg = (container: HTMLElement) => container.querySelector("svg") as SVGSVGElement;

describe("FolderGlyph — a folder, blue over its tint (#236 T4)", () => {
  it("is Folder while closed, FolderOpen while open", () => {
    const closed = render(<FolderGlyph />);
    expect(svg(closed.container)).toHaveAttribute("data-folder-icon", "closed");
    expect(svg(closed.container)).toHaveClass("lucide-folder");
    const open = render(<FolderGlyph open />);
    expect(svg(open.container)).toHaveAttribute("data-folder-icon", "open");
    expect(svg(open.container)).toHaveClass("lucide-folder-open");
  });

  it("strokes in glyph-folder and fills its shape with glyph-folder-soft", () => {
    for (const open of [false, true]) {
      const { container, unmount } = render(<FolderGlyph open={open} />);
      expect(svg(container)).toHaveClass("text-glyph-folder", "fill-glyph-folder-soft");
      unmount();
    }
  });

  it("is a 16px row glyph by default, any size and stroke when asked, never read", () => {
    const row = render(<FolderGlyph />);
    expect(svg(row.container)).toHaveAttribute("width", "16");
    expect(svg(row.container)).toHaveAttribute("stroke-width", "1.75");
    expect(svg(row.container)).toHaveAttribute("aria-hidden", "true");
    const card = render(<FolderGlyph size={36} strokeWidth={1.5} className="opacity-35" />);
    expect(svg(card.container)).toHaveAttribute("width", "36");
    expect(svg(card.container)).toHaveAttribute("stroke-width", "1.5");
    expect(svg(card.container)).toHaveClass("flex-none", "opacity-35");
  });
});

describe("DiagramGlyph — a diagram, pink with its two squares tinted (#236 T4)", () => {
  it("is Workflow, stroked in glyph-diagram", () => {
    const { container } = render(<DiagramGlyph />);
    expect(svg(container)).toHaveClass("lucide-workflow", "text-glyph-diagram");
    expect(svg(container)).toHaveAttribute("width", "16");
    expect(svg(container)).toHaveAttribute("aria-hidden", "true");
  });

  it("fills only the squares — the connector stays a line", () => {
    const { container } = render(<DiagramGlyph />);
    expect(svg(container)).toHaveClass("[&_rect]:fill-glyph-diagram-soft");
    expect(svg(container)).not.toHaveClass("fill-glyph-diagram-soft");
    expect(svg(container).querySelectorAll("rect")).toHaveLength(2);
  });

  it("takes a size, a stroke and a class", () => {
    const { container } = render(<DiagramGlyph size={13} strokeWidth={2} className="opacity-40" />);
    expect(svg(container)).toHaveAttribute("width", "13");
    expect(svg(container)).toHaveAttribute("stroke-width", "2");
    expect(svg(container)).toHaveClass("opacity-40");
  });
});
