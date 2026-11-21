import { getCurrentWindow } from "@tauri-apps/api/window";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CAPTION_BUTTON } from "../../lib/windowChrome";
import { resetWindowFrame, useWindowFrame } from "../../lib/windowFrame";
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
const button = (name: string) => screen.getByRole("button", { name });
const labels = () => screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));

describe("WindowControls (#127, #217 T3)", () => {
  beforeEach(() => {
    mockedWindow.mockReset();
    mockedWindow.mockReturnValue(win() as never);
    resetWindowFrame();
  });

  it("Draws nothing on macOS — the window draws the traffic lights over the strip", () => {
    const { container } = render(<WindowControls platform="mac" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("Other platforms draw minimize, maximize and close inside the strip — not a floating capsule", () => {
    render(<WindowControls platform="other" />);
    expect(labels()).toEqual(["Minimize", "Maximize", "Close"]);
    expect(screen.getByRole("group", { name: "Window" })).toBe(controls());
    // laid out by the band, not floated over the content
    expect(controls()?.className).not.toMatch(/\babsolute\b/);
    expect(controls()?.style.right).toBe("");
  });

  it("Each button calls the window API once", async () => {
    const user = userEvent.setup();
    const w = win();
    mockedWindow.mockReturnValue(w as never);
    render(<WindowControls platform="other" />);
    await user.click(button("Minimize"));
    await user.click(button("Maximize"));
    await user.click(button("Close"));
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
    await user.click(button("Close"));
    await new Promise((r) => setTimeout(r, 0));
    expect(w.close).toHaveBeenCalledTimes(1);
  });

  it("Renders outside Tauri (the window API throws) and the buttons do nothing", async () => {
    const user = userEvent.setup();
    mockedWindow.mockImplementation(() => {
      throw new TypeError("no __TAURI_INTERNALS__");
    });
    render(<WindowControls platform="other" />);
    await user.click(button("Close"));
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

describe("Windows caption buttons (the canvas's Win-Caption)", () => {
  beforeEach(() => {
    mockedWindow.mockReset();
    mockedWindow.mockReturnValue(win() as never);
    resetWindowFrame();
  });

  it("each is 46 wide — the caption-button token — and as tall as the band, with no gap between them", () => {
    expect(CAPTION_BUTTON).toBe(46);
    render(<WindowControls platform="other" />);
    expect(controls()?.className).not.toMatch(/\bgap-/);
    for (const b of screen.getAllByRole("button")) {
      expect(b).toHaveClass("w-(--caption-button)", "h-10");
      // square, flush: no rounded capsule
      expect(b.className).not.toMatch(/\brounded/);
    }
  });

  it("glyphs are the system's 10px, 1px shapes in ink — not Lucide icons", () => {
    render(<WindowControls platform="other" />);
    for (const b of screen.getAllByRole("button")) {
      const svg = b.querySelector("svg")!;
      expect(svg.getAttribute("width")).toBe("10");
      expect(svg.getAttribute("stroke-width")).toBe("1");
      expect(svg.classList.contains("lucide")).toBe(false);
      expect(b).toHaveClass("text-ink");
    }
  });

  it("Minimize and Maximize: `selected` under the pointer, `hover` while pressed", () => {
    render(<WindowControls platform="other" />);
    for (const name of ["Minimize", "Maximize"]) {
      expect(button(name)).toHaveClass("hover:bg-selected", "active:bg-hover");
    }
  });

  it("Close: the caption-close red with its white glyph, deeper while pressed — tokens, no hex", () => {
    render(<WindowControls platform="other" />);
    expect(button("Close")).toHaveClass(
      "hover:bg-caption-close",
      "hover:text-on-caption-close",
      "active:bg-caption-close-pressed",
      "active:text-on-caption-close",
    );
    for (const b of screen.getAllByRole("button")) expect(b.className).not.toMatch(/#[0-9a-f]{3}/i);
  });

  it("maximized: the middle button is Restore, with the two-square glyph — and back", () => {
    render(<WindowControls platform="other" />);
    const glyph = () => button(labels()[1]!).querySelector("svg")!;
    expect(glyph()).toHaveAttribute("data-glyph", "maximize");
    act(() => useWindowFrame.setState({ maximized: true }));
    expect(labels()).toEqual(["Minimize", "Restore", "Close"]);
    expect(glyph()).toHaveAttribute("data-glyph", "restore");
    act(() => useWindowFrame.setState({ maximized: false }));
    expect(labels()).toEqual(["Minimize", "Maximize", "Close"]);
  });

  it("Restore restores through the same call", async () => {
    const user = userEvent.setup();
    const w = win();
    mockedWindow.mockReturnValue(w as never);
    useWindowFrame.setState({ maximized: true });
    render(<WindowControls platform="other" />);
    await user.click(button("Restore"));
    expect(w.toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("another window has the focus: the glyphs dim to muted", () => {
    render(<WindowControls platform="other" />);
    expect(controls()).not.toHaveAttribute("data-inactive");
    act(() => useWindowFrame.setState({ focused: false }));
    expect(controls()).toHaveAttribute("data-inactive");
    for (const b of screen.getAllByRole("button")) {
      expect(b).toHaveClass("text-muted");
      expect(b).not.toHaveClass("text-ink");
    }
  });

  it("paints the pointer state Windows reports for the native Maximize spot (Snap layouts)", () => {
    render(<WindowControls platform="other" />);
    expect(button("Maximize")).toHaveAttribute("data-state", "rest");
    act(() => useWindowFrame.setState({ maxButton: "hover" }));
    expect(button("Maximize")).toHaveAttribute("data-state", "hover");
    expect(button("Maximize")).toHaveClass("data-[state=hover]:bg-selected");
    act(() => useWindowFrame.setState({ maxButton: "pressed" }));
    expect(button("Maximize")).toHaveClass("data-[state=pressed]:bg-hover");
    // the others have no native spot
    expect(button("Minimize")).not.toHaveAttribute("data-state");
  });

  it("full screen: no caption buttons", () => {
    useWindowFrame.setState({ fullscreen: true });
    const { container } = render(<WindowControls platform="other" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a copy out of the tab order — the one a dialog carries — keeps the buttons from Tab", () => {
    render(<WindowControls platform="other" tabbable={false} />);
    for (const b of screen.getAllByRole("button")) expect(b).toHaveAttribute("tabindex", "-1");
  });

  it("the focus ring stays inside the window — the buttons touch its edge", () => {
    render(<WindowControls platform="other" />);
    for (const b of screen.getAllByRole("button")) {
      expect(b.className).toMatch(/focus-visible:outline-offset-\[-2px\]/);
    }
  });
});
