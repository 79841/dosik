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
import { FOLD_MS } from "../FoldGroup";
import { ProjectsSection } from "../LibraryTree";
import { dropAt } from "../treeDrop";
import { folderKey } from "../treeModel";
import { resetTreeForTests, useTreeStore } from "../treeStore";
import { badgeIn } from "../../../test/badges";
import { showInLabel } from "../../library/fileManager";
import { likeRust } from "../../../test/rustAnswers";

// the tree's drop targets as they are, counted (#260)
vi.mock("../treeDrop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../treeDrop")>();
  return { ...actual, dropAt: vi.fn(actual.dropAt) };
});
const dropAtCalls = vi.mocked(dropAt);

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
/** a project holding a diagram that cannot be opened */
const mine = (): FolderMeta => ({
  folders: [],
  id: "my-diagrams",
  name: "My Diagrams",
  updatedAt: now - 10 * 86_400_000,
  diagrams: [{ id: "old", title: "Old one", updatedAt: now - 10 * 86_400_000, readable: false }],
});
const loginBook = (): DiagramDoc => ({ ...blankDoc(), title: "Login flow" });

/** list_library answers from `listing`, load_project from `files`, the rest from `extra` */
const serve = (
  listing: () => unknown = library,
  files: Record<string, unknown> = { p1: loginBook(), p2: blankDoc() },
  extra: Record<string, unknown> = {},
) =>
  mockedInvoke.mockImplementation(
    likeRust(async (cmd, args) => {
      if (cmd === "list_library") return listing();
      if (cmd === "load_project") {
        const { id } = args as { id: string };
        return typeof files[id] === "string" ? files[id] : JSON.stringify(files[id]);
      }
      if (cmd in extra) return extra[cmd];
      return undefined;
    }),
  );

