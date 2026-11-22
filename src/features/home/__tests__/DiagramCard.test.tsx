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
import { useHomeSelection } from "../homeSelection";
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
const show = ({
  id = "co",
  selected = false,
  stop = true,
}: {
  id?: string;
  selected?: boolean;
  stop?: boolean;
} = {}) =>
  render(
    <ul>
      <DiagramCard
        diagram={diagram(id)}
        folder={pay()}
        folders={useLibraryStore.getState().folders!}
        selected={selected}
        stop={stop}
      />
    </ul>,
  );
const card = () => screen.getByRole("article");
const main = () => screen.getByRole("button", { name: /, diagram, edited|, unreadable, edited/ });

/** a diagram's card in a folder view (#231 D7·D8, T14·T15·T19) */
describe("diagram card (#231 D7·D8, T19)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetPreviewCacheForTests();
    resetTabsForTests();
    useHomeSelection.getState().clear();
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

  it("look — inset 10·radius 8·shadow-raised, shadow-lifted on hover or with focus inside", () => {
    show();
    expect(card()).toHaveClass("rounded-lg", "bg-surface", "p-2.5", "shadow-raised");
    expect(card()).toHaveClass("hover:shadow-lifted", "focus-within:shadow-lifted");
    expect(card()).not.toHaveClass("ring-[1.5px]");
    // the picture's well keeps 15:8 — 168 at three across, smaller with more (#236 R5, T14)
    expect(card().querySelector('[class~="aspect-[15/8]"]')).not.toBeNull();
    expect(card().querySelector('[class~="h-[168px]"]')).toBeNull();
    expect(within(card()).getByText("Edited 2 min ago")).toHaveClass("text-[11px]", "text-muted");
  });

  it("main button — name '{title}, diagram, edited {time}', shortcuts, roving Tab stop", () => {
    const { unmount } = show();
    expect(main()).toHaveAccessibleName("Checkout service, diagram, edited 2 min ago");
    expect(main()).toHaveAttribute("aria-keyshortcuts", "Enter Shift+F10");
    expect(main()).toHaveAttribute("tabindex", "0");
    expect(main()).not.toHaveAttribute("aria-current");
    unmount();
    show({ stop: false });
    expect(main()).toHaveAttribute("tabindex", "-1");
  });

  it("selected card — 1.5px ink ring, aria-current", () => {
    show({ selected: true });
    expect(card()).toHaveClass("ring-[1.5px]", "ring-ink", "shadow-raised");
    expect(main()).toHaveAttribute("aria-current", "true");
  });

  it("unreadable diagram — 'unreadable' name, No preview, 'Edited …'", () => {
    show({ id: "br" });
    expect(main()).toHaveAccessibleName("Broken, unreadable, edited 1 hour ago");
    expect(within(card()).getByText("No preview")).toBeInTheDocument();
    expect(within(card()).getByText("Edited 1 hour ago")).toBeInTheDocument();
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

  it("pressing anywhere in the card selects + focuses the main button — inner padding, Open·More too (T14)", () => {
    show();
    fireEvent.pointerDown(card(), { button: 0 });
    expect(useHomeSelection.getState()).toMatchObject({ folder: "pay", key: "diagram:co" });
    expect(main()).toHaveFocus();
    useHomeSelection.getState().clear();
    fireEvent.pointerDown(screen.getByRole("button", { name: "More for Checkout service" }), {
      button: 0,
    });
    expect(useHomeSelection.getState().key).toBe("diagram:co");
  });

  it("right button·ctrl+click (macOS right click) does not select", () => {
    show();
    fireEvent.pointerDown(card(), { button: 2 });
    onMac(() => fireEvent.pointerDown(card(), { button: 0, ctrlKey: true }));
    expect(useHomeSelection.getState().key).toBeNull();
  });

  it("off macOS a ctrl+press is a press — the card is selected", () => {
    show();
    fireEvent.pointerDown(card(), { button: 0, ctrlKey: true });
    expect(useHomeSelection.getState().key).not.toBeNull();
  });

  it("pressing empty padding keeps focus on the main button — the press's default action does not steal it", () => {
    show();
    fireEvent.pointerDown(card(), { button: 0 });
    expect(fireEvent.mouseDown(card(), { button: 0 })).toBe(false);
    expect(fireEvent.mouseDown(main(), { button: 0 })).toBe(true);
  });

  it("one press does not open, a double press opens (T14)", async () => {
    const user = userEvent.setup();
    show();
    await user.click(main());
    expect(useAppStore.getState()).toMatchObject({ view: "home", tabs: [] });
    await user.dblClick(main());
    await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("co"));
    expect(useAppStore.getState().view).toBe("editor");
  });

  it("double-pressing More does not open — menu only", async () => {
    show();
    fireEvent.doubleClick(screen.getByRole("button", { name: "More for Checkout service" }));
    await act(async () => {});
    expect(useAppStore.getState()).toMatchObject({ view: "home", tabs: [] });
  });

  it("Enter opens and Space selects (T15)", async () => {
    const user = userEvent.setup();
    show();
    act(() => main().focus());
    await user.keyboard(" ");
    expect(useHomeSelection.getState()).toMatchObject({ folder: "pay", key: "diagram:co" });
    expect(useAppStore.getState().view).toBe("home");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("co"));
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

  it("More — Open · Rename · Move to… · Delete, selected background while open", async () => {
    const user = userEvent.setup();
    show();
    const more = screen.getByRole("button", { name: "More for Checkout service" });
    await user.click(more);
    expect(more).toHaveClass("bg-selected");
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
