import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useSidebarStore } from "../../../shared/lib/sidebarLayout";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { handleCanvasKeyDown } from "../../canvas/canvasKeymap";
import { SidebarResizeEdge } from "../SidebarResizeEdge";

const edge = () => screen.getByRole("separator", { name: "Resize sidebar" });
const stored = () => JSON.parse(localStorage.getItem("dosik.sidebar") ?? "null") as unknown;
const state = () => useSidebarStore.getState();

/** one animation frame at a time, run by the test */
const frames: FrameRequestCallback[] = [];
const runFrames = () =>
  act(() => {
    for (const cb of frames.splice(0)) cb(0);
  });

describe("sidebar edge (#217 D14·D28, T32)", () => {
  beforeEach(() => {
    localStorage.clear();
    frames.length = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    useSidebarStore.setState({
      hidden: false,
      width: 248,
      hinted: false,
      peek: false,
      resizing: false,
    });
    useToastStore.getState().dismissAll();
  });
  afterEach(() => {
    // timers first: fake timers stand in for requestAnimationFrame too, and
    // undoing them after the spy leaves the window without one
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.style.cursor = "";
  });

  it("separator — current width, min 200, max as much as the window allows (jsdom 1024 − 712)", () => {
    render(<SidebarResizeEdge />);
    expect(edge()).toHaveAttribute("aria-orientation", "vertical");
    expect(edge()).toHaveAttribute("aria-valuenow", "248");
    expect(edge()).toHaveAttribute("aria-valuemin", "200");
    expect(edge()).toHaveAttribute("aria-valuemax", "312");
    // the 10px hit band is centred on the sidebar's edge (#70)
    expect((edge().parentElement as HTMLElement).style.left).toBe(`${248 - 5}px`);
  });

  it("←→ 8px, Shift 40px, Home·End go to min·max — saved on each press", () => {
    render(<SidebarResizeEdge />);
    fireEvent.keyDown(edge(), { key: "ArrowRight" });
    expect(state().width).toBe(256);
    expect(stored()).toMatchObject({ width: 256 });
    fireEvent.keyDown(edge(), { key: "ArrowLeft", shiftKey: true });
    expect(state().width).toBe(216);
    fireEvent.keyDown(edge(), { key: "ArrowLeft", shiftKey: true });
    expect(state().width).toBe(200);
    fireEvent.keyDown(edge(), { key: "End" });
    expect(state().width).toBe(312);
    fireEvent.keyDown(edge(), { key: "Home" });
    expect(state().width).toBe(200);
    // the keyboard resizes; it does not hide
    expect(state().hidden).toBe(false);
  });

  it("dragging changes the width at most once per frame and saves once at the end", () => {
    render(<SidebarResizeEdge />);
    fireEvent.pointerDown(edge(), { clientX: 250, button: 0, isPrimary: true, pointerId: 1 });
    expect(state().resizing).toBe(true);
    expect(document.body.style.cursor).toBe("col-resize");
    fireEvent.pointerMove(window, { clientX: 290, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 302, pointerId: 1 });
    expect(state().width).toBe(248);
    runFrames();
    // the grab point stays under the pointer: 248 + (302 − 250)
    expect(state().width).toBe(300);
    expect(localStorage.getItem("dosik.sidebar")).toBeNull();
    fireEvent.pointerUp(window, { clientX: 302, pointerId: 1 });
    expect(state()).toMatchObject({ resizing: false, width: 300 });
    expect(stored()).toMatchObject({ hidden: false, width: 300 });
    expect(document.body.style.cursor).toBe("");
  });

  it("dragging below 160 hides it, coming back above 200 in the same gesture shows it — ending hidden shows a toast", () => {
    render(<SidebarResizeEdge />);
    fireEvent.pointerDown(edge(), { clientX: 248, button: 0, isPrimary: true, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 150, pointerId: 1 });
    runFrames();
    expect(state().hidden).toBe(true);
    fireEvent.pointerMove(window, { clientX: 210, pointerId: 1 });
    runFrames();
    expect(state()).toMatchObject({ hidden: false, width: 210 });
    fireEvent.pointerMove(window, { clientX: 100, pointerId: 1 });
    runFrames();
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(state()).toMatchObject({ hidden: true, width: 248, resizing: false });
    expect(useToastStore.getState().toasts.map((t) => [t.text, t.keys])).toEqual([
      ["Sidebar hidden · Ctrl+\\ to show", "Ctrl+\\"],
    ]);
  });

  it("ignores other buttons and other pointers", () => {
    render(<SidebarResizeEdge />);
    fireEvent.pointerDown(edge(), { clientX: 248, button: 2, isPrimary: true, pointerId: 1 });
    expect(state().resizing).toBe(false);
    fireEvent.pointerDown(edge(), { clientX: 248, button: 0, isPrimary: true, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 300, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });
    runFrames();
    expect(state()).toMatchObject({ resizing: true, width: 248 });
  });

  it("restores the cursor and ends the gesture if it disappears mid-drag", () => {
    const { unmount } = render(<SidebarResizeEdge />);
    fireEvent.pointerDown(edge(), { clientX: 248, button: 0, isPrimary: true, pointerId: 1 });
    unmount();
    expect(document.body.style.cursor).toBe("");
    expect(state().resizing).toBe(false);
    fireEvent.pointerMove(window, { clientX: 350, pointerId: 1 });
    runFrames();
    expect(state().width).toBe(248);
  });

  it("a tooltip inside the sidebar at pointer height after 600ms of hovering — not when just passing by", () => {
    vi.useFakeTimers();
    render(<SidebarResizeEdge />);
    fireEvent.pointerEnter(edge(), { clientY: 300 });
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerLeave(edge());
    act(() => vi.advanceTimersByTime(600));
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerEnter(edge(), { clientY: 300 });
    act(() => vi.advanceTimersByTime(600));
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Drag to resize");
    expect(tip).toHaveTextContent("drag past the edge to hide");
    expect(tip.style.top).toBe("300px");
    fireEvent.pointerDown(edge(), { clientX: 248, button: 0, isPrimary: true, pointerId: 1 });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keys received by the edge do not leak to the canvas — Backspace·Delete·Enter (T35)", async () => {
    const user = userEvent.setup();
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "n1" })], []), null);
    useDiagramStore.setState({
      nodes: useDiagramStore.getState().nodes.map((n) => ({ ...n, selected: true })),
    });
    window.addEventListener("keydown", handleCanvasKeyDown);
    try {
      render(<SidebarResizeEdge />);
      act(() => edge().focus());
      await user.keyboard("{Backspace}{Delete}");
      expect(useDiagramStore.getState().nodes).toHaveLength(1);
      // Enter would start editing the selected shape's label
      await user.keyboard("{Enter}");
      expect(useDiagramStore.getState().editRequestId).toBeNull();
    } finally {
      window.removeEventListener("keydown", handleCanvasKeyDown);
    }
  });
});