const renderTree = () => render(<ProjectsSection />);
const tree = () => screen.getByRole("tree", { name: "Projects" });
const item = (name: string | RegExp) => within(tree()).getByRole("treeitem", { name });
/** a row's own line — the treeitem also holds its children */
const row = (name: string | RegExp) => item(name).querySelector("[data-row]") as HTMLElement;
/** a row's fill — on its fill box, the list's visible width; the row paints nothing itself (#280) */
const fill = (name: string | RegExp) => row(name).querySelector("[data-fill]") as HTMLElement;
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
      useLibraryStore.setState({ folders: [...library(), mine()] });
      renderTree();
      await user.click(chevron(/^My Diagrams/));
      expect(item(/^Old one/)).not.toHaveAttribute("aria-expanded");
      expect(chevron(/^Old one/)).toBeNull();
    });
  });

  describe("fold motion (#260 R1)", () => {
    const icons = (name: RegExp) =>
      [...chevron(name).querySelectorAll("svg")].map((svg) => svg.getAttribute("class"));
    const groupOf = (name: RegExp) =>
      item(name).querySelector(":scope > [data-fold]") as HTMLElement | null;

    it("the chevron is one ChevronRight that turns 90° while unfolded, 180ms ease-out, only when motion is allowed", async () => {
      const user = userEvent.setup();
      renderTree();
      expect(icons(/^Work/)).toHaveLength(1);
      const svg = chevron(/^Work/).querySelector("svg")!;
      expect(svg).toHaveClass("lucide-chevron-right");
      expect(svg).not.toHaveClass("rotate-90");
      expect(
        svg
          .getAttribute("class")!
          .split(/\s+/)
          .filter((c) => /transition|duration|ease/.test(c)),
      ).toEqual([
        "motion-safe:transition-transform",
        "motion-safe:duration-180",
        "motion-safe:ease-[cubic-bezier(0.2,0,0,1)]",
      ]);
      await user.click(chevron(/^Work/));
      expect(chevron(/^Work/).querySelector("svg")).toBe(svg);
      expect(svg).toHaveClass("rotate-90");
      expect(tree().querySelector(".lucide-chevron-down")).toBeNull();
    });

    it("folding: aria-expanded at once, the rows fold out of the screen reader's and the focus' reach, then go", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      const group = groupOf(/^Work/)!;
      expect(group).toHaveClass("grid-rows-[1fr]");
      await user.click(chevron(/^Work/));
      expect(item(/^Work/)).toHaveAttribute("aria-expanded", "false");
      expect(groupOf(/^Work/)).toBe(group);
      expect(group).toHaveClass("grid-rows-[0fr]", "opacity-0");
      expect(group).toHaveAttribute("inert");
      expect(within(tree()).queryByRole("treeitem", { name: /^Login flow/ })).toBeNull();
      expect(within(tree()).queryByRole("group")).toBeNull();
      fireEvent.transitionEnd(group);
      expect(groupOf(/^Work/)).toBeNull();
    });

    it("→ and ← fold the same way as the chevron — a second press turns the motion back", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.tab();
      await user.tab();
      await user.keyboard("{ArrowRight}");
      const group = groupOf(/^Work/)!;
      expect(group).toHaveClass("grid-rows-[1fr]");
      await user.keyboard("{ArrowLeft}");
      expect(group).toHaveClass("grid-rows-[0fr]");
      expect(item(/^Work/)).toHaveFocus();
      // before the motion ends: the same rows turn back
      await user.keyboard("{ArrowRight}");
      expect(groupOf(/^Work/)).toBe(group);
      expect(group).toHaveClass("grid-rows-[1fr]");
      expect(group).not.toHaveAttribute("inert");
      expect(item(/^Login flow/)).toBeInTheDocument();
    });

    it("the focus that went into rows still unfolding is scrolled into view again once they have (#260)", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      try {
        renderTree();
        act(() => item(/^Work/).focus());
        fireEvent.keyDown(item(/^Work/), { key: "ArrowRight" });
        fireEvent.keyDown(item(/^Work/), { key: "ArrowRight" });
        expect(item(/^Login flow/)).toHaveFocus();
        expect(scroll).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(FOLD_MS + 50));
        expect(scroll.mock.contexts).toEqual([item(/^Login flow/)]);
      } finally {
        Reflect.deleteProperty(Element.prototype, "scrollIntoView");
        vi.useRealTimers();
      }
    });

    it("the rows stand 31 apart from 2 below the list's top — the pitch a drag works out (30 tall, 1 between)", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(chevron(/^Work/));
      expect(tree()).toHaveClass("pt-0.5", "gap-y-px");
      expect(row(/^Work/)).toHaveClass("h-[30px]");
      // the 1px between a row and its first child, and between children, is inside the group
      expect(item(/^Work/)).not.toHaveClass("gap-px");
      expect(within(item(/^Work/)).getByRole("group")).toHaveClass("[&>li]:mt-px");
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

    it("scrolls it into view again once its folders have unfolded — the list was shorter while they grew (#260)", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      try {
        renderTree();
        act(() => {
          openDocument({ ...blankDoc(), title: "Sequence" }, { projectId: "p2" });
        });
        expect(scroll).toHaveBeenCalledTimes(1);
        act(() => vi.advanceTimersByTime(FOLD_MS + 49));
        expect(scroll).toHaveBeenCalledTimes(1);
        act(() => vi.advanceTimersByTime(1));
        expect(scroll).toHaveBeenCalledTimes(2);
        expect(scroll.mock.contexts[1]).toBe(item(/^Sequence, diagram/));
        expect(scroll).toHaveBeenLastCalledWith({ block: "nearest" });
      } finally {
        Reflect.deleteProperty(Element.prototype, "scrollIntoView");
        vi.useRealTimers();
      }
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

    it("does nothing with other modifier keys", async () => {
      const user = userEvent.setup();
      renderTree();
      focusRowOf(/^Personal/);
      await user.keyboard("{Alt>}{Shift>}{ArrowUp}{/Shift}{/Alt}");
      expect(calls("reorder_item")).toHaveLength(0);
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
    /** the drop's preview row (#260 R2) — on the list, over the rows */
    const preview = () => tree().querySelector("[data-drop-preview]") as HTMLElement | null;
    /** its row line — at 40%, at the spot's depth */
    const previewRow = () => preview()?.firstElementChild as HTMLElement | null;
    /** each row's line moved out of the preview's way, by name */
    const moved = () =>
      Object.fromEntries(
        [...tree().querySelectorAll<HTMLElement>("[data-row]")]
          .filter((line) => line.style.transform)
          .map((line) => [
            line.closest("[role=treeitem]")!.getAttribute("aria-label")!.split(",")[0],
            line.style.transform,
          ]),
      );
    /** the drop ring — on the row's ring box (#280), none while the row is no drop target */
    const ring = (name: RegExp) => {
      const box = row(name).querySelector("[data-ring]");
      return box && DROP_RING.split(" ").every((c) => box.classList.contains(c)) ? box : null;
    };

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

    it("drags past 4px — the row turns into its preview where it stands, nothing moves, the lifted row follows the pointer (#260 R2)", () => {
      renderTree();
      act(() => item(/^Sequence, diagram/).focus());
      // Work, Archive, Login flow, Sequence (row 3): still over itself
      dragTo(/^Sequence, diagram/, 70, rowTop(/^Sequence/) + 20);
      expect(item(/^Sequence, diagram/)).toHaveClass("opacity-0");
      expect(item(/^Sequence, diagram/)).toHaveFocus();
      expect(preview()).toHaveStyle({ top: `${2 + 3 * 31}px` });
      expect(previewRow()).toHaveClass("pl-5");
      expect(moved()).toEqual({});
      expect(lifted()).toHaveTextContent("Sequence");
      expect(lifted()).toHaveStyle({ left: "78px", top: `${rowTop(/^Sequence/) + 30}px` });
      expect(lifted()).toHaveAttribute("aria-hidden", "true");
      // the lifted row stays 26 in 12px; its glyph is the row's, coloured (#236 R1, T8)
      expect(lifted()).toHaveClass("h-[26px]", "text-[12px]");
      const glyph = lifted()!.querySelector("svg.lucide-workflow");
      expect(glyph).toHaveClass("text-glyph-diagram");
      expect(glyph).toHaveAttribute("width", "16");
      firePointer("pointercancel", 70, 0);
    });

    it("between siblings: the preview stands at the slot at its depth, the rows between make room by 31px — no line (#260 R2)", () => {
      renderTree();
      dragTo(/^Sequence, diagram/, 70, rowTop(/^Login flow/) + 3);
      // Work, Archive, [Sequence], Login flow, Personal
      expect(preview()).toHaveStyle({ top: `${2 + 2 * 31}px` });
      expect(moved()).toEqual({ "Login flow": "translateY(31px)" });
      expect(tree().querySelector("[data-drop-line]")).toBeNull();
      // the row itself at 40%: its glyph and name, no fill, no `…`
      expect(previewRow()).toHaveClass("opacity-40", "pl-5", "h-[30px]", "font-medium");
      expect(previewRow()).not.toHaveClass("bg-selected");
      expect(previewRow()).toHaveTextContent(/^Sequence$/);
      expect(previewRow()!.querySelector("svg.lucide-workflow")).toHaveClass("text-glyph-diagram");
      expect(within(preview()!).queryByRole("button")).toBeNull();
      // not a tree item: screen readers hear the move from the tree
      expect(preview()).toHaveAttribute("aria-hidden", "true");
      expect(preview()).not.toHaveAttribute("role");
      expect(preview()).toHaveClass("pointer-events-none", "absolute");
      expect(tree()).toHaveClass("relative");
      expect(within(tree()).getAllByRole("treeitem")).toHaveLength(5);
      // the rows glide 150ms ease-out, only when motion is allowed; the preview jumps
      expect(
        row(/^Login flow/)
          .getAttribute("class")!
          .split(/\s+/)
          .filter((c) => /transition|duration|ease/.test(c)),
      ).toEqual([
        "motion-safe:transition-transform",
        "motion-safe:duration-150",
        "motion-safe:ease-[cubic-bezier(0.2,0,0,1)]",
      ]);
      expect(preview()!.className).not.toMatch(/transition/);
      firePointer("pointercancel", 70, 0);
    });

    it("dragging down: the rows between move up", () => {
      renderTree();
      dragTo(/^Login flow/, 70, rowTop(/^Sequence/) + 20);
      // Work, Archive, Sequence, [Login flow], Personal
      expect(preview()).toHaveStyle({ top: `${2 + 3 * 31}px` });
      expect(moved()).toEqual({ Sequence: "translateY(-31px)" });
      firePointer("pointercancel", 70, 0);
    });

    it("the same pointer y gives the same preview — the preview and the gliding rows do not move what is under it (#260)", () => {
      renderTree();
      const y = rowTop(/^Login flow/) + 3;
      dragTo(/^Sequence, diagram/, 70, y);
      const top = preview()!.style.top;
      // the rows on screen where the glide took them
      for (const line of tree().querySelectorAll<HTMLElement>("[data-row]")) {
        const shift = Number.parseFloat(line.style.transform.slice(11)) || 0;
        const { top: t, bottom: b } = line.getBoundingClientRect();
        line.getBoundingClientRect = () =>
          ({ top: t + shift, bottom: b + shift, left: 8, right: 240 }) as DOMRect;
      }
      firePointer("pointermove", 70, y);
      expect(preview()!.style.top).toBe(top);
      firePointer("pointermove", 71, y);
      expect(preview()!.style.top).toBe(top);
      expect(moved()).toEqual({ "Login flow": "translateY(31px)" });
      firePointer("pointercancel", 70, 0);
    });

    it("into an unfolded folder: the preview is its first item, one level deeper — no fill, no ring on the folder (#260 R2)", () => {
      renderTree();
      // the middle of Work's row (a project row is all "into")
      dragTo(/^Login flow/, 70, rowTop(/^Work/) + 15);
      expect(preview()).toHaveStyle({ top: `${2 + 31}px` });
      expect(previewRow()).toHaveClass("pl-5");
      expect(moved()).toEqual({ Archive: "translateY(31px)" });
      expect(fill(/^Work/)).not.toHaveClass("bg-selected");
      expect(ring(/^Work/)).toBeNull();
      firePointer("pointercancel", 70, 0);
    });

    it("an unfolded folder is never ringed — not even when the dragged row has left the rows some other way (#260 R2)", () => {
      renderTree();
      dragTo(/^Login flow/, 70, rowTop(/^Sequence/) + 20);
      // a listing lands with Login flow moved into the collapsed Archive elsewhere
      const elsewhere = (): FolderMeta[] => {
        const [work, personal] = ordered();
        return [
          {
            ...work!,
            order: ["diagram:p2"],
            diagrams: work!.diagrams.filter((d) => d.id !== "p1"),
            folders: [{ ...work!.folders[0]!, diagrams: [work!.diagrams[0]!] }],
          },
          personal!,
        ];
      };
      act(() => useLibraryStore.setState({ folders: elsewhere() }));
      expect(lifted()).not.toBeNull();
      // Work, Archive, Sequence, Personal: into Work, unfolded
      firePointer("pointermove", 70, 102 + 15);
      expect(ring(/^Work/)).toBeNull();
      expect(fill(/^Work/)).not.toHaveClass("bg-selected");
      firePointer("pointercancel", 0, 0);
    });

    it("into a collapsed folder: no preview, the folder row filled and ringed, no row moves — the dragged row's place stays empty (#260 R2)", () => {
      renderTree();
      dragTo(/^Login flow/, 70, rowTop(/^Archive/) + 13);
      expect(preview()).toBeNull();
      expect(fill(/^Archive/)).toHaveClass(...DROP_TARGET.split(" "));
      expect(ring(/^Archive/)).not.toBeNull();
      expect(moved()).toEqual({});
      expect(item(/^Login flow/)).toHaveClass("opacity-0");
      firePointer("pointercancel", 70, 0);
    });

    it("a project goes by blocks: its preview is its row folded at level 1 — chevron, badge, name, count — and the projects make room (#260 R2)", () => {
      renderTree();
      expect(item(/^Work/)).toHaveAttribute("aria-expanded", "true");
      // Work is unfolded: dragging it folds it — Work 102, Personal 133
      dragTo(/^Work/, 70, 133 + 20);
      expect(item(/^Work/)).toHaveAttribute("aria-expanded", "false");
      expect(item(/^Work/).querySelector(":scope > [data-fold]")).toHaveClass("grid-rows-[0fr]");
      expect(within(tree()).queryByRole("treeitem", { name: /^Login flow/ })).toBeNull();
      // Personal, [Work]
      expect(preview()).toHaveStyle({ top: `${2 + 31}px` });
      expect(moved()).toEqual({ Personal: "translateY(-31px)" });
      const line = previewRow()!;
      expect(line).toHaveClass("pl-1");
      const chevronSvg = line.querySelector("svg.lucide-chevron-right");
      expect(chevronSvg).not.toBeNull();
      expect(chevronSvg).not.toHaveClass("rotate-90");
      expect(badgeIn(line)).not.toBeNull();
      expect(line).toHaveTextContent("Work");
      expect(line).toHaveTextContent("3");
      // the drag ends: unfolded again — the fold was the drag's, not the tree's
      firePointer("pointercancel", 70, 0);
      expect(useTreeStore.getState().expanded.has(folderKey("work"))).toBe(true);
      expect(item(/^Work/)).toHaveAttribute("aria-expanded", "true");
      expect(item(/^Work/).querySelector(":scope > [data-fold]")).toHaveClass("grid-rows-[1fr]");
      expect(item(/^Login flow/)).toBeInTheDocument();
    });

    /** the rows that glide when they move — all but while a drop lands */
    const gliding = () =>
      [...tree().querySelectorAll<HTMLElement>("[data-row]")].filter((line) =>
        line.classList.contains("motion-safe:transition-transform"),
      ).length;
    const labels = () =>
      within(tree())
        .getAllByRole("treeitem")
        .map((i) => i.getAttribute("aria-label")!.split(",")[0]);

    it("a drop lands where its preview stood, at once — no row glides from where the drag had it, then the glide is back (#260 R4)", async () => {
      vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
      try {
        renderTree();
        const y = rowTop(/^Login flow/) + 3;
        dragTo(/^Sequence, diagram/, 70, y);
        expect(moved()).toEqual({ "Login flow": "translateY(31px)" });
        firePointer("pointerup", 70, y);
        // the same commit: the rows in their new order, none moved, none gliding
        expect(preview()).toBeNull();
        expect(moved()).toEqual({});
        expect(gliding()).toBe(0);
        expect(labels()).toEqual(["Work", "Archive", "Sequence", "Login flow", "Personal"]);
        expect(item(/^Sequence, diagram/)).not.toHaveClass("opacity-0");
        act(() => {
          vi.advanceTimersToNextFrame();
        });
        expect(gliding()).toBe(labels().length);
      } finally {
        vi.useRealTimers();
      }
      await waitFor(() => expect(calls("reorder_item")).toHaveLength(1));
    });

    it("Escape, a release off the tree or the window losing focus calls it off: the preview goes, the rows glide back, the row is where it was (#260 R4)", () => {
      renderTree();
      const y = rowTop(/^Login flow/) + 3;
      const calledOff = (end: () => void) => {
        act(() => item(/^Sequence, diagram/).focus());
        dragTo(/^Sequence, diagram/, 70, y);
        expect(moved()).toEqual({ "Login flow": "translateY(31px)" });
        end();
        expect(preview()).toBeNull();
        expect(lifted()).toBeNull();
        expect(moved()).toEqual({});
        // back to its place with the glide
        expect(gliding()).toBe(labels().length);
        expect(item(/^Sequence, diagram/)).not.toHaveClass("opacity-0");
        expect(item(/^Sequence, diagram/)).toHaveFocus();
        expect(labels()).toEqual(["Work", "Archive", "Login flow", "Sequence", "Personal"]);
      };
      calledOff(() =>
        act(() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
        }),
      );
      calledOff(() => firePointer("pointerup", 400, y));
      calledOff(() =>
        act(() => {
          window.dispatchEvent(new Event("blur"));
        }),
      );
      expect(calls("reorder_item")).toHaveLength(0);
      expect(calls("move_project")).toHaveLength(0);
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
      expect(preview()).toBeNull();
      expect(item(/^Sequence, diagram/)).not.toHaveClass("opacity-0");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Moved “Sequence” to position 2 of 3 in Work",
      );
      expect(item(/^Sequence, diagram/)).toHaveFocus();
    });

    it("middle of a folder row — that row gets the selection background, no preview, dropping puts it at the top of that folder (collapsed), focus on the folder row", async () => {
      renderTree();
      const archive = rowTop(/^Archive/);
      dragTo(/^Login flow/, 70, archive + 13);
      expect(fill(/^Archive/)).toHaveClass("bg-selected", ...DROP_TARGET.split(" "));
      expect(item(/^Archive/)).toHaveAttribute("aria-selected", "false");
      expect(preview()).toBeNull();
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
      expect(fill(/^Archive/)).toHaveClass(...DROP_TARGET.split(" "));
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
      // an inset shadow under the row's children would lie under the sticky tail's fill:
      // the ring is on its own layer over the content, last in the row, so it paints over the tail
      expect(row(/^Archive/).className).not.toMatch(/shadow-/);
      expect(fill(/^Archive/).className).not.toMatch(/shadow-/);
      const layer = ring(/^Archive/)!.parentElement!;
      expect(row(/^Archive/).lastElementChild).toBe(layer);
      expect(layer).toHaveClass("absolute", "inset-0", "z-10", "pointer-events-none");
      expect(layer).toHaveAttribute("aria-hidden", "true");
    });

    it("the drop target's fill and ring stay inside the list's visible width, all four corners rounded — boxes, not the row (#280)", () => {
      renderTree();
      dragTo(/^Login flow/, 70, rowTop(/^Archive/) + 13);
      // the row is as wide as the widest row: paint on it would end square at the list's edge
      expect(row(/^Archive/)).not.toHaveClass("bg-selected");
      expect(row(/^Archive/).className).not.toMatch(/shadow-/);
      const rings = row(/^Archive/).querySelector("[data-ring]");
      expect(fill(/^Archive/)).toHaveClass(
        "bg-selected",
        "sticky",
        "left-0",
        "w-(--list-w)",
        "rounded-[inherit]",
      );
      expect(rings).toHaveClass("sticky", "left-0", "w-(--list-w)", "rounded-[inherit]");
      expect(rings).toHaveClass("shadow-[inset_0_0_0_1.5px_var(--ink)]");
      // the count's tail fades into the target's fill, not the sidebar's
      expect(row(/^Archive/)).toHaveClass("[--row-bg:var(--selected)]");
      // while a drag is on, no row takes the hover tint
      expect(fill(/^Personal/)).not.toHaveClass("group-hover/row:bg-hover");
      expect(fill(/^Personal/)).not.toHaveClass("bg-selected", "bg-hover");
      firePointer("pointercancel", 70, 0);
    });

    it("the gap above the first row is the list's padding, inside its scroll box — the 2px a drag works out (#230, #260)", () => {
      renderTree();
      expect(tree()).toHaveClass("pt-0.5");
      expect(tree()).not.toHaveClass("mt-0.5");
    });

    it("the list draws no scrollbar on either axis — the wheel, the trackpad and the keys still scroll it (Sidebar-Deep)", () => {
      renderTree();
      expect(tree()).toHaveClass(
        "overflow-auto",
        "[scrollbar-width:none]",
        "[&::-webkit-scrollbar]:hidden",
      );
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
      // no target: the preview stays in the row's own place
      expect(preview()).toHaveStyle({ top: `${2 + 3 * 31}px` });
      expect(moved()).toEqual({});
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

    it("does not target rows hidden by scrolling when the pointer leaves above the list — the row at the visible edge (#230)", async () => {
      renderTree();
      layout();
      // scrolled by 62: Work (40) and Archive (71) sit above the list's top edge (100), hidden
      tree().scrollTop = 62;
      const start = 195 - 62 + 15;
      fireEvent.pointerDown(row(/^Sequence, diagram/), { button: 0, clientX: 60, clientY: start });
      firePointer("pointermove", 60, start + 6);
      // over the hidden Work row, above the list: Login flow, at the visible edge
      firePointer("pointermove", 70, 60);
      expect(fill(/^Work/)).not.toHaveClass("bg-selected");
      firePointer("pointerup", 70, 60);
      await waitFor(() => expect(calls("reorder_item")).toHaveLength(1));
      expect(calls("reorder_item")[0]![1]).toEqual({
        parent: "work",
        item: "diagram:p2",
        index: 1,
      });
    });

    it("works the slot out from the list's top and the rows' order — not the rows' boxes on screen, which glide in a drag (#260)", async () => {
      renderTree();
      layout();
      // every row drawn somewhere else, as in the middle of a glide
      for (const line of tree().querySelectorAll<HTMLElement>("[data-row]")) {
        line.getBoundingClientRect = () =>
          ({ top: 500, bottom: 530, left: 8, right: 240 }) as DOMRect;
      }
      // worked out: Work 102, Archive 133, Login flow 164, Sequence 195
      fireEvent.pointerDown(row(/^Sequence, diagram/), { button: 0, clientX: 60, clientY: 210 });
      firePointer("pointermove", 60, 216);
      firePointer("pointermove", 70, 167);
      firePointer("pointerup", 70, 167);
      await waitFor(() => expect(calls("reorder_item")).toHaveLength(1));
      expect(calls("reorder_item")[0]![1]).toEqual({
        parent: "work",
        item: "diagram:p2",
        index: 1,
      });
    });

    it("the rows changing under a still pointer (a listing landing) moves the target with them (#260)", () => {
      renderTree();
      // Login flow over the lower half of Sequence: after it
      dragTo(/^Login flow/, 70, rowTop(/^Sequence/) + 20);
      expect(fill(/^Personal/)).not.toHaveClass(...DROP_TARGET.split(" "));
      // Archive is gone: the same y is now over Personal
      act(() =>
        useLibraryStore.setState({
          folders: ordered().map((f) => ({ ...f, folders: [] })),
        }),
      );
      expect(fill(/^Personal/)).toHaveClass(...DROP_TARGET.split(" "));
      firePointer("pointercancel", 70, 215);
    });

    it("the first row is the target when the pointer leaves above a list scrolled to the top — it does not fall into the list's top padding (pt-0.5) (#230)", async () => {
      renderTree();
      const start = rowTop(/^Sequence, diagram/) + 13;
      dragTo(/^Sequence, diagram/, 70, start + 30);
      // above the list (the PROJECTS heading): the first row, Work, at the visible top edge —
      // into it, unfolded: the preview is its first item
      firePointer("pointermove", 70, 80);
      expect(preview()).toHaveStyle({ top: `${2 + 31}px` });
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
        const worked = dropAtCalls.mock.calls.length;
        act(() => {
          vi.advanceTimersToNextFrame();
          vi.advanceTimersToNextFrame();
          vi.advanceTimersToNextFrame();
        });
        expect(tree().scrollTop).toBe(700);
        expect(dropAtCalls.mock.calls.length).toBe(worked);
      } finally {
        firePointer("pointerup", 70, 396);
        vi.useRealTimers();
      }
    });

    describe("resting on a collapsed folder unfolds it (#260 R3)", () => {
      const drafts = (): FolderMeta[] => {
        const [work, personal] = ordered();
        return [
          {
            ...work!,
            folders: [
              {
                id: "arc",
                name: "Archive",
                updatedAt: 1,
                order: ["folder:deep", "diagram:a1"],
                diagrams: [{ id: "a1", title: "Old", updatedAt: 1, readable: true }],
                folders: [
                  {
                    id: "deep",
                    name: "Deep",
                    updatedAt: 1,
                    diagrams: [{ id: "d1", title: "Deeper", updatedAt: 1, readable: true }],
                    folders: [],
                  },
                ],
              },
            ],
          },
          personal!,
        ];
      };
      /** row `n`'s top + `dy`, worked out — Work, Archive, Login flow, Sequence, Personal while Archive is collapsed */
      const at = (n: number, dy: number) => 102 + n * 31 + dy;
      const unfolded = (id: string) => useTreeStore.getState().expanded.has(folderKey(id));
      const wait = (ms: number) =>
        act(() => {
          vi.advanceTimersByTime(ms);
        });
      const pressEscape = () =>
        act(() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
        });

      beforeEach(() => {
        useLibraryStore.setState({ folders: drafts() });
        serve(drafts);
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it("600ms on its middle: it unfolds and the preview stands at its top, a level deeper — dropped there, it stays open", async () => {
        renderTree();
        dragTo(/^Sequence, diagram/, 70, at(1, 15));
        expect(fill(/^Archive/)).toHaveClass(...DROP_TARGET.split(" "));
        wait(599);
        expect(item(/^Archive/)).toHaveAttribute("aria-expanded", "false");
        wait(1);
        expect(item(/^Archive/)).toHaveAttribute("aria-expanded", "true");
        expect(fill(/^Archive/)).not.toHaveClass("bg-selected");
        // Work, Archive, [Sequence], Deep, Old
        expect(preview()).toHaveStyle({ top: `${2 + 2 * 31}px` });
        expect(previewRow()).toHaveClass("pl-9");
        firePointer("pointerup", 70, at(1, 15));
        expect(unfolded("arc")).toBe(true);
        vi.useRealTimers();
        await waitFor(() => expect(calls("move_project")).toHaveLength(1));
        expect(calls("move_project")[0]![1]).toEqual({ id: "p2", folder: "arc", index: 0 });
      });

      it("moving off it before 600ms calls the wait off", () => {
        renderTree();
        dragTo(/^Sequence, diagram/, 70, at(1, 15));
        wait(599);
        firePointer("pointermove", 70, at(2, 3));
        wait(1000);
        expect(unfolded("arc")).toBe(false);
        firePointer("pointercancel", 0, 0);
      });

      it("a folder inside one it unfolded unfolds the same way — called off, both fold back; one the user unfolded stays", () => {
        renderTree();
        dragTo(/^Sequence, diagram/, 70, at(1, 15));
        wait(600);
        // Work, Archive, Deep, Old, Login flow, Sequence, Personal
        firePointer("pointermove", 70, at(2, 15));
        expect(fill(/^Deep,/)).toHaveClass(...DROP_TARGET.split(" "));
        wait(600);
        expect(item(/^Deep,/)).toHaveAttribute("aria-expanded", "true");
        expect(preview()).toHaveStyle({ top: `${2 + 3 * 31}px` });
        expect(previewRow()).toHaveClass("pl-13");
        pressEscape();
        expect(unfolded("arc")).toBe(false);
        expect(unfolded("deep")).toBe(false);
        expect(item(/^Archive/)).toHaveAttribute("aria-expanded", "false");
        expect(unfolded("work")).toBe(true);
        expect(calls("move_project")).toHaveLength(0);
      });

      it("dropped somewhere else: what it unfolded folds back", async () => {
        renderTree();
        dragTo(/^Sequence, diagram/, 70, at(1, 15));
        wait(600);
        // Work, Archive, Deep, Old, Login flow (row 4)
        firePointer("pointermove", 70, at(4, 3));
        firePointer("pointerup", 70, at(4, 3));
        expect(unfolded("arc")).toBe(false);
        vi.useRealTimers();
        await waitFor(() => expect(calls("reorder_item")).toHaveLength(1));
        expect(calls("reorder_item")[0]![1]).toEqual({
          parent: "work",
          item: "diagram:p2",
          index: 1,
        });
      });

      it("dropped anywhere under it: it stays open", async () => {
        renderTree();
        dragTo(/^Sequence, diagram/, 70, at(1, 15));
        wait(600);
        // into Deep (collapsed), before it unfolds
        firePointer("pointermove", 70, at(2, 15));
        firePointer("pointerup", 70, at(2, 15));
        expect(unfolded("arc")).toBe(true);
        expect(unfolded("deep")).toBe(false);
        vi.useRealTimers();
        await waitFor(() => expect(calls("move_project")).toHaveLength(1));
        expect(calls("move_project")[0]![1]).toEqual({ id: "p2", folder: "deep", index: 0 });
      });

      it("a folder the user unfolded stays open when the drag is called off", () => {
        act(() => useTreeStore.getState().expand([folderKey("arc")]));
        renderTree();
        dragTo(/^Sequence, diagram/, 70, at(1, 15));
        wait(1000);
        pressEscape();
        expect(unfolded("arc")).toBe(true);
      });

      it("the tree going away mid-drag (the sidebar hidden, the peek closed): what the drag unfolded folds back, the wait is called off", () => {
        const first = renderTree();
        dragTo(/^Sequence, diagram/, 70, at(1, 15));
        wait(600);
        expect(unfolded("arc")).toBe(true);
        first.unmount();
        expect(unfolded("arc")).toBe(false);
        expect(lifted()).toBeNull();

        const second = renderTree();
        dragTo(/^Sequence, diagram/, 70, at(1, 15));
        wait(300);
        second.unmount();
        wait(1000);
        expect(unfolded("arc")).toBe(false);
      });

      it("never the dragged folder itself, nor one with nothing in it", () => {
        renderTree();
        dragTo(/^Archive/, 70, at(1, 15));
        wait(1000);
        expect(unfolded("arc")).toBe(false);
        firePointer("pointercancel", 0, 0);
        // Personal holds nothing
        dragTo(/^Login flow/, 70, at(4, 15));
        expect(fill(/^Personal/)).toHaveClass(...DROP_TARGET.split(" "));
        wait(1000);
        expect(item(/^Personal/)).not.toHaveAttribute("aria-expanded");
        expect(unfolded("home")).toBe(false);
        firePointer("pointercancel", 0, 0);
      });
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

    it("with only one project there is no Move", async () => {
      const user = userEvent.setup();
      useLibraryStore.setState({ folders: [library()[0]!] });
      renderTree();
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
        mockedInvoke.mockImplementation(
          likeRust(async (cmd) => {
            if (cmd === "load_project") throw new Error("gone");
            return undefined;
          }),
        );
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

    it("Move to… — a picker beside the menu, picking another project does move_project, the current project cannot be picked (#229 D13)", async () => {
      const user = userEvent.setup();
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
      expect(fill(/^Work/)).toHaveClass("bg-hover");
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
      expect(fill(/^Work/)).not.toHaveClass("bg-hover");
    });

    it("empty space and the PROJECTS header — New project · Add folder… (#256 R1); New project creates one at the top and renames it", async () => {
      const user = userEvent.setup();
      renderTree();
      expect(rightClick(tree(), 40, 500)).toBe(false);
      expect(menuItemsOf("Projects")).toEqual(["New project", "Add folder…"]);
      expect(screen.getByRole("menu", { name: "Projects" })).toHaveStyle({
        left: "42px",
        top: "502px",
      });
      await user.keyboard("{Escape}");
      expect(rightClick(screen.getByRole("heading", { name: "Projects" }))).toBe(false);
      expect(menuItemsOf("Projects")).toEqual(["New project", "Add folder…"]);
      await user.click(screen.getByRole("menuitem", { name: "New project" }));
      await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
      expect(calls("create_folder")[0]![1]).toMatchObject({ name: "New project" });
      const made = calls("create_folder")[0]![1] as { id: string };
      await waitFor(() => expect(useTreeStore.getState().renaming).toBe(made.id));
    });

    it("empty space Add folder… — Rust's picker; the folder joins on top, picked and scrolled into view (#256 R1)", async () => {
      const user = userEvent.setup();
      const scrolled = vi.fn();
      Element.prototype.scrollIntoView = scrolled;
      let listing = library();
      mockedInvoke.mockImplementation(async (cmd) => {
        if (cmd === "add_library_folder") {
          listing = [
            {
              folders: [],
              id: "client",
              name: "client-diagrams",
              updatedAt: now,
              diagrams: [],
              added: true,
            },
            ...library(),
          ];
          return { kind: "added", id: "client" };
        }
        if (cmd === "list_library") return listing;
        return undefined;
      });
      try {
        renderTree();
        rightClick(tree(), 40, 500);
        await user.click(screen.getByRole("menuitem", { name: "Add folder…" }));
        await waitFor(() =>
          expect(item(/^client-diagrams/)).toHaveAttribute("aria-selected", "true"),
        );
        expect(calls("add_library_folder")[0]).toEqual(["add_library_folder"]);
        expect(within(tree()).getAllByRole("treeitem")[0]).toBe(item(/^client-diagrams/));
        expect(scrolled).toHaveBeenCalled();
        expect(scrolled.mock.contexts.at(-1)).toBe(item(/^client-diagrams/));
        expect(toasts()).toEqual([]);
      } finally {
        Reflect.deleteProperty(Element.prototype, "scrollIntoView");
      }
    });

    it("Add folder… on a folder already in the library — the toast says so and the list stays", async () => {
      const user = userEvent.setup();
      serve(library, undefined, { add_library_folder: { kind: "already" } });
      renderTree();
      rightClick(screen.getByRole("heading", { name: "Projects" }));
      await user.click(screen.getByRole("menuitem", { name: "Add folder…" }));
      await waitFor(() => expect(toasts()).toEqual(["Already in the library"]));
      expect(within(tree()).getAllByRole("treeitem")).toHaveLength(2);
      expect(calls("list_library")).toHaveLength(0);
    });

    it("moving to another field while a context-menu New project is being created — the name field does not steal focus (#230 D15 rule, #218 D15)", async () => {
      const user = userEvent.setup();
      // the write waits for the test: the field is focused before it lands
      let land: () => void = () => undefined;
      mockedInvoke.mockImplementation(
        likeRust(async (cmd) => {
          if (cmd === "create_folder") await new Promise<void>((r) => (land = r));
          if (cmd === "list_library") return library();
          return undefined;
        }),
      );
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

    it("the name field is not intercepted", async () => {
      useLibraryStore.setState({ folders: [library()[0]!] });
      renderTree();
      act(() => useTreeStore.getState().setRenaming("work"));
      const input = await screen.findByRole("textbox", { name: "Project name" });
      expect(rightClick(input)).toBe(true);
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  describe("+ menu (D12, T27, #256 R1)", () => {
    const plus = () => screen.getByRole("button", { name: "Add a project" });

    it("the + opens New project · Add folder… 2 below it, its right end on the +'s — the + shows selected while it is open", async () => {
      const user = userEvent.setup();
      renderTree();
      expect(plus()).toHaveAttribute("aria-haspopup", "menu");
      expect(plus()).toHaveAttribute("aria-expanded", "false");
      plus().getBoundingClientRect = () => ({ right: 236, bottom: 143 }) as DOMRect;
      await user.click(plus());
      const menu = screen.getByRole("menu", { name: "Add a project" });
      expect(menu).toHaveStyle({ left: "52px", top: "145px" });
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((i) => i.textContent),
      ).toEqual(["New project", "Add folder…"]);
      expect(plus()).toHaveAttribute("aria-expanded", "true");
      expect(plus()).toHaveClass("bg-selected");
      // pressed again, it closes
      await user.click(plus());
      expect(screen.queryByRole("menu")).toBeNull();
      expect(plus()).toHaveAttribute("aria-expanded", "false");
      expect(plus()).not.toHaveClass("bg-selected");
    });

    it("opens and picks from the keyboard; Escape gives the focus back to the +", async () => {
      const user = userEvent.setup();
      serve(library, undefined, { add_library_folder: { kind: "cancelled" } });
      renderTree();
      act(() => plus().focus());
      await user.keyboard("{Enter}");
      expect(screen.getByRole("menuitem", { name: "New project" })).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("menuitem", { name: "Add folder…" })).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).toBeNull();
      expect(plus()).toHaveFocus();
      // Add folder… from the keyboard: the picker, and the focus back on the +
      await user.keyboard("{Enter}{ArrowDown}{Enter}");
      await waitFor(() => expect(calls("add_library_folder")).toHaveLength(1));
      expect(plus()).toHaveFocus();
      expect(toasts()).toEqual([]);
    });

    it("Add folder… from the + — the new project on top, picked; while the user went to another tab nothing is picked (#218 D15)", async () => {
      const user = userEvent.setup();
      let listing = library();
      let meanwhile: () => void = () => undefined;
      mockedInvoke.mockImplementation(async (cmd) => {
        if (cmd === "add_library_folder") {
          meanwhile();
          listing = [
            {
              folders: [],
              id: "client",
              name: "client-diagrams",
              updatedAt: now,
              diagrams: [],
              added: true,
            },
            ...library(),
          ];
          return { kind: "added", id: "client" };
        }
        if (cmd === "list_library") return listing;
        return undefined;
      });
      renderTree();
      await user.click(plus());
      await user.click(screen.getByRole("menuitem", { name: "Add folder…" }));
      await waitFor(() =>
        expect(item(/^client-diagrams/)).toHaveAttribute("aria-selected", "true"),
      );
      act(() => resetTreeForTests());
      listing = library();
      meanwhile = () => openDocument({ ...blankDoc(), title: "Other" }, { projectId: "other" });
      await user.click(plus());
      await user.click(screen.getByRole("menuitem", { name: "Add folder…" }));
      await waitFor(() => expect(calls("add_library_folder")).toHaveLength(2));
      await waitFor(() => expect(item(/^client-diagrams/)).toBeInTheDocument());
      expect(useTreeStore.getState().picked).toBeNull();
    });

    it("creates and renames right in the tree — the screen stays", async () => {
      const user = userEvent.setup();
      let listing = library();
      mockedInvoke.mockImplementation(
        likeRust(async (cmd, args) => {
          if (cmd === "create_folder") {
            const { id } = args as { id: string };
            listing = [
              { folders: [], id, name: "New project", updatedAt: now, diagrams: [] },
              ...library(),
            ];
          }
          if (cmd === "list_library") return listing;
          return undefined;
        }),
      );
      openDocument(loginBook(), { projectId: "p1" });
      renderTree();
      await user.click(plus());
      await user.click(screen.getByRole("menuitem", { name: "New project" }));
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
      mockedInvoke.mockImplementation(
        likeRust(async (cmd, args) => {
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
        }),
      );
      renderTree();
      await user.click(plus());
      await user.click(screen.getByRole("menuitem", { name: "New project" }));
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
      mockedInvoke.mockImplementation(
        likeRust(async (cmd, args) => {
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
        }),
      );
      renderTree();
      await user.click(plus());
      await user.click(screen.getByRole("menuitem", { name: "New project" }));
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
      mockedInvoke.mockImplementation(
        likeRust(async (cmd, args) => {
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
        }),
      );
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
      mockedInvoke.mockImplementation(
        likeRust(async (cmd, args) => {
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
        }),
      );
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
      mockedInvoke.mockImplementation(
        likeRust(async (cmd) => {
          if (cmd === "load_project") {
            await failed;
            throw new Error("gone");
          }
          if (cmd === "list_library") return structuredClone(listing);
          return undefined;
        }),
      );
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
      mockedInvoke.mockImplementation(
        likeRust(async (cmd, args) => {
          if (cmd === "create_folder") await new Promise((r) => setTimeout(r, 20));
          return make(cmd, args);
        }),
      );
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
      mockedInvoke.mockImplementation(
        likeRust(async (cmd, args) => {
          if (cmd === "create_folder") await new Promise((r) => setTimeout(r, 20));
          return make(cmd, args);
        }),
      );
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
      mockedInvoke.mockImplementation(
        likeRust(async (cmd, args) => {
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
        }),
      );
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

  /**
   * Rows are as wide as the widest row and the list scrolls sideways
   * (Sidebar-Deep): a row's fill and rings sit on boxes as wide as the list's
   * visible part, stuck to its left edge, so they never end square at the
   * list's edge (#280)
   */
  describe("a row's paint stays inside the list's visible width (#280, Sidebar-Deep)", () => {
    /** the box over a row's content that carries its rings */
    const rings = (name: string | RegExp) =>
      row(name).querySelector("[data-ring]") as HTMLElement | null;
    /** what each box shares: the list's visible width, at its left edge, the row's corners */
    const VISIBLE_BOX = [
      "sticky",
      "left-0",
      "block",
      "h-full",
      "w-(--list-w)",
      "rounded-[inherit]",
    ];

    it("the list keeps --list-w at its visible width — its client width, read again as it changes (a classic scroll bar coming)", () => {
      const watched = new Map<Element, ResizeObserverCallback>();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          callback: ResizeObserverCallback;
          constructor(callback: ResizeObserverCallback) {
            this.callback = callback;
          }
          observe(el: Element) {
            watched.set(el, this.callback);
          }
          unobserve() {}
          disconnect() {}
        },
      );
      let width = 232;
      const client = vi
        .spyOn(HTMLElement.prototype, "clientWidth", "get")
        .mockImplementation(() => width);
      try {
        renderTree();
        expect(tree().style.getPropertyValue("--list-w")).toBe("232px");
        width = 215;
        act(() => watched.get(tree())!([], {} as ResizeObserver));
        expect(tree().style.getPropertyValue("--list-w")).toBe("215px");
      } finally {
        client.mockRestore();
        vi.unstubAllGlobals();
      }
    });

    it("a selected row's fill is not the row's own — a box the list's visible width, stuck to its left edge, all four corners rounded", () => {
      renderTree();
      fireEvent.click(row(/^Work/));
      expect(item(/^Work/)).toHaveAttribute("aria-selected", "true");
      expect(row(/^Work/)).not.toHaveClass("bg-selected");
      expect(fill(/^Work/)).toHaveClass("bg-selected", ...VISIBLE_BOX);
      // it sticks inside a layer over the whole row, under the row's content
      const layer = fill(/^Work/)!.parentElement!;
      expect(layer).toHaveClass(
        "pointer-events-none",
        "absolute",
        "inset-0",
        "-z-10",
        "rounded-[inherit]",
      );
      expect(layer).toHaveAttribute("aria-hidden", "true");
      expect(row(/^Work/)).toHaveClass("relative", "isolate", "rounded-[5px]");
      // the tail still fades into the selected fill
      expect(row(/^Work/)).toHaveClass("[--row-bg:var(--selected)]");
    });

    it("hover tints the same box, not the row", () => {
      renderTree();
      expect(row(/^Personal/)).not.toHaveClass("hover:bg-hover");
      expect(fill(/^Personal/)).toHaveClass("group-hover/row:bg-hover", ...VISIBLE_BOX);
      expect(fill(/^Personal/)).not.toHaveClass("bg-selected");
      expect(row(/^Personal/)).toHaveClass("group/row", "hover:[--row-bg:var(--hover)]");
    });

    it("the keyboard focus ring is drawn on a box the same width, over the row's content and its tail", () => {
      renderTree();
      expect(rings(/^Work/)).toHaveClass(...VISIBLE_BOX);
      const layer = rings(/^Work/)!.parentElement!;
      expect(layer).toHaveClass("pointer-events-none", "absolute", "inset-0", "z-10");
      expect(layer).toHaveAttribute("aria-hidden", "true");
      expect(row(/^Work/).lastElementChild).toBe(layer);
      expect(item(/^Work/)).toHaveClass(
        "focus-visible:[&>[data-row]_[data-ring]]:outline-2",
        "focus-visible:[&>[data-row]_[data-ring]]:-outline-offset-2",
        "focus-visible:[&>[data-row]_[data-ring]]:outline-focus",
      );
      expect(item(/^Work/).className).not.toContain("[&>[data-row]]:outline");
    });

    it("only the tab stop carries a ring box — the one row the focus can be on (roving tabindex)", () => {
      renderTree();
      expect(item(/^Work/)).toHaveAttribute("tabindex", "0");
      expect(rings(/^Work/)).not.toBeNull();
      expect(rings(/^Personal/)).toBeNull();
      act(() => item(/^Personal/).focus());
      expect(rings(/^Personal/)).not.toBeNull();
      expect(rings(/^Work/)).toBeNull();
    });

    describe("the rename field ends 8px in from the list's visible right edge, never past it", () => {
      /** a field `at` px into its row, in a list `width` wide scrolled `scrolled` to the right */
      const renameIn = (at: number, width: number, scrolled: number) => {
        const scrolledTo = vi.fn();
        const spies = [
          vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (
            this: HTMLElement,
          ) {
            return this.tagName === "INPUT" ? at : 0;
          }),
          vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width),
          vi.spyOn(Element.prototype, "scrollLeft", "get").mockReturnValue(scrolled),
          vi.spyOn(Element.prototype, "scrollLeft", "set").mockImplementation(scrolledTo),
        ];
        try {
          renderTree();
          scrolledTo.mockClear();
          act(() => useTreeStore.getState().setRenaming("work"));
          const field = within(row(/^Work/)).getByRole("textbox", { name: "Project name" });
          return { maxWidth: field.style.maxWidth, scrolledTo };
        } finally {
          for (const spy of spies) spy.mockRestore();
        }
      };

      it("from where it starts to 8px short of the edge, as the list is scrolled when it opens", () => {
        // a deep row (187 in), the list 232 wide scrolled 80: 117 of room
        const { maxWidth, scrolledTo } = renameIn(187, 232, 80);
        expect(maxWidth).toBe("max(96px, calc(var(--list-w) - 115px))");
        expect(scrolledTo).not.toHaveBeenCalled();
      });

      it("never narrower than 96px — with less room (a deep row, the narrowest sidebar) the list scrolls to give it the 8px inset", () => {
        // 184 wide, the field from 187: 11px short of the edge — 107 short of 96
        const { maxWidth, scrolledTo } = renameIn(187, 184, 0);
        expect(maxWidth).toBe("max(96px, calc(var(--list-w) - 195px))");
        expect(scrolledTo).toHaveBeenCalledWith(107);
      });

      it("while a row is renamed its count / … tail is hidden — the field takes its place", () => {
        renderTree();
        expect(row(/^Work/).querySelector("[data-tail]")).not.toBeNull();
        expect(row(/^Work/)).toHaveClass("pr-0");
        act(() => useTreeStore.getState().setRenaming("work"));
        expect(row(/^Work/).querySelector("[data-tail]")).toBeNull();
        expect(within(row(/^Work/)).getByRole("textbox", { name: "Project name" })).toBeVisible();
        // the 8px the tail carried comes back to the row
        expect(row(/^Work/)).toHaveClass("pr-2");
      });
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
      mine(),
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

    it("every top-level row gets a badge in its id's colour", () => {
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
      expect(fill(/^Checkout/)).toHaveClass("bg-selected");
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

  describe("a project not found, a folder added from elsewhere (#253 R7·R8, Sidebar-Library ②③)", () => {
    /** Work · architecture (not found) · client-diagrams (added from ~/Work) */
    const places = (): FolderMeta[] => [
      library()[0]!,
      {
        id: "arc",
        name: "architecture",
        updatedAt: 0,
        diagrams: [],
        folders: [],
        missing: true,
        path: "/Users/someone/Projects/architecture",
        shown: "~/Projects/architecture",
      },
      {
        id: "cli",
        name: "client-diagrams",
        updatedAt: now - 60_000,
        diagrams: [{ id: "c1", title: "Overview", updatedAt: now - 60_000, readable: true }],
        folders: [],
        added: true,
        path: "/Users/someone/Work/client-diagrams",
        shown: "~/Work/client-diagrams",
      },
    ];
    const menuItems = (name: string) =>
      within(screen.getByRole("menu", { name }))
        .getAllByRole("menuitem")
        .map((i) => i.textContent);

    beforeEach(() => {
      useLibraryStore.setState({ folders: places(), readFailed: false });
      serve(places);
    });

    it("keeps its place, no chevron — a grey badge, its name muted, “Not found” where the count goes", () => {
      renderTree();
      const items = within(tree()).getAllByRole("treeitem");
      expect(items.map((i) => i.getAttribute("aria-label"))).toEqual([
        "Work, project, 2 items",
        "architecture, project, not found",
        "client-diagrams, project, 1 item",
      ]);
      expect(item(/^architecture/)).not.toHaveAttribute("aria-expanded");
      expect(chevron(/^architecture/)).toBeNull();
      const badge = row(/^architecture/).querySelector("[aria-hidden='true'].bg-fill-subtle");
      expect(badge).toHaveClass("text-muted", "h-4", "w-4");
      expect(badge).toHaveTextContent("A");
      expect(badge?.previousElementSibling).toHaveClass("w-3.5");
      expect(within(row(/^architecture/)).getByText("architecture")).toHaveClass(
        "text-muted-strong",
      );
      const status = row(/^architecture/).querySelector("[data-count]");
      expect(status).toHaveTextContent("Not found");
      expect(status).toHaveClass("text-[11px]", "font-medium", "text-muted");
      expect(status).toHaveAttribute("aria-hidden", "true");
      // a project that is there looks like any other — added from elsewhere or not
      expect(badgeIn(row(/^client-diagrams/))).toHaveClass(`bg-badge-${badgeColour("cli")}-soft`);
      expect(within(row(/^client-diagrams/)).getByText("client-diagrams")).not.toHaveClass(
        "text-muted-strong",
      );
    });

    it("its menu is Locate… · Remove from Library — from the … and from a right-click", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(moreButton(/^architecture/)!);
      expect(menuItems("architecture")).toEqual(["Locate…", "Remove from Library"]);
      await user.keyboard("{Escape}");
      fireEvent.contextMenu(row(/^architecture/), { clientX: 120, clientY: 160 });
      expect(menuItems("architecture")).toEqual(["Locate…", "Remove from Library"]);
    });

    it("a folder added from elsewhere ends its menu with Remove from Library; one in the default location keeps Delete", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(moreButton(/^client-diagrams/)!);
      expect(menuItems("client-diagrams")).toEqual([
        "New diagram",
        "New folder",
        SHOW_IN,
        "Copy Path",
        "Rename",
        "Remove from Library",
      ]);
      await user.keyboard("{Escape}");
      await user.click(moreButton(/^Work/)!);
      expect(menuItems("Work").at(-1)).toBe("Delete");
    });

    it("Locate… asks Rust, which shows the folder picker — located lists again; already says so", async () => {
      const user = userEvent.setup();
      serve(places, {}, { locate_project: "located" });
      renderTree();
      await user.click(moreButton(/^architecture/)!);
      const before = calls("list_library").length;
      await user.click(screen.getByRole("menuitem", { name: "Locate…" }));
      await waitFor(() => expect(calls("list_library").length).toBe(before + 1));
      expect(calls("locate_project")[0]![1]).toEqual({ id: "arc" });
      serve(places, {}, { locate_project: "already" });
      await user.click(moreButton(/^architecture/)!);
      await user.click(screen.getByRole("menuitem", { name: "Locate…" }));
      await waitFor(() => expect(toasts()).toEqual(["Already in the library"]));
    });

    it("Remove from Library goes at once — no question — and lists again", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.click(moreButton(/^client-diagrams/)!);
      await user.click(screen.getByRole("menuitem", { name: "Remove from Library" }));
      await waitFor(() => expect(calls("remove_project")[0]![1]).toEqual({ id: "cli" }));
      expect(mockedAsk).not.toHaveBeenCalled();
      expect(calls("delete_folder")).toHaveLength(0);
    });

    it("does not drag, rename or step — no ⌥↑/⌥↓ announced", async () => {
      const user = userEvent.setup();
      renderTree();
      const line = row(/^architecture/);
      line.getBoundingClientRect = () =>
        ({ top: 133, bottom: 163, left: 8, right: 240 }) as DOMRect;
      fireEvent.pointerDown(line, { button: 0, clientX: 60, clientY: 140 });
      const move = new Event("pointermove") as PointerEvent;
      Object.assign(move, { clientX: 60, clientY: 190 });
      act(() => {
        window.dispatchEvent(move);
      });
      expect(document.body.querySelector("[data-drag-row]")).toBeNull();
      expect(item(/^architecture/)).not.toHaveClass("opacity-40");
      act(() => item(/^architecture/).focus());
      await user.keyboard("{F2}");
      expect(within(tree()).queryByRole("textbox")).toBeNull();
      await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
      expect(calls("reorder_item")).toHaveLength(0);
      expect(screen.getByRole("status").textContent).toBe("");
      expect(item(/^architecture/)).not.toHaveAttribute("aria-keyshortcuts");
    });

    it("a double click opens it in Home, which says it cannot be found", async () => {
      const user = userEvent.setup();
      renderTree();
      await user.dblClick(row(/^architecture/));
      expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "arc" });
    });
  });
});
