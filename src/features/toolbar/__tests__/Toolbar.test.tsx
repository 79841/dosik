import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { Toaster } from "../../../shared/ui/Toaster";
import { useChatStore } from "../../ai/chatStore";
import { useAppStore } from "../../library/appStore";
import type { FolderMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { openDocument, resetTabsForTests } from "../../library/tabActions";
import { resetUnsavedGuardForTests } from "../../library/unsavedGuard";
import { resetAutosaveForTests } from "../../library/useAutosave";
import { Toolbar } from "../Toolbar";

const clipboard = vi.hoisted(() => ({ writeText: vi.fn(async (_text: string) => {}) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: clipboard.writeText,
  writeImage: vi.fn(async () => {}),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedSave = vi.mocked(save);

const resetStore = () => {
  resetTabsForTests();
  mockedInvoke.mockResolvedValue(undefined);
  // a library diagram, the usual case: no Save in the toolbar (D5)
  openDocument(makeDoc([], [], "Untitled Diagram"), { projectId: "p0" });
  useToastStore.getState().dismissAll();
  resetAutosaveForTests();
  resetUnsavedGuardForTests();
  // the toolbar only lives in the editor; which tab holds the document is
  // the tab module's business, tested on its own
  useAppStore.setState({ view: "editor" });
  useChatStore.setState({ open: false, view: "chat" });
  useLibraryStore.setState({ folders: null, readFailed: false });
  mockedInvoke.mockResolvedValue(undefined);
  localStorage.clear();
};

/** outcomes surface as toasts, which the sheet mounts beside the toolbar */
const renderToolbar = () =>
  render(
    <>
      <Toolbar />
      <Toaster />
    </>,
  );
const actions = () => screen.getByRole("toolbar", { name: "Diagram actions" });

/**
 * The toolbar row at the top of the sheet (#219 D2): the diagram's path on
 * the left (#229 D3), its actions on the right. The title is the tab's, New
 * and Open the tab strip's, the sidebar's and ⌘T / ⌘O, Projects and the
 * theme the chrome's (#217) — the "feature map" of #219.
 */
describe("toolbar row (#219 D2, T14)", () => {
  beforeEach(resetStore);

  it("path on the left; Undo · Redo · Arrange · Export · Mermaid preview · Ask AI on the right — no page tabs", () => {
    renderToolbar();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add page|All pages/ })).toBeNull();
    const buttons = within(actions()).getAllByRole("button");
    expect(buttons).toEqual([
      within(actions()).getByRole("button", { name: "Undo" }),
      within(actions()).getByRole("button", { name: "Redo" }),
      within(actions()).getByRole("button", { name: "Arrange" }),
      within(actions()).getByRole("button", { name: "Export" }),
      within(actions()).getByRole("button", { name: "Mermaid preview" }),
      within(actions()).getByRole("button", { name: "Ask AI" }),
    ]);
  });

  it("has no title input · New · Open · Projects · theme — those belong to tabs, the sidebar, ⌘T and ⌘O (D4)", () => {
    renderToolbar();
    expect(screen.queryByLabelText("Diagram title")).toBeNull();
    for (const name of ["New diagram", "Open", "Projects", "Save"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: /theme/i })).toBeNull();
  });

  it("the whole 36-tall row is nodelete and not a window drag region (D20 · D21)", async () => {
    const user = userEvent.setup();
    const { container } = renderToolbar();
    const row = container.firstElementChild as HTMLElement;
    expect(row).toHaveClass("nodelete", "h-9", "px-2", "gap-2");
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(container.querySelector("[data-tauri-drag-region]")).toBeNull();
  });

  it("Export is a button with visible text, and so is Ask AI — menu buttons have aria-haspopup", () => {
    renderToolbar();
    const exportButton = within(actions()).getByRole("button", { name: "Export" });
    expect(exportButton).toHaveAttribute("aria-haspopup", "menu");
    expect(exportButton).toHaveAttribute("aria-expanded", "false");
    expect(exportButton.querySelector("[data-label]")).toHaveTextContent("Export");
    expect(within(actions()).getByRole("button", { name: "Arrange" })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );
    expect(
      within(actions()).getByRole("button", { name: "Ask AI" }).querySelector("[data-label]"),
    ).toHaveTextContent("Ask AI");
  });
});

