import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onMac } from "../../../test/platform";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import type { DiagramDoc } from "../../../shared/lib/types";
import { handleCanvasKeyDown } from "../../canvas/canvasKeymap";
import { useCanvasUiStore } from "../../canvas/canvasUiStore";
import { useAppStore } from "../../library/appStore";
import { blankDoc, type FolderMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { openDocument, resetTabsForTests, showHomeTab } from "../../library/tabActions";
import { resetUnsavedGuardForTests } from "../../library/unsavedGuard";
import { resetAutosaveForTests, useAutosave } from "../../library/useAutosave";
import { DROP_RING, DROP_TARGET } from "../../../shared/lib/palette";
import { badgeColour } from "../../../shared/lib/projectBadge";
import { ProjectsSection } from "../LibraryTree";
import { folderKey } from "../treeModel";
import { resetTreeForTests, useTreeStore } from "../treeStore";
import { badgeIn } from "../../../test/badges";
import { showInLabel } from "../../library/fileManager";

/** "Show in …" as this web view names its file manager (#238 D10) */
const SHOW_IN = showInLabel();

const mockedInvoke = vi.mocked(invoke);
const mockedAsk = vi.mocked(ask);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);

const now = Date.now();
const library = (): FolderMeta[] => [
  {
    folders: [],
    id: "work",
    name: "Work",
    updatedAt: now - 3 * 60_000,
    diagrams: [
      {
        id: "p1",
        title: "Login flow",
        updatedAt: now - 3 * 60_000,
        readable: true,
      },
      { id: "p2", title: "Sequence", updatedAt: now - 2 * 86_400_000, readable: true },
    ],
  },
  { folders: [], id: "home", name: "Personal", updatedAt: now - 5 * 86_400_000, diagrams: [] },
];
const stray = (): FolderMeta => ({
  folders: [],
  id: "my-diagrams",
  name: "My Diagrams",
  updatedAt: now - 10 * 86_400_000,
  stray: true,
  diagrams: [{ id: "old", title: "Old one", updatedAt: now - 10 * 86_400_000, readable: false }],
});
const loginBook = (): DiagramDoc => ({ ...blankDoc(), title: "Login flow" });

/** list_library answers from `listing`, load_project from `files`, the rest from `extra` */
const serve = (
  listing: () => unknown = library,
  files: Record<string, unknown> = { p1: loginBook(), p2: blankDoc() },
  extra: Record<string, unknown> = {},
) =>
  mockedInvoke.mockImplementation(async (cmd, args) => {
    if (cmd === "list_library") return listing();
    if (cmd === "load_project") {
      const { id } = args as { id: string };
      return typeof files[id] === "string" ? files[id] : JSON.stringify(files[id]);
    }
    if (cmd in extra) return extra[cmd];
    return undefined;
  });

const renderTree = () => render(<ProjectsSection />);
const tree = () => screen.getByRole("tree", { name: "Projects" });
const item = (name: string | RegExp) => within(tree()).getByRole("treeitem", { name });
/** a row's own line — the treeitem also holds its children */
const row = (name: string | RegExp) => item(name).querySelector("[data-row]") as HTMLElement;
const chevron = (name: string | RegExp) =>
  item(name).querySelector("[data-row] [data-chevron]") as HTMLElement;
const moreButton = (name: string | RegExp) =>
  within(row(name)).queryByRole("button", { name: /^Actions for / });

