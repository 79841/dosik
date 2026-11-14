import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { useAppStore } from "../../library/appStore";
import { blankDoc, type FolderMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { findFolder } from "../../library/libraryTree";
import { resetTabsForTests, showHomeTab } from "../../library/tabActions";
import { resetAutosaveForTests } from "../../library/useAutosave";
import { resetPreviewCacheForTests } from "../diagramPreview";
import { FolderView } from "../FolderView";
import { cardGrid } from "../homeGrid";
import { useHomeMode } from "../homeMode";
import { useHomeSelection } from "../homeSelection";

vi.mock("../../../shared/lib/systemClipboard", () => ({
  readClipboardText: vi.fn(async () => null),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedAsk = vi.mocked(ask);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const now = Date.now();

const library = (): FolderMeta[] => [
  {
    folders: [],
    id: "pay",
    name: "Payments",
    updatedAt: now - 2 * 60_000,
    diagrams: [
      {
        id: "co",
        title: "Checkout service",
        updatedAt: now - 2 * 60_000,
        readable: true,
      },
      { id: "le", title: "Ledger schema", updatedAt: now - 60 * 60_000, readable: true },
      { id: "br", title: "Broken", updatedAt: now - 90 * 60_000, readable: false },
    ],
  },
  { folders: [], id: "empty", name: "Sketches", updatedAt: now - 86_400_000, diagrams: [] },
  {
    folders: [],
    id: "my-diagrams",
    name: "My Diagrams",
    updatedAt: now - 2 * 86_400_000,
    stray: true,
    diagrams: [{ id: "old", title: "Old", updatedAt: now, readable: true }],
  },
];

const folder = (id: string) => findFolder(useLibraryStore.getState().folders!, id)!.folder;
const renderProject = (id: string) => {
  showHomeTab({ kind: "folder", folder: id });
  return render(<FolderView folder={folder(id)} folders={useLibraryStore.getState().folders!} />);
};
/** a card's main button — the grid's roving stop */
const mainOf = (title: string) =>
  within(card(title)).getByRole("button", {
    name: new RegExp(`^${title}, (diagram|folder|unreadable)`),
  });
const card = (title: string) => screen.getByRole("article", { name: title });
/** the dashed card's name where a folder can still go (#231 D9) */
const NEW_CARD =
  "New diagram, Blank, Flowchart, Sequence, Class, ERD or paste Mermaid · or a new folder";
/** the view as Home draws it: the folder and the listing from the store, as they change */
const Live = ({ id }: { id: string }) => {
  const folders = useLibraryStore((s) => s.folders)!;
  return <FolderView folder={findFolder(folders, id)!.folder} folders={folders} />;
};

describe("project view (#220 D11, T27)", () => {
  beforeEach(() => {
    useHomeSelection.getState().clear();
    useHomeMode.setState({ size: null });
    resetAutosaveForTests();
    resetPreviewCacheForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    useLibraryStore.setState({ folders: library(), readFailed: false });
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "list_library") return library();
      if (cmd === "load_project") {
        const { id } = args as { id: string };
        return JSON.stringify({ ...blankDoc(), title: id });
      }
      return undefined;
    });
  });

  it("the header row is Home's — the view starts with the grid, no title·menu·switch (#231 D2·D5)", () => {
    const { container } = renderProject("pay");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByRole("button", { name: /^More for Payments$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^New in/ })).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText(/items · edited/)).toBeNull();
    const list = screen.getByRole("list", { name: "Items in Payments" });
    expect(container.firstElementChild).toBe(list);
    expect(list).not.toHaveClass("mt-5");
    // no project dot (#229 D19)
    expect(document.querySelector(".bg-project-grey")).toBeNull();
  });

  it("card count + a dashed New card at the end (T13)", () => {
    renderProject("pay");
    const list = within(screen.getByRole("list", { name: "Items in Payments" }));
    expect(list.getAllByRole("article")).toHaveLength(3);
    expect(
      list.getByRole("button", {
        name: NEW_CARD,
      }),
    ).toBeInTheDocument();
  });

  it("grid — Items in {name}, equal row heights (auto-rows-fr), card meta is the edit time", () => {
    renderProject("pay");
    const list = screen.getByRole("list", { name: "Items in Payments" });
    expect(list).toHaveClass("grid", "auto-rows-fr");
    expect(within(card("Checkout service")).getByText("Edited 2 min ago")).toBeInTheDocument();
    // no page tiles (#229 D5)
    expect(within(card("Checkout service")).queryByRole("list")).toBeNull();
  });

  it("card size — Medium if never chosen, otherwise a grid at that size (#236 R5, T13)", () => {
    renderProject("pay");
    const list = screen.getByRole("list", { name: "Items in Payments" });
    expect(list).toHaveClass(...cardGrid("medium").split(" "));
    act(() => useHomeMode.getState().setSize("large"));
    expect(list).toHaveClass(...cardGrid("large").split(" "));
    expect(list.className).not.toContain(cardGrid("medium").split(" ").at(-1)!);
  });

  it("pressing a card selects it — view unchanged, pressing another card moves the selection (D7, T14)", async () => {
    const user = userEvent.setup();
    renderProject("pay");
    const focus = useAppStore.getState().homeFocus;
    await user.click(mainOf("Checkout service"));
    expect(mainOf("Checkout service")).toHaveAttribute("aria-current", "true");
    expect(card("Checkout service")).toHaveClass("ring-[1.5px]", "ring-ink");
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
    expect(useAppStore.getState().homeFocus).toBe(focus);
    await user.click(mainOf("Ledger schema"));
    expect(mainOf("Ledger schema")).toHaveAttribute("aria-current", "true");
    expect(mainOf("Checkout service")).not.toHaveAttribute("aria-current");
    // and a double click opens it in a tab
    await user.dblClick(mainOf("Ledger schema"));
    await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("le"));
  });

  it("one Tab stop — the selected card, else the first card; the dashed card is separate (T15)", () => {
    const { unmount } = renderProject("pay");
    const stops = () =>
      within(screen.getByRole("list", { name: "Items in Payments" }))
        .getAllByRole("button")
        .filter((b) => b.tabIndex === 0)
        .map((b) => b.getAttribute("aria-label"));
    expect(stops()).toEqual(["Checkout service, diagram, edited 2 min ago", NEW_CARD]);
    unmount();
    useHomeSelection.getState().select("pay", "diagram:le");
    renderProject("pay");
    expect(stops()).toEqual(["Ledger schema, diagram, edited 1 hour ago", NEW_CARD]);
  });

  it("a selection in another folder draws no ring in this view", () => {
    useHomeSelection.getState().select("empty", "diagram:le");
    renderProject("pay");
    expect(screen.queryByRole("button", { current: true })).toBeNull();
  });

  it("←→ — focus and selection move together to the previous·next card, stopping at the ends; Home·End (T15)", async () => {
    const user = userEvent.setup();
    renderProject("pay");
    act(() => mainOf("Checkout service").focus());
    await user.keyboard("{ArrowRight}");
    expect(mainOf("Ledger schema")).toHaveFocus();
    expect(mainOf("Ledger schema")).toHaveAttribute("aria-current", "true");
    expect(mainOf("Ledger schema")).toHaveAttribute("tabindex", "0");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(mainOf("Broken")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(mainOf("Checkout service")).toHaveFocus();
    expect(useHomeSelection.getState().key).toBe("diagram:co");
    await user.keyboard("{ArrowLeft}");
    expect(mainOf("Checkout service")).toHaveFocus();
    await user.keyboard("{End}");
    expect(mainOf("Broken")).toHaveFocus();
    expect(useHomeSelection.getState()).toMatchObject({ folder: "pay", key: "diagram:br" });
  });

  it("↑↓ — by the grid's column count (grid-template-columns at that moment) (T15)", async () => {
    const user = userEvent.setup();
    renderProject("pay");
    // two across: a narrow window, or 2 picked (#236)
    screen.getByRole("list", { name: "Items in Payments" }).style.gridTemplateColumns =
      "300px 300px";
    act(() => mainOf("Checkout service").focus());
    await user.keyboard("{ArrowDown}");
    expect(mainOf("Broken")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(mainOf("Broken")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(mainOf("Checkout service")).toHaveFocus();
    expect(useHomeSelection.getState().key).toBe("diagram:co");
  });

  it("↑↓ — three cards in 5 columns (including auto-fill's empty tracks) are one row, so it stays put (#236 R5)", async () => {
    const user = userEvent.setup();
    renderProject("pay");
    screen.getByRole("list", { name: "Items in Payments" }).style.gridTemplateColumns =
      "195px 195px 195px 195px 195px";
    act(() => mainOf("Ledger schema").focus());
    await user.keyboard("{ArrowDown}");
    expect(mainOf("Ledger schema")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(mainOf("Ledger schema")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(mainOf("Broken")).toHaveFocus();
  });

  it("Escape — clears the selection and keeps focus; not consumed when nothing is selected (T15)", async () => {
    const user = userEvent.setup();
    renderProject("pay");
    await user.click(mainOf("Ledger schema"));
    const pressEscape = () => fireEvent.keyDown(mainOf("Ledger schema"), { key: "Escape" });
    expect(pressEscape()).toBe(false);
    expect(useHomeSelection.getState().key).toBeNull();
    expect(mainOf("Ledger schema")).not.toHaveAttribute("aria-current");
    expect(mainOf("Ledger schema")).toHaveFocus();
    expect(pressEscape()).toBe(true);
  });

  it("the grid does not take arrows·Escape inside a card menu", async () => {
    const user = userEvent.setup();
    renderProject("pay");
    await user.click(mainOf("Ledger schema"));
    fireEvent.keyDown(mainOf("Ledger schema"), { key: "F10", shiftKey: true });
    const menu = screen.getByRole("menu", { name: "More for Ledger schema" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(useHomeSelection.getState().key).toBe("diagram:le");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(useHomeSelection.getState().key).toBe("diagram:le");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("card Delete — view unchanged, header focus, no selection left (#231 T7)", async () => {
    const user = userEvent.setup();
    mockedAsk.mockResolvedValue(true);
    const gone = library();
    gone[0]!.diagrams = gone[0]!.diagrams.filter((d) => d.id !== "le");
    mockedInvoke.mockImplementation(async (cmd) => (cmd === "list_library" ? gone : undefined));
    const { rerender } = renderProject("pay");
    const focus = useAppStore.getState().homeFocus;
    await user.click(mainOf("Ledger schema"));
    await user.click(within(card("Ledger schema")).getByRole("button", { name: /^More/ }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(calls("delete_project")[0]![1]).toEqual({ id: "le" }));
    await waitFor(() => expect(useAppStore.getState().homeFocus).toBe(focus + 1));
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
    rerender(<FolderView folder={folder("pay")} folders={useLibraryStore.getState().folders!} />);
    expect(screen.queryByRole("article", { name: "Ledger schema" })).toBeNull();
    expect(screen.queryByRole("button", { current: true })).toBeNull();
  });

  it("dashed card → New menu → in this project", async () => {
    const user = userEvent.setup();
    renderProject("pay");
    await user.click(screen.getByRole("button", { name: /^New diagram, Blank/ }));
    expect(screen.getByRole("menu", { name: "New in Payments" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Flowchart" }));
    await waitFor(() => expect(useAppStore.getState().view).toBe("editor"));
    expect(calls("save_project")[0]![1]).toMatchObject({ folder: "pay" });
    expect(useDiagramStore.getState().title).toBe("Flowchart");
  });

  it("empty project — a single dashed card", () => {
    renderProject("empty");
    const list = within(screen.getByRole("list", { name: "Items in Sketches" }));
    expect(list.queryAllByRole("article")).toHaveLength(0);
    expect(list.getByRole("button", { name: /^New diagram, Blank/ })).toBeInTheDocument();
  });

  it("stray project — diagram cards only: no dashed card, no ⋯·New ▾ (T13)", () => {
    renderProject("my-diagrams");
    expect(screen.queryByRole("button", { name: /^New diagram, Blank/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^New in / })).toBeNull();
    expect(screen.queryByRole("button", { name: "More for My Diagrams" })).toBeNull();
    const list = within(screen.getByRole("list", { name: "Items in My Diagrams" }));
    expect(list.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("article", { name: "Old" })).toBeInTheDocument();
  });

  it("a folder at the deepest level — the dashed card's description has no new folder (#229 D9)", () => {
    let deepest: FolderMeta = { id: "e10", name: "E10", updatedAt: now, diagrams: [], folders: [] };
    for (let k = 9; k >= 2; k--) {
      deepest = { id: `e${k}`, name: `E${k}`, updatedAt: now, diagrams: [], folders: [deepest] };
    }
    useLibraryStore.setState({ folders: [{ ...library()[0]!, folders: [deepest] }] });
    renderProject("e10");
    expect(
      screen.getByRole("button", {
        name: "New diagram, Blank, Flowchart, Sequence, Class, ERD or paste Mermaid",
      }),
    ).toBeInTheDocument();
  });
});

/** a folder at any depth on Home (#229 D5, D11, T39) */
describe("nested folder view (#229 D5, T39)", () => {
  const nested = (): FolderMeta[] => {
    const [pay, ...rest] = library();
    return [
      {
        ...pay!,
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
                updatedAt: now - 60_000,
                diagrams: [{ id: "x", title: "X", updatedAt: now - 60_000, readable: true }],
                folders: [],
              },
              {
                id: "arc",
                name: "Archive",
                updatedAt: now - 86_400_000,
                diagrams: [],
                folders: [],
              },
            ],
          },
        ],
      },
      ...rest,
    ];
  };
  let listing: FolderMeta[] = [];

  beforeEach(() => {
    useHomeSelection.getState().clear();
    resetAutosaveForTests();
    resetPreviewCacheForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    listing = nested();
    useLibraryStore.setState({ folders: nested(), readFailed: false });
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "list_library") return listing;
      if (cmd === "create_folder") return undefined;
      if (cmd === "load_project") {
        const { id } = args as { id: string };
        return JSON.stringify({ ...blankDoc(), title: id });
      }
      return undefined;
    });
  });

  it("without order, cards mix newest first (D8) — folder cards and diagram cards, dashed card at the end", () => {
    renderProject("chk");
    const list = within(screen.getByRole("list", { name: "Items in Checkout" }));
    expect(list.getAllByRole("article")).toHaveLength(3);
    expect(
      list
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"))
        .filter((n) => !n?.startsWith("Open ") && !n?.startsWith("More ")),
    ).toEqual([
      "Flows, folder, 1 item",
      expect.stringMatching(/^Order flow, diagram, edited/),
      "Archive, folder, 0 items",
      NEW_CARD,
    ]);
  });

  it("cards follow the same manual order as the sidebar — new items missing from order go first (#230 D15, T25)", () => {
    const withOrder = (fs: FolderMeta[]): FolderMeta[] =>
      fs.map((f) =>
        f.id === "chk"
          ? { ...f, order: ["folder:arc", "diagram:ord", "folder:flw"] }
          : { ...f, folders: withOrder(f.folders) },
      );
    useLibraryStore.setState({ folders: withOrder(nested()) });
    renderProject("chk");
    const list = within(screen.getByRole("list", { name: "Items in Checkout" }));
    expect(
      list
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"))
        .filter((n) => !n?.startsWith("Open ") && !n?.startsWith("More ")),
    ).toEqual([
      "Archive, folder, 0 items",
      expect.stringMatching(/^Order flow, diagram, edited/),
      "Flows, folder, 1 item",
      NEW_CARD,
    ]);
  });

  it("the project view mixes in folder cards too", () => {
    renderProject("pay");
    expect(screen.getByRole("button", { name: "Checkout, folder, 3 items" })).toBeInTheDocument();
  });

  it("dashed card New folder — view unchanged, the new card is first and selected, its name row is the name field (#231 D8, T20)", async () => {
    const user = userEvent.setup();
    mockedInvoke.mockImplementation(async (cmd, args) => {
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
    });
    showHomeTab({ kind: "folder", folder: "chk" });
    // in Home's sheet: the dashed card keeps the focus until the new card's field takes it (#231 W1)
    render(
      <main>
        <Live id="chk" />
      </main>,
    );
    await user.click(screen.getByRole("button", { name: NEW_CARD }));
    await user.click(screen.getByRole("menuitem", { name: "New folder" }));
    const input = await screen.findByRole("textbox", { name: "Folder name" });
    const list = screen.getByRole("list", { name: "Items in Checkout" });
    const first = within(list).getAllByRole("article")[0]!;
    expect(first).toContainElement(input);
    expect(first).toHaveClass("ring-[1.5px]", "ring-ink");
    expect(input).toHaveFocus();
    expect(input).toHaveValue("New folder");
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
    // the name is selected as the field takes focus: typing replaces it
    await user.keyboard("Specs{Enter}");
    const { id } = calls("create_folder")[0]![1] as { id: string };
    await waitFor(() => expect(calls("rename_folder")[0]![1]).toEqual({ id, name: "Specs" }));
    const main = within(first).getByRole("button", { name: /^New folder, folder, 0 items$/ });
    await waitFor(() => expect(main).toHaveFocus());
    expect(main).toHaveAttribute("aria-current", "true");
  });

  it("after card Move to…, focus goes to a remaining neighbor card — not dropped to body (#229)", async () => {
    const user = userEvent.setup();
    renderProject("chk");
    await user.click(screen.getByRole("button", { name: "More for Order flow" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to…" }));
    const picker = screen.getByRole("tree", { name: "Move to" });
    await user.click(
      within(picker)
        .getByRole("treeitem", { name: "Payments, project" })
        .querySelector("[data-row]")!,
    );
    await waitFor(() => expect(calls("move_project")).toHaveLength(1));
    // the card after it: Archive (Flows · Order flow · Archive) — focus and selection go together
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Archive, folder, 0 items" }),
      ),
    );
    expect(useHomeSelection.getState()).toMatchObject({ folder: "chk", key: "folder:arc" });
  });
});
