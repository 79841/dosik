import { getCurrentWindow } from "@tauri-apps/api/window";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSidebarStore } from "../../../shared/lib/sidebarLayout";
import { useSidebarSlideStore } from "../../../shared/lib/sidebarSlide";
import { useDiagramStore } from "../../../shared/lib/store";
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

  it("the tabs glide with the docked sidebar's slide — 200ms, the slide's ease — and only then (canvas TabsCollapse-Toggle)", () => {
    render(<ChromeBand mac />);
    const glide = ["motion-safe:transition-[left]", "motion-safe:duration-200"];
    expect(placeOf(tablist())).not.toHaveClass(glide[0]!);
    act(() => {
      useSidebarStore.setState({ hidden: true });
      useSidebarSlideStore.setState({ phase: "closing" });
    });
    expect(placeOf(tablist())).toHaveClass(...glide);
    expect(placeOf(tablist()).style.left).toBe("124px");
    act(() => useSidebarSlideStore.setState({ phase: "closed" }));
    // a resize drag moves them with the pointer, not after it
    expect(placeOf(tablist())).not.toHaveClass(glide[0]!);
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