const listed = (): FolderMeta[] => [
  {
    folders: [],
    id: "pay",
    name: "Payments",
    updatedAt: 2,
    diagrams: [{ id: "p0", title: "Order flow", updatedAt: 2, readable: true }],
  },
  {
    folders: [],
    id: "default",
    name: "My Diagrams",
    updatedAt: 1,
    diagrams: [{ id: "lost", title: "Lost", updatedAt: 1, readable: true }],
  },
];
const crumbs = () => screen.getByRole("navigation", { name: "Breadcrumb" });

/**
 * The path in place of the page tabs (#229 D3, `EditorH-Tabs`): the folders
 * the listing finds the diagram in, then its live title. No dot.
 */
describe("path (#229 D3, T42)", () => {
  beforeEach(resetStore);

  it("library diagram — project / title (current, live)", () => {
    useLibraryStore.setState({ folders: listed() });
    renderToolbar();
    expect(crumbs().textContent).toBe("Payments/Untitled Diagram");
    expect(within(crumbs()).getByRole("button", { name: "Payments" })).toBeInTheDocument();
    expect(
      within(crumbs()).getByText("Untitled Diagram").closest("[aria-current]"),
    ).toHaveAttribute("aria-current", "page");
    act(() => useDiagramStore.getState().setTitle("Order flow v2"));
    expect(crumbs().textContent).toBe("Payments/Order flow v2");
    expect(crumbs().querySelector(".bg-project-grey")).toBeNull();
  });

  it("changes the path when the list changes", () => {
    useLibraryStore.setState({ folders: listed() });
    renderToolbar();
    act(() =>
      useLibraryStore.setState({
        folders: listed().map((f) => (f.id === "pay" ? { ...f, name: "Billing" } : f)),
      }),
    );
    expect(crumbs().textContent).toBe("Billing/Untitled Diagram");
  });

  it("a diagram of another project — My Diagrams / title", () => {
    useLibraryStore.setState({ folders: listed() });
    openDocument(makeDoc([], [], "Lost"), { projectId: "lost" });
    renderToolbar();
    expect(crumbs().textContent).toBe("My Diagrams/Lost");
  });

  it("an external file or a diagram not yet in the list — the title alone", () => {
    useLibraryStore.setState({ folders: listed() });
    openDocument(makeDoc([], [], "New one"), { projectId: "fresh" });
    const { unmount } = renderToolbar();
    expect(crumbs().textContent).toBe("New one");
    expect(within(crumbs()).queryByRole("button")).toBeNull();
    unmount();
    openDocument(makeDoc([], [], "Ext"), { filePath: "/tmp/ext.dosik.json" });
    renderToolbar();
    expect(crumbs().textContent).toBe("Ext");
  });

  it("nested folders — a multi-level path; clicking a middle ancestor makes Home show that folder (T42 nesting)", async () => {
    const user = userEvent.setup();
    const [pay, ...rest] = listed();
    const order = pay!.diagrams[0]!;
    useLibraryStore.setState({
      folders: [
        {
          ...pay!,
          diagrams: [],
          folders: [
            {
              id: "chk",
              name: "Checkout",
              updatedAt: 2,
              diagrams: [],
              folders: [{ id: "flw", name: "Flows", updatedAt: 2, diagrams: [order], folders: [] }],
            },
          ],
        },
        ...rest,
      ],
    });
    renderToolbar();
    expect(crumbs().textContent).toBe("Payments/Checkout/Flows/Untitled Diagram");
    await user.click(within(crumbs()).getByRole("button", { name: "Checkout" }));
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
  });

  it("clicking an ancestor makes the Home tab show that project — the document stays in its tab", async () => {
    const user = userEvent.setup();
    useLibraryStore.setState({ folders: listed() });
    renderToolbar();
    const tab = useAppStore.getState().activeTab;
    await user.click(within(crumbs()).getByRole("button", { name: "Payments" }));
    expect(useAppStore.getState().activeTab).toBeNull();
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
    expect(useAppStore.getState().tabs.map((t) => t.id)).toContain(tab);
  });
});

