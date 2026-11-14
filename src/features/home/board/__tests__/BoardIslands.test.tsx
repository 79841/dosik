import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HintPill } from "../BoardIslands";

describe("hint pill padding (#231 D12)", () => {
  it("0 12 0 6 when an Esc kbd leads — Hybrid-Folder-Canvas", () => {
    render(<HintPill id="hint" focus />);
    const pill = screen.getByText(/to zoom out/).closest("p")!;
    expect(pill.firstElementChild?.tagName.toLowerCase()).toBe("kbd");
    expect(pill).toHaveClass("pr-3", "pl-1.5");
    expect(pill).not.toHaveClass("pl-2.5");
  });

  it("0 12 0 10 unchanged when an icon leads — Hybrid-Home-Canvas", () => {
    render(<HintPill id="hint" focus={false} />);
    const pill = screen.getByText(/Double-click a folder/).closest("p")!;
    expect(pill.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(pill).toHaveClass("pr-3", "pl-2.5");
    expect(pill).not.toHaveClass("pl-1.5");
  });
});
