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
import { likeRust } from "../../../test/rustAnswers";

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
/** the view Home shows, as Home picks it: the folder the app's Home view names */
const Home265 = () => {
  const folders = useLibraryStore((s) => s.folders)!;
  const view = useAppStore((s) => s.homeView);
  const id = view.kind === "folder" ? view.folder : "pay";
  return <FolderView key={id} folder={findFolder(folders, id)!.folder} folders={folders} />;
};
/** the view as Home draws it: the folder and the listing from the store, as they change */
const Live = ({ id }: { id: string }) => {
  const folders = useLibraryStore((s) => s.folders)!;
  return <FolderView folder={findFolder(folders, id)!.folder} folders={folders} />;
};

describe("project view (#220 D11, T27)", () => {
  beforeEach(() => {
    useHomeMode.setState({ size: null });
    resetAutosaveForTests();
    resetPreviewCacheForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    useLibraryStore.setState({ folders: library(), readFailed: false });
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
    mockedInvoke.mockImplementation(
      likeRust(async (cmd, args) => {
        if (cmd === "list_library") return library();
        if (cmd === "load_project") {
          const { id } = args as { id: string };
          return JSON.stringify({ ...blankDoc(), title: id });
        }
        return undefined;
      }),
    );
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

  it("one click on a card opens it — a diagram in its tab, no selection kept (#265)", async () => {
    const user = userEvent.setup();
    renderProject("pay");
    await user.click(mainOf("Ledger schema"));
    await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("le"));
    expect(useAppStore.getState().view).toBe("editor");
    expect(screen.queryByRole("button", { current: true })).toBeNull();
    expect(card("Ledger schema").className).not.toMatch(/ring-\[1\.5px\]/);
  });

  it("one Tab stop — the first card, then the card the focus went to last; the dashed card is separate (T15)", () => {
    renderProject("pay");
    const stops = () =>
      within(screen.getByRole("list", { name: "Items in Payments" }))
        .getAllByRole("button")
        .filter((b) => b.tabIndex === 0)
        .map((b) => b.getAttribute("aria-label"));
    expect(stops()).toEqual(["Checkout service, diagram, edited 2 min ago", NEW_CARD]);
    act(() => mainOf("Ledger schema").focus());
    expect(stops()).toEqual(["Ledger schema, diagram, edited 1 hour ago", NEW_CARD]);
  });

  it("the Tab stop goes back to the first card when the card that had it leaves the view", () => {
    const { rerender } = renderProject("pay");
    act(() => mainOf("Ledger schema").focus());
    expect(mainOf("Ledger schema")).toHaveAttribute("tabindex", "0");
    const gone = library();
    gone[0]!.diagrams = gone[0]!.diagrams.filter((d) => d.id !== "le");
    act(() => useLibraryStore.setState({ folders: gone }));
    rerender(<FolderView folder={folder("pay")} folders={useLibraryStore.getState().folders!} />);
    expect(mainOf("Checkout service")).toHaveAttribute("tabindex", "0");
    expect(mainOf("Broken")).toHaveAttribute("tabindex", "-1");
  });

  it("←→ — the focus and the Tab stop move to the previous·next card, stopping at the ends; Home·End (T15)", async () => {
    const user = userEvent.setup();
    renderProject("pay");
    act(() => mainOf("Checkout service").focus());
    await user.keyboard("{ArrowRight}");
    expect(mainOf("Ledger schema")).toHaveFocus();
    expect(mainOf("Ledger schema")).toHaveAttribute("tabindex", "0");
    expect(mainOf("Checkout service")).toHaveAttribute("tabindex", "-1");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(mainOf("Broken")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(mainOf("Checkout service")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(mainOf("Checkout service")).toHaveFocus();
    await user.keyboard("{End}");
    expect(mainOf("Broken")).toHaveFocus();
    expect(mainOf("Broken")).toHaveAttribute("tabindex", "0");
    // the arrows only move — nothing opened
    expect(useAppStore.getState().view).toBe("home");
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

  it("Escape is not the grid's — nothing to let go, the key goes on (#265)", () => {
    renderProject("pay");
    act(() => mainOf("Ledger schema").focus());
    expect(fireEvent.keyDown(mainOf("Ledger schema"), { key: "Escape" })).toBe(true);
    expect(mainOf("Ledger schema")).toHaveFocus();
  });

  it("the grid does not take arrows inside a card menu", () => {
    renderProject("pay");
    act(() => mainOf("Ledger schema").focus());
    fireEvent.keyDown(mainOf("Ledger schema"), { key: "F10", shiftKey: true });
    const menu = screen.getByRole("menu", { name: "More for Ledger schema" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(mainOf("Broken")).not.toHaveFocus();
    expect(mainOf("Ledger schema")).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("card Delete — view unchanged, header focus (#231 T7)", async () => {
    const user = userEvent.setup();
    mockedAsk.mockResolvedValue(true);
    const gone = library();
    gone[0]!.diagrams = gone[0]!.diagrams.filter((d) => d.id !== "le");
    mockedInvoke.mockImplementation(
      likeRust(async (cmd) => (cmd === "list_library" ? gone : undefined)),
    );
    const { rerender } = renderProject("pay");
    const focus = useAppStore.getState().homeFocus;
    await user.click(within(card("Ledger schema")).getByRole("button", { name: /^More/ }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(calls("delete_project")[0]![1]).toEqual({ id: "le" }));
    await waitFor(() => expect(useAppStore.getState().homeFocus).toBe(focus + 1));
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
    rerender(<FolderView folder={folder("pay")} folders={useLibraryStore.getState().folders!} />);
    expect(screen.queryByRole("article", { name: "Ledger schema" })).toBeNull();
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
    resetAutosaveForTests();
    resetPreviewCacheForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    listing = nested();
    useLibraryStore.setState({ folders: nested(), readFailed: false });
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
    mockedInvoke.mockImplementation(
      likeRust(async (cmd, args) => {
        if (cmd === "list_library") return listing;
        if (cmd === "create_folder") return undefined;
        if (cmd === "load_project") {
          const { id } = args as { id: string };
          return JSON.stringify({ ...blankDoc(), title: id });
        }
        return undefined;
      }),
    );
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

  it("dashed card New folder — view unchanged, the new card is first, its caption bar's name is the name field (#231 D8, T20)", async () => {
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
    expect(first.querySelector("[data-caption-bar]")).toContainElement(input);
    expect(first.className).not.toMatch(/ring-\[1\.5px\]/);
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
    expect(main).toHaveAttribute("tabindex", "0");
    expect(main).not.toHaveAttribute("aria-current");
  });

  it("a double click on a folder card enters it once — its second click on the new view's dashed card opens no menu", () => {
    showHomeTab({ kind: "folder", folder: "pay" });
    render(<Home265 />);
    const archive = screen.getByRole("button", { name: /^Checkout, folder/ });
    // the first click: into Checkout, whose view draws its own cards in the same places
    fireEvent.mouseDown(archive, { detail: 1 });
    fireEvent.click(archive, { detail: 1 });
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
    // the second press of the same double click lands on whatever is there now
    const under = screen.getByRole("button", { name: NEW_CARD });
    fireEvent.mouseDown(under, { detail: 2 });
    fireEvent.click(under, { detail: 2 });
    fireEvent.doubleClick(under, { detail: 2 });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
    // a new click is a click again
    fireEvent.mouseDown(under, { detail: 1 });
    fireEvent.click(under, { detail: 1 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
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
    // the card after it: Archive (Flows · Order flow · Archive) — the focus and the Tab stop go together
    const archive = () => screen.getByRole("button", { name: "Archive, folder, 0 items" });
    await waitFor(() => expect(document.activeElement).toBe(archive()));
    expect(archive()).toHaveAttribute("tabindex", "0");
  });
});