describe("Undo·Redo (T15)", () => {
  beforeEach(resetStore);

  it("is enabled or disabled by history — shortcut in the tooltip", () => {
    renderToolbar();
    const undo = () => screen.getByRole("button", { name: "Undo" });
    expect(undo()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    act(() => useDiagramStore.getState().addNode("rect", { x: 0, y: 0 }));
    expect(undo()).toBeEnabled();
    expect(within(undo()).getByRole("tooltip")).toHaveTextContent(/Undo(⌘|Ctrl\+)Z/);
    expect(
      within(screen.getByRole("button", { name: "Redo" })).getByRole("tooltip"),
    ).toHaveTextContent(/Redo(⇧⌘|Ctrl\+Shift\+)Z/);
    act(() => useDiagramStore.getState().undo());
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
  });
});

describe("Export ▾ (T17)", () => {
  beforeEach(resetStore);

  const selectTwo = () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 300, y: 0 } },
      { op: "add_edge", edge: { id: "ab", source: "a", target: "b" } },
    ]);
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => ({ ...n, selected: true })),
    }));
  };

  it("three copies (Markdown · image · SVG), three files (Markdown · PNG · SVG) — Markdown first, no PowerPoint (#192)", async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByRole("button", { name: "Export" }));
    const menu = screen.getByRole("menu", { name: "Export" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((b) => b.textContent),
    ).toEqual([
      "Copy as Markdown",
      "Copy image",
      "Copy as SVG",
      "Markdown (.md)",
      "PNG image",
      "SVG image",
    ]);
    expect(screen.queryByText(/PowerPoint/)).toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).toHaveAttribute("aria-expanded", "true");
  });

  it("Copy as Markdown: puts Markdown containing a Mermaid block on the clipboard (#192)", async () => {
    const user = userEvent.setup();
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    renderToolbar();
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "Copy as Markdown" }));
    expect(await screen.findByText("Copied as Markdown")).toBeInTheDocument();
    expect(clipboard.writeText.mock.calls.at(-1)?.[0]).toMatch(/```mermaid[\s\S]*A[\s\S]*```/);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("exports only the whole document even with a selection — selection export is the canvas context menu (#139)", async () => {
    const user = userEvent.setup();
    selectTwo();
    renderToolbar();
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.queryByText("Selection only")).toBeNull();
    expect(screen.getAllByText("Markdown (.md)")).toHaveLength(1);
  });

  it("does not add -selection to the whole-document Markdown file name", async () => {
    const user = userEvent.setup();
    selectTwo();
    mockedSave.mockResolvedValue("/tmp/out.md");
    renderToolbar();
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "Markdown (.md)" }));
    expect(await screen.findByText("Exported as Markdown")).toBeInTheDocument();
    expect(mockedSave).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: expect.not.stringContaining("-selection") }),
    );
  });

  it("closes with Escape or an outside click", async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("menu keyboard — opening focuses the first item, ↑↓ Home End, Escape closes back to Export (#219)", async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(screen.getByRole("button", { name: "Export" }));
    const item = (name: string) => screen.getByRole("menuitem", { name });
    expect(item("Copy as Markdown")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item("Copy image")).toHaveFocus();
    await user.keyboard("{End}");
    expect(item("SVG image")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item("Copy as Markdown")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(item("SVG image")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(item("Copy as Markdown")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).toHaveFocus();
  });

  it("choosing an item closes it and focus goes to Export (#219)", async () => {
    const user = userEvent.setup();
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    renderToolbar();
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Copied as Markdown")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).toHaveFocus();
  });
});