describe("sidebar tree (#217 R3)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTreeForTests();
    resetTabsForTests();
    useLibraryStore.setState({ folders: library(), readFailed: false });
    useToastStore.getState().dismissAll();
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
    serve();
  });

  describe("structure and names (D29, T14)", () => {
    it("a tree under the PROJECTS header — everything starts collapsed (#176)", () => {
      renderTree();
      expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
      const items = within(tree()).getAllByRole("treeitem");
      expect(items.map((i) => i.getAttribute("aria-label"))).toEqual([
        "Work, project, 2 items",
        "Personal, project, 0 items",
      ]);
      expect(items.map((i) => i.getAttribute("aria-level"))).toEqual(["1", "1"]);
      expect(item("Work, project, 2 items")).toHaveAttribute("aria-expanded", "false");
      // nothing to unfold: no aria-expanded at all
      expect(item("Personal, project, 0 items")).not.toHaveAttribute("aria-expanded");
      expect(within(tree()).queryByRole("group")).toBeNull();
      // no project dot (#229 D19)
      expect(tree().querySelector(".bg-project-grey")).toBeNull();
    });

    it("rows show a name and count — projects show how many items they hold (none at 0), diagrams have no count or chevron (#229 D6)", async () => {
      const user = userEvent.setup();
      renderTree();
      expect(within(row(/^Work/)).getByText("Work")).toBeInTheDocument();
      expect(row(/^Work/).querySelector("[data-count]")).toHaveTextContent("2");
      expect(row(/^Personal/).querySelector("[data-count]")).toBeNull();
      await user.click(chevron(/^Work/));
      const login = item("Login flow, diagram, edited 3 min ago");
      expect(login).toHaveAttribute("aria-level", "2");
      expect(login).not.toHaveAttribute("aria-expanded");
      expect(row(/^Login flow/).querySelector("[data-count]")).toBeNull();
      expect(chevron(/^Login flow/)).toBeNull();
      expect(item("Sequence, diagram, edited 2 days ago")).toBeInTheDocument();
    });

    it("the chevron only expands and collapses — the screen stays", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      expect(item(/^Work/)).toHaveAttribute("aria-expanded", "true");
      expect(within(item(/^Work/)).getByRole("group")).toBeInTheDocument();
      await user.click(chevron(/^Work/));
      expect(within(tree()).queryByRole("treeitem", { name: /^Login flow/ })).toBeNull();
      expect(useAppStore.getState()).toMatchObject({
        view: "home",
        homeView: { kind: "dashboard" },
      });
    });

    it("expansion survives a redraw — docked, peek, Home↔editor (T16)", async () => {
      const user = userEvent.setup();
      const { unmount } = renderTree();
      await user.click(chevron(/^Work/));
      unmount();
      renderTree();
      expect(item(/^Work/)).toHaveAttribute("aria-expanded", "true");
    });

    it("an unreadable diagram is a leaf too — only the chevron slot is left empty", async () => {
      const user = userEvent.setup();
      useLibraryStore.setState({ folders: [...library(), stray()] });
      renderTree();
      await user.click(chevron(/^My Diagrams/));
      expect(item(/^Old one/)).not.toHaveAttribute("aria-expanded");
      expect(chevron(/^Old one/)).toBeNull();
    });
  });

  describe("clicks — once selects, twice or Enter opens (#230 D8, T15·T16)", () => {
    const homeView = () => useAppStore.getState().homeView;
    const selected = () =>
      within(tree())
        .getAllByRole("treeitem")
        .filter((i) => i.getAttribute("aria-selected") === "true")
        .map((i) => i.getAttribute("aria-label"));

    it("one click selects only that row — Home's view and expansion stay", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(row(/^Work/));
      expect(selected()).toEqual(["Work, project, 2 items"]);
      expect(item(/^Work/)).toHaveAttribute("aria-expanded", "false");
      expect(homeView()).toEqual({ kind: "dashboard" });
      await user.click(row(/^Personal/));
      expect(selected()).toEqual(["Personal, project, 0 items"]);
      expect(homeView()).toEqual({ kind: "dashboard" });
    });

    it("one click on a row in the editor — stays in the editor, neither reading nor previewing the diagram", async () => {
      const user = userEvent.setup();
      openDocument(loginBook(), { projectId: "p1" });
      renderTree();
      await user.click(row(/^Sequence, diagram/));
      expect(useAppStore.getState().view).toBe("editor");
      expect(useDiagramStore.getState().projectId).toBe("p1");
      expect(calls("load_project")).toHaveLength(0);
      expect(selected()).toEqual([expect.stringMatching(/^Sequence, diagram/)]);
      expect(useAppStore.getState().tabs.map((t) => t.projectId)).toEqual(["p1"]);
    });

    it("double-clicking a project row — Home shows that project and expands its row, and the selection moves there", async () => {
      const user = userEvent.setup();
      openDocument(loginBook(), { projectId: "p1" });
      renderTree();
      await user.click(row(/^Personal/));
      await user.dblClick(row(/^Work/));
      await waitFor(() =>
        expect(useAppStore.getState()).toMatchObject({
          view: "home",
          homeView: { kind: "folder", folder: "work" },
        }),
      );
      expect(item(/^Work/)).toHaveAttribute("aria-expanded", "true");
      expect(selected()).toEqual(["Work, project, 2 items"]);
      // the document stays in its tab (#218 D18)
      expect(useAppStore.getState().tabs.map((t) => t.projectId)).toEqual(["p1"]);
    });

    it("a double click opens — an open one is not reread, and a single click does not change tabs (T18)", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      await user.dblClick(row(/^Login flow/));
      await waitFor(() => expect(useAppStore.getState().view).toBe("editor"));
      expect(calls("load_project")).toEqual([["load_project", { id: "p1" }]]);
      act(() => showHomeTab());
      await user.click(row(/^Login flow/));
      expect(useAppStore.getState().view).toBe("home");
      await user.dblClick(row(/^Login flow/));
      await waitFor(() => expect(useAppStore.getState().view).toBe("editor"));
      expect(calls("load_project")).toHaveLength(1);
    });

    it("when the location changes the selection follows it — the picked row is forgotten", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      await user.click(row(/^Personal/));
      expect(selected()).toEqual(["Personal, project, 0 items"]);
      await user.dblClick(row(/^Login flow/));
      await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("p1"));
      expect(selected()).toEqual([expect.stringMatching(/^Login flow, diagram/)]);
      act(() => showHomeTab({ kind: "dashboard" }));
      expect(selected()).toEqual([]);
      // a listing landing is no move: a row picked since stays picked
      await user.click(row(/^Personal/));
      act(() => useLibraryStore.setState({ folders: library() }));
      expect(selected()).toEqual(["Personal, project, 0 items"]);
    });

    it("opening another diagram rereads the listing — the left diagram's row does not revert to its old title (#217)", async () => {
      const user = userEvent.setup();
      renderHook(() => useAutosave());
      // Rust lists what was last written: the new title once p1 is saved
      serve(() =>
        library().map((f) => ({
          ...f,
          diagrams: f.diagrams.map((d) =>
            d.id === "p1" && calls("save_project").length > 0 ? { ...d, title: "Login v2" } : d,
          ),
        })),
      );
      renderTree();
      await user.click(chevron(/^Work/));
      await user.dblClick(row(/^Login flow/));
      await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("p1"));
      // the open diagram's row follows the store, not the listing
      act(() => useDiagramStore.getState().setTitle("Login v2"));
      expect(item(/^Login v2/)).toBeInTheDocument();
      await user.dblClick(row(/^Sequence, diagram/));
      await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("p2"));
      // p1 is the listing's again — the listing read after its last write
      await waitFor(() => expect(item(/^Login v2/)).toBeInTheDocument());
      expect(within(tree()).queryByRole("treeitem", { name: /^Login flow/ })).toBeNull();
    });

    it("toasts an error when it cannot open and stays on Home", async () => {
      const user = userEvent.setup();
      serve(library, { p1: "{ broken" });
      renderTree();
      await user.click(chevron(/^Work/));
      await user.dblClick(row(/^Login flow/));
      await waitFor(() => expect(toasts()).toHaveLength(1));
      expect(useAppStore.getState().view).toBe("home");
      expect(useDiagramStore.getState().projectId).toBeNull();
    });

    it("unsaved changes in an external file — going through the tree does not ask, and that file stays in its tab (#218 D8)", async () => {
      const user = userEvent.setup();
      openDocument(makeDoc([], []), { filePath: "/tmp/ext.dosik.json" });
      useDiagramStore.getState().addNode("rect", { x: 10, y: 10 });
      renderTree();
      await user.dblClick(row(/^Work/));
      await waitFor(() => expect(useAppStore.getState().view).toBe("home"));
      expect(item(/^Work/)).toHaveAttribute("aria-expanded", "true");
      await user.dblClick(row(/^Login flow/));
      await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("p1"));
      expect(mockedAsk).not.toHaveBeenCalled();
      expect(useAppStore.getState().tabs.map((t) => t.filePath ?? t.projectId)).toEqual([
        "/tmp/ext.dosik.json",
        "p1",
      ]);
    });

    describe("double-clicking controls inside a row does not open (#220)", () => {
      it("the … on a diagram row — only opens and closes the menu, does not open", async () => {
        const user = userEvent.setup();
        renderTree();
        await user.click(chevron(/^Work/));
        await user.dblClick(moreButton(/^Login flow/) as HTMLElement);
        expect(screen.queryByRole("menu")).toBeNull();
        expect(calls("load_project")).toHaveLength(0);
        expect(useAppStore.getState()).toMatchObject({ view: "home", tabs: [] });
      });

      it("a project row chevron while editing — stays in the editor", async () => {
        const user = userEvent.setup();
        openDocument(loginBook(), { projectId: "p1" });
        renderTree();
        const before = item(/^Work/).getAttribute("aria-expanded");
        await user.dblClick(chevron(/^Work/));
        expect(item(/^Work/)).toHaveAttribute("aria-expanded", before ?? "");
        expect(useAppStore.getState().view).toBe("editor");
        expect(useDiagramStore.getState().projectId).toBe("p1");
      });

      it("the tree's name field while editing — double-clicking a word to select it stays in the editor and keeps the field", async () => {
        const user = userEvent.setup();
        openDocument(loginBook(), { projectId: "p1" });
        renderTree();
        act(() => useTreeStore.getState().setRenaming("work"));
        const input = await screen.findByRole("textbox", { name: "Project name" });
        await user.dblClick(input);
        expect(useAppStore.getState().view).toBe("editor");
        expect(input).toHaveFocus();
        expect(calls("rename_folder")).toHaveLength(0);
      });
    });
  });

  describe("selection and live values (D6·D8)", () => {
    it("Home's project screen → that project row, editor → that diagram row (T15)", () => {
      showHomeTab({ kind: "folder", folder: "work" });
      const { unmount } = renderTree();
      expect(item(/^Work/)).toHaveAttribute("aria-selected", "true");
      expect(item(/^Personal/)).toHaveAttribute("aria-selected", "false");
      unmount();

      openDocument(loginBook(), { projectId: "p1" });
      renderTree();
      expect(item(/^Work/)).toHaveAttribute("aria-selected", "false");
      // opening unfolded its project (D7)
      expect(item(/^Login flow/)).toHaveAttribute("aria-selected", "true");
    });

    /** Work with a folder inside — a Home view whose row unfolds its ancestors */
    const withFlows = (): FolderMeta[] => {
      const listed = library();
      listed[0]!.folders = [
        { id: "flw", name: "Flows", updatedAt: now, diagrams: [], folders: [] },
      ];
      return listed;
    };

    it("Home's folder view → that row, ancestors expanded and focus unchanged (#220 D3, T9, #231 D1)", () => {
      useLibraryStore.setState({ folders: withFlows() });
      renderTree();
      const before = document.activeElement;
      act(() => showHomeTab({ kind: "folder", folder: "flw" }));
      expect(item(/^Flows/)).toHaveAttribute("aria-selected", "true");
      expect(document.activeElement).toBe(before);
      act(() => showHomeTab({ kind: "folder", folder: "home" }));
      expect(item(/^Personal/)).toHaveAttribute("aria-selected", "true");
      expect(item(/^Flows/)).toHaveAttribute("aria-selected", "false");
    });

    it("scrolls the row into view when Home's view changes (#220 D3)", () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      try {
        useLibraryStore.setState({ folders: withFlows() });
        renderTree();
        act(() => showHomeTab({ kind: "folder", folder: "flw" }));
        expect(scroll.mock.contexts.at(-1)).toBe(item(/^Flows/));
      } finally {
        Reflect.deleteProperty(Element.prototype, "scrollIntoView");
      }
    });

    it("Home dashboard and external files → no row is selected", () => {
      const { unmount } = renderTree();
      expect(within(tree()).queryByRole("treeitem", { selected: true })).toBeNull();
      unmount();
      openDocument(makeDoc([], []), { filePath: "/tmp/x.dosik.json" });
      renderTree();
      expect(within(tree()).queryByRole("treeitem", { selected: true })).toBeNull();
    });

    it("an open diagram's row follows the store — the title shows right away (T13)", () => {
      openDocument(loginBook(), { projectId: "p1" });
      renderTree();
      act(() => useDiagramStore.getState().setTitle("Login v2"));
      expect(item("Login v2, diagram, edited 3 min ago")).toBeInTheDocument();
    });

    it("an inactive tab's diagram row also shows that tab's title — and keeps it when going to another tab (#218 D19, T37)", () => {
      openDocument(loginBook(), { projectId: "p1" });
      useDiagramStore.getState().setTitle("Login v2");
      openDocument({ ...blankDoc(), title: "Sequence" }, { projectId: "p2" });
      renderTree();
      expect(item(/^Login v2, diagram/)).toBeInTheDocument();
      // the selected row is the active tab's diagram (#217 D6)
      expect(item(/^Sequence, diagram/)).toHaveAttribute("aria-selected", "true");
      expect(item(/^Login v2/)).toHaveAttribute("aria-selected", "false");
    });

    it("scrolls the open diagram's row into view (D7)", () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      try {
        renderTree();
        act(() => {
          openDocument({ ...blankDoc(), title: "Sequence" }, { projectId: "p2" });
        });
        expect(scroll).toHaveBeenCalledTimes(1);
        expect(scroll.mock.contexts[0]).toBe(item(/^Sequence, diagram/));
      } finally {
        Reflect.deleteProperty(Element.prototype, "scrollIntoView");
      }
    });
  });

  describe("keyboard (D29, T17)", () => {
    /** the tree's one tab stop */
    const enterTree = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.tab();
      await user.tab();
      expect(document.activeElement?.getAttribute("role")).toBe("treeitem");
    };
    const focused = () => document.activeElement?.getAttribute("aria-label");

    it("one tab stop — the first row when nothing is selected", () => {
      renderTree();
      const stops = within(tree())
        .getAllByRole("treeitem")
        .filter((i) => i.tabIndex === 0);
      expect(stops.map((i) => i.getAttribute("aria-label"))).toEqual(["Work, project, 2 items"]);
    });

    it("↑↓ move, → expand/first child, ← collapse/parent, Home/End", async () => {
      const user = userEvent.setup();
      renderTree();
      await enterTree(user);
      expect(focused()).toBe("Work, project, 2 items");
      await user.keyboard("{ArrowDown}");
      expect(focused()).toBe("Personal, project, 0 items");
      await user.keyboard("{ArrowUp}{ArrowRight}");
      expect(item(/^Work/)).toHaveAttribute("aria-expanded", "true");
      await user.keyboard("{ArrowRight}");
      expect(focused()).toBe("Login flow, diagram, edited 3 min ago");
      await user.keyboard("{ArrowLeft}");
      expect(focused()).toBe("Work, project, 2 items");
      await user.keyboard("{End}");
      expect(focused()).toBe("Personal, project, 0 items");
      await user.keyboard("{Home}{ArrowLeft}");
      expect(item(/^Work/)).toHaveAttribute("aria-expanded", "false");
    });

    it("Space selects, Enter opens — a project opens as Home's view of it, focus stays in the tree (#230 D8)", async () => {
      const user = userEvent.setup();
      renderTree();
      await enterTree(user);
      await user.keyboard(" ");
      expect(item(/^Work/)).toHaveAttribute("aria-selected", "true");
      expect(useAppStore.getState().homeView).toEqual({ kind: "dashboard" });
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "work" }),
      );
      await user.keyboard("{ArrowDown} ");
      expect(item(/^Login flow/)).toHaveAttribute("aria-selected", "true");
      expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "work" });
      expect(calls("load_project")).toHaveLength(0);
      expect(focused()).toBe("Login flow, diagram, edited 3 min ago");
      await user.keyboard("{Enter}");
      await waitFor(() => expect(useAppStore.getState().view).toBe("editor"));
      expect(useDiagramStore.getState().projectId).toBe("p1");
    });

    it("F2 renames a project, Shift+F10 opens the row menu", async () => {
      const user = userEvent.setup();
      renderTree();
      await enterTree(user);
      await user.keyboard("{F2}");
      expect(screen.getByRole("textbox", { name: "Project name" })).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(focused()).toBe("Work, project, 2 items");
      await user.keyboard("{Shift>}{F10}{/Shift}");
      const menu = screen.getByRole("menu", { name: "Work" });
      expect(within(menu).getAllByRole("menuitem")[0]).toHaveFocus();
    });

    it("keys received by the tree do not leak to the canvas — Backspace·Enter·Shift+F10 (T35)", async () => {
      const user = userEvent.setup();
      openDocument(makeDoc([makeNode({ id: "n1" })], []), { filePath: "/tmp/keys.dosik.json" });
      useDiagramStore.setState({
        nodes: useDiagramStore.getState().nodes.map((n) => ({ ...n, selected: true })),
      });
      useCanvasUiStore.setState({ nodeMenu: null });
      window.addEventListener("keydown", handleCanvasKeyDown);
      try {
        render(
          <div className="nodelete">
            <ProjectsSection />
          </div>,
        );
        await enterTree(user);
        await user.keyboard("{Backspace}");
        expect(useDiagramStore.getState().nodes).toHaveLength(1);
        await user.keyboard("{Shift>}{F10}{/Shift}");
        expect(useCanvasUiStore.getState().nodeMenu).toBeNull();
        await user.keyboard("{Escape}");
        // Enter on a project row shows Home's project; the label editor stays shut
        await user.keyboard("{Enter}");
        expect(useDiagramStore.getState().editRequestId).toBeNull();
      } finally {
        window.removeEventListener("keydown", handleCanvasKeyDown);
      }
    });
  });

  describe("reordering with the keyboard (#230 D10·D14, T22·T27)", () => {
    const status = () => screen.getByRole("status");
    const focusRowOf = (name: RegExp) => act(() => item(name).focus());

    it("⌥↓·⌥↑ — one slot among siblings, focus stays on the row, the result is announced", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      focusRowOf(/^Login flow/);
      await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
      await waitFor(() => expect(calls("reorder_item")).toHaveLength(1));
      expect(calls("reorder_item")[0]![1]).toEqual({
        parent: "work",
        item: "diagram:p1",
        index: 1,
      });
      expect(item(/^Login flow/)).toHaveFocus();
      expect(status()).toHaveTextContent("Moved “Login flow” to position 2 of 2 in Work");
    });

    it("the live region exists from the start and is not remounted — new sentences in the same node (#230)", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      const region = status();
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).toHaveTextContent("");
      focusRowOf(/^Login flow/);
      await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
      expect(status()).toBe(region);
      expect(region).toHaveTextContent("“Login flow” is already first");
      await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
      expect(status()).toBe(region);
      expect(region).toHaveTextContent("“Login flow” is already first");
    });

    it("at the ends it writes nothing and only announces that", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      focusRowOf(/^Login flow/);
      await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
      expect(status()).toHaveTextContent("“Login flow” is already first");
      focusRowOf(/^Sequence, diagram/);
      await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
      expect(status()).toHaveTextContent("“Sequence” is already last");
      expect(calls("reorder_item")).toHaveLength(0);
    });

    it("projects move among projects", async () => {
      const user = userEvent.setup();
      renderTree();
      focusRowOf(/^Personal/);
      await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
      await waitFor(() => expect(calls("reorder_item")).toHaveLength(1));
      expect(calls("reorder_item")[0]![1]).toEqual({ item: "folder:home", index: 0 });
      expect(status()).toHaveTextContent("Moved “Personal” to position 1 of 2 projects");
    });

    it("does nothing with other modifier keys or on a stray row", async () => {
      const user = userEvent.setup();
      useLibraryStore.setState({ folders: [...library(), stray()] });
      renderTree();
      focusRowOf(/^Personal/);
      await user.keyboard("{Alt>}{Shift>}{ArrowUp}{/Shift}{/Alt}");
      focusRowOf(/^My Diagrams/);
      await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
      expect(calls("reorder_item")).toHaveLength(0);
    });

    it("only movable rows have aria-keyshortcuts", () => {
      useLibraryStore.setState({ folders: [...library(), stray()] });
      renderTree();
      expect(item(/^Work/)).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
      expect(item(/^My Diagrams/)).not.toHaveAttribute("aria-keyshortcuts");
    });

    it("⌥↓ does not leak to the canvas", async () => {
      const user = userEvent.setup();
      const seen = vi.fn();
      window.addEventListener("keydown", seen);
      try {
        renderTree();
        focusRowOf(/^Work/);
        await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
        expect(seen.mock.calls.filter(([e]) => (e as KeyboardEvent).key === "ArrowDown")).toEqual(
          [],
        );
      } finally {
        window.removeEventListener("keydown", seen);
      }
    });
  });

  describe("dragging (#230 D9·D13, T23·T24)", () => {
    /** the list at y 100..400, 232 wide; rows 30 tall (#236), 1 apart, from y = 102 — under its `pt-0.5` */
    const layout = () => {
      const list = tree();
      list.getBoundingClientRect = () =>
        ({ top: 100, bottom: 400, left: 8, right: 240, width: 232, height: 300 }) as DOMRect;
      const lines = [...list.querySelectorAll<HTMLElement>("[data-row]")];
      lines.forEach((line, i) => {
        line.getBoundingClientRect = () =>
          ({ top: 102 + i * 31, bottom: 132 + i * 31, left: 8, right: 240 }) as DOMRect;
      });
    };
    const rowTop = (name: RegExp) => {
      layout();
      return row(name).getBoundingClientRect().top;
    };
    const firePointer = (type: string, x: number, y: number) => {
      const ev = new Event(type) as PointerEvent;
      Object.assign(ev, { clientX: x, clientY: y });
      act(() => {
        window.dispatchEvent(ev);
      });
    };
    /** presses `name`'s row and moves the pointer to (x, y), past the 4px threshold */
    const dragTo = (name: RegExp, x: number, y: number) => {
      layout();
      const start = row(name).getBoundingClientRect().top + 15;
      fireEvent.pointerDown(row(name), { button: 0, clientX: 60, clientY: start });
      firePointer("pointermove", 60, start + 6);
      layout();
      firePointer("pointermove", x, y);
    };
    const lifted = () => document.body.querySelector("[data-drag-row]") as HTMLElement | null;
    const dropLine = () => tree().querySelector("[data-drop-line]") as HTMLElement | null;
    const ring = (name: RegExp) => row(name).querySelector(":scope > [data-drop-ring]");

    const ordered = (): FolderMeta[] => [
      {
        ...library()[0]!,
        order: ["diagram:p1", "diagram:p2"],
        folders: [{ id: "arc", name: "Archive", updatedAt: 1, diagrams: [], folders: [] }],
      },
      library()[1]!,
    ];
    beforeEach(() => {
      useLibraryStore.setState({ folders: ordered() });
      serve(ordered);
      useTreeStore.getState().expand([folderKey("work")]);
    });

    it("drags past 4px — a ghost in place, a lifted row following the pointer, a 2px line at the spot", () => {
      renderTree();
      // Work: Archive (unlisted, on top), Login flow, Sequence
      dragTo(/^Sequence, diagram/, 70, rowTop(/^Login flow/) + 3);
      expect(item(/^Sequence, diagram/)).toHaveClass("opacity-40");
      expect(lifted()).toHaveTextContent("Sequence");
      expect(lifted()).toHaveStyle({ left: "78px", top: `${rowTop(/^Login flow/) + 13}px` });
      expect(lifted()).toHaveAttribute("aria-hidden", "true");
      // the lifted row stays 26 in 12px; its glyph is the row's, coloured (#236 R1, T8)
      expect(lifted()).toHaveClass("h-[26px]", "text-[12px]");
      const glyph = lifted()!.querySelector("svg.lucide-workflow");
      expect(glyph).toHaveClass("text-glyph-diagram");
      expect(glyph).toHaveAttribute("width", "16");
      expect(dropLine()?.closest("[data-row]")).toBe(row(/^Login flow/));
      expect(dropLine()).toHaveClass("left-5", "-top-[1.5px]");
    });

    it("dragging a folder shows a blue folder icon on the lifted row, a project only its name (#236 T8)", () => {
      renderTree();
      dragTo(/^Archive, folder/, 70, rowTop(/^Sequence/) + 20);
      const glyph = lifted()!.querySelector("[data-folder-icon]");
      expect(glyph).toHaveClass("text-glyph-folder", "fill-glyph-folder-soft");
      expect(glyph).toHaveAttribute("width", "16");
      expect(lifted()).toHaveTextContent(/^Archive$/);
      // called off, not dropped: nothing moves
      firePointer("pointercancel", 70, rowTop(/^Sequence/) + 20);
      expect(lifted()).toBeNull();
      // a project's lifted row is its name alone — no glyph, no badge (#236 R4 lists no chip)
      dragTo(/^Personal, project/, 70, rowTop(/^Work/) + 3);
      expect(lifted()).toHaveTextContent(/^Personal$/);
      expect(lifted()!.querySelector("svg")).toBeNull();
      expect(badgeIn(lifted()!)).toBeNull();
      firePointer("pointercancel", 70, rowTop(/^Work/) + 3);
      expect(calls("move_folder")).toEqual([]);
      expect(calls("reorder_item")).toEqual([]);
    });

    it("dropping places it there — reorder_item within the same parent, announced without a toast", async () => {
      renderTree();
      dragTo(/^Sequence, diagram/, 70, rowTop(/^Login flow/) + 3);
      firePointer("pointerup", 70, rowTop(/^Login flow/) + 3);
      await waitFor(() => expect(calls("reorder_item")).toHaveLength(1));
      expect(calls("reorder_item")[0]![1]).toEqual({
        parent: "work",
        item: "diagram:p2",
        index: 1,
      });
      expect(lifted()).toBeNull();
      expect(dropLine()).toBeNull();
      expect(item(/^Sequence, diagram/)).not.toHaveClass("opacity-40");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Moved “Sequence” to position 2 of 3 in Work",
      );
      expect(item(/^Sequence, diagram/)).toHaveFocus();
    });

    it("middle of a folder row — that row gets the selection background, no line, dropping puts it at the top of that folder (collapsed), focus on the folder row", async () => {
      renderTree();
      const archive = rowTop(/^Archive/);
      dragTo(/^Login flow/, 70, archive + 13);
      expect(row(/^Archive/)).toHaveClass("bg-selected", ...DROP_TARGET.split(" "));
      expect(item(/^Archive/)).toHaveAttribute("aria-selected", "false");
      expect(dropLine()).toBeNull();
      firePointer("pointerup", 70, archive + 13);
      await waitFor(() => expect(calls("move_project")).toHaveLength(1));
      expect(calls("move_project")[0]![1]).toEqual({ id: "p1", folder: "arc", index: 0 });
      expect(item(/^Archive/)).toHaveFocus();
      expect(useToastStore.getState().toasts.map((t) => t.text)).toContain(
        "Moved “Login flow” to Archive",
      );
    });

    it("marks the target with an inner ink border even when the selected row is the drop target (#230)", () => {
      renderTree();
      fireEvent.click(row(/^Archive/));
      expect(item(/^Archive/)).toHaveAttribute("aria-selected", "true");
      const archive = rowTop(/^Archive/);
      dragTo(/^Login flow/, 70, archive + 13);
      expect(row(/^Archive/)).toHaveClass(...DROP_TARGET.split(" "));
      expect(ring(/^Archive/)).toHaveClass(...DROP_RING.split(" "));
      // the ring is the target's alone: the selected fill without a drop has none
      firePointer("pointerup", 400, 120);
      expect(ring(/^Archive/)).toBeNull();
    });

    it("the drop border is drawn above the row's tail (count, …) — the tail's background does not cover the border's right side (#230)", () => {
      const filled = (): FolderMeta[] => {
        const [work, rest] = ordered();
        const archive = {
          ...work!.folders[0]!,
          diagrams: [{ id: "a1", title: "Old", updatedAt: 1, readable: true }],
        };
        return [{ ...work!, folders: [archive] }, rest!];
      };
      useLibraryStore.setState({ folders: filled() });
      serve(filled);
      renderTree();
      dragTo(/^Login flow/, 70, rowTop(/^Archive/) + 13);
      const tail = row(/^Archive/).querySelector("[data-tail]");
      expect(tail).not.toBeNull();
      // a row's own inset shadow paints under its children, the sticky tail's fill on top of it:
      // the ring is its own layer, last in the row, so it paints over the tail
      expect(row(/^Archive/).className).not.toMatch(/shadow-/);
      expect(row(/^Archive/).lastElementChild).toBe(ring(/^Archive/));
      expect(ring(/^Archive/)).toHaveClass("absolute", "inset-0", "z-10", "pointer-events-none");
      expect(ring(/^Archive/)).toHaveAttribute("aria-hidden", "true");
    });

    it("the line before the top row is not clipped at the list's top edge — the list's inner padding (#230)", () => {
      renderTree();
      expect(tree()).toHaveClass("pt-0.5");
      expect(tree()).not.toHaveClass("mt-0.5");
    });

    it("Escape cancels — writes nothing and clears the drawing", () => {
      renderTree();
      dragTo(/^Sequence, diagram/, 70, rowTop(/^Login flow/) + 3);
      const esc = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
      act(() => {
        window.dispatchEvent(esc);
      });
      expect(esc.defaultPrevented).toBe(true);
      firePointer("pointerup", 70, rowTop(/^Login flow/) + 3);
      expect(lifted()).toBeNull();
      expect(calls("reorder_item")).toHaveLength(0);
    });

    it("dropping outside the tree (sideways) does nothing", () => {
      renderTree();
      dragTo(/^Sequence, diagram/, 400, rowTop(/^Login flow/) + 3);
      expect(dropLine()).toBeNull();
      firePointer("pointerup", 400, rowTop(/^Login flow/) + 3);
      expect(calls("reorder_item")).toHaveLength(0);
      expect(calls("move_project")).toHaveLength(0);
    });

    it("a click after a drag does not change the selection — under 4px is just a click (select)", () => {
      renderTree();
      dragTo(/^Sequence, diagram/, 400, 120);
      firePointer("pointerup", 400, 120);
      fireEvent.click(row(/^Sequence, diagram/));
      expect(item(/^Sequence, diagram/)).toHaveAttribute("aria-selected", "false");
      fireEvent.pointerDown(row(/^Sequence, diagram/), { button: 0, clientX: 60, clientY: 200 });
      firePointer("pointermove", 61, 201);
      firePointer("pointerup", 61, 201);
      fireEvent.click(row(/^Sequence, diagram/));
      expect(item(/^Sequence, diagram/)).toHaveAttribute("aria-selected", "true");
      expect(lifted()).toBeNull();
    });

    it("the next Space still selects if no click follows the drag — only that one click is swallowed (#230)", async () => {
      const user = userEvent.setup();
      renderTree();
      dragTo(/^Sequence, diagram/, 400, 120);
      // dropped off the list: no click lands on the row
      firePointer("pointerup", 400, 120);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      act(() => item(/^Sequence, diagram/).focus());
      await user.keyboard(" ");
      expect(item(/^Sequence, diagram/)).toHaveAttribute("aria-selected", "true");
    });

    it("a row being renamed does not drag even when pressed outside the input (#230)", async () => {
      renderTree();
      act(() => useTreeStore.getState().setRenaming("work"));
      await screen.findByRole("textbox", { name: "Project name" });
      layout();
      fireEvent.pointerDown(row(/^Work/), { button: 0, clientX: 230, clientY: 113 });
      firePointer("pointermove", 230, 160);
      expect(lifted()).toBeNull();
      firePointer("pointerup", 230, 160);
    });

    it("a ctrl+click (right click on macOS) that also sends click does not change the selection (#230)", () => {
      renderTree();
      onMac(() => fireEvent.click(row(/^Personal/), { ctrlKey: true }));
      expect(item(/^Personal/)).toHaveAttribute("aria-selected", "false");
      fireEvent.click(row(/^Personal/));
      expect(item(/^Personal/)).toHaveAttribute("aria-selected", "true");
    });

    it("off macOS a ctrl+click is a click — it picks the row", () => {
      renderTree();
      fireEvent.click(row(/^Personal/), { ctrlKey: true });
      expect(item(/^Personal/)).toHaveAttribute("aria-selected", "true");
    });

    it("does not drag from the chevron, …, the right button or ctrl+click", () => {
      renderTree();
      layout();
      const tryDrag = (el: Element, init: object) => {
        fireEvent.pointerDown(el, { clientX: 60, clientY: 110, ...init });
        firePointer("pointermove", 60, 160);
        expect(lifted()).toBeNull();
        firePointer("pointerup", 60, 160);
      };
      tryDrag(chevron(/^Work/), { button: 0 });
      tryDrag(moreButton(/^Work/)!, { button: 0 });
      tryDrag(row(/^Personal/), { button: 2 });
      onMac(() => tryDrag(row(/^Personal/), { button: 0, ctrlKey: true }));
    });

    it("does not target rows hidden by scrolling when the pointer leaves above the list — the row at the visible edge (#230)", () => {
      renderTree();
      // scrolled by 54: Work and Archive sit above the list's top edge (100), hidden
      const scrolled = () => {
        layout();
        [...tree().querySelectorAll<HTMLElement>("[data-row]")].forEach((line, i) => {
          line.getBoundingClientRect = () =>
            ({ top: 46 + i * 27, bottom: 72 + i * 27, left: 8, right: 240 }) as DOMRect;
        });
      };
      scrolled();
      const start = row(/^Sequence, diagram/).getBoundingClientRect().top + 13;
      fireEvent.pointerDown(row(/^Sequence, diagram/), { button: 0, clientX: 60, clientY: start });
      firePointer("pointermove", 60, start + 6);
      scrolled();
      // over the hidden Work row, above the list
      firePointer("pointermove", 70, 60);
      expect(row(/^Work/)).not.toHaveClass("bg-selected");
      expect(dropLine()?.closest("[data-row]")).toBe(row(/^Login flow/));
      firePointer("pointerup", 70, 60);
    });

    it("the first row is the target when the pointer leaves above a list scrolled to the top — it does not fall into the list's top padding (pt-0.5) (#230)", async () => {
      renderTree();
      const start = rowTop(/^Sequence, diagram/) + 13;
      dragTo(/^Sequence, diagram/, 70, start + 30);
      // above the list (the PROJECTS heading): the first row, Work, at the visible top edge
      firePointer("pointermove", 70, 80);
      expect(row(/^Work/)).toHaveClass(...DROP_TARGET.split(" "));
      firePointer("pointerup", 70, 80);
      await waitFor(() => expect(calls("reorder_item")).toHaveLength(1));
      expect(calls("reorder_item")[0]![1]).toEqual({
        parent: "work",
        item: "diagram:p2",
        index: 0,
      });
    });

    /** the list's scroll range: 700 of content in a 300 box */
    const scrollRange = () => {
      Object.defineProperty(tree(), "scrollHeight", { configurable: true, value: 1000 });
      Object.defineProperty(tree(), "clientHeight", { configurable: true, value: 300 });
    };

    it("the tree scrolls by itself at the edges", () => {
      vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
      try {
        renderTree();
        scrollRange();
        dragTo(/^Sequence, diagram/, 70, 396);
        act(() => {
          vi.advanceTimersToNextFrame();
          vi.advanceTimersToNextFrame();
        });
        expect(tree().scrollTop).toBeGreaterThan(0);
      } finally {
        firePointer("pointerup", 70, 396);
        vi.useRealTimers();
      }
    });

    it("does not recompute the spot every frame once already scrolled to the end (#230)", () => {
      vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
      try {
        renderTree();
        scrollRange();
        tree().scrollTop = 700;
        dragTo(/^Sequence, diagram/, 70, 396);
        // every row's box is read when the slot is worked out again
        let reads = 0;
        for (const line of tree().querySelectorAll<HTMLElement>("[data-row]")) {
          const read = line.getBoundingClientRect;
          line.getBoundingClientRect = () => {
            reads += 1;
            return read();
          };
        }
        act(() => {
          vi.advanceTimersToNextFrame();
          vi.advanceTimersToNextFrame();
          vi.advanceTimersToNextFrame();
        });
        expect(tree().scrollTop).toBe(700);
        expect(reads).toBe(0);
      } finally {
        firePointer("pointerup", 70, 396);
        vi.useRealTimers();
      }
    });

    it("dropping a stray diagram on a real folder row moves it into that folder (#230)", async () => {
      const withStray = (): FolderMeta[] => [...ordered(), stray()];
      useLibraryStore.setState({ folders: withStray() });
      serve(withStray);
      useTreeStore.getState().expand([folderKey("work"), folderKey("my-diagrams")]);
      renderTree();
      const archive = rowTop(/^Archive/);
      dragTo(/^Old one/, 70, archive + 13);
      expect(row(/^Archive/)).toHaveClass(...DROP_TARGET.split(" "));
      firePointer("pointerup", 70, archive + 13);
      await waitFor(() => expect(calls("move_project")).toHaveLength(1));
      expect(calls("move_project")[0]![1]).toEqual({ id: "old", folder: "arc", index: 0 });
    });

    it("cancels the drag when the dragged item disappears from the listing", () => {
      renderTree();
      dragTo(/^Sequence, diagram/, 70, rowTop(/^Login flow/) + 3);
      act(() =>
        useLibraryStore.setState({
          folders: ordered().map((f) => ({
            ...f,
            diagrams: f.diagrams.filter((d) => d.id !== "p2"),
          })),
        }),
      );
      expect(lifted()).toBeNull();
      firePointer("pointerup", 70, 130);
      expect(calls("reorder_item")).toHaveLength(0);
    });
  });

  describe("row menu (D10, T26)", () => {
    it("project = New diagram · New folder · Rename · Delete, diagram = Open · Rename · Move to… · Delete (#219 D3, #229 D11)", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(moreButton(/^Work/)!);
      expect(
        within(screen.getByRole("menu", { name: "Work" }))
          .getAllByRole("menuitem")
          .map((i) => i.textContent),
      ).toEqual(["New diagram", "New folder", SHOW_IN, "Copy Path", "Rename", "Delete"]);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).toBeNull();
      await user.click(chevron(/^Work/));
      await user.click(moreButton(/^Login flow/)!);
      expect(
        within(screen.getByRole("menu", { name: "Login flow" }))
          .getAllByRole("menuitem")
          .map((i) => i.textContent),
      ).toEqual(["Open", SHOW_IN, "Copy Path", "Rename", "Move to…", "Delete"]);
    });

    it("clicking the … of an open menu again closes it (#220)", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(moreButton(/^Work/)!);
      expect(screen.getByRole("menu", { name: "Work" })).toBeInTheDocument();
      await user.click(moreButton(/^Work/)!);
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("a stray project has no menu, and with only one project there is no Move", async () => {
      const user = userEvent.setup();
      useLibraryStore.setState({ folders: [library()[0]!, stray()] });
      renderTree();
      expect(moreButton(/^My Diagrams/)).toBeNull();
      await user.click(chevron(/^Work/));
      await user.click(moreButton(/^Login flow/)!);
      expect(
        within(screen.getByRole("menu", { name: "Login flow" }))
          .getAllByRole("menuitem")
          .map((i) => i.textContent),
      ).toEqual(["Open", SHOW_IN, "Copy Path", "Rename", "Delete"]);
    });

    it("arrows cycle through items, Escape closes and returns to the row", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(moreButton(/^Work/)!);
      const items = within(screen.getByRole("menu", { name: "Work" })).getAllByRole("menuitem");
      expect(items[0]).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(items[1]).toHaveFocus();
      // past the first: round to the last (New diagram · New folder · Show in Finder · Copy Path · Rename · Delete)
      await user.keyboard("{ArrowUp}{ArrowUp}");
      expect(items).toHaveLength(6);
      expect(items[5]).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).toBeNull();
      expect(item(/^Work/)).toHaveFocus();
    });

    it("New diagram — creates a new diagram in that project and opens it", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(moreButton(/^Personal/)!);
      await user.click(screen.getByRole("menuitem", { name: "New diagram" }));
      await waitFor(() => expect(useAppStore.getState().view).toBe("editor"));
      expect(calls("save_project")[0]![1]).toMatchObject({ folder: "home" });
    });

    it("Rename — Escape cancels, clicking elsewhere saves only once", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(moreButton(/^Work/)!);
      await user.click(screen.getByRole("menuitem", { name: "Rename" }));
      let input = screen.getByRole("textbox", { name: "Project name" });
      await user.clear(input);
      await user.type(input, "Nope{Escape}");
      expect(screen.queryByRole("textbox", { name: "Project name" })).toBeNull();
      expect(calls("rename_folder")).toHaveLength(0);

      await user.click(moreButton(/^Work/)!);
      await user.click(screen.getByRole("menuitem", { name: "Rename" }));
      input = screen.getByRole("textbox", { name: "Project name" });
      await user.clear(input);
      await user.type(input, "Client");
      await user.click(document.body);
      await waitFor(() => expect(calls("rename_folder")).toHaveLength(1));
      expect(calls("rename_folder")[0]![1]).toMatchObject({ name: "Client" });
    });

    it("Delete — asks, then deletes (project and diagram)", async () => {
      const user = userEvent.setup();
      mockedAsk.mockResolvedValue(true);
      renderTree();
      await user.click(moreButton(/^Work/)!);
      await user.click(screen.getByRole("menuitem", { name: "Delete" }));
      await waitFor(() => expect(calls("delete_folder")[0]![1]).toEqual({ id: "work" }));
      await user.click(chevron(/^Work/));
      await user.click(moreButton(/^Login flow/)!);
      await user.click(screen.getByRole("menuitem", { name: "Delete" }));
      await waitFor(() => expect(calls("delete_project")[0]![1]).toEqual({ id: "p1" }));
    });

    describe("Rename — opens it and renames in its tab (#219 D3, T29)", () => {
      beforeEach(() => useAppStore.setState({ titleEditRequest: null }));

      const renameFromMenu = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
        await user.click(moreButton(name)!);
        await user.click(screen.getByRole("menuitem", { name: "Rename" }));
      };

      it("an open, active diagram — requests on that tab right away", async () => {
        const user = userEvent.setup();
        openDocument(loginBook(), { projectId: "p1" });
        // the open diagram's project is unfolded already
        renderTree();
        await renameFromMenu(user, /^Login flow/);
        expect(useAppStore.getState().titleEditRequest).toBe(useAppStore.getState().activeTab);
        expect(calls("load_project")).toHaveLength(0);
      });

      it("an unopened diagram — reads it, opens a new tab, then requests on that tab", async () => {
        const user = userEvent.setup();
        renderTree();
        await user.click(chevron(/^Work/));
        await renameFromMenu(user, /^Sequence/);
        await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("p2"));
        expect(calls("load_project")).toHaveLength(1);
        expect(useAppStore.getState().titleEditRequest).toBe(useAppStore.getState().activeTab);
      });

      it("an open inactive tab — switches to it, then requests, without rereading", async () => {
        const user = userEvent.setup();
        openDocument(loginBook(), { projectId: "p1" });
        openDocument(blankDoc(), { projectId: "p2" });
        const first = useAppStore.getState().tabs[0]!.id;
        renderTree();
        await renameFromMenu(user, /^Login flow/);
        await waitFor(() => expect(useAppStore.getState().activeTab).toBe(first));
        expect(useAppStore.getState().titleEditRequest).toBe(first);
        expect(calls("load_project")).toHaveLength(0);
      });

      it("only a toast when it cannot be read — no edit request", async () => {
        const user = userEvent.setup();
        serve(library, {});
        mockedInvoke.mockImplementation(async (cmd) => {
          if (cmd === "load_project") throw new Error("gone");
          return undefined;
        });
        renderTree();
        await user.click(chevron(/^Work/));
        await renameFromMenu(user, /^Sequence/);
        await waitFor(() => expect(toasts()).toEqual(["Error: gone"]));
        expect(useAppStore.getState().titleEditRequest).toBeNull();
        // no title field took the focus: it goes back to the row (#219)
        await waitFor(() => expect(item(/^Sequence/)).toHaveFocus());
      });
    });

    it("Open — opens the diagram", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      await user.click(moreButton(/^Sequence/)!);
      await user.click(screen.getByRole("menuitem", { name: "Open" }));
      await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("p2"));
    });

    it("Move to… — a picker beside the menu, picking another project does move_project, the current project cannot be picked, and there is no stray (#229 D13)", async () => {
      const user = userEvent.setup();
      useLibraryStore.setState({ folders: [...library(), stray()] });
      renderTree();
      await user.click(chevron(/^Work/));
      await user.click(moreButton(/^Login flow/)!);
      await user.click(screen.getByRole("menuitem", { name: "Move to…" }));
      // the menu stays, the picker opens beside it
      expect(screen.getByRole("menu", { name: "Login flow" })).toBeInTheDocument();
      const picker = screen.getByRole("tree", { name: "Move to" });
      expect(
        within(picker).getByRole("treeitem", { name: "Work, project, current location" }),
      ).toHaveAttribute("aria-disabled", "true");
      expect(within(picker).queryByRole("treeitem", { name: /^My Diagrams/ })).toBeNull();
      await user.click(
        within(picker)
          .getByRole("treeitem", { name: "Personal, project" })
          .querySelector("[data-row]")!,
      );
      await waitFor(() =>
        expect(calls("move_project")[0]![1]).toEqual({ id: "p1", folder: "home" }),
      );
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  describe("context menu (#230 D11, T19)", () => {
    const menuItemsOf = (name: string) =>
      within(screen.getByRole("menu", { name }))
        .getAllByRole("menuitem")
        .map((i) => i.textContent);
    const rightClick = (el: Element, x = 100, y = 200) =>
      // false: the webview's own menu was kept away
      fireEvent.contextMenu(el, { clientX: x, clientY: y, button: 2 });

    it("right-clicking a row opens its menu 2px right and below the pointer — blocks the default menu, keeps the selection, tints the row as hovered", () => {
      renderTree();
      expect(rightClick(row(/^Work/))).toBe(false);
      const menu = screen.getByRole("menu", { name: "Work" });
      expect(menu).toHaveStyle({ left: "102px", top: "202px" });
      expect(menuItemsOf("Work")).toEqual([
        "New diagram",
        "New folder",
        SHOW_IN,
        "Copy Path",
        "Rename",
        "Delete",
      ]);
      expect(row(/^Work/)).toHaveClass("bg-hover");
      // the count stays, the `…` does not come up under the resting pointer
      expect(moreButton(/^Work/)).toHaveClass("hidden");
      expect(moreButton(/^Work/)).not.toHaveClass("group-hover/row:flex");
      expect(row(/^Work/).querySelector("[data-count]")).not.toHaveClass("group-hover/row:hidden");
      expect(item(/^Work/)).toHaveAttribute("aria-selected", "false");
      expect(useAppStore.getState().homeView).toEqual({ kind: "dashboard" });
    });

    it("diagram row — Open · Rename · Move to… · Delete, Escape closes and returns to the row", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      rightClick(row(/^Login flow/));
      expect(menuItemsOf("Login flow")).toEqual([
        "Open",
        SHOW_IN,
        "Copy Path",
        "Rename",
        "Move to…",
        "Delete",
      ]);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).toBeNull();
      expect(item(/^Login flow/)).toHaveFocus();
    });

    it("right-clicking another row switches to that row's menu — one at a time", () => {
      renderTree();
      rightClick(row(/^Work/));
      fireEvent.pointerDown(row(/^Personal/), { button: 2 });
      rightClick(row(/^Personal/), 50, 60);
      expect(screen.getAllByRole("menu")).toHaveLength(1);
      expect(screen.getByRole("menu", { name: "Personal" })).toHaveStyle({ left: "52px" });
      expect(row(/^Work/)).not.toHaveClass("bg-hover");
    });

    it("empty space and the PROJECTS header — just New project; picking it creates one at the top and renames it", async () => {
      const user = userEvent.setup();
      renderTree();
      expect(rightClick(tree(), 40, 500)).toBe(false);
      expect(menuItemsOf("Projects")).toEqual(["New project"]);
      expect(screen.getByRole("menu", { name: "Projects" })).toHaveStyle({
        left: "42px",
        top: "502px",
      });
      await user.keyboard("{Escape}");
      expect(rightClick(screen.getByRole("heading", { name: "Projects" }))).toBe(false);
      expect(menuItemsOf("Projects")).toEqual(["New project"]);
      await user.click(screen.getByRole("menuitem", { name: "New project" }));
      await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
      expect(calls("create_folder")[0]![1]).toMatchObject({ name: "New project" });
      const made = calls("create_folder")[0]![1] as { id: string };
      await waitFor(() => expect(useTreeStore.getState().renaming).toBe(made.id));
    });

    it("moving to another field while a context-menu New project is being created — the name field does not steal focus (#230 D15 rule, #218 D15)", async () => {
      const user = userEvent.setup();
      // the write waits for the test: the field is focused before it lands
      let land: () => void = () => undefined;
      mockedInvoke.mockImplementation(async (cmd) => {
        if (cmd === "create_folder") await new Promise<void>((r) => (land = r));
        if (cmd === "list_library") return library();
        return undefined;
      });
      renderTree();
      rightClick(tree(), 40, 500);
      await user.click(screen.getByRole("menuitem", { name: "New project" }));
      await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
      const field = document.createElement("input");
      document.body.appendChild(field);
      act(() => field.focus());
      const listed = calls("list_library").length;
      await act(async () => land());
      await waitFor(() => expect(calls("list_library").length).toBe(listed + 1));
      await act(async () => undefined);
      expect(document.activeElement).toBe(field);
      expect(useTreeStore.getState().renaming).toBeNull();
      field.remove();
    });

    it("a stray row has no menu but the default menu does not appear either, and the name field is not intercepted", async () => {
      useLibraryStore.setState({ folders: [library()[0]!, stray()] });
      renderTree();
      expect(rightClick(row(/^My Diagrams/))).toBe(false);
      expect(screen.queryByRole("menu")).toBeNull();
      act(() => useTreeStore.getState().setRenaming("work"));
      const input = await screen.findByRole("textbox", { name: "Project name" });
      expect(rightClick(input)).toBe(true);
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  describe("+ New project (D12, T27)", () => {
    it("creates and renames right in the tree — the screen stays", async () => {
      const user = userEvent.setup();
      let listing = library();
      mockedInvoke.mockImplementation(async (cmd, args) => {
        if (cmd === "create_folder") {
          const { id } = args as { id: string };
          listing = [
            { folders: [], id, name: "New project", updatedAt: now, diagrams: [] },
            ...library(),
          ];
        }
        if (cmd === "list_library") return listing;
        return undefined;
      });
      openDocument(loginBook(), { projectId: "p1" });
      renderTree();
      await user.click(screen.getByRole("button", { name: "New project" }));
      const input = await screen.findByRole("textbox", { name: "Project name" });
      expect(input).toHaveFocus();
      expect(calls("create_folder")[0]![1]).toMatchObject({ name: "New project" });
      // the editor's document stays open
      expect(useAppStore.getState().view).toBe("editor");
      expect(useDiagramStore.getState().projectId).toBe("p1");
      await user.clear(input);
      await user.type(input, "Client X{Enter}");
      await waitFor(() => expect(calls("rename_folder")).toHaveLength(1));
      expect(calls("rename_folder")[0]![1]).toMatchObject({ name: "Client X" });
    });

    it("moving to another tab while creating — does not open the name field even with focus on body (#229, WebKit)", async () => {
      const user = userEvent.setup();
      let listing = library();
      mockedInvoke.mockImplementation(async (cmd, args) => {
        if (cmd === "create_folder") {
          await new Promise((r) => setTimeout(r, 20));
          const { id } = args as { id: string };
          listing = [
            { folders: [], id, name: "New project", updatedAt: now, diagrams: [] },
            ...library(),
          ];
        }
        if (cmd === "list_library") return listing;
        return undefined;
      });
      renderTree();
      await user.click(screen.getByRole("button", { name: "New project" }));
      act(() => (document.activeElement as HTMLElement | null)?.blur());
      act(() => {
        openDocument({ ...blankDoc(), title: "Other" }, { projectId: "other" });
      });
      await waitFor(() => expect(item(/^New project/)).toBeInTheDocument());
      await act(() => new Promise((r) => setTimeout(r, 30)));
      expect(useTreeStore.getState().renaming).toBeNull();
    });

    it("when the user moves to another field while creating — the name field does not steal focus (#229, #218 D15)", async () => {
      const user = userEvent.setup();
      let listing = library();
      mockedInvoke.mockImplementation(async (cmd, args) => {
        if (cmd === "create_folder") {
          await new Promise((r) => setTimeout(r, 20));
          const { id } = args as { id: string };
          listing = [
            { folders: [], id, name: "New project", updatedAt: now, diagrams: [] },
            ...library(),
          ];
        }
        if (cmd === "list_library") return listing;
        return undefined;
      });
      renderTree();
      await user.click(screen.getByRole("button", { name: "New project" }));
      const field = document.createElement("input");
      document.body.appendChild(field);
      act(() => field.focus());
      await waitFor(() => expect(item(/^New project/)).toBeInTheDocument());
      await act(() => new Promise((r) => setTimeout(r, 30)));
      expect(field).toHaveFocus();
      expect(screen.queryByRole("textbox", { name: "Project name" })).toBeNull();
      field.remove();
    });
  });

  describe("listing states (R2)", () => {
    afterEach(() => vi.useRealTimers());

    it("placeholder rows after 300ms before the listing arrives", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      useLibraryStore.setState({ folders: null });
      renderTree();
      expect(screen.queryByRole("status", { name: "Loading projects" })).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByRole("status", { name: "Loading projects" })).toBeInTheDocument();
      act(() => useLibraryStore.setState({ folders: library() }));
      expect(screen.queryByRole("status", { name: "Loading projects" })).toBeNull();
      expect(item(/^Work/)).toBeInTheDocument();
    });

    it("a failed read with an empty listing shows 'Couldn't load projects' + Try again", async () => {
      const user = userEvent.setup();
      useLibraryStore.setState({ folders: [], readFailed: true });
      renderTree();
      expect(screen.getByText("Couldn't load projects")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByRole("treeitem", { name: /^Work/ })).toBeInTheDocument();
    });

    it("an empty library shows 'No projects yet'", () => {
      useLibraryStore.setState({ folders: [] });
      renderTree();
      expect(screen.getByText("No projects yet")).toBeInTheDocument();
    });

    it("reads the listing when first drawn in the editor without one — when Home mounts, Home reads it", async () => {
      useLibraryStore.setState({ folders: null });
      const { unmount } = renderTree();
      expect(calls("list_library")).toHaveLength(0);
      unmount();
      openDocument(makeDoc([], []), { filePath: "/tmp/editor.dosik.json" });
      renderTree();
      await waitFor(() => expect(calls("list_library")).toHaveLength(1));
      expect(await screen.findByRole("treeitem", { name: /^Work/ })).toBeInTheDocument();
    });

    it("row key handling does not intercept keys in the name input", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(moreButton(/^Work/)!);
      await user.click(screen.getByRole("menuitem", { name: "Rename" }));
      const input = screen.getByRole("textbox", { name: "Project name" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: " " });
      expect(input).toHaveFocus();
    });
  });

  /** folders nest (#229 D6·D11·D13, T38) */
  describe("nested folders", () => {
    const nested = (): FolderMeta[] => [
      {
        id: "work",
        name: "Work",
        updatedAt: now,
        diagrams: [{ id: "p1", title: "Login flow", updatedAt: now - 60_000, readable: true }],
        folders: [
          {
            id: "chk",
            name: "Checkout",
            updatedAt: now,
            diagrams: [{ id: "ord", title: "Order", updatedAt: now, readable: true }],
            folders: [{ id: "flw", name: "Flows", updatedAt: 1, diagrams: [], folders: [] }],
          },
        ],
      },
      { id: "home", name: "Personal", updatedAt: 1, diagrams: [], folders: [] },
    ];
    let listing: FolderMeta[] = [];

    beforeEach(() => {
      listing = nested();
      useLibraryStore.setState({ folders: nested(), readFailed: false });
      mockedInvoke.mockImplementation(async (cmd, args) => {
        if (cmd === "create_folder") {
          const { id, parent } = args as { id: string; parent?: string };
          const add = (fs: FolderMeta[]): FolderMeta[] =>
            fs.map((f) =>
              f.id === parent
                ? {
                    ...f,
                    folders: [
                      { id, name: "New folder", updatedAt: now + 1, diagrams: [], folders: [] },
                      ...f.folders,
                    ],
                  }
                : { ...f, folders: add(f.folders) },
            );
          listing = add(listing);
        }
        if (cmd === "list_library") return listing;
        return undefined;
      });
    });

    it("folder row — chevron + Folder (FolderOpen when expanded) + name + count, indented 16px per level", async () => {
      const user = userEvent.setup();
      renderTree();
      expect(item("Work, project, 2 items")).toHaveAttribute("aria-level", "1");
      await user.click(chevron(/^Work/));
      const checkout = item("Checkout, folder, 2 items");
      expect(checkout).toHaveAttribute("aria-level", "2");
      expect(row(/^Checkout/)).toHaveClass("pl-5");
      expect(row(/^Checkout/).querySelector("[data-folder-icon]")).toHaveAttribute(
        "data-folder-icon",
        "closed",
      );
      expect(row(/^Checkout/).querySelector("[data-count]")).toHaveTextContent("2");
      await user.click(chevron(/^Checkout/));
      expect(row(/^Checkout/).querySelector("[data-folder-icon]")).toHaveAttribute(
        "data-folder-icon",
        "open",
      );
      expect(item(/^Order, diagram/)).toHaveAttribute("aria-level", "3");
      expect(row(/^Order/)).toHaveClass("pl-9");
      // an empty folder: no count, no chevron
      const flows = item("Flows, folder, 0 items");
      expect(flows).not.toHaveAttribute("aria-expanded");
      expect(row(/^Flows/).querySelector("[data-count]")).toBeNull();
    });

    it("double-clicking a folder row makes Home show that folder and expands the row (#230 D8)", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      await user.dblClick(row(/^Checkout/));
      expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
      expect(item(/^Checkout/)).toHaveAttribute("aria-expanded", "true");
      expect(item(/^Checkout/)).toHaveAttribute("aria-selected", "true");
    });

    it("Home's folder view → that folder row expands too, showing its contents, and stays collapsed after collapsing even when a new listing arrives (#231 D1)", async () => {
      const user = userEvent.setup();
      renderTree();
      act(() => showHomeTab({ kind: "folder", folder: "chk" }));
      expect(item(/^Work/)).toHaveAttribute("aria-expanded", "true");
      expect(item(/^Checkout/)).toHaveAttribute("aria-expanded", "true");
      expect(item(/^Order, diagram/)).toBeInTheDocument();
      await user.click(chevron(/^Checkout/));
      act(() => useLibraryStore.setState({ folders: nested() }));
      expect(item(/^Checkout/)).toHaveAttribute("aria-expanded", "false");
      expect(within(tree()).queryByRole("treeitem", { name: /^Order, diagram/ })).toBeNull();
    });

    it("opening a nested diagram expands all ancestors and selects its row", () => {
      // an open diagram's row is its tab's title (D8)
      openDocument({ ...blankDoc(), title: "Order" }, { projectId: "ord" });
      renderTree();
      expect(item(/^Work/)).toHaveAttribute("aria-expanded", "true");
      expect(item(/^Checkout/)).toHaveAttribute("aria-expanded", "true");
      expect(item(/^Order/)).toHaveAttribute("aria-selected", "true");
    });

    it("F2 — renames a folder row in place", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      act(() => item(/^Checkout/).focus());
      fireEvent.keyDown(item(/^Checkout/), { key: "F2" });
      const input = screen.getByRole("textbox", { name: "Folder name" });
      await user.clear(input);
      await user.type(input, "Basket{Enter}");
      await waitFor(() =>
        expect(calls("rename_folder")[0]![1]).toEqual({ id: "chk", name: "Basket" }),
      );
    });

    it("folder menu = New diagram · New folder · Rename · Move to… · Delete — New folder expands the parent and renames the new row (D11)", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      await user.click(moreButton(/^Checkout/)!);
      expect(
        within(screen.getByRole("menu", { name: "Checkout" }))
          .getAllByRole("menuitem")
          .map((i) => i.textContent),
      ).toEqual([
        "New diagram",
        "New folder",
        SHOW_IN,
        "Copy Path",
        "Rename",
        "Move to…",
        "Delete",
      ]);
      await user.click(screen.getByRole("menuitem", { name: "New folder" }));
      const input = await screen.findByRole("textbox", { name: "Folder name" });
      expect(input).toHaveFocus();
      expect(calls("create_folder")[0]![1]).toMatchObject({ name: "New folder", parent: "chk" });
      expect(item(/^Checkout/)).toHaveAttribute("aria-expanded", "true");
    });

    it("Move to… — moves into a nested folder (D13)", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      await user.click(moreButton(/^Login flow/)!);
      await user.click(screen.getByRole("menuitem", { name: "Move to…" }));
      const picker = screen.getByRole("tree", { name: "Move to" });
      await user.click(
        within(picker)
          .getByRole("treeitem", { name: "Checkout, folder" })
          .querySelector("[data-row]")!,
      );
      await waitFor(() =>
        expect(calls("move_project")[0]![1]).toEqual({ id: "p1", folder: "chk" }),
      );
    });

    it("deep folders — scroll sideways instead of truncating: grid list, no ellipsis, counts stick to the right edge (Sidebar-Deep)", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      await user.click(chevron(/^Checkout/));
      const tree = screen.getByRole("tree");
      // one column as wide as the widest row, at least the list's; both axes scroll
      expect(tree).toHaveClass("grid", "grid-cols-[minmax(max-content,1fr)]", "overflow-auto");
      // no name is cut with an ellipsis; it takes its own width
      const name = within(row(/^Checkout/)).getByText("Checkout");
      expect(name).not.toHaveClass("truncate");
      expect(name).toHaveClass("whitespace-nowrap", "flex-[1_0_auto]");
      // the count sticks to the visible right edge over a 12px fade of the row's own fill
      const tail = row(/^Checkout/).querySelector("[data-tail]") as HTMLElement;
      expect(tail).toHaveClass("sticky", "right-0", "pl-3", "pr-2");
      expect(tail.className).toContain("linear-gradient(to_right,transparent,var(--row-bg)_12px)");
      expect(tail.querySelector("[data-count]")).toHaveTextContent("2");
      // a row with a count leaves its right padding to the box; one without keeps 8
      expect(row(/^Checkout/)).toHaveClass("pr-0");
      expect(row(/^Order/)).toHaveClass("pr-2");
      // the fill the fade blends into follows the row: frame, hover, selected
      expect(row(/^Checkout/)).toHaveClass(
        "[--row-bg:var(--frame)]",
        "hover:[--row-bg:var(--hover)]",
      );
    });

    it("folder Move to… — itself and descendants disabled, picking does move_folder to the top of that folder (#230 D12)", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      fireEvent.contextMenu(row(/^Checkout/), { clientX: 60, clientY: 80 });
      await user.click(screen.getByRole("menuitem", { name: "Move to…" }));
      const picker = screen.getByRole("tree", { name: "Move to" });
      expect(picker).toHaveAccessibleDescription("Moving Checkout");
      expect(
        within(picker).getByRole("treeitem", { name: "Work, project, current location" }),
      ).toBeInTheDocument();
      expect(
        within(picker).getByRole("treeitem", { name: "Checkout, folder, unavailable" }),
      ).toHaveAttribute("aria-disabled", "true");
      await user.click(
        within(picker)
          .getByRole("treeitem", { name: "Personal, project" })
          .querySelector("[data-row]")!,
      );
      await waitFor(() =>
        expect(calls("move_folder")[0]![1]).toEqual({ id: "chk", parent: "home", index: 0 }),
      );
      expect(screen.queryByRole("menu")).toBeNull();
      expect(useToastStore.getState().toasts.map((t) => t.text)).toContain(
        "Moved “Checkout” to Personal",
      );
    });

    it("the project menu has no Move to… (#230 D7)", () => {
      renderTree();
      fireEvent.contextMenu(row(/^Work/), { clientX: 60, clientY: 80 });
      expect(screen.queryByRole("menuitem", { name: "Move to…" })).toBeNull();
    });

    it("a level-10 folder's menu has no New folder — a level-9 one does (#229)", async () => {
      const user = userEvent.setup();
      // Work › d2 › … › d10
      let deepest: FolderMeta = { id: "d10", name: "D10", updatedAt: 1, diagrams: [], folders: [] };
      for (let k = 9; k >= 2; k--) {
        deepest = { id: `d${k}`, name: `D${k}`, updatedAt: 1, diagrams: [], folders: [deepest] };
      }
      const chain = (): FolderMeta[] => [{ ...nested()[0]!, folders: [deepest] }];
      useLibraryStore.setState({ folders: chain() });
      useTreeStore
        .getState()
        .expand(["work", ...Array.from({ length: 8 }, (_, i) => `d${i + 2}`)].map(folderKey));
      renderTree();
      const labels = async (name: RegExp) => {
        await user.click(moreButton(name)!);
        const menu = screen.getByRole("menu");
        const out = within(menu)
          .getAllByRole("menuitem")
          .map((i) => i.textContent);
        await user.keyboard("{Escape}");
        return out;
      };
      expect(await labels(/^D9,/)).toContain("New folder");
      expect(await labels(/^D10,/)).toEqual([
        "New diagram",
        SHOW_IN,
        "Copy Path",
        "Rename",
        "Move to…",
        "Delete",
      ]);
    });

    /** move_project moves p1 (Login flow) from Work into `chk` in the listing — a little late, as the disk does */
    const serveMove = () => {
      mockedInvoke.mockImplementation(async (cmd, args) => {
        if (cmd === "move_project") {
          await new Promise((r) => setTimeout(r, 20));
          const { folder: to } = args as { folder: string };
          const p1 = listing[0]!.diagrams.find((d) => d.id === "p1")!;
          listing = structuredClone(listing);
          listing[0]!.diagrams = listing[0]!.diagrams.filter((d) => d.id !== "p1");
          if (to === "chk") listing[0]!.folders[0]!.diagrams.push(p1);
        }
        if (cmd === "list_library") return structuredClone(listing);
        return undefined;
      });
    };
    /** Login flow's row › Shift+F10 › Move to… › → › ↓ (Checkout) › Enter */
    const moveLoginToCheckout = async (user: ReturnType<typeof userEvent.setup>) => {
      act(() => item(/^Login flow/).focus());
      await user.keyboard("{Shift>}{F10}{/Shift}");
      act(() => screen.getByRole("menuitem", { name: "Move to…" }).focus());
      await user.keyboard("{ArrowRight}");
      await user.keyboard("{ArrowDown}");
      expect(document.activeElement).toHaveAttribute("aria-label", "Checkout, folder");
      await user.keyboard("{Enter}");
    };

    it.each([
      ["collapsed", false],
      ["expanded", true],
    ])(
      "after Move to…, focus is on that row at its new place — even when moved into a %s folder, it does not fall to body (#229)",
      async (_, open) => {
        const user = userEvent.setup();
        serveMove();
        useTreeStore.getState().expand([folderKey("work"), ...(open ? [folderKey("chk")] : [])]);
        renderTree();
        await moveLoginToCheckout(user);
        // the listing has the row in Checkout now, unfolded
        await waitFor(() => expect(item(/^Login flow/)).toHaveAttribute("aria-level", "3"));
        expect(item(/^Checkout/)).toHaveAttribute("aria-expanded", "true");
        // and the focus is on that row — the tree keeps its Backspace guard
        await waitFor(() => expect(document.activeElement).toBe(item(/^Login flow/)));
        expect(screen.getByRole("tree")).toContainElement(document.activeElement as HTMLElement);
      },
    );

    /** a field outside the tree — the canvas's label editor, a title */
    const elsewhere = () => {
      const field = document.createElement("input");
      field.setAttribute("aria-label", "elsewhere field");
      document.body.appendChild(field);
      act(() => field.focus());
      return field;
    };

    it("when the user moves to another field during the move — focus is not stolen even when the listing arrives (#229, #218 D15)", async () => {
      const user = userEvent.setup();
      serveMove();
      useTreeStore.getState().expand([folderKey("work"), folderKey("chk")]);
      renderTree();
      await moveLoginToCheckout(user);
      const field = elsewhere();
      await waitFor(() => expect(item(/^Login flow/)).toHaveAttribute("aria-level", "3"));
      await new Promise((r) => setTimeout(r, 30));
      expect(document.activeElement).toBe(field);
      field.remove();
    });

    /** WebKit: a click on a tab leaves the focus on the page — the screen changed all the same */
    const anotherTabWithFocusOnThePage = () => {
      act(() => (document.activeElement as HTMLElement | null)?.blur());
      act(() => {
        openDocument({ ...blankDoc(), title: "Other" }, { projectId: "other" });
      });
      expect(document.activeElement).toBe(document.body);
    };

    it("moving to another tab during the move — focus is not pulled into the tree even when on body (#229, WebKit)", async () => {
      const user = userEvent.setup();
      serveMove();
      useTreeStore.getState().expand([folderKey("work"), folderKey("chk")]);
      renderTree();
      await moveLoginToCheckout(user);
      anotherTabWithFocusOnThePage();
      await waitFor(() => expect(item(/^Login flow/)).toHaveAttribute("aria-level", "3"));
      await act(() => new Promise((r) => setTimeout(r, 30)));
      expect(document.activeElement).toBe(document.body);
    });

    it("does not pull focus to the row if Rename could not open and the user went to another tab meanwhile (#230, #218 D15)", async () => {
      const user = userEvent.setup();
      // the load fails when the test says, not after a timer a loaded machine may outrun
      let fail = () => {};
      const failed = new Promise<void>((r) => {
        fail = r;
      });
      mockedInvoke.mockImplementation(async (cmd) => {
        if (cmd === "load_project") {
          await failed;
          throw new Error("gone");
        }
        if (cmd === "list_library") return structuredClone(listing);
        return undefined;
      });
      renderTree();
      await user.click(chevron(/^Work/));
      await user.click(moreButton(/^Login flow/)!);
      await user.click(screen.getByRole("menuitem", { name: "Rename" }));
      anotherTabWithFocusOnThePage();
      fail();
      await act(() => new Promise((r) => setTimeout(r, 50)));
      expect(document.activeElement).toBe(document.body);
    });

    it("moving to another tab while New folder is being created — does not open the name field even with focus on body (#229)", async () => {
      const user = userEvent.setup();
      const make = mockedInvoke.getMockImplementation()!;
      mockedInvoke.mockImplementation(async (cmd, args) => {
        if (cmd === "create_folder") await new Promise((r) => setTimeout(r, 20));
        return make(cmd, args);
      });
      renderTree();
      await user.click(chevron(/^Work/));
      await user.click(moreButton(/^Checkout/)!);
      await user.click(screen.getByRole("menuitem", { name: "New folder" }));
      anotherTabWithFocusOnThePage();
      await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
      await act(() => new Promise((r) => setTimeout(r, 50)));
      expect(useTreeStore.getState().renaming).toBeNull();
      expect(document.activeElement).toBe(document.body);
    });

    it("when the user moves to another field while New folder is being created — the name field does not steal focus (#229)", async () => {
      const user = userEvent.setup();
      const make = mockedInvoke.getMockImplementation()!;
      mockedInvoke.mockImplementation(async (cmd, args) => {
        if (cmd === "create_folder") await new Promise((r) => setTimeout(r, 20));
        return make(cmd, args);
      });
      renderTree();
      await user.click(chevron(/^Work/));
      await user.click(moreButton(/^Checkout/)!);
      await user.click(screen.getByRole("menuitem", { name: "New folder" }));
      const field = elsewhere();
      await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
      // the listing has it — inside Checkout, which stays folded: nothing moved
      await waitFor(() =>
        expect(
          useLibraryStore.getState().folders?.[0]?.folders[0]?.folders.map((f) => f.name),
        ).toContain("New folder"),
      );
      await new Promise((r) => setTimeout(r, 30));
      expect(document.activeElement).toBe(field);
      expect(screen.queryByRole("textbox", { name: "Folder name" })).toBeNull();
      field.remove();
    });

    /** move_folder moves `chk` (Checkout) into `parent` in the listing — a little late, as the disk does */
    /** the move lands after 20ms — or, `held`, when the returned `land` says: not after a timer a loaded machine may outrun */
    const serveFolderMove = ({ held = false } = {}) => {
      let land = () => {};
      const landed = new Promise<void>((r) => {
        land = r;
      });
      mockedInvoke.mockImplementation(async (cmd, args) => {
        if (cmd === "move_folder") {
          await (held ? landed : new Promise((r) => setTimeout(r, 20)));
          const { parent } = args as { parent: string };
          const chk = listing[0]!.folders.find((f) => f.id === "chk")!;
          listing = structuredClone(listing);
          listing[0]!.folders = listing[0]!.folders.filter((f) => f.id !== "chk");
          listing.find((f) => f.id === parent)!.folders.unshift(chk);
        }
        if (cmd === "list_library") return structuredClone(listing);
        return undefined;
      });
      return land;
    };
    /** Checkout's row › Shift+F10 › Move to… › Personal */
    const moveCheckoutToPersonal = async (user: ReturnType<typeof userEvent.setup>) => {
      act(() => item(/^Checkout/).focus());
      await user.keyboard("{Shift>}{F10}{/Shift}");
      await user.click(screen.getByRole("menuitem", { name: "Move to…" }));
      await user.click(
        within(screen.getByRole("tree", { name: "Move to" }))
          .getByRole("treeitem", { name: "Personal, project" })
          .querySelector("[data-row]")!,
      );
    };

    it("after folder Move to…, focus is also on that folder row at its new place — its parent expands (#230 D12, #229)", async () => {
      const user = userEvent.setup();
      serveFolderMove();
      useTreeStore.getState().expand([folderKey("work")]);
      renderTree();
      await moveCheckoutToPersonal(user);
      await waitFor(() => expect(item(/^Checkout/)).toHaveAttribute("aria-level", "2"));
      expect(item(/^Personal/)).toHaveAttribute("aria-expanded", "true");
      expect(item(/^Personal/)).toContainElement(item(/^Checkout/));
      await waitFor(() => expect(document.activeElement).toBe(item(/^Checkout/)));
    });

    it("moving to another tab while a folder is moving — focus is not pulled into the tree even when on body (#230, #229)", async () => {
      const user = userEvent.setup();
      const land = serveFolderMove({ held: true });
      useTreeStore.getState().expand([folderKey("work")]);
      renderTree();
      await moveCheckoutToPersonal(user);
      anotherTabWithFocusOnThePage();
      land();
      await waitFor(() =>
        expect(
          useLibraryStore
            .getState()
            .folders?.find((f) => f.id === "home")
            ?.folders.map((f) => f.id),
        ).toEqual(["chk"]),
      );
      await act(() => new Promise((r) => setTimeout(r, 30)));
      expect(document.activeElement).toBe(document.body);
      expect(item(/^Personal/)).toHaveAttribute("aria-expanded", "false");
    });

    it("when the user moves to another field while a folder is moving — neither focus nor expansion is stolen when the listing arrives (#230 D15 rule, #218 D15)", async () => {
      const user = userEvent.setup();
      const land = serveFolderMove({ held: true });
      useTreeStore.getState().expand([folderKey("work")]);
      renderTree();
      await moveCheckoutToPersonal(user);
      const field = elsewhere();
      land();
      // the listing has Checkout in Personal now — which stays folded
      await waitFor(() =>
        expect(
          useLibraryStore
            .getState()
            .folders?.find((f) => f.id === "home")
            ?.folders.map((f) => f.id),
        ).toEqual(["chk"]),
      );
      await new Promise((r) => setTimeout(r, 30));
      expect(document.activeElement).toBe(field);
      expect(item(/^Personal/)).toHaveAttribute("aria-expanded", "false");
      field.remove();
    });

    it("the Move to… picker opens with the folders expanded in the sidebar still expanded (#229)", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      await user.click(chevron(/^Checkout/));
      await user.click(moreButton(/^Login flow/)!);
      await user.click(screen.getByRole("menuitem", { name: "Move to…" }));
      const picker = screen.getByRole("tree", { name: "Move to" });
      expect(within(picker).getByRole("treeitem", { name: "Checkout, folder" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(within(picker).getByRole("treeitem", { name: "Flows, folder" })).toBeInTheDocument();
    });
  });

  /** 30px rows in 13px, glyphs coloured by kind, a project's badge (#236 R1·R2·R4, T5) */
  describe("row and color display (#236)", () => {
    const marked = (): FolderMeta[] => [
      {
        id: "work",
        name: "Work",
        updatedAt: now,
        diagrams: [{ id: "p1", title: "Login flow", updatedAt: now - 60_000, readable: true }],
        folders: [
          {
            id: "chk",
            name: "Checkout",
            updatedAt: now,
            diagrams: [{ id: "ord", title: "Order", updatedAt: now, readable: true }],
            folders: [],
          },
        ],
      },
      { id: "home", name: "personal", updatedAt: 1, diagrams: [], folders: [] },
      stray(),
    ];
    const badgeOf = (name: RegExp) => badgeIn(row(name));

    beforeEach(() => {
      useLibraryStore.setState({ folders: marked(), readFailed: false });
    });

    it("rows are 30px·13px, counts 12px", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      for (const name of [/^Work/, /^Checkout/, /^Login flow/, /^My Diagrams/]) {
        expect(row(name)).toHaveClass("h-[30px]", "text-[13px]");
        expect(row(name)).not.toHaveClass("h-[26px]");
        expect(row(name)).not.toHaveClass("text-[12px]");
      }
      expect(row(/^Work/).querySelector("[data-count]")).toHaveClass("text-[12px]");
    });

    it("project row — badge after the chevron (or its slot), then the name. The badge is the first letter in the id's color", () => {
      renderTree();
      const work = badgeOf(/^Work/)!;
      expect(work).toHaveTextContent("W");
      expect(work).toHaveClass(`bg-badge-${badgeColour("work")}-soft`, "h-4", "w-4");
      expect(work).toHaveAttribute("aria-hidden", "true");
      expect(work.previousElementSibling).toBe(chevron(/^Work/));
      expect(work.nextElementSibling).toHaveTextContent("Work");
      // nothing to unfold: the chevron's spacer, then the badge; the letter is upper case
      const personal = badgeOf(/^personal/)!;
      expect(personal).toHaveTextContent("P");
      expect(personal.previousElementSibling).toHaveClass("w-3.5");
      // the badge is not read: the row's name stays as it was
      expect(item(/^Work/)).toHaveAttribute("aria-label", "Work, project, 2 items");
    });

    it("the stray list (My Diagrams) is a top-level row too, so it gets a badge", () => {
      renderTree();
      const mine = badgeOf(/^My Diagrams/)!;
      expect(mine).toHaveTextContent("M");
      expect(mine).toHaveClass(`bg-badge-${badgeColour("my-diagrams")}-soft`);
    });

    it("folder and diagram rows have 16px colored icons and no badge", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      const folder = row(/^Checkout/).querySelector("[data-folder-icon]")!;
      expect(folder).toHaveClass("text-glyph-folder", "fill-glyph-folder-soft");
      expect(folder).toHaveAttribute("width", "16");
      const diagram = row(/^Login flow/).querySelector("svg.lucide-workflow")!;
      expect(diagram).toHaveClass("text-glyph-diagram");
      expect(diagram).toHaveAttribute("width", "16");
      expect(badgeOf(/^Checkout/)).toBeNull();
      expect(badgeOf(/^Login flow/)).toBeNull();
      // the chevron stays 14
      expect(chevron(/^Checkout/).querySelector("svg")).toHaveAttribute("width", "14");
    });

    it("a selected row's icon color does not turn ink", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      await user.click(row(/^Checkout/));
      expect(row(/^Checkout/)).toHaveClass("bg-selected");
      const folder = row(/^Checkout/).querySelector("[data-folder-icon]")!;
      expect(folder).toHaveClass("text-glyph-folder");
      expect(folder).not.toHaveClass("text-ink");
      await user.click(row(/^Login flow/));
      expect(row(/^Login flow/).querySelector("svg.lucide-workflow")).toHaveClass(
        "text-glyph-diagram",
      );
    });

    it("placeholder rows while reading are 30px too", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        useLibraryStore.setState({ folders: null });
        renderTree();
        await act(async () => {
          vi.advanceTimersByTime(300);
        });
        const rows = screen.getByRole("status", { name: "Loading projects" }).children;
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) expect(r).toHaveClass("h-[30px]");
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
