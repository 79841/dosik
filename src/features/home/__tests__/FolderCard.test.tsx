import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "../../library/appStore";
import type { FolderMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { findFolder } from "../../library/libraryTree";
import { resetTabsForTests, showHomeTab } from "../../library/tabActions";
import { FolderCard } from "../FolderCard";
import { showInLabel } from "../../library/fileManager";

/** "Show in …" as this web view names its file manager (#238 D10) */
const SHOW_IN = showInLabel();

const mockedInvoke = vi.mocked(invoke);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);

const library = (): FolderMeta[] => [
  {
    id: "pay",
    name: "Payments",
    updatedAt: 5,
    diagrams: [],
    folders: [
      {
        id: "chk",
        name: "Checkout",
        updatedAt: 5,
        diagrams: [
          { id: "a", title: "A", updatedAt: 5, readable: true },
          { id: "b", title: "B", updatedAt: 4, readable: true },
        ],
        folders: [{ id: "flw", name: "Flows", updatedAt: 3, diagrams: [], folders: [] }],
      },
    ],
  },
  { id: "onb", name: "Onboarding", updatedAt: 1, diagrams: [], folders: [] },
];

const folder = (id: string) => findFolder(useLibraryStore.getState().folders!, id)!.folder;
const show = ({ stop = true }: { stop?: boolean } = {}) =>
  render(
    <ul>
      <FolderCard
        folder={folder("chk")}
        parent={folder("pay")}
        folders={useLibraryStore.getState().folders!}
        stop={stop}
      />
    </ul>,
  );
const card = () => screen.getByRole("article", { name: "Checkout" });
const main = () => screen.getByRole("button", { name: "Checkout, folder, 3 items" });

