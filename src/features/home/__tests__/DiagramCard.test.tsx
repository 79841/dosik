import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { onMac } from "../../../test/platform";

import { useDiagramStore } from "../../../shared/lib/store";
import { useAppStore } from "../../library/appStore";
import { blankDoc, type FolderMeta, type ProjectMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { resetTabsForTests, showHomeTab } from "../../library/tabActions";
import { resetAutosaveForTests } from "../../library/useAutosave";
import { DiagramCard } from "../DiagramCard";
import { resetPreviewCacheForTests } from "../diagramPreview";
import { showInLabel } from "../../library/fileManager";
import { likeRust } from "../../../test/rustAnswers";

/** "Show in …" as this web view names its file manager (#238 D10) */
const SHOW_IN = showInLabel();

const mockedInvoke = vi.mocked(invoke);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const now = Date.now();

const library = (): FolderMeta[] => [
  {
    folders: [],
    id: "pay",
    name: "Payments",
    updatedAt: now - 2 * 60_000,
    diagrams: [
      { id: "co", title: "Checkout service", updatedAt: now - 2 * 60_000, readable: true },
      { id: "br", title: "Broken", updatedAt: now - 60 * 60_000, readable: false },
    ],
  },
  { folders: [], id: "empty", name: "Sketches", updatedAt: now - 86_400_000, diagrams: [] },
];

const pay = () => useLibraryStore.getState().folders![0]!;
const diagram = (id: string): ProjectMeta => pay().diagrams.find((d) => d.id === id)!;
const show = ({ id = "co", stop = true }: { id?: string; stop?: boolean } = {}) =>
  render(
    <ul>
      <DiagramCard
        diagram={diagram(id)}
        folder={pay()}
        folders={useLibraryStore.getState().folders!}
        stop={stop}
      />
    </ul>,
  );
const card = () => screen.getByRole("article");
const main = () => screen.getByRole("button", { name: /, diagram, edited|, unreadable, edited/ });

/** a diagram's card in a folder view (#231 D8, card C — one click opens) */
describe("diagram card (card C, one click opens)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetPreviewCacheForTests();
    resetTabsForTests();
    useLibraryStore.setState({ folders: library(), readFailed: false });
    showHomeTab({ kind: "folder", folder: "pay" });
    mockedInvoke.mockImplementation(
      likeRust(async (cmd, args) => {
        if (cmd === "list_library") return library();
        if (cmd === "load_project") {
          return JSON.stringify({ ...blankDoc(), title: (args as { id: string }).id });
        }
        return undefined;
      }),
    );
  });

  it("look — card C: a hairline (0.5px) inside, no padding, no shadow; the line a step darker on hover", () => {
    show();
    expect(card()).toHaveClass(
      "rounded-lg",
      "bg-surface",
      "outline-[0.5px]",
      "-outline-offset-[0.5px]",
    );
    expect(card()).toHaveClass("outline-edge", "hover:outline-dash");
    expect(card().className).not.toMatch(/shadow-raised|shadow-lifted|ring-\[1\.5px\]|\bp-2\.5\b/);
    // the keyboard's ring round the card: 2px of surface, then 2px of focus (Home-States 2)
    expect(card()).toHaveClass(
      "has-[:focus-visible]:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--focus)]",
    );
    // the picture fills the card's top, 15:8 (#236 R5)
    const well = card().querySelector('[class~="aspect-[15/8]"]');
    expect(well).not.toBeNull();
    expect(well).not.toHaveClass("rounded-[6px]");
  });

  it("caption bar — 40 high under a hairline: the diagram glyph, the title, 'Edited …'", () => {
    show();
    const bar = card().querySelector("[data-caption-bar]") as HTMLElement;
    expect(bar).toHaveClass("h-10", "border-t-[0.5px]", "border-edge", "px-3", "gap-2");
    expect(bar).toHaveClass("group-hover/card:border-dash", "group-hover/card:bg-hover");
    expect(bar.querySelector("svg.text-glyph-diagram")).not.toBeNull();
    expect(within(bar).getByText("Checkout service")).toHaveClass("truncate", "font-semibold");
    expect(within(bar).getByText("Edited 2 min ago")).toHaveClass(
      "text-[11px]",
      "text-muted-strong",
    );
  });

  it("motion only where motion is allowed — a press on the card itself shrinks it to 99% in 160ms and lets it out softly in 360ms (HomeCardFx-Fade)", () => {
    show();
    expect(card()).toHaveClass(
      "motion-safe:has-[[data-card-key]:active]:scale-[.99]",
      "motion-safe:has-[[data-card-key]:active]:[transition-duration:160ms,220ms,160ms]",
      "motion-safe:[transition:outline-color_160ms_ease-out,box-shadow_220ms_ease-out,scale_360ms_cubic-bezier(0.22,1,0.36,1)]",
    );
    // pressing Open or More is not pressing the card: no `active:` on the card itself
    expect(card().className).not.toMatch(/(^|\s)(motion-safe:)?active:/);
    expect(card().className).not.toMatch(/(^|\s)(active:scale|transition|\[transition)/);
  });

  it("a right-click on the card opens More's menu beside the pointer — More drawn pressed, nothing opened", async () => {
    show();
    const right = fireEvent.contextMenu(card().querySelector("[data-caption-bar]")!, {
      clientX: 300,
      clientY: 200,
    });
    expect(right).toBe(false);
    const menu = screen.getByRole("menu", { name: "More for Checkout service" });
    expect(menu.style.left).toBe("302px");
    expect(menu.style.top).toBe("202px");
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Open",
      SHOW_IN,
      "Copy Path",
      "Rename",
      "Move to…",
      "Delete",
    ]);
    expect(screen.getByRole("button", { name: "More for Checkout service" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await act(async () => {});
    expect(useAppStore.getState()).toMatchObject({ view: "home", tabs: [] });
  });

  it("a right-click on Open or More opens the same menu", () => {
    show();
    fireEvent.contextMenu(screen.getByRole("button", { name: "More for Checkout service" }), {
      clientX: 10,
      clientY: 20,
    });
    expect(screen.getByRole("menu", { name: "More for Checkout service" })).toBeInTheDocument();
  });

  it("the main button hides its own outline only while focused — high contrast still marks the focused card", () => {
    show();
    expect(main()).toHaveClass("focus-visible:outline-hidden");
    expect(main().className).not.toMatch(/(^|\s)outline-hidden/);
  });

  it("main button — name '{title}, diagram, edited {time}', shortcuts, roving Tab stop, no selection", () => {
    const { unmount } = show();
    expect(main()).toHaveAccessibleName("Checkout service, diagram, edited 2 min ago");
    expect(main()).toHaveAttribute("aria-keyshortcuts", "Enter Shift+F10");
    expect(main()).toHaveAttribute("tabindex", "0");
    expect(main()).not.toHaveAttribute("aria-current");
    unmount();
    show({ stop: false });
    expect(main()).toHaveAttribute("tabindex", "-1");
  });

  it("unreadable diagram — 'unreadable' name, No preview, 'Edited …'", () => {
    show({ id: "br" });
    expect(main()).toHaveAccessibleName("Broken, unreadable, edited 1 hour ago");
    expect(within(card()).getByText("No preview")).toBeInTheDocument();
    expect(within(card()).getByText("Edited 1 hour ago")).toBeInTheDocument();
  });

  it("Open·More rest hidden, 4px up and out of the pointer's way; pointing·focus inside·an open menu bring them down (HomeCardFx-Fade)", async () => {
    const user = userEvent.setup();
    show();
    const controls = card().querySelector("[data-card-controls]") as HTMLElement;
    expect(controls).toHaveClass(
      "right-2.5",
      "top-2.5",
      "opacity-0",
      "-translate-y-1",
      "pointer-events-none",
    );
    expect(controls).toHaveClass(
      "group-hover/card:opacity-100",
      "group-hover/card:translate-y-0",
      "group-focus-within/card:opacity-100",
      "motion-safe:[transition:opacity_160ms_ease-out,translate_160ms_cubic-bezier(0.2,0.7,0.2,1)]",
    );
    await user.click(screen.getByRole("button", { name: "More for Checkout service" }));
    expect(controls).toHaveClass("opacity-100", "pointer-events-auto");
    expect(controls).not.toHaveClass("-translate-y-1");
  });

  it("Open·More are for pointers — not Tab stops", () => {
    show();
    expect(screen.getByRole("button", { name: "Open Checkout service" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(screen.getByRole("button", { name: "More for Checkout service" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("one click anywhere on the card opens it in its tab", async () => {
    const user = userEvent.setup();
    show();
    await user.click(card().querySelector("[data-caption-bar]")!);
    await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("co"));
    expect(useAppStore.getState().view).toBe("editor");
    expect(useAppStore.getState().tabs).toHaveLength(1);
  });

  it("a double click's second click opens nothing more — it lands on the screen the first opened", async () => {
    show();
    fireEvent.click(main(), { detail: 2 });
    await act(async () => {});
    expect(useAppStore.getState()).toMatchObject({ view: "home", tabs: [] });
  });

  it("right click·ctrl+click (macOS right click) does not open", async () => {
    show();
    fireEvent.contextMenu(main());
    onMac(() => {
      fireEvent.contextMenu(main(), { ctrlKey: true });
      fireEvent.click(main(), { ctrlKey: true, detail: 1 });
    });
    await act(async () => {});
    expect(useAppStore.getState()).toMatchObject({ view: "home", tabs: [] });
  });

  it("double-pressing More does not open — menu only", async () => {
    show();
    fireEvent.doubleClick(screen.getByRole("button", { name: "More for Checkout service" }));
    await act(async () => {});
    expect(useAppStore.getState()).toMatchObject({ view: "home", tabs: [] });
  });

  it.each([
    ["Shift+Enter", { key: "Enter", shiftKey: true }],
    ["Alt+Enter", { key: "Enter", altKey: true }],
    ["Cmd+Enter", { key: "Enter", metaKey: true }],
  ])("%s opens nothing — and keeps the button's own click from opening it", async (_, keys) => {
    show();
    const down = fireEvent.keyDown(main(), keys);
    await act(async () => {});
    expect(down).toBe(false);
    expect(useAppStore.getState()).toMatchObject({ view: "home", tabs: [] });
  });

  it("off macOS a ctrl+click is a click — it opens", async () => {
    show();
    fireEvent.click(main(), { ctrlKey: true, detail: 1 });
    await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("co"));
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("%s opens it", async (_, key) => {
    const user = userEvent.setup();
    show();
    act(() => main().focus());
    await user.keyboard(key);
    await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("co"));
  });

  it("Open opens once — the card's own button is not pressed with it", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Open Checkout service" }));
    await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("co"));
    expect(useAppStore.getState().tabs).toHaveLength(1);
  });

  it.each([
    ["Shift+F10", { key: "F10", shiftKey: true }],
    ["ContextMenu", { key: "ContextMenu" }],
  ])("%s → that card's More menu, Escape → focus to the main button (T15)", async (_, keys) => {
    show();
    fireEvent.keyDown(main(), keys);
    const menu = screen.getByRole("menu", { name: "More for Checkout service" });
    expect(screen.getByRole("button", { name: "More for Checkout service" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(main()).toHaveFocus();
  });

  it("More — Open · Rename · Move to… · Delete, selected background while open, opens nothing", async () => {
    const user = userEvent.setup();
    show();
    const more = screen.getByRole("button", { name: "More for Checkout service" });
    // a 1px line, no shadow (Home-States 2)
    expect(more).toHaveClass("inset-ring", "inset-ring-line-strong", "bg-surface");
    expect(more.className).not.toMatch(/shadow-raised/);
    await user.click(more);
    expect(more).toHaveClass("bg-selected", "inset-ring");
    expect(useAppStore.getState()).toMatchObject({ view: "home", tabs: [] });
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Open",
      SHOW_IN,
      "Copy Path",
      "Rename",
      "Move to…",
      "Delete",
    ]);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Open Checkout service" }));
    await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("co"));
  });

  it("the More menu aligns to the button's right edge, 4px below — same as the header ⋯ (Hybrid-Project-Cards, #238)", () => {
    show();
    const more = screen.getByRole("button", { name: "More for Checkout service" });
    vi.spyOn(more, "getBoundingClientRect").mockReturnValue(new DOMRect(928, 363, 24, 24));
    fireEvent.click(more);
    const menu = screen.getByRole("menu", { name: "More for Checkout service" });
    // 184 wide, its right edge at the button's
    expect(menu.style.left).toBe(`${952 - 184}px`);
    expect(menu.style.top).toBe("391px");
  });

  it("no Move to… when there is nowhere to move", async () => {
    const user = userEvent.setup();
    useLibraryStore.setState({ folders: [library()[0]!] });
    show();
    await user.click(screen.getByRole("button", { name: "More for Checkout service" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Open",
      SHOW_IN,
      "Copy Path",
      "Rename",
      "Delete",
    ]);
  });

  it("Move to… — choosing another project calls move_project", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "More for Checkout service" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to…" }));
    const picker = screen.getByRole("tree", { name: "Move to" });
    const sketches = within(picker).getByRole("treeitem", { name: "Sketches, project" });
    await user.click(sketches.querySelector("[data-row]")!);
    await waitFor(() =>
      expect(calls("move_project")[0]![1]).toEqual({ id: "co", folder: "empty" }),
    );
  });

  it("Rename — opens it and that tab edits the title (#219 D3)", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ titleEditRequest: null });
    show();
    await user.click(screen.getByRole("button", { name: "More for Checkout service" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("co"));
    expect(useAppStore.getState().titleEditRequest).toBe(useAppStore.getState().activeTab);
  });

  it("Rename — if it cannot open, focus goes to the main button (#219 D3)", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(
      likeRust(async (cmd) => {
        if (cmd === "load_project") throw new Error("gone");
        return undefined;
      }),
    );
    show();
    await user.click(screen.getByRole("button", { name: "More for Checkout service" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    await waitFor(() => expect(main()).toHaveFocus());
  });

  it("if Rename could not open and the user moved to another screen meanwhile, does not take focus (#230, #218 D15)", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(
      likeRust(async (cmd) => {
        if (cmd === "load_project") {
          await new Promise((r) => setTimeout(r, 20));
          throw new Error("gone");
        }
        return undefined;
      }),
    );
    show();
    await user.click(screen.getByRole("button", { name: "More for Checkout service" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    act(() => showHomeTab({ kind: "recent" }));
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(main()).not.toHaveFocus();
  });
});
