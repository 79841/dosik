import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MarkerShape } from "../../../shared/lib/types";
import { EdgeMarkerDef, MARKER_REF_X, MarkerGlyph } from "../edgeMarkers";

const SHAPES: MarkerShape[] = ["arrow", "open", "circle", "diamond", "bar", "many"];

const renderSvg = (children: React.ReactNode) => render(<svg>{children}</svg>);

describe("MarkerGlyph", () => {
  it("renders a shape for every marker except none", () => {
    for (const shape of SHAPES) {
      const { container, unmount } = renderSvg(<MarkerGlyph shape={shape} color="#111" />);
      expect(container.querySelector("path, circle, rect"), shape).not.toBeNull();
      unmount();
    }
    const { container } = renderSvg(<MarkerGlyph shape="none" color="#111" />);
    expect(container.querySelector("path, circle, rect")).toBeNull();
  });
});

describe("EdgeMarkerDef", () => {
  it("creates no marker definition for shape=none", () => {
    const { container } = renderSvg(
      <defs>
        <EdgeMarkerDef id="m1" shape="none" color="#111" size="md" />
      </defs>,
    );
    expect(container.querySelector("marker")).toBeNull();
  });

  it("reflects the edge's color, size and reference point in markers", () => {
    const { container } = renderSvg(
      <defs>
        <EdgeMarkerDef id="m2" shape="arrow" color="#ABCDEF" size="lg" />
      </defs>,
    );
    const marker = container.querySelector("marker");
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("id")).toBe("m2");
    expect(marker?.getAttribute("markerWidth")).toBe("15");
    expect(marker?.getAttribute("refX")).toBe(String(MARKER_REF_X.arrow));
    expect(container.querySelector("path")?.getAttribute("fill")).toBe("#ABCDEF");
  });
});
