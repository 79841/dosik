import { getCurrentWindow } from "@tauri-apps/api/window";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WindowControls } from "../WindowControls";

const mockedWindow = vi.mocked(getCurrentWindow);
const win = () => ({
  close: vi.fn(async () => {}),
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  onCloseRequested: vi.fn(async () => () => {}),
  isFullscreen: vi.fn(async () => false),
  onResized: vi.fn(async () => () => {}),
});
const controls = () => document.querySelector("[data-window-controls]") as HTMLElement | null;

describe("WindowControls (#127, #217 T3)", () => {
  beforeEach(() => {
    mockedWindow.mockReset();
    mockedWindow.mockReturnValue(win() as never);
  });

  it("Draws nothing on macOS — the window draws the traffic lights over the strip", () => {
    const { container } = render(<WindowControls platform="mac" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("Other platforms draw minimize, maximize and close inside the strip — not a floating capsule", () => {
    render(<WindowControls platform="other" />);
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Minimize",
      "Maximize",
      "Close",
    ]);
    // laid out by the band, not floated over the content
    expect(controls()?.className).not.toMatch(/\babsolute\b/);
    expect(controls()?.style.right).toBe("");
  });

  it("Each button calls the window API once", async () => {
    const user = userEvent.setup();
    const w = win();
    mockedWindow.mockReturnValue(w as never);
    render(<WindowControls platform="other" />);
    await user.click(screen.getByRole("button", { name: "Minimize" }));
    await user.click(screen.getByRole("button", { name: "Maximize" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(w.minimize).toHaveBeenCalledTimes(1);
    expect(w.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(w.close).toHaveBeenCalledTimes(1);
  });

  it("Moves on silently when the window API rejects (missing permission, IPC failure)", async () => {
    const user = userEvent.setup();
    const w = win();
    w.close.mockRejectedValue(new Error("window.close not allowed"));
    mockedWindow.mockReturnValue(w as never);
    render(<WindowControls platform="other" />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(w.close).toHaveBeenCalledTimes(1);
  });

  it("Renders outside Tauri (the window API throws) and the buttons do nothing", async () => {
    const user = userEvent.setup();
    mockedWindow.mockImplementation(() => {
      throw new TypeError("no __TAURI_INTERNALS__");
    });
    render(<WindowControls platform="other" />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(controls()).toBeInTheDocument();
  });

  it("Picks by UA when no platform is given — no buttons on a Mac", () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      configurable: true,
    });
    try {
      const { unmount } = render(<WindowControls />);
      expect(screen.queryAllByRole("button")).toHaveLength(0);
      unmount();
    } finally {
      delete (navigator as { userAgent?: string }).userAgent;
    }
    render(<WindowControls />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});
