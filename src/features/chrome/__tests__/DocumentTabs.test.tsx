import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useAppStore } from "../../library/appStore";
import { blankDoc } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { openDocument, resetTabsForTests, showHomeTab } from "../../library/tabActions";
import { newTab } from "../../library/tabModel";
import { resetUnsavedGuardForTests } from "../../library/unsavedGuard";
import { resetAutosaveForTests } from "../../library/useAutosave";
import { DocumentTabs } from "../DocumentTabs";

const mockedAsk = vi.mocked(ask);
const mockedInvoke = vi.mocked(invoke);
const tablist = () => screen.getByRole("tablist", { name: "Open documents" });
const tabs = () => within(tablist()).getAllByRole("tab");
/** the pinned first tab — Home's last view, named "Library" (#231 D16) */
const homeTab = () => within(tablist()).getByRole("tab", { name: "Library" });
const docTab = (name: string | RegExp) => within(tablist()).getByRole("tab", { name });
const strip = () => document.querySelector("[data-tab-scroll]") as HTMLElement;

/** the width the strip's box reports — what a ResizeObserver would say */
let observed: ((width: number) => void)[] = [];
class ResizeObserverStub {
  constructor(private cb: ResizeObserverCallback) {}
  observe() {
    observed.push((width) =>
      this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as never),
    );
  }
  unobserve() {}
  disconnect() {}
}
const resize = (width: number) =>
  act(() => {
    for (const fn of observed) fn(width);
  });

const library = () =>
  useLibraryStore.setState({
    folders: [
      {
        id: "work",
        name: "Work",
        updatedAt: 1,
        diagrams: [
          { id: "p1", title: "Login flow", updatedAt: 1, readable: true },
          { id: "p2", title: "Checkout", updatedAt: 1, readable: true },
          { id: "p3", title: "Listed title", updatedAt: 1, readable: true },
        ],
        folders: [
          {
            id: "sub",
            name: "Sub",
            updatedAt: 1,
            diagrams: [{ id: "deep", title: "Deep title", updatedAt: 1, readable: true }],
            folders: [],
          },
        ],
      },
    ],
  });
const open = (title: string, projectId: string) =>
  act(() => {
    openDocument({ ...blankDoc(), title }, { projectId });
  });

