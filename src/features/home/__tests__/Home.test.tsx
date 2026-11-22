import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSidebarStore } from "../../../shared/lib/sidebarLayout";
import { useDiagramStore } from "../../../shared/lib/store";
import { useThemeStore } from "../../../shared/lib/theme";
import { useToastStore } from "../../../shared/lib/toastStore";
import { spoken } from "../../../test/badges";
import { useAppStore } from "../../library/appStore";
import { DASHBOARD, type HomeView } from "../../library/homeView";
import { blankDoc, type FolderMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { viewInHome } from "../../library/navigation";
import { openDocument, resetTabsForTests, showHomeTab } from "../../library/tabActions";
import { resetAutosaveForTests, useAutosave } from "../../library/useAutosave";
import { resetBoardForTests } from "../board/boardStore";
import { resetPreviewCacheForTests } from "../diagramPreview";
import { Home } from "../Home";
import { cardGrid } from "../homeGrid";
import { useHomeMode } from "../homeMode";
import { useHomeSelection } from "../homeSelection";
import { likeRust } from "../../../test/rustAnswers";

vi.mock("../../../shared/lib/systemClipboard", () => ({
  readClipboardText: vi.fn(async () => null),
}));

const mockedInvoke = vi.mocked(invoke);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const now = Date.now();
const library = (): FolderMeta[] => [
  {
    folders: [],
    id: "work",
    name: "Work",
    updatedAt: now - 3 * 60_000,
    diagrams: [
      { id: "p1", title: "Login flow", updatedAt: now - 3 * 60_000, readable: true },
      { id: "p2", title: "Sequence", updatedAt: now - 2 * 86_400_000, readable: true },
    ],
  },
  { folders: [], id: "home", name: "Personal", updatedAt: now - 5 * 86_400_000, diagrams: [] },
];

/** list_library answers from `listing`; load_project a blank of that id */
const serve = (listing: () => unknown = library) =>
  mockedInvoke.mockImplementation(
    likeRust(async (cmd, args) => {
      if (cmd === "list_library") return listing();
      if (cmd === "load_project") {
        return JSON.stringify({ ...blankDoc(), title: (args as { id: string }).id });
      }
      return undefined;
    }),
  );

const show = (view: HomeView) => {
  showHomeTab(view);
  return render(<Home />);
};
const sheet = () => screen.getByRole("main", { name: "Home" });
/** what is under the header row: the cards' scroll box or the board's */
const body = () => sheet().lastElementChild as HTMLElement;
const column = () => body().firstElementChild as HTMLElement;
const h1 = () => screen.getByRole("heading", { level: 1 });

describe("Home assembly (#220 D1·D4·D12·D16, T29)", () => {
  beforeEach(() => {
    useHomeSelection.getState().clear();
    useAppStore.setState({ folderRenameRequest: null });
    resetAutosaveForTests();
    resetPreviewCacheForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    useSidebarStore.setState({ hidden: false, peek: false });
    useLibraryStore.setState({ folders: library(), readFailed: false });
    useThemeStore.getState().setTheme("light");
    serve();
  });

  it.each<[HomeView, string]>([
    [DASHBOARD, "Home"],
    [{ kind: "recent" }, "Recent"],
    [{ kind: "folder", folder: "work" }, "Work"],
  ])("homeView %o → view titled '%s'", async (view, title) => {
    show(view);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
  });

  it("nested folder view → that folder's header, ⋯ New folder → view unchanged, name field on the new first card (#229 D5, #231 D8, T39)", async () => {
    const user = userEvent.setup();
    let listing = library();
    listing[0]!.folders = [
      { id: "chk", name: "Checkout", updatedAt: now, diagrams: [], folders: [] },
    ];
    mockedInvoke.mockImplementation(
      likeRust(async (cmd, args) => {
        if (cmd === "create_folder") {
          const { id } = args as { id: string };
          listing = structuredClone(listing);
          listing[0]!.folders[0]!.folders = [
            { id, name: "New folder", updatedAt: now, diagrams: [], folders: [] },
          ];
        }
        if (cmd === "list_library") return structuredClone(listing);
        return undefined;
      }),
    );
    useLibraryStore.setState({ folders: structuredClone(listing) });
    show({ kind: "folder", folder: "chk" });
    expect(h1()).toHaveTextContent("Checkout");
    await user.click(screen.getByRole("button", { name: "More for Checkout" }));
    await user.click(screen.getByRole("menuitem", { name: "New folder" }));
    const input = await screen.findByRole("textbox", { name: "Folder name" });
    // the new card, first and selected, names it — not the header's path (#231 D8)
    const list = screen.getByRole("list", { name: "Items in Checkout" });
    const first = within(list).getAllByRole("article")[0]!;
    expect(first).toContainElement(input);
    expect(first).toHaveClass("ring-[1.5px]", "ring-ink");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).not.toContainElement(input);
    expect(h1()).toHaveTextContent("Checkout");
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
    expect(input).toHaveFocus();
    expect(input).toHaveValue("New folder");
    // the name is selected as the field takes focus: typing replaces it
    await user.keyboard("Flows{Enter}");
    await waitFor(() => expect(calls("rename_folder").at(-1)![1]).toMatchObject({ name: "Flows" }));
  });

  describe("a late move·delete·create does not steal the place the user went to meanwhile (#229, #218 D15)", () => {
    /** Work › Checkout (Order flow) › Flows; the disk answers a little late */
    let where: "chk" | "work" | "gone" = "chk";
    const lib = (): FolderMeta[] => {
      const order = {
        id: "ord",
        title: "Order flow",
        updatedAt: now - 10 * 60_000,
        readable: true,
      };
      const base = library();
      base[0]!.folders = [
        {
          id: "chk",
          name: "Checkout",
          updatedAt: now - 5 * 60_000,
          diagrams: where === "chk" ? [order] : [],
          folders: [
            { id: "flw", name: "Flows", updatedAt: now - 60_000, diagrams: [], folders: [] },
          ],
        },
      ];
      if (where === "work") base[0]!.diagrams.push(order);
      return base;
    };
    const Shell = () => (useAppStore((s) => s.view) === "home" ? <Home /> : null);
    const slow = () => new Promise((r) => setTimeout(r, 40));
    beforeEach(() => {
      where = "chk";
      useLibraryStore.setState({ folders: lib() });
      mockedInvoke.mockImplementation(
        likeRust(async (cmd, args) => {
          if (cmd === "move_project") {
            await slow();
            where = "work";
          }
          if (cmd === "delete_project") {
            await slow();
            where = "gone";
          }
          if (cmd === "create_folder") await slow();
          if (cmd === "list_library") return lib();
          if (cmd === "load_project") {
            return JSON.stringify({ ...blankDoc(), title: (args as { id: string }).id });
          }
          return undefined;
        }),
      );
    });
    const moveOrderToWork = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByRole("button", { name: "More for Order flow" }));
      await user.click(screen.getByRole("menuitem", { name: "Move to…" }));
      const picker = screen.getByRole("tree", { name: "Move to" });
      await user.click(
        within(picker)
          .getByRole("treeitem", { name: "Work, project" })
          .querySelector("[data-row]")!,
      );
    };
    const landed = async (cmd: string) => {
      await waitFor(() => expect(calls(cmd)).toHaveLength(1));
      await waitFor(() => expect(calls("list_library").length).toBeGreaterThan(1));
      await act(() => new Promise((r) => setTimeout(r, 60)));
    };

    it("going to another folder right after card Move to… — stays there", async () => {
      const user = userEvent.setup();
      show({ kind: "folder", folder: "chk" });
      await moveOrderToWork(user);
      act(() => showHomeTab({ kind: "folder", folder: "flw" }));
      await landed("move_project");
      expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "flw" });
      expect(h1()).toHaveTextContent("Flows");
    });

    it("opening a document tab right after card Move to… — stays on that tab", async () => {
      const user = userEvent.setup();
      showHomeTab({ kind: "folder", folder: "chk" });
      render(<Shell />);
      await moveOrderToWork(user);
      act(() => {
        openDocument({ ...blankDoc(), title: "X" }, { projectId: "x" });
      });
      const tab = useAppStore.getState().activeTab;
      await landed("move_project");
      expect(useAppStore.getState()).toMatchObject({ view: "editor", activeTab: tab });
    });

    it("opening a document tab right after card Delete — stays on that tab", async () => {
      const user = userEvent.setup();
      vi.mocked(ask).mockResolvedValue(true);
      showHomeTab({ kind: "folder", folder: "chk" });
      render(<Shell />);
      await user.click(await screen.findByRole("button", { name: "More for Order flow" }));
      await user.click(screen.getByRole("menuitem", { name: "Delete" }));
      await waitFor(() => expect(calls("delete_project")).toHaveLength(1));
      act(() => {
        openDocument({ ...blankDoc(), title: "X" }, { projectId: "x" });
      });
      const tab = useAppStore.getState().activeTab;
      await landed("delete_project");
      expect(useAppStore.getState()).toMatchObject({ view: "editor", activeTab: tab });
    });

    it("going to another folder right after header ⋯ New folder — stays there, neither selects the new card nor requests the name field", async () => {
      const user = userEvent.setup();
      show({ kind: "folder", folder: "chk" });
      await user.click(await screen.findByRole("button", { name: "More for Checkout" }));
      await user.click(screen.getByRole("menuitem", { name: "New folder" }));
      act(() => showHomeTab({ kind: "folder", folder: "flw" }));
      await landed("create_folder");
      expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "flw" });
      expect(useAppStore.getState().folderRenameRequest).toBeNull();
      expect(useHomeSelection.getState().key).toBeNull();
    });
  });

  it("Cards, a project not found — the board's box centred under the header, no cards (#253 R7, Library-Missing)", async () => {
    const lost: FolderMeta = {
      folders: [],
      id: "arc",
      name: "architecture",
      updatedAt: 0,
      diagrams: [],
      missing: true,
      shown: "~/Projects/architecture",
    };
    useLibraryStore.setState({ folders: [...library(), lost] });
    serve(() => [...library(), lost]);
    show({ kind: "folder", folder: "arc" });
    // Home lists the library as it comes on show
    await waitFor(() => expect(calls("list_library")).toHaveLength(1));
    expect(h1()).toHaveTextContent("architecture");
    const title = screen.getByText("Can't find this folder");
    expect(title.parentElement).toHaveClass("w-[212px]", "h-[92px]");
    expect(title.parentElement!.parentElement).toHaveClass(
      "flex",
      "h-full",
      "items-center",
      "justify-center",
    );
    expect(screen.queryByRole("list", { name: /^Items in/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^New in / })).toBeNull();
    expect(screen.queryByRole("button", { name: "More for architecture" })).toBeNull();
    // located: the heading takes the focus, while Home still shows it
    mockedInvoke.mockImplementation(
      likeRust(async (cmd) => {
        if (cmd === "locate_project") return "located";
        if (cmd === "list_library") return [...library(), { ...lost, missing: undefined }];
        return undefined;
      }),
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Locate…" }));
    await waitFor(() => expect(h1()).toHaveFocus());
    expect(screen.queryByText("Can't find this folder")).toBeNull();
  });

  it("Home showing a vanished project draws the dashboard (D1)", () => {
    show({ kind: "folder", folder: "gone" });
    expect(h1()).toHaveTextContent("Home");
  });

  it("grid max width — docked 1040, hidden 1232, peek also 1232, from the left (#231 D21)", () => {
    const { rerender } = show(DASHBOARD);
    expect(column()).toHaveClass("max-w-[1040px]", "@container");
    expect(column()).not.toHaveClass("mx-auto");
    act(() => useSidebarStore.setState({ hidden: true }));
    rerender(<Home />);
    expect(column()).toHaveClass("max-w-[1232px]");
    act(() => useSidebarStore.setState({ hidden: true, peek: true }));
    rerender(<Home />);
    expect(column()).toHaveClass("max-w-[1232px]");
  });

  it("no Open…·New project in the header — the right end is the Cards/Canvas switch (#221) (D4)", () => {
    show(DASHBOARD);
    expect(screen.getAllByRole("radiogroup")).toEqual([
      screen.getByRole("radiogroup", { name: "View" }),
    ]);
    expect(screen.queryByRole("button", { name: /Canvas/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Open…/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.queryByRole("button", { name: /theme/ })).toBeNull();
  });

  it("navigation inside the sheet focuses the new view's h1 — See all, card, path", async () => {
    const user = userEvent.setup();
    show(DASHBOARD);
    await user.click(screen.getByRole("button", { name: "See all recent diagrams" }));
    await waitFor(() => expect(h1()).toHaveFocus());
    expect(h1()).toHaveTextContent("Recent");
    act(() => viewInHome({ kind: "folder", folder: "work" }, true));
    await waitFor(() => expect(h1()).toHaveFocus());
    expect(h1()).toHaveTextContent("Work");
  });

  it("navigation from the sidebar does not move focus", () => {
    show(DASHBOARD);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    act(() => viewInHome({ kind: "recent" }));
    expect(h1()).toHaveTextContent("Recent");
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("when shown, waits for pending writes before reading the list (D14 ⑨)", async () => {
    let landWrite: () => void = () => {};
    mockedInvoke.mockImplementation(
      likeRust((cmd) => {
        if (cmd === "save_project")
          return new Promise((resolve) => (landWrite = () => resolve(undefined)));
        if (cmd === "list_library") return Promise.resolve(library());
        return Promise.resolve(undefined);
      }),
    );
    // an edit pending in an open diagram, then Home
    const { unmount } = render(<AutosaveHost />);
    act(() => {
      openDocument(blankDoc(), { projectId: "p1" });
      useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
    });
    act(() => showHomeTab());
    render(<Home />);
    await act(async () => {});
    expect(calls("list_library")).toHaveLength(0);
    await act(async () => landWrite());
    // Home's own listing — and the one leaving the diagram asks for — both after the write
    await waitFor(() => expect(calls("list_library").length).toBeGreaterThan(0));
    const order = mockedInvoke.mock.calls.map(([c]) => c);
    expect(order.indexOf("save_project")).toBeLessThan(order.indexOf("list_library"));
    unmount();
  });

  it("placeholders in a folder view waiting for the list are a grid at the chosen size (#236 R5)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      useLibraryStore.setState({ folders: null });
      useHomeMode.setState({ mode: "cards", size: "small" });
      mockedInvoke.mockImplementation(likeRust(() => new Promise(() => {})));
      show({ kind: "folder", folder: "work" });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      const skeleton = screen.getByRole("status", { name: "Loading projects" });
      expect(skeleton).toHaveClass(...cardGrid("small").split(" "));
      // a card's shape, not a fixed height: the size picked sets it
      for (const cell of skeleton.children) {
        expect(cell).toHaveClass("p-2.5", "pb-[52px]");
        expect(cell.className).not.toMatch(/\bh-\[\d+px\]/);
        expect(cell.firstElementChild).toHaveClass("aspect-[15/8]");
      }
    } finally {
      useHomeMode.setState({ size: null });
      vi.useRealTimers();
    }
  });

  it("failing to read the list shows an error toast and a 'couldn't load' box — not an empty library (#178)", async () => {
    const user = userEvent.setup();
    useLibraryStore.setState({ folders: null });
    let fail = true;
    mockedInvoke.mockImplementation(
      likeRust(async (cmd) => {
        if (cmd === "list_library") {
          if (fail) throw new Error("no folder");
          return library();
        }
        return undefined;
      }),
    );
    show(DASHBOARD);
    expect(await screen.findByText("Couldn't load your projects")).toBeInTheDocument();
    expect(screen.queryByText("No diagrams yet")).toBeNull();
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(["Error: no folder"]);
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Recent diagrams" })).toBeInTheDocument();
  });

  it("opening from a card makes a new tab — tabs open before coming to Home stay (#218 D18)", async () => {
    const user = userEvent.setup();
    openDocument({ ...blankDoc(), title: "Login flow" }, { projectId: "p1" });
    showHomeTab();
    render(<Home />);
    const recent = within(await screen.findByRole("list", { name: "Recent diagrams" }));
    await user.click(recent.getByRole("button", { name: "Open Sequence in Work" }));
    await waitFor(() => expect(useAppStore.getState().view).toBe("editor"));
    expect(useAppStore.getState().tabs.map((t) => t.projectId)).toEqual(["p1", "p2"]);
  });
});

/**
 * #231 D7, D11: no preview any more — a card's click selects it, a double
 * click opens it, and the selection outlives Home (a document tab and back).
 */
describe("cards — one press = select, two = open, no preview — in the real Home (#231 D7·D11, T14·T17·T23)", () => {
  const card = (title: string) => screen.getByRole("article", { name: title });
  const cardBody = () => screen.getByRole("button", { name: /^Login flow, diagram, edited/ });

  beforeEach(() => {
    resetAutosaveForTests();
    resetPreviewCacheForTests();
    resetTabsForTests();
    useHomeSelection.getState().clear();
    useToastStore.getState().dismissAll();
    useHomeMode.setState({ mode: "cards" });
    useLibraryStore.setState({ folders: library(), readFailed: false });
    serve();
  });

  it("pressing a card selects it — view unchanged, nothing opens", async () => {
    const user = userEvent.setup();
    show({ kind: "folder", folder: "work" });
    await user.click(cardBody());
    expect(cardBody()).toHaveAttribute("aria-current", "true");
    expect(card("Login flow")).toHaveClass("ring-[1.5px]", "ring-ink");
    expect(useAppStore.getState()).toMatchObject({
      view: "home",
      tabs: [],
      homeView: { kind: "folder", folder: "work" },
    });
    expect(h1()).toHaveTextContent("Work");
  });

  it("a double press opens it — new tab", async () => {
    const user = userEvent.setup();
    show({ kind: "folder", folder: "work" });
    await user.dblClick(cardBody());
    await waitFor(() => expect(useAppStore.getState().view).toBe("editor"));
    expect(useDiagramStore.getState().projectId).toBe("p1");
  });

  it("the selection survives Home unmounting and remounting — even after visiting a document tab (T17)", async () => {
    const user = userEvent.setup();
    const first = show({ kind: "folder", folder: "work" });
    await user.click(cardBody());
    first.unmount();
    render(<Home />);
    expect(cardBody()).toHaveAttribute("aria-current", "true");
  });

  it("pressing empty space in the body clears the selection — not cards·controls", async () => {
    const user = userEvent.setup();
    show({ kind: "folder", folder: "work" });
    await user.click(cardBody());
    await user.click(screen.getByRole("radio", { name: "Cards" }));
    // the header row is not the body's empty space
    await user.click(document.querySelector("header")!);
    expect(cardBody()).toHaveAttribute("aria-current", "true");
    await user.click(body());
    expect(cardBody()).not.toHaveAttribute("aria-current");
  });

  it("empty space in the dashboard·Recent·another folder view leaves that folder view's selection alone — it is an invisible selection (D7)", async () => {
    const user = userEvent.setup();
    show({ kind: "folder", folder: "work" });
    await user.click(cardBody());
    const elsewhere: HomeView[] = [
      DASHBOARD,
      { kind: "recent" },
      { kind: "folder", folder: "home" },
    ];
    for (const view of elsewhere) {
      act(() => viewInHome(view));
      await user.click(body());
      expect(useHomeSelection.getState()).toMatchObject({ folder: "work", key: "diagram:p1" });
    }
    act(() => viewInHome({ kind: "folder", folder: "work" }));
    expect(cardBody()).toHaveAttribute("aria-current", "true");
  });

  it.each<HomeView>([DASHBOARD, { kind: "recent" }, { kind: "folder", folder: "work" }])(
    "%o — no preview text·Move to… button (T23)",
    async (view) => {
      show(view);
      await act(async () => {});
      expect(screen.queryByText("Couldn't read this diagram")).toBeNull();
      expect(screen.queryByRole("button", { name: /^Move to/ })).toBeNull();
      // the Continue card's well is the dashboard's only picture by that name
      expect(screen.queryAllByRole("img", { name: /^Preview of/ })).toHaveLength(
        view === DASHBOARD ? 1 : 0,
      );
    },
  );
});

/**
 * #231 D2, D5: one header row for every view and both modes — drawn once,
 * at the top of the sheet; its current path item is the sheet's h1.
 */
describe("a single header row — per view·mode (#231 D2·D3·D5·D12, T8·T11)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetPreviewCacheForTests();
    resetTabsForTests();
    resetBoardForTests();
    useHomeSelection.getState().clear();
    useSidebarStore.setState({ hidden: false, peek: false });
    useLibraryStore.setState({ folders: library(), readFailed: false });
    serve();
  });

  const cases: [HomeView, "cards" | "canvas", string][] = [
    [DASHBOARD, "cards", "Home"],
    [{ kind: "recent" }, "cards", "Recent"],
    [{ kind: "folder", folder: "work" }, "cards", "Work"],
    [DASHBOARD, "canvas", "Library"],
    [{ kind: "recent" }, "canvas", "Recent"],
    [{ kind: "folder", folder: "work" }, "canvas", "Work"],
  ];

  it.each(cases)(
    "%o · %s — one header, ends with the switch (none for Recent), one h1 = the current path item",
    (view, mode, current) => {
      useHomeMode.setState({ mode });
      show(view);
      const headers = sheet().querySelectorAll("header");
      expect(headers).toHaveLength(1);
      expect(sheet().firstElementChild).toBe(headers[0]);
      const radios = screen.queryByRole("radiogroup", { name: "View" });
      if (view.kind === "recent") expect(radios).toBeNull();
      else expect(headers[0]!.lastElementChild).toBe(radios);
      const titles = screen.getAllByRole("heading", { level: 1 });
      expect(titles).toHaveLength(1);
      expect(titles[0]).toHaveTextContent(current);
      expect(titles[0]).toHaveAttribute("aria-current", "page");
      expect(titles[0]).toHaveAttribute("data-home-heading");
      expect(headers[0]).toContainElement(titles[0]!);
      // no big title, no Back, no switch island over the board
      expect(sheet().querySelector(".text-\\[20px\\]")).toBeNull();
      expect(screen.queryByRole("button", { name: "Back to library" })).toBeNull();
      expect(sheet().querySelectorAll("[data-board-island] [role=radiogroup]")).toHaveLength(0);
    },
  );

  it("in Canvas too, navigation inside the sheet focuses the new h1", async () => {
    useHomeMode.setState({ mode: "canvas" });
    show(DASHBOARD);
    act(() => viewInHome({ kind: "folder", folder: "work" }, true));
    await waitFor(() => expect(h1()).toHaveFocus());
    expect(h1()).toHaveTextContent("Work");
  });

  it("an ancestor in the Cards path → that folder view + h1 focus (T11)", async () => {
    const user = userEvent.setup();
    const listing = library();
    listing[0]!.folders = [
      { id: "chk", name: "Checkout", updatedAt: now, diagrams: [], folders: [] },
    ];
    useLibraryStore.setState({ folders: listing });
    serve(() => listing);
    show({ kind: "folder", folder: "chk" });
    await user.click(screen.getByRole("button", { name: "Work" }));
    await waitFor(() => expect(h1()).toHaveFocus());
    expect(h1()).toHaveTextContent("Work");
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "work" });
  });

  it("'Library' in the Canvas path → dashboard + h1 'Library' focus (T11)", async () => {
    const user = userEvent.setup();
    useHomeMode.setState({ mode: "canvas" });
    show({ kind: "folder", folder: "work" });
    expect(spoken(screen.getByRole("navigation", { name: "Breadcrumb" }))).toBe("Library/Work");
    await user.click(screen.getByRole("button", { name: "Library" }));
    expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
    await waitFor(() => expect(h1()).toHaveFocus());
    expect(h1()).toHaveTextContent("Library");
  });
});