describe("panel toggles — Mermaid preview · Ask AI (#219 D13, T18)", () => {
  beforeEach(resetStore);

  const ask = () => screen.getByRole("button", { name: "Ask AI" });
  const mermaid = () => screen.getByRole("button", { name: "Mermaid preview" });

  it("when closed, neither is pressed and there is no aria-controls", () => {
    renderToolbar();
    expect(ask()).toHaveAttribute("aria-pressed", "false");
    expect(mermaid()).toHaveAttribute("aria-pressed", "false");
    expect(ask()).not.toHaveAttribute("aria-controls");
  });

  it("opens with Ask AI, switches with Mermaid preview, and closes on a second press", async () => {
    const user = userEvent.setup();
    renderToolbar();
    await user.click(ask());
    expect(useChatStore.getState()).toMatchObject({ open: true, view: "chat" });
    expect(ask()).toHaveAttribute("aria-pressed", "true");
    expect(ask()).toHaveAttribute("aria-controls", "side-panel");
    expect(mermaid()).toHaveAttribute("aria-pressed", "false");

    await user.click(mermaid());
    expect(useChatStore.getState()).toMatchObject({ open: true, view: "mermaid" });
    expect(mermaid()).toHaveAttribute("aria-pressed", "true");
    expect(ask()).toHaveAttribute("aria-pressed", "false");

    await user.click(mermaid());
    expect(useChatStore.getState().open).toBe(false);
    expect(mermaid()).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles have ids — closing the panel returns focus to them", () => {
    renderToolbar();
    expect(ask()).toHaveAttribute("id", "toggle-chat");
    expect(mermaid()).toHaveAttribute("id", "toggle-mermaid");
  });
});

