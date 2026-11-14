import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ZoomIsland } from "../ZoomIsland";

const handlers = () => ({
  onZoomOut: vi.fn(),
  onReset: vi.fn(),
  onZoomIn: vi.fn(),
  onFit: vi.fn(),
});

const show = (zoom: number, over: Partial<Parameters<typeof ZoomIsland>[0]> = {}) => {
  const on = handlers();
  const view = render(<ZoomIsland zoom={zoom} minZoom={0.2} maxZoom={2} {...on} {...over} />);
  return { on, view };
};

describe("Zoom island — the same part as in the editor (#219 D10) (#221 D16, T30)", () => {
  it("group 'Zoom' — Zoom out · ratio · Zoom in · Fit to screen, in that order", () => {
    show(0.7);
    const group = within(screen.getByRole("group", { name: "Zoom" }));
    expect(group.getAllByRole("button")).toEqual([
      group.getByRole("button", { name: "Zoom out" }),
      group.getByRole("button", { name: "Zoom 70%, reset to 100%" }),
      group.getByRole("button", { name: "Zoom in" }),
      group.getByRole("button", { name: "Fit to screen" }),
    ]);
    expect(group.getByRole("button", { name: /^Zoom 70%/ })).toHaveTextContent("70%");
  });

  it("The ratio is the scale × 100, rounded", () => {
    show(1.234);
    expect(screen.getByRole("button", { name: /^Zoom 123%/ })).toHaveTextContent("123%");
  });

  it("Clicking calls the passed functions — zoom out, 100%, zoom in, fit", () => {
    const { on } = show(1);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: /^Zoom 100%/ }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Fit to screen" }));
    expect(on.onZoomOut).toHaveBeenCalledTimes(1);
    expect(on.onReset).toHaveBeenCalledTimes(1);
    expect(on.onZoomIn).toHaveBeenCalledTimes(1);
    expect(on.onFit).toHaveBeenCalledTimes(1);
  });

  it("− turns off at the minimum scale, + at the maximum", () => {
    const { view, on } = show(0.2);
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    view.rerender(<ZoomIsland zoom={2} minZoom={0.2} maxZoom={2} {...on} />);
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeEnabled();
  });

  it("When disabled, all four buttons are off — a board whose list couldn't be read", () => {
    show(0.7, { disabled: true });
    for (const button of within(screen.getByRole("group", { name: "Zoom" })).getAllByRole(
      "button",
    )) {
      expect(button).toBeDisabled();
    }
  });

  it("An island 12 from the bottom right, 36 high — the same classes as the editor island", () => {
    show(1);
    expect(screen.getByRole("group", { name: "Zoom" })).toHaveClass(
      "absolute",
      "right-3",
      "bottom-3",
      "z-30",
      "h-9",
      "rounded-(--radius-island)",
      "bg-surface",
      "shadow-raised",
    );
  });

  it("data-* attributes go on the island — the board marks its own island (#221)", () => {
    render(<ZoomIsland data-board-island="" zoom={1} minZoom={0.2} maxZoom={2} {...handlers()} />);
    expect(screen.getByRole("group", { name: "Zoom" })).toHaveAttribute("data-board-island", "");
  });
});