/** autosave, as the shell mounts it */
const AutosaveHost = () => {
  useAutosave();
  return null;
};

describe("Cards/Canvas (#221 D1·D2, T38)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetPreviewCacheForTests();
    resetTabsForTests();
    resetBoardForTests();
    localStorage.clear();
    useHomeMode.setState({ mode: "cards" });
    useSidebarStore.setState({ hidden: false, peek: false });
    useLibraryStore.setState({ folders: library(), readFailed: false });
    serve();
  });

  const views: HomeView[] = [DASHBOARD, { kind: "folder", folder: "work" }];

  it.each(views)(
    "in Canvas, %o has the board as the whole body below the header row (#231 D5·D12)",
    (view) => {
      useHomeMode.setState({ mode: "canvas" });
      show(view);
      const board = screen.getByRole("region", { name: "Library canvas" });
      expect(body()).toContainElement(board);
      expect(body()).toHaveClass("relative", "min-h-0", "flex-1");
      expect(body()).not.toHaveClass("px-8");
      expect(sheet().firstElementChild?.tagName).toBe("HEADER");
    },
  );

  it("the Cards body scrolls below the header row — the header row does not scroll (#231 D5)", () => {
    show({ kind: "folder", folder: "work" });
    expect(sheet()).toHaveClass("flex", "flex-col");
    expect(sheet()).not.toHaveClass("overflow-y-auto");
    expect(body()).toHaveClass("min-h-0", "flex-1", "overflow-y-auto", "px-8", "pt-4", "pb-6");
  });

  it("in Canvas, Recent is still the Cards Recent — no switch", async () => {
    useHomeMode.setState({ mode: "canvas" });
    show({ kind: "recent" });
    expect(await screen.findByRole("heading", { level: 1, name: "Recent" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Library canvas" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "View" })).toBeNull();
  });

  it.each(views)("the Cards header row of %o has the switch", (view) => {
    show(view);
    expect(screen.getByRole("radiogroup", { name: "View" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true");
  });

  it("the switch does not change homeView, and the pressed radio keeps focus — the header row does not remount (#231 D4, T12)", async () => {
    const user = userEvent.setup();
    show({ kind: "folder", folder: "work" });
    const canvas = screen.getByRole("radio", { name: "Canvas" });
    const cards = screen.getByRole("radio", { name: "Cards" });
    const row = document.querySelector("header");
    await user.click(canvas);
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "work" });
    expect(screen.getByRole("region", { name: "Library canvas" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Canvas" })).toBe(canvas);
    expect(document.querySelector("header")).toBe(row);
    expect(canvas).toHaveFocus();
    await user.click(cards);
    expect(screen.getByRole("heading", { level: 1, name: "Work" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Cards" })).toBe(cards);
    expect(cards).toHaveFocus();
  });

  it("switching with → moves focus to the chosen radio — header row unchanged (T12)", async () => {
    const user = userEvent.setup();
    show(DASHBOARD);
    const cards = screen.getByRole("radio", { name: "Cards" });
    const canvas = screen.getByRole("radio", { name: "Canvas" });
    act(() => cards.focus());
    await user.keyboard("{ArrowRight}");
    expect(useHomeMode.getState().mode).toBe("canvas");
    expect(screen.getByRole("region", { name: "Library canvas" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Canvas" })).toBe(canvas);
    expect(canvas).toHaveFocus();
  });
});
