import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { badgesIn, spoken } from "../../../test/badges";
import { useAppStore } from "../../library/appStore";
import { DASHBOARD, type HomeView } from "../../library/homeView";
import { blankDoc, type FolderMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { findFolder } from "../../library/libraryTree";
import { openDocument, resetTabsForTests, showHomeTab } from "../../library/tabActions";
import { resetAutosaveForTests } from "../../library/useAutosave";
import { HomeHeader, homeHeaderModel, LIBRARY_CRUMB } from "../HomeHeader";
import { type HomeMode, useHomeMode } from "../homeMode";
import { useHomeSelection } from "../homeSelection";
import { showInLabel } from "../../library/fileManager";
import { likeRust } from "../../../test/rustAnswers";

/** "Show in …" as this web view names its file manager (#238 D10) */
const SHOW_IN = showInLabel();

vi.mock("../../../shared/lib/systemClipboard", () => ({
  readClipboardText: vi.fn(async () => null),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedAsk = vi.mocked(ask);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const now = Date.now();

/** Payments › Checkout › Flows, an empty project and My Diagrams — 4 diagrams in all */
const library = (): FolderMeta[] => [
  {
    id: "pay",
    name: "Payments",
    updatedAt: now - 2 * 60_000,
    diagrams: [
      { id: "co", title: "Checkout service", updatedAt: now - 2 * 60_000, readable: true },
    ],
    folders: [
      {
        id: "chk",
        name: "Checkout",
        updatedAt: now - 5 * 60_000,
        diagrams: [
          { id: "ord", title: "Order flow", updatedAt: now - 10 * 60_000, readable: true },
        ],
        folders: [
          {
            id: "flw",
            name: "Flows",
            updatedAt: now - 86_400_000,
            diagrams: [{ id: "x", title: "X", updatedAt: now - 86_400_000, readable: true }],
            folders: [],
          },
        ],
      },
    ],
  },
  { id: "sk", name: "Sketches", updatedAt: now - 86_400_000, diagrams: [], folders: [] },
  {
    id: "my-diagrams",
    name: "My Diagrams",
    updatedAt: now - 3 * 60_000,
    diagrams: [{ id: "old", title: "Old", updatedAt: now - 3 * 60_000, readable: true }],
    folders: [],
  },
];
const found = (id: string) => findFolder(library(), id)!.folder;

const show = (view: HomeView, mode: HomeMode = "cards") => {
  useHomeMode.setState({ mode, size: null });
  showHomeTab(view);
  return render(<HomeHeader />);
};
const header = () => document.querySelector("header")!;
const more = (name: string) => screen.getByRole("button", { name: `More for ${name}` });
const h1 = () => screen.getByRole("heading", { level: 1 });

/** the slot table (#231 D2): what each view and mode fills the row with — nine rows */
describe("homeHeaderModel — the nine rows of the slot table (#231 D2·D3, T9)", () => {
  const f = library();
  const pay = f[0]!;
  const chk = pay.folders[0]!;
  const flw = chk.folders[0]!;

  it("① dashboard · Cards — 'Home', no caption·actions, switch", () => {
    expect(homeHeaderModel(DASHBOARD, "cards", f)).toEqual({
      path: [],
      current: "Home",
      project: null,
      currentId: null,
      caption: null,
      actions: null,
      switch: true,
      // the dashboard's RECENT row is a card grid too (#236 R5, D7)
      cardSize: true,
      pathOf: null,
    });
  });

  it("② recent · both modes — 'Recent', 'N diagrams' (when the list exists and did not fail), no switch", () => {
    const recent = {
      path: [],
      current: "Recent",
      project: null,
      currentId: null,
      caption: "4 diagrams",
      actions: null,
    };
    // Recent is cards in either mode: it keeps the card size button (#236 R5)
    expect(homeHeaderModel({ kind: "recent" }, "cards", f)).toEqual({
      ...recent,
      switch: false,
      cardSize: true,
      pathOf: null,
    });
    expect(homeHeaderModel({ kind: "recent" }, "canvas", f)).toEqual({
      ...recent,
      switch: false,
      cardSize: true,
      pathOf: null,
    });
    expect(homeHeaderModel({ kind: "recent" }, "cards", null).caption).toBeNull();
    expect(homeHeaderModel({ kind: "recent" }, "cards", [], true).caption).toBeNull();
  });

  it("③ top-level project · Cards — a single name, 'N items · edited …', ⋯·New ▾, switch", () => {
    expect(homeHeaderModel({ kind: "folder", folder: "pay" }, "cards", f)).toEqual({
      path: [],
      current: "Payments",
      project: "pay",
      currentId: "pay",
      caption: "2 items · edited 2 min ago",
      actions: { folder: pay, parent: null },
      switch: true,
      cardSize: true,
      pathOf: "pay",
    });
  });

  it("④ nested folder · Cards — ancestors (from the project) + current, no leading 'Home'", () => {
    expect(homeHeaderModel({ kind: "folder", folder: "flw" }, "cards", f)).toEqual({
      path: [
        { id: "pay", name: "Payments" },
        { id: "chk", name: "Checkout" },
      ],
      current: "Flows",
      project: "pay",
      currentId: "flw",
      caption: "1 item · edited yesterday",
      actions: { folder: flw, parent: chk },
      switch: true,
      cardSize: true,
      pathOf: "flw",
    });
  });

  it("⑤ another project · Cards — its name, caption and actions, switch", () => {
    expect(homeHeaderModel({ kind: "folder", folder: "my-diagrams" }, "cards", f)).toEqual({
      path: [],
      current: "My Diagrams",
      project: "my-diagrams",
      currentId: "my-diagrams",
      caption: "1 item · edited 3 min ago",
      actions: { folder: found("my-diagrams"), parent: null },
      switch: true,
      cardSize: true,
      pathOf: "my-diagrams",
    });
  });

  it("a project not found · Cards — its name alone: no caption, no ⋯·New ▾ (#253 R7)", () => {
    const lost: FolderMeta = {
      id: "arc",
      name: "architecture",
      updatedAt: 0,
      diagrams: [],
      folders: [],
      missing: true,
    };
    const model = homeHeaderModel({ kind: "folder", folder: "arc" }, "cards", [lost]);
    expect(model).toMatchObject({
      path: [],
      current: "architecture",
      caption: null,
      actions: null,
      switch: true,
    });
  });

  it("⑥ dashboard · Canvas — 'Library', 'p projects · d diagrams' (all depths)", () => {
    expect(homeHeaderModel(DASHBOARD, "canvas", f)).toEqual({
      path: [],
      current: "Library",
      project: null,
      currentId: null,
      caption: "3 projects · 4 diagrams",
      actions: null,
      switch: true,
      cardSize: false,
      pathOf: null,
    });
    // no listing yet, or none that could be read: no count to give
    expect(homeHeaderModel(DASHBOARD, "canvas", null).caption).toBeNull();
    expect(homeHeaderModel(DASHBOARD, "canvas", [], true).caption).toBeNull();
  });

  it("⑦ top-level project · Canvas — Library / Payments, no caption·actions", () => {
    expect(homeHeaderModel({ kind: "folder", folder: "pay" }, "canvas", f)).toEqual({
      path: [{ id: LIBRARY_CRUMB, name: "Library" }],
      current: "Payments",
      project: "pay",
      currentId: "pay",
      caption: null,
      actions: null,
      switch: true,
      cardSize: false,
      pathOf: "pay",
    });
  });

  it("⑧ nested folder · Canvas — Library / Payments / Checkout", () => {
    expect(homeHeaderModel({ kind: "folder", folder: "chk" }, "canvas", f)).toEqual({
      path: [
        { id: LIBRARY_CRUMB, name: "Library" },
        { id: "pay", name: "Payments" },
      ],
      current: "Checkout",
      project: "pay",
      currentId: "chk",
      caption: null,
      actions: null,
      switch: true,
      cardSize: false,
      pathOf: "chk",
    });
  });

  it.each<HomeMode>(["cards", "canvas"])(
    "⑨ folder whose list has not arrived · %s — empty path, the switch stays",
    (mode) => {
      expect(homeHeaderModel({ kind: "folder", folder: "pay" }, mode, null)).toEqual({
        path: [],
        current: null,
        project: null,
        currentId: null,
        caption: null,
        actions: null,
        switch: true,
        cardSize: false,
        pathOf: null,
      });
    },
  );

  it("project is the view folder's project id, currentId is the current step's folder id — badge slot (#236 R4)", () => {
    // the project's step carries the badge: an ancestor in a nested view, the current step in its own
    expect(homeHeaderModel({ kind: "folder", folder: "flw" }, "canvas", f)).toMatchObject({
      project: "pay",
      currentId: "flw",
    });
    expect(homeHeaderModel({ kind: "folder", folder: "sk" }, "cards", f)).toMatchObject({
      project: "sk",
      currentId: "sk",
    });
  });

  it("the Library item's id is a value no folder id can be (validate_id is [A-Za-z0-9_-])", () => {
    expect(LIBRARY_CRUMB).toBe(":library");
    expect(/^[A-Za-z0-9_-]+$/.test(LIBRARY_CRUMB)).toBe(false);
  });
});

describe("header row — rendering (#231 D2, T9)", () => {
  beforeEach(() => {
    resetTabsForTests();
    useLibraryStore.setState({ folders: library(), readFailed: false });
    mockedInvoke.mockImplementation(likeRust(async () => undefined));
  });

  type Row = {
    crumbs: string;
    caption: string | null;
    actions: { toolbar: string; name: string } | null;
    switch: boolean;
  };
  const rows: [string, HomeView, HomeMode, Row][] = [
    ["① dashboard · Cards", DASHBOARD, "cards", row("Home", null, null, true)],
    ["② recent · Cards", { kind: "recent" }, "cards", row("Recent", "4 diagrams", null, false)],
    ["② recent · Canvas", { kind: "recent" }, "canvas", row("Recent", "4 diagrams", null, false)],
    [
      "③ project · Cards",
      { kind: "folder", folder: "pay" },
      "cards",
      row("Payments", "2 items · edited 2 min ago", ["Project actions", "Payments"], true),
    ],
    [
      "④ nested folder · Cards",
      { kind: "folder", folder: "flw" },
      "cards",
      row(
        "Payments/Checkout/Flows",
        "1 item · edited yesterday",
        ["Folder actions", "Flows"],
        true,
      ),
    ],
    [
      "⑤ another project · Cards",
      { kind: "folder", folder: "my-diagrams" },
      "cards",
      row("My Diagrams", "1 item · edited 3 min ago", ["Project actions", "My Diagrams"], true),
    ],
    [
      "⑥ dashboard · Canvas",
      DASHBOARD,
      "canvas",
      row("Library", "3 projects · 4 diagrams", null, true),
    ],
    [
      "⑦ project · Canvas",
      { kind: "folder", folder: "pay" },
      "canvas",
      row("Library/Payments", null, null, true),
    ],
    [
      "⑧ nested folder · Canvas",
      { kind: "folder", folder: "chk" },
      "canvas",
      row("Library/Payments/Checkout", null, null, true),
    ],
  ];

  it.each(rows)("%s", (_, view, mode, want) => {
    show(view, mode);
    const nav = within(header()).getByRole("navigation", { name: "Breadcrumb" });
    expect(spoken(nav)).toBe(want.crumbs);
    // the current item is the sheet's one h1
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(h1()).toHaveTextContent(want.crumbs.split("/").at(-1)!);
    expect(h1()).toHaveAttribute("aria-current", "page");
    // the left slot: the path, then the caption if there is one
    const left = nav.parentElement!;
    expect(left.children).toHaveLength(want.caption ? 2 : 1);
    if (want.caption) expect(left.lastElementChild).toHaveTextContent(want.caption);
    const toolbar = within(header()).queryByRole("toolbar");
    const divider = header().querySelector(".bg-dot");
    if (want.actions) {
      expect(toolbar).toHaveAccessibleName(want.actions.toolbar);
      expect(
        within(toolbar!)
          .getAllByRole("button")
          .map((b) => b.getAttribute("aria-label")),
      ).toEqual([`More for ${want.actions.name}`, `New in ${want.actions.name}`]);
      expect(divider).toHaveAttribute("aria-hidden", "true");
    } else {
      expect(toolbar).toBeNull();
      expect(divider).toBeNull();
    }
    const radios = within(header()).queryByRole("radiogroup", { name: "View" });
    if (want.switch) expect(header().lastElementChild).toBe(radios);
    else expect(radios).toBeNull();
  });

  it.each<HomeMode>(["cards", "canvas"])(
    "⑨ folder whose list has not arrived · %s — no path·h1, the switch stays in place",
    (mode) => {
      useLibraryStore.setState({ folders: null });
      show({ kind: "folder", folder: "pay" }, mode);
      expect(within(header()).queryByRole("navigation")).toBeNull();
      expect(screen.queryByRole("heading")).toBeNull();
      expect(within(header()).queryByRole("toolbar")).toBeNull();
      expect(header().lastElementChild).toBe(screen.getByRole("radiogroup", { name: "View" }));
    },
  );

  it.each<[string, HomeView, HomeMode, string | null]>([
    ["① dashboard · Cards", DASHBOARD, "cards", null],
    ["② recent", { kind: "recent" }, "cards", null],
    ["③ project · Cards — current step", { kind: "folder", folder: "pay" }, "cards", "Payments"],
    [
      "④ nested folder · Cards — first step",
      { kind: "folder", folder: "flw" },
      "cards",
      "Payments",
    ],
    [
      "⑤ another project · Cards — current step",
      { kind: "folder", folder: "my-diagrams" },
      "cards",
      "My Diagrams",
    ],
    ["⑥ dashboard · Canvas", DASHBOARD, "canvas", null],
    [
      "⑦ project · Canvas — step after Library",
      { kind: "folder", folder: "pay" },
      "canvas",
      "Payments",
    ],
    [
      "⑧ nested folder · Canvas — step after Library",
      { kind: "folder", folder: "chk" },
      "canvas",
      "Payments",
    ],
  ])("badge only on the project step — %s (#236 R4, T9)", (_, view, mode, step) => {
    show(view, mode);
    const nav = within(header()).getByRole("navigation", { name: "Breadcrumb" });
    const badges = badgesIn(nav);
    if (step === null) {
      expect(badges).toEqual([]);
      return;
    }
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveClass("h-3.5", "w-3.5");
    expect(badges[0]!.nextElementSibling).toHaveTextContent(step);
    expect(badges[0]).toHaveTextContent(step[0]!);
  });

  it.each<[string, HomeView, HomeMode, "before switch" | "last" | null]>([
    ["① dashboard · Cards — right before the switch", DASHBOARD, "cards", "before switch"],
    ["② recent · Cards — end of the row", { kind: "recent" }, "cards", "last"],
    ["② recent · Canvas — Recent is always cards", { kind: "recent" }, "canvas", "last"],
    [
      "③ project · Cards — after the divider, right before the switch",
      { kind: "folder", folder: "pay" },
      "cards",
      "before switch",
    ],
    ["④ nested folder · Cards", { kind: "folder", folder: "flw" }, "cards", "before switch"],
    [
      "⑤ another project · Cards",
      { kind: "folder", folder: "my-diagrams" },
      "cards",
      "before switch",
    ],
    ["⑥ dashboard · Canvas", DASHBOARD, "canvas", null],
    ["⑦ project · Canvas", { kind: "folder", folder: "pay" }, "canvas", null],
  ])("size button placement — %s (#236 R5, T10)", (_, view, mode, place) => {
    show(view, mode);
    const size = within(header()).queryByRole("button", { name: /^Card size: / });
    if (place === null) {
      expect(size).toBeNull();
      return;
    }
    expect(size).toHaveAccessibleName("Card size: Medium");
    if (place === "last") expect(header().lastElementChild).toBe(size);
    else {
      expect(size!.nextElementSibling).toBe(screen.getByRole("radiogroup", { name: "View" }));
      // after the folder's divider, when it has actions
      if (view.kind === "folder") {
        expect(size!.previousElementSibling).toHaveClass("bg-dot");
      }
    }
  });

  it("dimensions — height 44, 0 12 0 16, gap 10, surface; left flex-1 gap 6; caption 11/14 muted (D2)", () => {
    show({ kind: "folder", folder: "pay" });
    expect(header()).toHaveClass(
      "flex",
      "h-11",
      "flex-none",
      "items-center",
      "gap-2.5",
      "pl-4",
      "pr-3",
      "bg-surface",
    );
    const left = within(header()).getByRole("navigation").parentElement!;
    expect(left).toHaveClass("flex", "min-w-0", "flex-1", "items-center", "gap-1.5");
    expect(screen.getByText("2 items · edited 2 min ago")).toHaveClass(
      "flex-none",
      "whitespace-nowrap",
      "text-[11px]",
      "leading-[14px]",
      "text-muted",
    );
  });

  it("actions — ⋯ 28×28 radius 6 text-icon hover, New ▾ height 28 ink fill Plus·New·Chevron, divider 1×16 dot", () => {
    show({ kind: "folder", folder: "pay" });
    expect(screen.getByRole("toolbar")).toHaveClass("flex", "items-center", "gap-1.5");
    expect(more("Payments")).toHaveClass("h-7", "w-7", "rounded-md", "text-icon", "hover:bg-hover");
    expect(more("Payments")).toHaveAttribute("aria-haspopup", "menu");
    const create = screen.getByRole("button", { name: "New in Payments" });
    expect(create).toHaveAttribute("aria-haspopup", "menu");
    expect(create).toHaveClass("h-7", "rounded-md", "pl-2.5", "pr-2", "gap-1.5", "bg-primary");
    expect(create).toHaveTextContent("New");
    expect(create.querySelectorAll("svg")).toHaveLength(2);
    expect(header().querySelector(".bg-dot")).toHaveClass("mx-2", "h-4", "w-px", "flex-none");
  });
});

describe("pressing the header path (#231 D3, T11)", () => {
  beforeEach(() => {
    resetTabsForTests();
    useLibraryStore.setState({ folders: library(), readFailed: false });
    mockedInvoke.mockImplementation(likeRust(async () => undefined));
  });

  it("Cards ancestor → that folder view, requests focus on the new h1", async () => {
    const user = userEvent.setup();
    show({ kind: "folder", folder: "flw" });
    const focus = useAppStore.getState().homeFocus;
    await user.click(screen.getByRole("button", { name: "Checkout" }));
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
    expect(useAppStore.getState().homeFocus).toBe(focus + 1);
    expect(h1()).toHaveTextContent("Checkout");
  });

  it("Canvas 'Library' → dashboard, 'Payments' → focus on that project", async () => {
    const user = userEvent.setup();
    show({ kind: "folder", folder: "chk" }, "canvas");
    const focus = useAppStore.getState().homeFocus;
    await user.click(screen.getByRole("button", { name: "Payments" }));
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
    await user.click(screen.getByRole("button", { name: "Library" }));
    expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
    expect(useAppStore.getState().homeFocus).toBe(focus + 2);
    expect(h1()).toHaveTextContent("Library");
  });
});

/**
 * The header's ⋯ and New ▾ (#231 D2, D8, `Home-States` 4·4b): the folder's
 * menu, the tree row's; Rename edits the name in the path.
 */
describe("header ⋯·New ▾ (#231 D8, T21)", () => {
  let listing: FolderMeta[] = [];
  beforeEach(() => {
    resetAutosaveForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    listing = library();
    useLibraryStore.setState({ folders: library(), readFailed: false });
    useAppStore.setState({ folderRenameRequest: null });
    useHomeSelection.getState().clear();
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
    mockedInvoke.mockImplementation(
      likeRust(async (cmd, args) => {
        if (cmd === "list_library") return structuredClone(listing);
        if (cmd === "load_project") {
          return JSON.stringify({ ...blankDoc(), title: (args as { id: string }).id });
        }
        return undefined;
      }),
    );
  });

  it("project ⋯ — New diagram · New folder · Rename · Delete (no Move to…)", async () => {
    const user = userEvent.setup();
    show({ kind: "folder", folder: "pay" });
    await user.click(more("Payments"));
    expect(screen.getByRole("menu", { name: "More for Payments" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "New diagram",
      "New folder",
      SHOW_IN,
      "Copy Path",
      "Rename",
      "Delete",
    ]);
    expect(more("Payments")).toHaveAttribute("aria-expanded", "true");
  });

  it("nested folder ⋯ — Move to… when there is somewhere to move (folder picker)", async () => {
    const user = userEvent.setup();
    show({ kind: "folder", folder: "flw" });
    await user.click(more("Flows"));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "New diagram",
      "New folder",
      SHOW_IN,
      "Copy Path",
      "Rename",
      "Move to…",
      "Delete",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "Move to…" }));
    const picker = screen.getByRole("tree", { name: "Move to" });
    await user.click(
      within(picker)
        .getByRole("treeitem", { name: /^Sketches/ })
        .querySelector("[data-row]")!,
    );
    await waitFor(() => expect(calls("move_folder")).toHaveLength(1));
    expect(calls("move_folder")[0]![1]).toMatchObject({ id: "flw", parent: "sk" });
  });

  it("a level-10 folder's ⋯ has no New folder (#229)", async () => {
    const user = userEvent.setup();
    let deepest: FolderMeta = { id: "e10", name: "E10", updatedAt: now, diagrams: [], folders: [] };
    for (let k = 9; k >= 2; k--) {
      deepest = { id: `e${k}`, name: `E${k}`, updatedAt: now, diagrams: [], folders: [deepest] };
    }
    useLibraryStore.setState({ folders: [{ ...library()[0]!, folders: [deepest] }] });
    show({ kind: "folder", folder: "e10" });
    await user.click(more("E10"));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).not.toContain("New folder");
  });

  it("the ⋯ menu aligns to the button's right edge, 4 below — menu width 184 (#230)", () => {
    show({ kind: "folder", folder: "pay" });
    more("Payments").getBoundingClientRect = () => ({ right: 800, bottom: 100 }) as DOMRect;
    fireEvent.click(more("Payments"));
    expect(screen.getByRole("menu")).toHaveStyle({ left: `${800 - 184}px`, top: "104px" });
  });

  it("Rename → the current path item becomes the name field — Enter calls renameFolderTo, focus to ⋯", async () => {
    const user = userEvent.setup();
    show({ kind: "folder", folder: "pay" });
    await user.click(more("Payments"));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Project name" });
    const nav = within(header()).getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getAllByRole("listitem").at(-1)).toContainElement(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Payments");
    // 160 wide, 2 above and below, 1 at the sides: the row does not move (Home-States 4)
    expect(input.parentElement).toHaveClass("w-40", "mx-px", "my-0.5");
    // the project's badge stays in front of the field, 6 clear of it (#236, Home-States 4)
    const badge = badgesIn(nav)[0]!;
    expect(badge).toHaveClass("mr-1.5");
    expect(badge.nextElementSibling).toBe(input.parentElement);
    expect(screen.queryByRole("heading")).toBeNull();
    await user.keyboard("Billing{Enter}");
    await waitFor(() =>
      expect(calls("rename_folder")[0]![1]).toEqual({ id: "pay", name: "Billing" }),
    );
    expect(more("Payments")).toHaveFocus();
    // the Enter that ended the edit is not a press of ⋯, which now has the focus
    expect(screen.queryByRole("menu")).toBeNull();
    expect(h1()).toBeInTheDocument();
  });

  it("Rename of a nested folder is 'Folder name' — ancestors stay links", async () => {
    const user = userEvent.setup();
    show({ kind: "folder", folder: "flw" });
    await user.click(more("Flows"));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(screen.getByRole("textbox", { name: "Folder name" })).toHaveValue("Flows");
    expect(screen.getByRole("button", { name: "Checkout" })).toBeInTheDocument();
    // the badge stays on the project's step, not on the field
    const nav = within(header()).getByRole("navigation", { name: "Breadcrumb" });
    expect(badgesIn(nav)).toHaveLength(1);
    expect(badgesIn(nav)[0]!.closest("button")).toHaveAccessibleName("Payments");
  });

  it("Escape → name unchanged, focus to ⋯", async () => {
    const user = userEvent.setup();
    show({ kind: "folder", folder: "pay" });
    await user.click(more("Payments"));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    await user.keyboard("Billing{Escape}");
    expect(calls("rename_folder")).toHaveLength(0);
    expect(h1()).toHaveTextContent("Payments");
    expect(more("Payments")).toHaveFocus();
  });

  it("leaving the field applies it — focus stays where it went", async () => {
    const user = userEvent.setup();
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    show({ kind: "folder", folder: "pay" });
    await user.click(more("Payments"));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    await user.keyboard("Billing");
    await user.click(elsewhere);
    await waitFor(() =>
      expect(calls("rename_folder")[0]![1]).toEqual({ id: "pay", name: "Billing" }),
    );
    expect(elsewhere).toHaveFocus();
    elsewhere.remove();
  });

  it("project Delete — asks, then on delete goes to the dashboard and requests title focus", async () => {
    const user = userEvent.setup();
    mockedAsk.mockResolvedValue(true);
    show({ kind: "folder", folder: "pay" });
    const focus = useAppStore.getState().homeFocus;
    await user.click(more("Payments"));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(calls("delete_folder")[0]![1]).toEqual({ id: "pay" }));
    await waitFor(() => expect(useAppStore.getState().homeView).toEqual(DASHBOARD));
    expect(useAppStore.getState().homeFocus).toBe(focus + 1);
  });

  it("does not delete if a diagram was opened during the confirm dialog (#161, #218 D20)", async () => {
    const user = userEvent.setup();
    mockedAsk.mockImplementation(async () => {
      openDocument(blankDoc(), { projectId: "agent" });
      return true;
    });
    show({ kind: "folder", folder: "pay" });
    await user.click(more("Payments"));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(calls("delete_folder")).toHaveLength(0);
  });

  it("folder Delete — on delete goes to the parent folder view and requests title focus", async () => {
    const user = userEvent.setup();
    mockedAsk.mockResolvedValue(true);
    show({ kind: "folder", folder: "chk" });
    const focus = useAppStore.getState().homeFocus;
    await user.click(more("Checkout"));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(calls("delete_folder")[0]![1]).toEqual({ id: "chk" }));
    await waitFor(() =>
      expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" }),
    );
    expect(useAppStore.getState().homeFocus).toBe(focus + 1);
  });

  it("⋯ New folder — creates it in this folder and keeps the view, selects the new card and requests its name field (#231 D8)", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(
      likeRust(async (cmd, args) => {
        if (cmd === "create_folder") {
          const { id } = args as { id: string };
          const chk = findFolder(listing, "chk")!.folder;
          chk.folders = [
            { id, name: "New folder", updatedAt: now, diagrams: [], folders: [] },
            ...chk.folders,
          ];
        }
        if (cmd === "list_library") return structuredClone(listing);
        return undefined;
      }),
    );
    show({ kind: "folder", folder: "chk" });
    await user.click(more("Checkout"));
    await user.click(screen.getByRole("menuitem", { name: "New folder" }));
    await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
    const { id, parent } = calls("create_folder")[0]![1] as { id: string; parent?: string };
    expect(parent).toBe("chk");
    await waitFor(() => expect(useAppStore.getState().folderRenameRequest?.id).toBe(id));
    expect(useHomeSelection.getState()).toMatchObject({ folder: "chk", key: `folder:${id}` });
    // Home stays, and the header's path is no field: the card names it
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(h1()).toHaveTextContent("Checkout");
  });

  it("the header does not take rename requests — those belong to the folder card (#231 D8)", () => {
    show({ kind: "folder", folder: "chk" });
    act(() => useAppStore.getState().requestFolderRename("chk"));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(useAppStore.getState().folderRenameRequest?.id).toBe("chk");
  });

  it("going to another folder closes the name field — it belonged to that folder", async () => {
    const user = userEvent.setup();
    show({ kind: "folder", folder: "chk" });
    await user.click(more("Checkout"));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(screen.getByRole("textbox", { name: "Folder name" })).toBeInTheDocument();
    // from the sidebar: the field goes with its folder's view
    await waitFor(() => showHomeTab({ kind: "folder", folder: "pay" }));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(h1()).toHaveTextContent("Payments");
  });

  it("New ▾ — opens the New menu aligned to the button's right edge, choosing creates in this folder (#231 D9)", async () => {
    const user = userEvent.setup();
    show({ kind: "folder", folder: "chk" });
    const create = screen.getByRole("button", { name: "New in Checkout" });
    create.getBoundingClientRect = () => ({ right: 900, bottom: 80 }) as DOMRect;
    await user.click(create);
    expect(create).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "New in Checkout" });
    expect(menu).toHaveStyle({ left: `${900 - 184}px`, top: "84px" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual([
      "Blank diagram",
      "Flowchart",
      "Sequence",
      "Class",
      "ERD",
      "From Mermaid…",
      "New folder",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "Flowchart" }));
    await waitFor(() => expect(useAppStore.getState().view).toBe("editor"));
    expect(calls("save_project")[0]![1]).toMatchObject({ folder: "chk" });
    expect(useDiagramStore.getState().title).toBe("Flowchart");
  });
});

function row(
  crumbs: string,
  caption: string | null,
  actions: [string, string] | null,
  hasSwitch: boolean,
) {
  return {
    crumbs,
    caption,
    actions: actions ? { toolbar: actions[0], name: actions[1] } : null,
    switch: hasSwitch,
  };
}
