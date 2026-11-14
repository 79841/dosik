import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ICON_PATHS } from "../../../shared/lib/icons";
import { ICON_GLYPH_RATIO, ICON_LABEL_H } from "../../../shared/lib/palette";
import { IconNodeSvg } from "../IconNodeSvg";

describe("IconNodeSvg (#9)", () => {
  it("draws only the glyph, no box — filling the area above the label line, centered", () => {
    const { container } = render(
      <svg>
        <IconNodeSvg icon="database" width={96} height={96} stroke="#333" />
      </svg>,
    );
    // no frame around the glyph
    expect(container.querySelector("rect")).toBeNull();
    expect(container.querySelectorAll("path")).toHaveLength(ICON_PATHS.database.length);
    const g = container.querySelector("g")!;
    const areaH = 96 - ICON_LABEL_H;
    const glyph = Math.min(96, areaH) * ICON_GLYPH_RATIO;
    expect(g.getAttribute("transform")).toBe(
      `translate(${(96 - glyph) / 2} ${(areaH - glyph) / 2}) scale(${glyph / 24})`,
    );
  });

  it("draws a placeholder for an unknown id — the node isn't left empty", () => {
    const { container } = render(
      <svg>
        <IconNodeSvg icon="future-icon" width={96} height={96} stroke="#333" />
      </svg>,
    );
    expect(container.querySelectorAll("path").length).toBeGreaterThan(0);
  });
});
