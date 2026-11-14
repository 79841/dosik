import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHROME_DARK, CHROME_LIGHT } from "../../../shared/lib/palette";
import { mountDiagramView, type ToolResult, type ViewHost } from "../diagramView";

const svg = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="100%"><text>${label}</text></svg>`;

const drawn = (label: string, extra: Partial<Record<string, unknown>> = {}): ToolResult => ({
  content: [{ type: "text", text: "Showing" }],
  structuredContent: {
    svg: svg(label),
    theme: "light",
    title: "Flow",
    shapes: 2,
    connectors: 1,
    target: { file: "/tmp/a.dosik.json" },
    ...extra,
  },
});

const fakeHost = (theme?: "light" | "dark") => {
  const host = {
    theme,
    callServerTool: vi.fn<ViewHost["callServerTool"]>(async () => drawn("again")),
    getHostContext: () => (host.theme ? { theme: host.theme } : {}),
  };
  return host;
};

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
});

/** buttons are icons; they are found by their accessible name, as a screen reader would */
const LABELS: Record<string, string> = { Fit: "Fit to view" };
const button = (name: string) =>
  root.querySelector(`button[aria-label="${LABELS[name] ?? name}"]`) as HTMLButtonElement | null;
const shownText = () => root.querySelector(".dsk-stage > svg text")?.textContent;
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("In-chat app (#202)", () => {
  it("Draws the SVG and sets it to Fit when a tool result arrives", () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult(drawn("first"));
    expect(shownText()).toBe("first");
    const shown = root.querySelector(".dsk-stage > svg") as SVGSVGElement;
    // The app owns the viewBox — it fills the frame instead of using its own size
    expect(shown.getAttribute("width")).toBe("100%");
    expect(shown.getAttribute("height")).toBe("100%");
    expect(shown.getAttribute("viewBox")).not.toBeNull();
    // There is no title row — the title is only the drawing's accessible name
    expect(root.querySelector(".dsk-title")).toBeNull();
    expect(shown.parentElement?.getAttribute("aria-label")).toBe("Diagram: Flow");
  });

  it("Refresh calls render_diagram again with the same file and the current theme, and redraws", async () => {
    const host = fakeHost("light");
    const view = mountDiagramView(root, host);
    view.showResult(drawn("first"));
    button("Refresh")?.click();
    await settle();
    expect(host.callServerTool).toHaveBeenCalledWith({
      name: "render_diagram",
      arguments: { file: "/tmp/a.dosik.json", theme: "light" },
    });
    expect(shownText()).toBe("again");
  });

  it("Calls without file when the target is the open app", async () => {
    const host = fakeHost("light");
    const view = mountDiagramView(root, host);
    view.showResult(drawn("first", { target: {} }));
    button("Refresh")?.click();
    await settle();
    expect(host.callServerTool).toHaveBeenCalledWith({
      name: "render_diagram",
      arguments: { theme: "light" },
    });
  });

  it("Shows the reason and keeps the previous drawing when a redraw fails", async () => {
    const host = fakeHost("light");
    host.callServerTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "Dosik is not running" }],
    });
    const view = mountDiagramView(root, host);
    view.showResult(drawn("first"));
    button("Refresh")?.click();
    await settle();
    expect(shownText()).toBe("first");
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("Dosik is not running");
  });

  it("Shows the reason even when the call itself fails", async () => {
    const host = fakeHost("light");
    host.callServerTool.mockRejectedValueOnce(new Error("Tool call refused"));
    const view = mountDiagramView(root, host);
    view.showResult(drawn("first"));
    button("Refresh")?.click();
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("Tool call refused");
  });

  it("When the first result is an error, shows only the reason, with no drawing", () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult({ isError: true, content: [{ type: "text", text: "No such file" }] });
    expect(root.querySelector(".dsk-stage > svg")).toBeNull();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("No such file");
  });

  it("Open in Dosik exists only for file targets, and clicking it calls open_in_dosik", async () => {
    const host = fakeHost("light");
    const view = mountDiagramView(root, host);
    view.showResult(drawn("first", { target: {} }));
    expect(button("Open in Dosik")?.hidden).toBe(true);
    view.showResult(drawn("second"));
    expect(button("Open in Dosik")?.hidden).toBe(false);
    host.callServerTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "{}" }],
    });
    button("Open in Dosik")?.click();
    await settle();
    expect(host.callServerTool).toHaveBeenLastCalledWith({
      name: "open_in_dosik",
      arguments: { file: "/tmp/a.dosik.json" },
    });
  });

  it("When the host theme differs from the result theme, skips that drawing and draws in the host theme — no flashing", async () => {
    const host = fakeHost("dark");
    const view = mountDiagramView(root, host);
    view.showResult(drawn("light one"));
    expect(root.querySelector(".dsk-stage > svg")).toBeNull();
    expect(root.dataset.theme).toBe("dark");
    await settle();
    expect(host.callServerTool).toHaveBeenCalledWith({
      name: "render_diagram",
      arguments: { file: "/tmp/a.dosik.json", theme: "dark" },
    });
    expect(shownText()).toBe("again");
  });

  it("Shows the received drawing as is when redrawing in the host theme fails", async () => {
    const host = fakeHost("dark");
    host.callServerTool.mockRejectedValueOnce(new Error("refused"));
    const view = mountDiagramView(root, host);
    view.showResult(drawn("light one"));
    await settle();
    expect(shownText()).toBe("light one");
  });

  it("Redraws when the host theme changes — no call when it is the same", async () => {
    const host = fakeHost("light");
    const view = mountDiagramView(root, host);
    view.showResult(drawn("first"));
    view.hostContextChanged();
    await settle();
    expect(host.callServerTool).not.toHaveBeenCalled();
    host.theme = "dark";
    view.hostContextChanged();
    await settle();
    expect(host.callServerTool).toHaveBeenCalledWith({
      name: "render_diagram",
      arguments: { file: "/tmp/a.dosik.json", theme: "dark" },
    });
  });

  it("⌘·Ctrl+wheel (including trackpad pinch) zooms, and Fit goes back to the initial fit", () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult(drawn("first"));
    const shown = root.querySelector(".dsk-stage > svg") as SVGSVGElement;
    const fitted = shown.getAttribute("viewBox");
    const stage = shown.parentElement as HTMLElement;
    const wheel = new WheelEvent("wheel", {
      deltaY: -200,
      clientX: 10,
      clientY: 10,
      ctrlKey: true,
      cancelable: true,
    });
    stage.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(shown.getAttribute("viewBox")).not.toBe(fitted);
    button("Fit")?.click();
    expect(shown.getAttribute("viewBox")).toBe(fitted);
  });

  it("A plain wheel scrolls the chat — it does not zoom, and tells how to zoom", () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult(drawn("first"));
    const shown = root.querySelector(".dsk-stage > svg") as SVGSVGElement;
    const fitted = shown.getAttribute("viewBox");
    const wheel = new WheelEvent("wheel", { deltaY: 100, cancelable: true });
    (shown.parentElement as HTMLElement).dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(shown.getAttribute("viewBox")).toBe(fitted);
    expect(root.querySelector(".dsk-hint")?.textContent).toMatch(/scroll to zoom/);
  });

  it("Zooms and pans without a mouse — buttons and keys", () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult(drawn("first"));
    const shown = root.querySelector(".dsk-stage > svg") as SVGSVGElement;
    const stage = shown.parentElement as HTMLElement;
    const fitted = shown.getAttribute("viewBox");
    const zoomIn = root.querySelector('button[aria-label="Zoom in"]') as HTMLButtonElement;
    zoomIn.click();
    const zoomed = shown.getAttribute("viewBox");
    expect(zoomed).not.toBe(fitted);
    (root.querySelector('button[aria-label="Zoom out"]') as HTMLButtonElement).click();
    expect(shown.getAttribute("viewBox")).toBe(fitted);
    expect(stage.tabIndex).toBe(0);
    expect(stage.getAttribute("aria-label")).toBe("Diagram: Flow");
    const key = (k: string) => {
      const event = new KeyboardEvent("keydown", { key: k, cancelable: true });
      stage.dispatchEvent(event);
      return event;
    };
    expect(key("+").defaultPrevented).toBe(true);
    expect(shown.getAttribute("viewBox")).toBe(zoomed);
    key("ArrowLeft");
    expect(shown.getAttribute("viewBox")).not.toBe(zoomed);
    key("0");
    expect(shown.getAttribute("viewBox")).toBe(fitted);
    // Other keys pass through
    expect(key("a").defaultPrevented).toBe(false);
  });

  it("Before the first result it says it is drawing and disables the buttons", () => {
    mountDiagramView(root, fakeHost("light"));
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Drawing…");
    for (const name of ["Fit", "Refresh"]) expect(button(name)?.disabled, name).toBe(true);
    expect((root.querySelector('button[aria-label="Zoom in"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("When a redraw fails it says the drawing is the previous one", async () => {
    const host = fakeHost("light");
    host.callServerTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "Dosik is not running" }],
    });
    const view = mountDiagramView(root, host);
    view.showResult(drawn("first"));
    button("Refresh")?.click();
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't refresh — showing the last drawing. Dosik is not running",
    );
  });

  it("Disables the button while opening in the app — so a double click doesn't open it twice", async () => {
    const host = fakeHost("light");
    let release: (r: ToolResult) => void = () => {};
    host.callServerTool.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const view = mountDiagramView(root, host);
    view.showResult(drawn("first"));
    button("Open in Dosik")?.click();
    expect(button("Open in Dosik")?.disabled).toBe(true);
    release({ content: [{ type: "text", text: "{}" }] });
    await settle();
    expect(button("Open in Dosik")?.disabled).toBe(false);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Opened in Dosik");
  });

  it("Drops the request when the host theme returns to the original during a redraw", async () => {
    const host = fakeHost("dark");
    let release: (r: ToolResult) => void = () => {};
    const view = mountDiagramView(root, host);
    view.showResult(drawn("dark one", { theme: "dark" }));
    host.callServerTool.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    host.theme = "light";
    view.hostContextChanged();
    host.theme = "dark";
    view.hostContextChanged();
    release(drawn("light one", { theme: "light" }));
    await settle();
    expect(shownText()).toBe("dark one");
    expect(button("Refresh")?.disabled).toBe(false);
  });

  it("Sends only one request even if the same theme notice arrives again during a redraw", async () => {
    const host = fakeHost("light");
    let release: (r: ToolResult) => void = () => {};
    const view = mountDiagramView(root, host);
    view.showResult(drawn("light one"));
    host.callServerTool
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockResolvedValueOnce(drawn("dark again", { theme: "dark" }));
    host.theme = "dark";
    view.hostContextChanged();
    // A notice for the same theme does not create a new request
    view.hostContextChanged();
    expect(host.callServerTool).toHaveBeenCalledTimes(1);
    release(drawn("dark one", { theme: "dark" }));
    await settle();
    expect(shownText()).toBe("dark one");
  });

  it("Draws right away when the host theme returns to the deferred drawing's theme in the meantime", async () => {
    const host = fakeHost("dark");
    host.callServerTool.mockImplementationOnce(() => new Promise(() => {}));
    const view = mountDiagramView(root, host);
    view.showResult(drawn("light one"));
    expect(root.querySelector(".dsk-stage > svg")).toBeNull();
    host.theme = "light";
    view.hostContextChanged();
    await settle();
    expect(shownText()).toBe("light one");
    expect(root.dataset.theme).toBe("light");
  });

  it("Drops an in-progress redraw when the host sends a new result", async () => {
    const host = fakeHost("light");
    let release: (r: ToolResult) => void = () => {};
    host.callServerTool.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const view = mountDiagramView(root, host);
    view.showResult(drawn("first"));
    button("Refresh")?.click();
    view.showResult(drawn("pushed"));
    release(drawn("old refresh"));
    await settle();
    expect(shownText()).toBe("pushed");
    expect(button("Refresh")?.disabled).toBe(false);
  });

  it("Does not run an SVG that contains a script either", () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult(
      drawn("x", {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="x()"><script>x()</script></svg>',
      }),
    );
    const shown = root.querySelector(".dsk-stage > svg") as SVGSVGElement;
    expect(shown.querySelector("script")).toBeNull();
    expect(shown.hasAttribute("onload")).toBe(false);
  });

  it("Dragging moves the drawing and does not select labels", () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult(drawn("first"));
    const shown = root.querySelector(".dsk-stage > svg") as SVGSVGElement;
    const stage = shown.parentElement as HTMLElement;
    const before = shown.getAttribute("viewBox");
    const down = new MouseEvent("pointerdown", {
      button: 0,
      clientX: 50,
      clientY: 50,
      cancelable: true,
    });
    stage.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    stage.dispatchEvent(new MouseEvent("pointermove", { clientX: 80, clientY: 60 }));
    stage.dispatchEvent(new MouseEvent("pointerup", {}));
    expect(shown.getAttribute("viewBox")).not.toBe(before);
    // Movement after releasing does not move it
    const after = shown.getAttribute("viewBox");
    stage.dispatchEvent(new MouseEvent("pointermove", { clientX: 200, clientY: 200 }));
    expect(shown.getAttribute("viewBox")).toBe(after);
  });

  it("The name is the title alone — page in an old report is ignored (#229 D17, T24)", () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult(drawn("x"));
    expect(root.querySelector(".dsk-stage")?.getAttribute("aria-label")).toBe("Diagram: Flow");
    // an older server still sends which page it drew: a diagram is one canvas now
    view.showResult(drawn("y", { page: { index: 2, count: 3, name: "Detail" } }));
    expect(root.querySelector(".dsk-stage")?.getAttribute("aria-label")).toBe("Diagram: Flow");
  });

  it("Shows the reason when opening in the app fails", async () => {
    const host = fakeHost("light");
    host.callServerTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "Dosik is not installed" }],
    });
    const view = mountDiagramView(root, host);
    view.showResult(drawn("first"));
    button("Open in Dosik")?.click();
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("Dosik is not installed");
    expect(shownText()).toBe("first");
  });

  it("Overlapping redraws draw only the last request's result", async () => {
    const host = fakeHost("light");
    let releaseFirst: (r: ToolResult) => void = () => {};
    host.callServerTool
      .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce(drawn("second", { theme: "dark" }));
    const view = mountDiagramView(root, host);
    view.showResult(drawn("first"));
    // The host theme changes while Refresh is running
    button("Refresh")?.click();
    host.theme = "dark";
    view.hostContextChanged();
    await settle();
    expect(shownText()).toBe("second");
    releaseFirst(drawn("stale"));
    await settle();
    expect(shownText()).toBe("second");
  });

  it("Disables Refresh during a redraw and says so", async () => {
    const host = fakeHost("light");
    let release: (r: ToolResult) => void = () => {};
    host.callServerTool.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const view = mountDiagramView(root, host);
    view.showResult(drawn("first"));
    button("Refresh")?.click();
    expect(button("Refresh")?.disabled).toBe(true);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Drawing…");
    release(drawn("again"));
    await settle();
    expect(button("Refresh")?.disabled).toBe(false);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("Says so and keeps the previous drawing when the SVG can't be read", () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult(drawn("first"));
    view.showResult(drawn("x", { svg: "<svg" }));
    expect(shownText()).toBe("first");
    expect(root.querySelector('[role="alert"]')?.textContent).toMatch(/could not be read/);
  });

  it("When an error result follows a deferred drawing, shows that drawing and reports the error — nothing is left hanging (#202)", async () => {
    const host = fakeHost("dark");
    host.callServerTool.mockImplementationOnce(() => new Promise(() => {}));
    const view = mountDiagramView(root, host);
    view.showResult(drawn("held light"));
    view.showResult({ isError: true, content: [{ type: "text", text: "second call failed" }] });
    expect(shownText()).toBe("held light");
    expect(root.querySelector('[role="alert"]')?.textContent).toBe("second call failed");
    expect(button("Refresh")?.disabled).toBe(false);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("");
    // Nothing deferred remains — even if the host switches to that drawing's theme, it neither redraws nor clears the error
    host.theme = "light";
    view.hostContextChanged();
    await settle();
    expect(host.callServerTool).toHaveBeenCalledTimes(1);
    expect(shownText()).toBe("held light");
    expect(root.querySelector('[role="alert"]')?.textContent).toBe("second call failed");
  });

  it("Drops a deferred drawing that is broken", () => {
    const host = fakeHost("dark");
    host.callServerTool.mockImplementationOnce(() => new Promise(() => {}));
    const view = mountDiagramView(root, host);
    view.showResult(drawn("x", { svg: "<svg" }));
    host.theme = "light";
    view.hostContextChanged();
    expect(root.querySelector(".dsk-stage > svg")).toBeNull();
    expect(root.querySelector('[role="alert"]')?.textContent).toMatch(/could not be read/);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("Keeps following host theme switches after redrawing a first result with a mismatched theme", async () => {
    const host = fakeHost("dark");
    host.callServerTool.mockResolvedValueOnce(drawn("dark one", { theme: "dark" }));
    const view = mountDiagramView(root, host);
    view.showResult(drawn("light one"));
    await settle();
    expect(shownText()).toBe("dark one");
    host.callServerTool.mockResolvedValueOnce(drawn("light again", { theme: "light" }));
    host.theme = "light";
    view.hostContextChanged();
    await settle();
    expect(host.callServerTool).toHaveBeenLastCalledWith({
      name: "render_diagram",
      arguments: { file: "/tmp/a.dosik.json", theme: "light" },
    });
    expect(shownText()).toBe("light again");
  });

  it("Does not stall on a result with missing fields — defaults when title or target is absent", () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult({ structuredContent: { svg: svg("bare"), theme: "light" } });
    expect(shownText()).toBe("bare");
    expect(root.querySelector(".dsk-stage")?.getAttribute("aria-label")).toBe("Diagram: Diagram");
    expect(button("Open in Dosik")?.hidden).toBe(true);
  });

  it("A result matching the host theme that arrives during a redraw becomes the baseline", async () => {
    const host = fakeHost("dark");
    host.callServerTool.mockImplementationOnce(() => new Promise(() => {}));
    const view = mountDiagramView(root, host);
    view.showResult(drawn("light one"));
    view.showResult(drawn("dark two", { theme: "dark" }));
    expect(shownText()).toBe("dark two");
    host.callServerTool.mockResolvedValueOnce(drawn("light three", { theme: "light" }));
    host.theme = "light";
    view.hostContextChanged();
    await settle();
    expect(host.callServerTool).toHaveBeenLastCalledWith({
      name: "render_diagram",
      arguments: { file: "/tmp/a.dosik.json", theme: "light" },
    });
    expect(shownText()).toBe("light three");
  });

  it("Zooming while pointing at an empty margin does not make the drawing vanish out of the frame", () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult(drawn("first"));
    const shown = root.querySelector(".dsk-stage > svg") as SVGSVGElement;
    const stage = shown.parentElement as HTMLElement;
    for (let i = 0; i < 20; i++) {
      stage.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -400,
          clientX: 5000,
          clientY: 5000,
          ctrlKey: true,
          cancelable: true,
        }),
      );
    }
    const [x, y] = (shown.getAttribute("viewBox") ?? "").split(" ").map(Number);
    // Part of the drawing (0..200 × 0..100) is still inside the frame
    expect(x).toBeLessThan(200);
    expect(y).toBeLessThan(100);
  });

  it("The frame and stage have no background — the drawing sits on the chat background (#202)", () => {
    mountDiagramView(root, fakeHost("light"));
    const css = document.getElementById("dsk-view-style")?.textContent ?? "";
    const rule = (selector: string) =>
      css.match(new RegExp(`${selector.replace(".", "\\.")} \\{[^}]*\\}`))?.[0] ?? "";
    // First check the rule was actually found — with an empty string the assertions below prove nothing
    expect(rule(".dsk-view")).toContain("--ink");
    expect(rule(".dsk-stage")).toContain("overflow");
    expect(rule(".dsk-view")).not.toMatch(/background/);
    expect(rule(".dsk-stage")).not.toMatch(/background/);
  });

  it("Chrome colors are design system tokens — the hover wash too (#216)", () => {
    mountDiagramView(root, fakeHost("light"));
    const css = document.getElementById("dsk-view-style")?.textContent ?? "";
    expect(css).toContain(`--hover: ${CHROME_LIGHT.hover};`);
    expect(css).toContain(`--hover: ${CHROME_DARK.hover};`);
    expect(CHROME_LIGHT.hover).toBe("#F0F0F0");
    expect(CHROME_DARK.hover).toBe("#2A2A2A");
  });

  it("The document's color-scheme is the host theme alone — otherwise the iframe paints an opaque backdrop (#202)", async () => {
    const host = fakeHost("light");
    const view = mountDiagramView(root, host);
    view.showResult(drawn("first"));
    expect(document.documentElement.style.colorScheme).toBe("light");
    host.callServerTool.mockResolvedValueOnce(drawn("dark", { theme: "dark" }));
    host.theme = "dark";
    view.hostContextChanged();
    await settle();
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("When the host does not state a theme, lays down the drawing theme's backdrop — without one it may be invisible (#202)", () => {
    const view = mountDiagramView(root, fakeHost(undefined));
    view.showResult(drawn("first", { theme: "dark" }));
    expect(root.hasAttribute("data-backdrop")).toBe(true);
    expect(root.dataset.theme).toBe("dark");
    const themed = document.createElement("div");
    document.body.append(themed);
    const withTheme = mountDiagramView(themed, fakeHost("light"));
    withTheme.showResult(drawn("second"));
    expect(themed.hasAttribute("data-backdrop")).toBe(false);
    const css = document.getElementById("dsk-view-style")?.textContent ?? "";
    expect(css).toMatch(/\.dsk-view\[data-backdrop\] \.dsk-stage \{ background: var\(--bg\)/);
  });

  it("The control buttons float over the drawing and show on hover or focus", () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult(drawn("first"));
    const controls = root.querySelector(".dsk-controls") as HTMLElement;
    // In the same frame as the drawing — they don't take a row of their own above or below
    expect(controls.parentElement).toBe(root.querySelector(".dsk-frame"));
    expect(controls.querySelector('button[aria-label="Zoom in"]')).not.toBeNull();
    expect(root.querySelector(".dsk-bar")).toBeNull();
    const css = document.getElementById("dsk-view-style")?.textContent ?? "";
    expect(css).toMatch(/\.dsk-frame:hover \.dsk-controls/);
    expect(css).toMatch(/\.dsk-frame:focus-within \.dsk-controls/);
    // Always visible on devices without a mouse
    expect(css).toMatch(/@media \(hover: none\)[^}]*\.dsk-controls/);
  });

  it("The control buttons sit bottom right, as icons — clear of the host's top-right menu", () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult(drawn("first"));
    for (const label of ["Zoom out", "Zoom in", "Fit to view", "Refresh", "Open in Dosik"]) {
      const b = root.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
      expect(b, label).not.toBeNull();
      expect(b.querySelector("svg"), label).not.toBeNull();
      expect(b.title, label).toBe(label);
    }
    const css = document.getElementById("dsk-view-style")?.textContent ?? "";
    const rule = css.match(/\.dsk-controls \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("bottom:");
    expect(rule).toContain("right:");
    expect(rule).not.toContain("top:");
    // Stacked vertically — with no box around them
    expect(rule).toContain("flex-direction: column");
    expect(root.querySelector(".dsk-controls")?.classList.contains("dsk-panel")).toBe(false);
    // Start by clearing the default styles the host puts on button — so no border or padding sneaks in
    expect(css).toMatch(/\.dsk-controls button \{ all: unset;/);
    // Use the host's standard variables, falling back to our own values
    expect(css).toContain("var(--color-background-primary,");
    expect(css).toContain("var(--color-border-tertiary,");
    expect(css).toContain("var(--border-radius-lg,");
  });

  it("Fit leaves room for the right button column — so the drawing doesn't end up under the buttons", () => {
    const view = mountDiagramView(root, fakeHost("light"));
    // A wide drawing whose width decides the fit (2000×100)
    view.showResult(
      drawn("wide", {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 100"><text>wide</text></svg>',
      }),
    );
    const stage = root.querySelector(".dsk-stage") as HTMLElement;
    const [x, , w] = (
      (root.querySelector(".dsk-stage > svg") as SVGSVGElement).getAttribute("viewBox") ?? ""
    )
      .split(" ")
      .map(Number);
    // From the drawing's right end (0..2000) to the frame's right edge, a margin the width of the button column (44) remains
    const scale = 640 / w!;
    expect((x! + w! - 2000) * scale).toBeGreaterThanOrEqual(44 - 0.01);
    // The frame is tall enough that the button column doesn't reach the host menu (…) at the top
    expect(Number.parseFloat(stage.style.height)).toBeGreaterThanOrEqual(248);
    const css = document.getElementById("dsk-view-style")?.textContent ?? "";
    const alert = css.match(/\.dsk-alert \{[^}]*\}/)?.[0] ?? "";
    expect(alert).toContain("bottom:");
    expect(alert).not.toContain("top:");
  });

  it("Buttons are 28px and icons 14px", () => {
    mountDiagramView(root, fakeHost("light"));
    const css = document.getElementById("dsk-view-style")?.textContent ?? "";
    expect(css).toMatch(/\.dsk-controls button \{[^}]*width: 28px; height: 28px;/);
    expect(css).toMatch(/\.dsk-controls button svg \{[^}]*width: 14px; height: 14px;/);
  });

  it("Buttons are square, borderless, and darken on hover", () => {
    mountDiagramView(root, fakeHost("light"));
    const css = document.getElementById("dsk-view-style")?.textContent ?? "";
    const base = css.match(/\.dsk-controls button \{[^}]*\}/)?.[0] ?? "";
    expect(base).toContain("aspect-ratio: 1");
    expect(base).toContain("flex: none");
    expect(base).not.toMatch(/border:|box-shadow/);
    const hover = css.match(/\.dsk-controls button:hover:not\(:disabled\) \{[^}]*\}/)?.[0] ?? "";
    expect(hover).toContain("color-mix(in srgb, var(--dsk-button)");
    expect(hover).toContain("#000");
    expect(hover).not.toMatch(/border|box-shadow/);
  });
});