describe("Save — only for external files (#219 D5, T19)", () => {
  beforeEach(resetStore);

  it("library diagrams have no Save — autosave, ⌘S", () => {
    openDocument(makeDoc([], []), { projectId: "p1" });
    renderToolbar();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("external files get Save before Undo — clicking writes to that file", async () => {
    const user = userEvent.setup();
    openDocument(makeDoc([makeNode({ id: "a" })], []), { filePath: "/tmp/ext.dosik.json" });
    renderToolbar();
    const buttons = within(actions()).getAllByRole("button");
    expect(buttons[0]).toBe(screen.getByRole("button", { name: "Save" }));
    expect(within(buttons[0]!).getByRole("tooltip")).toHaveTextContent(/Save(⌘|Ctrl\+)S/);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "write_text_file",
        expect.objectContaining({ path: "/tmp/ext.dosik.json" }),
      ),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});

describe("Arrange menu (formerly Layout) — auto layout (#3, #219 T16)", () => {
  beforeEach(resetStore);

  const load = (selected: string[] = []) => {
    const doc = makeDoc(
      [makeNode({ id: "a", x: 500, y: 400 }), makeNode({ id: "b" }), makeNode({ id: "c", x: 300 })],
      [
        {
          id: "ab",
          type: "labeled",
          source: "a",
          target: "b",
          data: { arrow: true, variant: "solid" },
        },
        {
          id: "bc",
          type: "labeled",
          source: "b",
          target: "c",
          data: { arrow: true, variant: "solid" },
        },
      ],
    );
    useDiagramStore.getState().loadDoc(doc, null);
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: selected.includes(n.id) })),
    }));
  };
  const y = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id)!.position.y;
  const x = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id)!.position.x;

  const renderWithToasts = () =>
    render(
      <>
        <Toolbar />
        <Toaster />
      </>,
    );

  it("does not arrange when nothing is selected — items are disabled and say why (#182)", async () => {
    load();
    renderWithToasts();
    await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
    expect(screen.getByRole("menuitem", { name: "Top to bottom" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Left to right" })).toBeDisabled();
    expect(screen.getByText("Select two or more shapes to arrange")).toBeInTheDocument();
    expect(x("a")).toBe(500);
  });

  it("menu keyboard — opening focuses the first item, ↓ walks to the flips, Escape closes back to Arrange (#219)", async () => {
    load(["a", "b"]);
    renderWithToasts();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Arrange" }));
    expect(screen.getByRole("menuitem", { name: "Top to bottom" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemcheckbox", { name: "Flip vertical direction" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Flip horizontal direction" }),
    ).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Top to bottom" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Arrange" })).toHaveFocus();
  });

  it("skips disabled items and focuses the first flip — the reason text isn't a child of the menu (#219)", async () => {
    load();
    renderWithToasts();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Arrange" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Flip vertical direction" })).toHaveFocus();
    const hint = screen.getByText("Select two or more shapes to arrange");
    expect(hint).toHaveAttribute("role", "none");
    // still the disabled items' description
    expect(screen.getByRole("menuitem", { name: "Top to bottom" })).toHaveAccessibleDescription(
      "Select two or more shapes to arrange",
    );
  });

  it("choosing a direction closes it and focus goes to Arrange (#219)", async () => {
    load(["a", "b"]);
    renderWithToasts();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Arrange" }));
    await user.click(screen.getByRole("menuitem", { name: "Left to right" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Arrange" })).toHaveFocus();
  });

  it("does not arrange with only one selected", async () => {
    load(["a"]);
    renderWithToasts();
    await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
    expect(screen.getByRole("menuitem", { name: "Left to right" })).toBeDisabled();
  });

  it("arranges the selection top → bottom and announces it", async () => {
    load(["a", "b", "c"]);
    renderWithToasts();
    await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
    expect(screen.queryByText("Select two or more shapes to arrange")).toBeNull();
    await userEvent.click(screen.getByRole("menuitem", { name: "Top to bottom" }));
    expect(y("a")).toBeLessThan(y("b"));
    expect(y("b")).toBeLessThan(y("c"));
    expect(await screen.findByText("Arranged 3 shapes")).toBeInTheDocument();
  });

  it("leaves unselected shapes as is", async () => {
    load(["a", "b"]);
    renderWithToasts();
    await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Left to right" }));
    expect(x("a")).toBeLessThan(x("b"));
    expect(x("c")).toBe(300);
    expect(await screen.findByText("Arranged 2 shapes")).toBeInTheDocument();
  });

  it("says it's already arranged when pressing again would change nothing", async () => {
    load(["a", "b", "c"]);
    renderWithToasts();
    for (let i = 0; i < 2; i += 1) {
      await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Top to bottom" }));
    }
    expect(await screen.findByText("Already arranged")).toBeInTheDocument();
  });

  describe("per-row flip — four directions (#206)", () => {
    beforeEach(() => localStorage.clear());

    it("flipping the vertical row gives Bottom to top and arranges that way", async () => {
      load(["a", "b", "c"]);
      renderWithToasts();
      await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
      const flip = screen.getByRole("menuitemcheckbox", { name: "Flip vertical direction" });
      expect(flip).toHaveAttribute("aria-checked", "false");
      await userEvent.click(flip);
      expect(flip).toHaveAttribute("aria-checked", "true");
      expect(screen.queryByRole("menuitem", { name: "Top to bottom" })).toBeNull();
      // Flipping alone doesn't close the menu — pick, then press
      await userEvent.click(screen.getByRole("menuitem", { name: "Bottom to top" }));
      expect(y("a")).toBeGreaterThan(y("b"));
      expect(y("b")).toBeGreaterThan(y("c"));
    });

    it("flipping the horizontal row gives Right to left — the vertical row stays", async () => {
      load(["a", "b", "c"]);
      renderWithToasts();
      await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
      await userEvent.click(
        screen.getByRole("menuitemcheckbox", { name: "Flip horizontal direction" }),
      );
      expect(screen.getByRole("menuitem", { name: "Top to bottom" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("menuitem", { name: "Right to left" }));
      expect(x("a")).toBeGreaterThan(x("b"));
      expect(x("b")).toBeGreaterThan(x("c"));
    });

    it("flipping works even with nothing selected — only the arrange items are disabled", async () => {
      load();
      renderWithToasts();
      await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
      const flip = screen.getByRole("menuitemcheckbox", { name: "Flip vertical direction" });
      expect(flip).toBeEnabled();
      await userEvent.click(flip);
      expect(screen.getByRole("menuitem", { name: "Bottom to top" })).toBeDisabled();
    });

    it("remembers the flipped state — it survives a re-render", async () => {
      load(["a", "b"]);
      const { unmount } = renderWithToasts();
      await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
      await userEvent.click(
        screen.getByRole("menuitemcheckbox", { name: "Flip horizontal direction" }),
      );
      unmount();
      renderWithToasts();
      await userEvent.click(screen.getByRole("button", { name: "Arrange" }));
      expect(screen.getByRole("menuitem", { name: "Right to left" })).toBeInTheDocument();
      expect(
        screen.getByRole("menuitemcheckbox", { name: "Flip horizontal direction" }),
      ).toHaveAttribute("aria-checked", "true");
    });
  });
});