describe("document tab strip (#218 R1, D13·D14·D22, T38)", () => {
  const RealObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    observed = [];
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useLibraryStore.setState({ folders: [], readFailed: false });
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
    mockedInvoke.mockResolvedValue(undefined);
  });
  afterEach(() => {
    globalThis.ResizeObserver = RealObserver;
  });

  it("one Library tab — pinned, icon only, selected, no close", () => {
    render(<DocumentTabs />);
    expect(tabs()).toHaveLength(1);
    expect(homeTab()).toHaveAttribute("aria-selected", "true");
    expect(homeTab()).toHaveAttribute("aria-controls", "doc-panel");
    expect(homeTab()).toHaveAttribute("id", "doc-tab-home");
    expect(homeTab()).toHaveAttribute("title", "Library");
    // 36 wide, the icon alone
    expect(homeTab()).toHaveClass("w-9");
    expect(homeTab().textContent).toBe("");
    expect(screen.queryByRole("button", { name: /^Close/ })).toBeNull();
    expect(screen.getByRole("button", { name: "New diagram" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+T",
    );
  });

  it("the Library tab icon is the app mark — not a house; the house belongs to the sidebar Home row (#231 D16, T2)", () => {
    render(<DocumentTabs />);
    const icons = homeTab().querySelectorAll("svg");
    expect(icons).toHaveLength(1);
    const [icon] = icons;
    // AppGlyph's four shapes, not Lucide's House
    expect(icon).not.toHaveClass("lucide-house");
    expect([...(icon?.children ?? [])].map((s) => s.tagName.toLowerCase())).toEqual([
      "rect",
      "path",
      "circle",
      "path",
    ]);
    expect(icon).toHaveAttribute("width", "15");
    expect(icon).toHaveAttribute("stroke-width", "1.75");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("a tab per document — the active one shows the live title, title is project / title, no dot (#229 D19)", () => {
    library();
    open("Login flow", "p1");
    act(() => {
      openDocument(makeDoc([], [], "Ext"), { filePath: "/tmp/ext.dosik.json" });
    });
    open("Checkout", "p2");
    render(<DocumentTabs />);
    expect(tabs().map((t) => t.getAttribute("aria-label") ?? t.textContent)).toEqual([
      "Library",
      "Login flow",
      "Ext",
      "Checkout",
    ]);
    const active = docTab("Checkout");
    expect(active).toHaveAttribute("aria-selected", "true");
    expect(active).toHaveAttribute("aria-controls", "doc-panel");
    expect(active).toHaveAttribute("title", "Work / Checkout");
    expect(active).toHaveAttribute("aria-keyshortcuts", "Control+W");
    // no project dot anywhere (#229 D19)
    expect(active.querySelector("[data-project-dot]")).toBeNull();
    expect(active.querySelector(".bg-project-grey")).toBeNull();
    expect(docTab("Ext")).toHaveAttribute("title", "/tmp/ext.dosik.json");
    expect(docTab("Ext").querySelector("[data-project-dot]")).toBeNull();
    expect(docTab("Ext")).toHaveAttribute("aria-selected", "false");
    expect(docTab("Ext")).not.toHaveAttribute("aria-controls");
    act(() => useDiagramStore.getState().setTitle("Checkout v2"));
    expect(docTab("Checkout v2")).toHaveAttribute("title", "Work / Checkout v2");
    expect(screen.getByRole("button", { name: "Close Checkout v2" })).toBeInTheDocument();
  });

  it("a diagram in nested folders — title is the path from the top (#229 D10)", () => {
    library();
    open("Deep", "deep");
    render(<DocumentTabs />);
    expect(docTab("Deep")).toHaveAttribute("title", "Work / Sub / Deep");
  });

  it("an unread tab shows the listing title, else the saved title — aria-busy while reading", () => {
    library();
    useAppStore.getState().commitTabs({
      tabs: [
        { ...newTab({ projectId: "p3", filePath: null, title: "Saved" }, false), loading: true },
        newTab({ projectId: "gone", filePath: null, title: "Saved only" }, false),
      ],
      activeTab: null,
    });
    render(<DocumentTabs />);
    expect(docTab("Listed title")).toHaveAttribute("aria-busy", "true");
    expect(docTab("Saved only")).not.toHaveAttribute("aria-busy");
  });

  it("separators only between inactive document tabs — none beside the active tab or after the Library tab", () => {
    open("A", "p1");
    open("B", "p2");
    open("C", "p3");
    act(() => showHomeTab());
    const { rerender } = render(<DocumentTabs />);
    const separators = () => tabs().map((t) => t.querySelector("[data-tab-separator]") !== null);
    expect(separators()).toEqual([false, true, true, false]);
    act(() => {
      openDocument({ ...blankDoc(), title: "B" }, { projectId: "p2" });
    });
    rerender(<DocumentTabs />);
    expect(separators()).toEqual([false, false, false, false]);
  });

  it("the close button is outside the tablist, 25 from the tab's right edge — named Close {title}", () => {
    open("Login flow", "p1");
    open("Checkout", "p2");
    render(<DocumentTabs />);
    const closeA = screen.getByRole("button", { name: "Close Login flow" });
    const closeB = screen.getByRole("button", { name: "Close Checkout" });
    expect(tablist()).not.toContainElement(closeA);
    // strip coordinates: Home 0–36, A 38–214, B 216–392
    // — the pinned cell's 2 of padding covers the gap after Home, and its -2 of
    // margin gives the gap back, so A starts at 38 as the model has it, not 40
    // (Main and the DS tab strip: one 2px gap between every tab)
    expect(homeTab().parentElement).toHaveClass("sticky", "pr-0.5", "-mr-0.5");
    expect(tablist()).toHaveClass("gap-0.5");
    expect(closeA.style.left).toBe("189px");
    expect(closeB.style.left).toBe("367px");
    expect(closeB).toHaveClass("text-icon");
    expect(closeA).toHaveClass("text-muted-strong");
  });

  it("click → activate, × → close, middle click → close, Library tab → Home (document tabs stay)", async () => {
    const user = userEvent.setup();
    open("Login flow", "p1");
    open("Checkout", "p2");
    open("Ledger", "p3");
    render(<DocumentTabs />);
    await user.click(docTab("Login flow"));
    expect(useDiagramStore.getState().projectId).toBe("p1");
    await user.click(screen.getByRole("button", { name: "Close Checkout" }));
    await waitFor(() => expect(useAppStore.getState().tabs).toHaveLength(2));
    fireEvent(docTab("Ledger"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    await waitFor(() => expect(useAppStore.getState().tabs).toHaveLength(1));
    await user.click(homeTab());
    expect(useAppStore.getState().view).toBe("home");
    expect(tabs()).toHaveLength(2);
    expect(mockedAsk).not.toHaveBeenCalled();
  });

  it("closing the active tab with × moves focus to the new active tab", async () => {
    const user = userEvent.setup();
    open("Login flow", "p1");
    open("Checkout", "p2");
    render(<DocumentTabs />);
    await user.click(screen.getByRole("button", { name: "Close Checkout" }));
    await waitFor(() => expect(docTab("Login flow")).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Close Login flow" }));
    await waitFor(() => expect(homeTab()).toHaveFocus());
  });

  it("× on an unsaved external file — asks, and Cancel leaves it open", async () => {
    const user = userEvent.setup();
    act(() => {
      openDocument(makeDoc([], [], "Ext"), { filePath: "/tmp/ext.dosik.json" });
    });
    act(() => {
      useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
    });
    render(<DocumentTabs />);
    await user.click(screen.getByRole("button", { name: "Close Ext" }));
    await waitFor(() => expect(mockedAsk).toHaveBeenCalledTimes(1));
    expect(tabs()).toHaveLength(2);
  });

  it("←→ move focus only, Home/End, Enter activates — activating switches screens, so it is chosen by hand", async () => {
    const user = userEvent.setup();
    open("Login flow", "p1");
    open("Checkout", "p2");
    render(<DocumentTabs />);
    const [home, a, b] = tabs();
    // one tab stop: the selected tab
    expect(b).toHaveAttribute("tabindex", "0");
    expect(home).toHaveAttribute("tabindex", "-1");
    expect(a).toHaveAttribute("tabindex", "-1");
    await user.tab();
    expect(b).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(a).toHaveFocus();
    expect(useDiagramStore.getState().projectId).toBe("p2");
    await user.keyboard("{Home}");
    expect(home).toHaveFocus();
    await user.keyboard("{End}");
    expect(b).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(home).toHaveFocus();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(useDiagramStore.getState().projectId).toBe("p1");
  });

  it("176 when roomy — shrinks evenly as space narrows, stops at 112 and scrolls horizontally", () => {
    for (const [title, id] of [
      ["A", "p1"],
      ["B", "p2"],
      ["C", "p3"],
    ] as const)
      open(title, id);
    render(<DocumentTabs />);
    expect(docTab("A").style.width).toBe("176px");
    // 36 + 3·(2 + w) + the + button's 30 in 400: w = 110 → 112, overflow
    resize(400);
    expect(docTab("A").style.width).toBe("112px");
    // 370 of room, and 8 past each end for the fillets (D22)
    expect(strip().style.width).toBe("386px");
    expect(strip()).toHaveAttribute("data-overflow", "true");
    resize(600);
    expect(docTab("A").style.width).toBe("176px");
    expect(strip()).toHaveAttribute("data-overflow", "false");
  });

  it("the vertical wheel scrolls horizontally only when overflowing — hidden ends fade", () => {
    for (const [title, id] of [
      ["A", "p1"],
      ["B", "p2"],
      ["C", "p3"],
    ] as const)
      open(title, id);
    act(() => showHomeTab());
    render(<DocumentTabs />);
    fireEvent.wheel(strip(), { deltaY: 40 });
    expect(strip().scrollLeft).toBe(0);
    resize(300);
    expect(strip()).toHaveAttribute("data-fade", "right");
    fireEvent.wheel(strip(), { deltaY: 40 });
    expect(strip().scrollLeft).toBe(40);
    fireEvent.scroll(strip());
    expect(strip()).toHaveAttribute("data-fade", "both");
  });

  it("the seam curves under the active tab are not clipped — the scroll box is 8 wider on each side and gives that back as padding (#231 D22)", () => {
    open("A", "p1");
    open("B", "p2");
    render(<DocumentTabs />);
    resize(600);
    // content 36 + 2·(2 + 176) = 392; the clip reaches 8 past each end, where
    // the active tab's 8px fillets hang — its -8 margins keep the layout as it was
    expect(strip().style.width).toBe("408px");
    expect(strip()).toHaveClass("-mx-2");
    expect(strip().firstElementChild).toHaveClass("px-2");
    const fillets = docTab("B").querySelectorAll("[data-tab-fillet]");
    expect(fillets).toHaveLength(2);
    expect(docTab("A").querySelectorAll("[data-tab-fillet]")).toHaveLength(0);
    // nothing is scrolled under the pinned Library cell, so it covers nothing —
    // the first tab's left fillet (over the cell's right edge) shows
    expect(homeTab().parentElement).toHaveClass("-ml-2", "pl-2");
    expect(homeTab().parentElement).not.toHaveClass("bg-frame");
    expect(homeTab().parentElement).not.toHaveClass("z-10");
  });

  it("when scrolled, the Library cell becomes a cover — hiding tabs that slid under it and their curves (#231 D22)", () => {
    for (const [title, id] of [
      ["A", "p1"],
      ["B", "p2"],
      ["C", "p3"],
    ] as const)
      open(title, id);
    render(<DocumentTabs />);
    resize(300);
    expect(strip().scrollLeft).toBeGreaterThan(0);
    expect(homeTab().parentElement).toHaveClass("bg-frame", "z-10");
    // the fades start past the 8 of fillet room: Library's cell [0, 46] stays sharp
    expect(strip().className).toContain("black_46px,transparent_46px,black_70px");
    // back at the start, nothing is under it again
    strip().scrollLeft = 0;
    fireEvent.scroll(strip());
    expect(homeTab().parentElement).not.toHaveClass("bg-frame");
    expect(homeTab().parentElement).not.toHaveClass("z-10");
    expect(strip().className).toContain("to_left,transparent_8px,black_32px");
  });

  it("curves take no clicks — the covered corner belongs to the neighbouring tab (#231 D22)", () => {
    open("A", "p1");
    open("B", "p2");
    render(<DocumentTabs />);
    for (const fillet of docTab("B").querySelectorAll("[data-tab-fillet]"))
      expect(fillet).toHaveClass("pointer-events-none");
  });

  it("when Home is active, the Library tab carries both curves", () => {
    open("A", "p1");
    act(() => showHomeTab());
    render(<DocumentTabs />);
    expect(homeTab().querySelectorAll("[data-tab-fillet]")).toHaveLength(2);
  });

  it("the active tab scrolls into view — when activated and when resized", () => {
    for (const [title, id] of [
      ["A", "p1"],
      ["B", "p2"],
      ["C", "p3"],
    ] as const)
      open(title, id);
    render(<DocumentTabs />);
    // 270 for the strip: C (38 + 2·114 = 266 … 378) must end at the right edge
    resize(300);
    expect(strip().scrollLeft).toBe(378 - 270);
    act(() => {
      openDocument({ ...blankDoc(), title: "A" }, { projectId: "p1" });
    });
    // A at 38 sits right after the pinned Home
    expect(strip().scrollLeft).toBe(0);
  });

  it("+ New diagram — opens in a new tab", async () => {
    const user = userEvent.setup();
    render(<DocumentTabs mac />);
    const plus = screen.getByRole("button", { name: "New diagram" });
    expect(plus).toHaveAttribute("aria-keyshortcuts", "Meta+T");
    expect(within(plus).getByRole("tooltip")).toHaveTextContent("New diagram⌘T");
    await user.click(plus);
    await waitFor(() => expect(useAppStore.getState().tabs).toHaveLength(1));
    expect(useAppStore.getState().view).toBe("editor");
  });
});

/**
 * The diagram's title moved out of the toolbar into its tab (#219 D3): a
 * double-click or F2 on a document tab edits it in place.
 */
describe("renaming from the tab (#219 D3, T28)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useLibraryStore.setState({ folders: [], readFailed: false });
    mockedInvoke.mockResolvedValue(undefined);
    open("Login flow", "p1");
    open("Checkout", "p2");
  });

  const field = () => screen.getByRole("textbox", { name: "Diagram title" });
  const title = () => useDiagramStore.getState().title;

  it("double-clicking the active tab → title input with everything selected", () => {
    render(<DocumentTabs />);
    fireEvent.doubleClick(docTab("Checkout"));
    expect(field()).toHaveValue("Checkout");
    expect(field()).toHaveFocus();
    expect([
      (field() as HTMLInputElement).selectionStart,
      (field() as HTMLInputElement).selectionEnd,
    ]).toEqual([0, "Checkout".length]);
    // the tab's own close button steps aside while the field is up
    expect(screen.queryByRole("button", { name: "Close Checkout" })).toBeNull();
  });

  it("Enter commits — the title and tab label change and focus returns to the tab", () => {
    render(<DocumentTabs />);
    fireEvent.doubleClick(docTab("Checkout"));
    fireEvent.change(field(), { target: { value: "Payments" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(title()).toBe("Payments");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(docTab("Payments")).toHaveFocus();
  });

  it("blur commits too, Escape keeps the old title, whitespace only falls back to the previous title", () => {
    render(<DocumentTabs />);
    fireEvent.doubleClick(docTab("Checkout"));
    fireEvent.change(field(), { target: { value: "Blurred" } });
    fireEvent.blur(field());
    expect(title()).toBe("Blurred");

    fireEvent.doubleClick(docTab("Blurred"));
    fireEvent.change(field(), { target: { value: "Nope" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(title()).toBe("Blurred");
    expect(docTab("Blurred")).toHaveFocus();

    fireEvent.doubleClick(docTab("Blurred"));
    fireEvent.change(field(), { target: { value: "   " } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(title()).toBe("Blurred");
  });

  it("the strip is select-none but the title field is select-text — drag selection and the caret work in WebKit (#219)", () => {
    render(<DocumentTabs />);
    fireEvent.doubleClick(docTab("Checkout"));
    expect(field()).toHaveClass("select-text");
  });

  it("F2 on the focused active tab", () => {
    render(<DocumentTabs />);
    act(() => docTab("Checkout").focus());
    fireEvent.keyDown(docTab("Checkout"), { key: "F2" });
    expect(field()).toHaveValue("Checkout");
  });

  it("double-clicking an inactive tab → activates it, then edits", async () => {
    render(<DocumentTabs />);
    fireEvent.doubleClick(docTab("Login flow"));
    await waitFor(() => expect(field()).toHaveValue("Login flow"));
    expect(useDiagramStore.getState().projectId).toBe("p1");
  });

  it("takes the sidebar Rename request and edits in the active tab — the request is consumed", () => {
    render(<DocumentTabs />);
    act(() => useAppStore.getState().requestTitleEdit(useAppStore.getState().activeTab!));
    expect(field()).toHaveValue("Checkout");
    expect(useAppStore.getState().titleEditRequest).toBeNull();
  });
});
