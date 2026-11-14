import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const crash = vi.hoisted(() => ({ body: false }));
vi.mock("../LibrarySidebar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../LibrarySidebar")>();
  return {
    ...actual,
    LibraryBody: () => {
      if (crash.body) throw new Error("boom: tree failed");
      return actual.LibraryBody();
    },
  };
});

import { useSidebarStore } from "../../../shared/lib/sidebarLayout";
import { useDiagramStore } from "../../../shared/lib/store";
import { useAppStore } from "../../library/appStore";
import { blankDoc } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { ShowSidebarButton, SidebarPeek } from "../SidebarPeek";
import { resetTreeForTests } from "../treeStore";

const show = () => screen.getByRole("button", { name: "Show sidebar" });
const peek = () => screen.queryByRole("complementary", { name: "Library" });
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

/** jsdom hovers nothing: from here on, `:hover` matches `el` */
const hover = (el: Element) => {
  const matches = Element.prototype.matches;
  return vi.spyOn(Element.prototype, "matches").mockImplementation(function (
    this: Element,
    selector: string,
  ) {
    return selector === ":hover" ? this === el : matches.call(this, selector);
  });
};

const renderChrome = () =>
  render(
    <>
      <ShowSidebarButton />
      <SidebarPeek />
      <button type="button">elsewhere</button>
    </>,
  );