/** a folder on Home (#229 D5, #231 D8, card C — `Home-States` folder card states) */
describe("folder card (card C, one click opens)", () => {
  beforeEach(() => {
    resetTabsForTests();
    useAppStore.setState({ folderRenameRequest: null });
    useLibraryStore.setState({ folders: library(), readFailed: false });
    showHomeTab({ kind: "folder", folder: "pay" });
    vi.mocked(ask).mockReset();
    vi.mocked(ask).mockResolvedValue(false);
    mockedInvoke.mockImplementation(async (cmd) =>
      cmd === "list_library" ? library() : undefined,
    );
  });

  it("canvas look — card C: a hairline, a full-bleed frame well with Folder 36, the caption bar", () => {
    show();
    expect(card()).toHaveClass("rounded-lg", "bg-surface", "outline-[0.5px]", "outline-edge");
    expect(card()).toHaveClass("hover:outline-dash");
    expect(card().className).not.toMatch(/shadow-raised|shadow-lifted|ring-\[1\.5px\]/);
    const well = card().querySelector("[data-folder-well]") as HTMLElement;
    // the well keeps 15:8, full bleed (#236 R5, Home-States 2)
    expect(well).toHaveClass("aspect-[15/8]", "bg-frame");
    expect(well).not.toHaveClass("rounded-[6px]");
    const icon = well.querySelector("svg") as SVGElement;
    // a folder, blue over its tint (#236 R2, T4)
    expect(icon).toHaveClass("text-glyph-folder", "fill-glyph-folder-soft");
    expect(icon).toHaveAttribute("width", "36");
    expect(icon).toHaveAttribute("stroke-width", "1.5");
    // the caption bar: the folder glyph 16, the name, what it holds
    const bar = card().querySelector("[data-caption-bar]") as HTMLElement;
    expect(bar).toHaveClass("h-10", "border-t-[0.5px]", "border-edge");
    const glyph = bar.querySelector("svg") as SVGElement;
    expect(glyph).toHaveClass("text-glyph-folder");
    expect(glyph).toHaveAttribute("width", "16");
    expect(within(bar).getByText("Checkout")).toHaveClass("text-[12px]", "font-semibold");
    expect(within(bar).getByText("3 items")).toHaveClass("text-[11px]", "text-muted-strong");
  });

  it("main button — name '{name}, folder, N items', shortcuts, roving, an empty folder is '0 items'", () => {
    show();
    expect(main()).toHaveAttribute("aria-keyshortcuts", "Enter Shift+F10");
    expect(main()).toHaveAttribute("tabindex", "0");
    expect(main()).not.toHaveAttribute("aria-current");
  });

  it("Open pill·More — for pointers", () => {
    show({ stop: false });
    expect(main()).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "Open Checkout" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "More for Checkout" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it.each([
    ["one click on the well", () => fireEvent.click(card().querySelector("[data-folder-well]")!)],
    [
      "one click on the caption bar",
      () => fireEvent.click(card().querySelector("[data-caption-bar]")!),
    ],
    ["Enter", () => fireEvent.keyDown(main(), { key: "Enter" })],
    ["Open pill", () => fireEvent.click(screen.getByRole("button", { name: "Open Checkout" }))],
  ])("%s → that folder's view, requests header focus (#220 D16)", (_, act) => {
    show();
    const focus = useAppStore.getState().homeFocus;
    act();
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
    expect(useAppStore.getState().homeFocus).toBe(focus + 1);
  });

  it("a double click enters once — its second click (detail 2) lands on the new view and opens nothing", () => {
    show();
    const focus = useAppStore.getState().homeFocus;
    fireEvent.click(main(), { detail: 1 });
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
    fireEvent.click(main(), { detail: 2 });
    expect(useAppStore.getState().homeFocus).toBe(focus + 1);
    act(() => showHomeTab({ kind: "folder", folder: "pay" }));
    fireEvent.click(main(), { detail: 2 });
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
  });

  it("double-pressing the Open pill opens only once — the second click (detail 2) does not open even if it lands on the pill in the same spot of the new view (#231 D7)", () => {
    show();
    const open = screen.getByRole("button", { name: "Open Checkout" });
    const focus = useAppStore.getState().homeFocus;
    fireEvent.click(open, { detail: 1 });
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
    // the second click of the double click: no second open
    fireEvent.click(open, { detail: 2 });
    expect(useAppStore.getState().homeFocus).toBe(focus + 1);
    act(() => showHomeTab({ kind: "folder", folder: "pay" }));
    fireEvent.click(open, { detail: 2 });
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
  });

  it("More — same list as the sidebar folder row (New diagram · New folder · Rename · Move to… · Delete)", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "More for Checkout" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "New diagram",
      "New folder",
      SHOW_IN,
      "Copy Path",
      "Rename",
      "Move to…",
      "Delete",
    ]);
  });

  it("Shift+F10 → More menu, Escape → main button", () => {
    show();
    fireEvent.keyDown(main(), { key: "F10", shiftKey: true });
    fireEvent.keyDown(screen.getByRole("menu", { name: "More for Checkout" }), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(main()).toHaveFocus();
  });

  it("Move to… — picker in folder mode, choosing calls move_folder", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "More for Checkout" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to…" }));
    const picker = screen.getByRole("tree", { name: "Move to" });
    await user.click(
      within(picker)
        .getByRole("treeitem", { name: "Onboarding, project" })
        .querySelector("[data-row]")!,
    );
    await waitFor(() => expect(calls("move_folder")).toHaveLength(1));
    expect(calls("move_folder")[0]![1]).toMatchObject({ id: "chk", parent: "onb" });
  });

  it("Rename → the card's name row becomes an input, Enter → renameFolderTo, then main button (T18)", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "More for Checkout" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = within(card()).getByRole("textbox", { name: "Folder name" });
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Checkout");
    expect(input).toHaveClass("h-[22px]", "text-[12px]");
    // the field is open: no Open pill and no More (Home-States 3)
    expect(within(card()).queryByRole("button", { name: "Open Checkout" })).toBeNull();
    expect(within(card()).queryByRole("button", { name: "More for Checkout" })).toBeNull();
    await user.keyboard("Cart{Enter}");
    await waitFor(() => expect(calls("rename_folder")[0]![1]).toEqual({ id: "chk", name: "Cart" }));
    expect(within(card()).queryByRole("textbox")).toBeNull();
    expect(main()).toHaveFocus();
    // …and they come back with the name
    expect(within(card()).getByRole("button", { name: "Open Checkout" })).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: "More for Checkout" })).toBeInTheDocument();
  });

  it("Escape during Rename — name unchanged, focus to the main button", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "More for Checkout" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    await user.keyboard("Cart{Escape}");
    expect(calls("rename_folder")).toHaveLength(0);
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
    await waitFor(() => expect(main()).toHaveFocus());
  });

  it("a right-click while the name field is open opens no menu — the field keeps the system's own", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "More for Checkout" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = within(card()).getByRole("textbox", { name: "Folder name" });
    expect(fireEvent.contextMenu(input)).toBe(true);
    fireEvent.contextMenu(card().querySelector("[data-folder-well]")!);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a right-click on the card opens the folder menu — the sidebar row's list", () => {
    show();
    fireEvent.contextMenu(card().querySelector("[data-folder-well]")!, {
      clientX: 40,
      clientY: 50,
    });
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "New diagram",
      "New folder",
      SHOW_IN,
      "Copy Path",
      "Rename",
      "Move to…",
      "Delete",
    ]);
  });

  it("pressing or double-pressing the name input does not enter the folder", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "More for Checkout" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = within(card()).getByRole("textbox", { name: "Folder name" });
    fireEvent.doubleClick(input);
    await act(async () => {});
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
    expect(input).toHaveFocus();
  });

  it("clicking elsewhere on the card (the well) while the name field is open does not enter (#231 S1)", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "More for Checkout" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.click(card().querySelector("[data-folder-well]")!);
    fireEvent.doubleClick(card().querySelector("[data-folder-well]")!);
    await act(async () => {});
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
    expect(within(card()).getByRole("textbox", { name: "Folder name" })).toBeInTheDocument();
  });

  it("resting look while the name field is open — no hover, no press, the field in the caption bar, the focus ring kept (Home-States 3, #231 D8)", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "More for Checkout" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = within(card()).getByRole("textbox", { name: "Folder name" });
    expect(input).toHaveFocus();
    expect(card().querySelector("[data-caption-bar]")).toContainElement(input);
    expect(card()).toHaveClass("outline-edge");
    expect(card().className).not.toMatch(/hover:|active:/);
    expect(card()).toHaveClass(
      "has-[:focus-visible]:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--focus)]",
    );
    // the count stays in the bar beside the field
    expect(within(card()).getByText("3 items")).toBeInTheDocument();
  });

  it("takes a rename request for this card's folder — name field, request taken only once (#231 D8, T18)", async () => {
    useAppStore.getState().requestFolderRename("chk");
    const first = show();
    const input = await within(card()).findByRole("textbox", { name: "Folder name" });
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Checkout");
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
    expect(card().querySelector("[data-card-controls]")).toBeNull();
    first.unmount();
    show();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("leaves requests for other folders alone", () => {
    useAppStore.getState().requestFolderRename("flw");
    show();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(useAppStore.getState().folderRenameRequest?.id).toBe("flw");
  });

  it("takes and discards a request made on another screen — does not open the name field (#231 C1)", () => {
    useAppStore.setState({
      folderRenameRequest: {
        id: "chk",
        asked: { view: "home", activeTab: null, homeView: { kind: "folder", folder: "onb" } },
      },
    });
    show();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
  });

  it("More New folder — creates it inside this card's folder, goes to that folder's view and requests the name field (D8)", async () => {
    const user = userEvent.setup();
    const listing = library();
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "create_folder") {
        const { id } = args as { id: string };
        const chk = findFolder(listing, "chk")!.folder;
        chk.folders = [
          { id, name: "New folder", updatedAt: 9, diagrams: [], folders: [] },
          ...chk.folders,
        ];
      }
      return cmd === "list_library" ? structuredClone(listing) : undefined;
    });
    show();
    const focus = useAppStore.getState().homeFocus;
    await user.click(screen.getByRole("button", { name: "More for Checkout" }));
    await user.click(screen.getByRole("menuitem", { name: "New folder" }));
    await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
    const { id, parent } = calls("create_folder")[0]![1] as { id: string; parent?: string };
    expect(parent).toBe("chk");
    await waitFor(() => expect(useAppStore.getState().folderRenameRequest?.id).toBe(id));
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
    expect(useAppStore.getState().homeFocus).toBe(focus + 1);
  });

  it("Delete — after deleting, requests the view's header focus (view unchanged)", async () => {
    const user = userEvent.setup();
    vi.mocked(ask).mockResolvedValue(true);
    show();
    const focus = useAppStore.getState().homeFocus;
    await user.click(screen.getByRole("button", { name: "More for Checkout" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(calls("delete_folder")[0]![1]).toEqual({ id: "chk" }));
    await waitFor(() => expect(useAppStore.getState().homeFocus).toBe(focus + 1));
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
  });
});
