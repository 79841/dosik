import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSidebarStore } from "../../../shared/lib/sidebarLayout";
import { useDiagramStore } from "../../../shared/lib/store";
import { resetWindowFrame, useWindowFrame } from "../../../shared/lib/windowFrame";
import { useAppStore } from "../../library/appStore";
import { blankDoc } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { ChromeBand } from "../ChromeBand";

const band = () => document.querySelector("[data-chrome-band]") as HTMLElement;
/** the positioned box a band control sits in */
const placeOf = (el: HTMLElement) => el.closest("[data-band-slot]") as HTMLElement;
const tablist = () => screen.getByRole("tablist", { name: "Open documents" });

describe("window band (#217 R1, D19~D21)", () => {
  beforeEach(() => {
    localStorage.clear();
    useDiagramStore.getState().loadDoc(blankDoc(), null);
    useAppStore.setState({ view: "home", homeView: { kind: "dashboard" } });
    useLibraryStore.setState({ folders: [], readFailed: false });
    useSidebarStore.setState({
      hidden: false,
      width: 248,
      hinted: true,
      peek: false,
      focusAfter: null,
    });
    vi.mocked(getCurrentWindow).mockClear();
    resetWindowFrame();
  });

  it("a 40px band across the window — the window drag handle; keys do not leak to the canvas (T4)", () => {
    render(<ChromeBand mac />);
    expect(band()).toHaveAttribute("data-tauri-drag-region", "deep");
    expect(band()).toHaveClass("h-10", "nodelete");
  });

  it("docked: the sidebar's top row — Hide sidebar 8 inside the sidebar's right edge, tabs at width + 8 (T2)", () => {
    render(<ChromeBand mac />);
    const hide = screen.getByRole("button", { name: "Hide sidebar" });
    // 248 − 8 − 24
    expect(placeOf(hide).style.left).toBe("216px");
    expect(placeOf(tablist()).style.left).toBe("256px");
    expect(screen.queryByRole("button", { name: "Show sidebar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  it("hidden (macOS): traffic lights → Show sidebar (x=88) → tabs (124) … ⋯ More (T2)", () => {
    useSidebarStore.setState({ hidden: true });
    render(<ChromeBand mac />);
    const show = screen.getByRole("button", { name: "Show sidebar" });
    expect(placeOf(show).style.left).toBe("88px");
    expect(placeOf(tablist()).style.left).toBe("124px");
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide sidebar" })).toBeNull();
    // macOS draws its own lights
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("hidden (other): Show sidebar x=12, tabs 48, window controls at the right end — More to their left (D20)", () => {
    useSidebarStore.setState({ hidden: true });
    render(<ChromeBand mac={false} />);
    expect(placeOf(screen.getByRole("button", { name: "Show sidebar" })).style.left).toBe("12px");
    expect(placeOf(tablist()).style.left).toBe("48px");
    const end = within(band().querySelector("[data-band-end]") as HTMLElement);
    expect(
      end.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toEqual(["More", "Minimize", "Maximize", "Close"]);
  });

  it("on other platforms the window controls sit at the right end of the band even when docked (T3)", () => {
    render(<ChromeBand mac={false} />);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("Hide → hides and focus goes to Show; clicking Show → docks and focus goes to Hide (T29)", async () => {
    const user = userEvent.setup();
    render(<ChromeBand mac />);
    await user.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(useSidebarStore.getState().hidden).toBe(true);
    expect(screen.getByRole("button", { name: "Show sidebar" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(useSidebarStore.getState().hidden).toBe(false);
    expect(screen.getByRole("button", { name: "Hide sidebar" })).toHaveFocus();
    expect(useSidebarStore.getState().focusAfter).toBeNull();
  });

  it("does not move focus when hiding or showing if focus was outside the sidebar", () => {
    render(
      <>
        <ChromeBand mac />
        <input aria-label="canvas field" />
      </>,
    );
    const field = screen.getByRole("textbox", { name: "canvas field" });
    field.focus();
    act(() => useSidebarStore.getState().hide());
    expect(field).toHaveFocus();
    act(() => useSidebarStore.getState().show());
    expect(field).toHaveFocus();
  });
});

describe("the band off macOS, as a title bar (the canvas's Win-Home, Win-Hidden, Win-Caption)", () => {
  const end = () => band().querySelector("[data-band-end]") as HTMLElement;
  const captions = () => band().querySelector("[data-window-controls]") as HTMLElement | null;
  const windowMenuCalls = () =>
    vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "show_window_menu");

  beforeEach(() => {
    localStorage.clear();
    useDiagramStore.getState().loadDoc(blankDoc(), null);
    useAppStore.setState({ view: "home", homeView: { kind: "dashboard" } });
    useLibraryStore.setState({ folders: [], readFailed: false });
    useSidebarStore.setState({
      hidden: false,
      width: 248,
      hinted: true,
      peek: false,
      focusAfter: null,
    });
    resetWindowFrame();
    vi.mocked(invoke).mockClear();
  });

  it("docked: only the caption buttons at the band's end, flush with the window's corner", () => {
    render(<ChromeBand mac={false} />);
    expect(
      within(end())
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Minimize", "Maximize", "Close"]);
    // no right or top inset: the buttons touch the corner
    expect(end().className).not.toMatch(/\bpr-|\bpt-/);
  });

  it("hidden: ⋯ More sits 8 left of the caption buttons, on the centre line", () => {
    useSidebarStore.setState({ hidden: true });
    render(<ChromeBand mac={false} />);
    const more = screen
      .getByRole("button", { name: "More" })
      .closest("[data-band-more]") as HTMLElement;
    expect(more).toHaveClass("pt-3", "pr-2");
    expect(more.nextElementSibling).toBe(captions());
  });

  it("full screen: no caption buttons, ⋯ More back 12 from the right edge, and the band is no drag handle", () => {
    useSidebarStore.setState({ hidden: true });
    useWindowFrame.setState({ fullscreen: true });
    render(<ChromeBand mac={false} />);
    expect(captions()).toBeNull();
    expect(end()).toHaveClass("pr-3");
    const more = screen
      .getByRole("button", { name: "More" })
      .closest("[data-band-more]") as HTMLElement;
    expect(more).not.toHaveClass("pr-2");
    // no drag and no double-click maximize while the window fills the screen
    expect(band()).not.toHaveAttribute("data-tauri-drag-region");
  });

  it("macOS keeps the drag handle in full screen — the native window manages it", () => {
    useWindowFrame.setState({ fullscreen: true });
    render(<ChromeBand mac />);
    expect(band()).toHaveAttribute("data-tauri-drag-region", "deep");
  });

  it("a right click on the empty band opens the window menu at the pointer, once, instead of the browser's", () => {
    render(<ChromeBand mac={false} />);
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    band().dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(windowMenuCalls()).toEqual([["show_window_menu", { atPointer: true }]]);
  });

  it("not on a tab or a button — those keep their own menu, or none", () => {
    useSidebarStore.setState({ hidden: true });
    render(<ChromeBand mac={false} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "More" }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "Close" }));
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Library" }));
    expect(windowMenuCalls()).toHaveLength(0);
  });

  it("not on macOS, and not in full screen", () => {
    const { unmount } = render(<ChromeBand mac />);
    fireEvent.contextMenu(band());
    unmount();
    useWindowFrame.setState({ fullscreen: true });
    render(<ChromeBand mac={false} />);
    fireEvent.contextMenu(band());
    expect(windowMenuCalls()).toHaveLength(0);
  });

  it("a refused window menu is quiet", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("no such command"));
    render(<ChromeBand mac={false} />);
    fireEvent.contextMenu(band());
    await new Promise((r) => setTimeout(r, 0));
    expect(windowMenuCalls()).toHaveLength(1);
  });
});