describe("peek (#217 D16, T31)", () => {
  beforeEach(() => {
    crash.body = false;
    vi.useFakeTimers();
    localStorage.clear();
    resetTreeForTests();
    useDiagramStore.getState().loadDoc(blankDoc(), null);
    useAppStore.setState({ view: "home", homeView: { kind: "dashboard" } });
    useLibraryStore.setState({ folders: [], readFailed: false });
    useSidebarStore.setState({ hidden: true, width: 248, hinted: true, peek: false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens only after hovering the Show button for 120ms — not when just passing by", () => {
    renderChrome();
    fireEvent.pointerEnter(show());
    wait(100);
    expect(peek()).toBeNull();
    fireEvent.pointerLeave(show());
    wait(200);
    expect(peek()).toBeNull();
    fireEvent.pointerEnter(show());
    wait(120);
    expect(peek()).toBeInTheDocument();
    // the button is its name and its shortcut, not a tooltip: hovering opens the peek
    expect(show()).toHaveAttribute("aria-keyshortcuts", "Control+Backslash");
    expect(show()).toHaveAttribute("aria-controls", "library-peek");
    expect(screen.queryByRole("tooltip", { name: "Show sidebar" })).toBeNull();
  });

  it("closes 300ms after leaving both the button and the panel — stays if the pointer comes back in between", () => {
    renderChrome();
    fireEvent.pointerEnter(show());
    wait(120);
    fireEvent.pointerLeave(show());
    wait(200);
    // across the 12px gap into the panel
    fireEvent.pointerEnter(peek()!);
    wait(400);
    expect(peek()).toBeInTheDocument();
    fireEvent.pointerLeave(peek()!);
    wait(299);
    expect(peek()).toBeInTheDocument();
    wait(1);
    expect(peek()).toBeNull();
    expect(useSidebarStore.getState()).toMatchObject({ hidden: true, peek: false });
  });

  it("closes with Escape", () => {
    renderChrome();
    fireEvent.pointerEnter(show());
    wait(120);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(peek()).toBeNull();
  });

  it("Escape while dragging inside the peek only cancels the drag and does not close the peek (#230)", () => {
    useLibraryStore.setState({
      folders: [
        {
          id: "work",
          name: "Work",
          updatedAt: 2,
          diagrams: [],
          folders: [],
        },
        { id: "home", name: "Personal", updatedAt: 1, diagrams: [], folders: [] },
      ],
    });
    useSidebarStore.setState({ peek: true });
    renderChrome();
    const row = within(peek()!)
      .getByRole("treeitem", { name: /^Personal/ })
      .querySelector("[data-row]") as HTMLElement;
    const move = (type: string, x: number, y: number) => {
      const ev = new Event(type) as PointerEvent;
      Object.assign(ev, { clientX: x, clientY: y });
      act(() => {
        window.dispatchEvent(ev);
      });
    };
    fireEvent.pointerDown(row, { button: 0, clientX: 60, clientY: 100 });
    move("pointermove", 60, 120);
    expect(document.body.querySelector("[data-drag-row]")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.body.querySelector("[data-drag-row]")).toBeNull();
    expect(peek()).not.toBeNull();
    move("pointerup", 60, 120);
  });

  it("does not close on leaving while focus is inside the panel — closes when focus leaves", () => {
    renderChrome();
    fireEvent.pointerEnter(show());
    wait(120);
    const newProject = screen.getByRole("button", { name: "New project" });
    act(() => newProject.focus());
    fireEvent.pointerLeave(show());
    wait(400);
    expect(peek()).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: "elsewhere" }).focus());
    wait(300);
    expect(peek()).toBeNull();
  });

  it("does not close when focus leaves while the pointer is over the panel — closes when the pointer leaves (#217)", () => {
    renderChrome();
    fireEvent.pointerEnter(show());
    wait(120);
    const aside = peek()!;
    fireEvent.pointerLeave(show());
    fireEvent.pointerEnter(aside);
    const hovering = hover(aside);
    try {
      act(() => screen.getByRole("button", { name: "New project" }).focus());
      // focus moves out from under the pointer — a dialog, a programmatic focus
      act(() => screen.getByRole("button", { name: "elsewhere" }).focus());
      wait(400);
      expect(peek()).toBeInTheDocument();
    } finally {
      hovering.mockRestore();
    }
    fireEvent.pointerLeave(aside);
    wait(300);
    expect(peek()).toBeNull();
  });

  it("the peek survives a tree crash — it has its own boundary like the sidebar (#217)", () => {
    crash.body = true;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderChrome();
      fireEvent.pointerEnter(show());
      wait(120);
      const aside = peek()!;
      expect(within(aside).getByText("Something went wrong")).toBeInTheDocument();
      expect(within(aside).getByRole("button", { name: "Keep sidebar open" })).toBeInTheDocument();
      expect(show()).toBeInTheDocument();
    } finally {
      quiet.mockRestore();
    }
  });

  it("does not open on keyboard focus — Enter and click dock it", () => {
    renderChrome();
    act(() => show().focus());
    wait(500);
    expect(peek()).toBeNull();
    fireEvent.click(show());
    expect(useSidebarStore.getState()).toMatchObject({ hidden: false, peek: false });
  });

  it("the header is 'Library' and Pin — clicking it docks (T10)", () => {
    renderChrome();
    fireEvent.pointerEnter(show());
    wait(120);
    const aside = peek()!;
    expect(aside).toHaveAttribute("id", "library-peek");
    expect(screen.getByText("Library")).toBeInTheDocument();
    // the same body as the docked sidebar: Views, the tree, the footer — no brand row
    expect(screen.getByRole("navigation", { name: "Views" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open file…" })).toBeInTheDocument();
    expect(screen.queryByText("Dosik")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep sidebar open" }));
    expect(useSidebarStore.getState()).toMatchObject({ hidden: false, peek: false });
  });

  it("floats above the content — left 8 · top 48 · bottom 8, the chosen width, opacity only without transform", () => {
    useSidebarStore.setState({ width: 300 });
    renderChrome();
    fireEvent.pointerEnter(show());
    wait(120);
    const aside = peek()!;
    expect(aside.className).toMatch(/(^|\s)fixed(\s|$)/);
    expect(aside).toHaveClass("left-2", "top-12", "bottom-2", "rounded-xl", "shadow-overlay");
    expect(aside.style.width).toBe("300px");
    // a transformed ancestor would misplace the tree's fixed menus (#206)
    expect(aside.className).not.toMatch(/translate|scale|rotate|transform/);
    expect(aside).toHaveClass("nodelete");
  });

  it("a docked sidebar cannot be peeked", () => {
    useSidebarStore.setState({ hidden: false });
    render(<SidebarPeek />);
    act(() => useSidebarStore.getState().openPeek());
    expect(peek()).toBeNull();
  });
});
