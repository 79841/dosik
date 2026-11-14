import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ZoomIsland } from "../ZoomIsland";

/** the viewport is React Flow's; what can be pinned is the call made on it */
const flow = vi.hoisted(() => ({
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  zoomTo: vi.fn(),
  fitView: vi.fn(),
}));
const state = vi.hoisted(() => ({ transform: [0, 0, 1] as [number, number, number] }));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useReactFlow: () => flow,
    useStore: <T,>(selector: (s: unknown) => T) =>
      selector({ transform: state.transform, minZoom: 0.2, maxZoom: 2.5 }),
  };
});

const zoomAt = (zoom: number) => {
  state.transform = [0, 0, zoom];
};

describe("zoom island (#219 D10, T7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    zoomAt(1);
  });

  it("group 'Zoom' — Zoom out · percentage · Zoom in · Fit to screen, in that order", () => {
    zoomAt(0.9);
    render(<ZoomIsland />);
    const group = within(screen.getByRole("group", { name: "Zoom" }));
    expect(group.getAllByRole("button")).toEqual([
      group.getByRole("button", { name: "Zoom out" }),
      group.getByRole("button", { name: "Zoom 90%, reset to 100%" }),
      group.getByRole("button", { name: "Zoom in" }),
      group.getByRole("button", { name: "Fit to screen" }),
    ]);
    expect(group.getByRole("button", { name: /^Zoom 90%/ })).toHaveTextContent("90%");
  });

  it("shows zoom × 100, rounded", () => {
    zoomAt(1.234);
    render(<ZoomIsland />);
    expect(screen.getByRole("button", { name: /^Zoom 123%/ })).toHaveTextContent("123%");
  });

  it("clicks zoom out · 100% · zoom in · fit — the same calls as the React Flow controls", () => {
    render(<ZoomIsland />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(flow.zoomOut).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /^Zoom 100%/ }));
    expect(flow.zoomTo).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(flow.zoomIn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Fit to screen" }));
    expect(flow.fitView).toHaveBeenCalledTimes(1);
  });

  it("disables − at the minimum zoom and + at the maximum", () => {
    zoomAt(0.2);
    const view = render(<ZoomIsland />);
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    zoomAt(2.5);
    view.rerender(<ZoomIsland />);
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeEnabled();
  });

  it("is a 36px-tall island 12px from the canvas's bottom right — no board island marker (#221)", () => {
    render(<ZoomIsland />);
    expect(screen.getByRole("group", { name: "Zoom" })).not.toHaveAttribute("data-board-island");
    expect(screen.getByRole("group", { name: "Zoom" })).toHaveClass(
      "absolute",
      "right-3",
      "bottom-3",
      "h-9",
      "shadow-raised",
    );
  });
});

describe("narrow canvas — zoom island vs. toast and edit bar (#219)", () => {
  const column = { width: 892 };
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  beforeEach(() => {
    column.width = 892;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-editor-canvas") ? column.width : 0;
      },
    });
  });
  afterEach(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, "clientWidth", original);
  });

  const renderInCanvas = () =>
    render(
      <div data-editor-canvas>
        <ZoomIsland />
      </div>,
    );
  const zoomLift = () => document.documentElement.style.getPropertyValue("--dsk-toast-zoom-lift");

  it("shares the edit bar's layer (z-30) — the bar raised to the row above the island keeps its tooltips uncovered", () => {
    render(<ZoomIsland />);
    expect(screen.getByRole("group", { name: "Zoom" })).toHaveClass("z-30");
    expect(screen.getByRole("group", { name: "Zoom" })).not.toHaveClass("z-10");
  });

  it("leaves the toast alone even on a narrow canvas (412) — the editor already puts it on the row above the islands (60) (#231 D18)", () => {
    column.width = 412;
    renderInCanvas();
    expect(zoomLift()).toBe("");
  });
});
