import { invoke } from "@tauri-apps/api/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "../../library/appStore";
import type { FolderMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { findFolder } from "../../library/libraryTree";
import { resetTabsForTests, showHomeTab } from "../../library/tabActions";
import { useHomeMode } from "../homeMode";
import { useHomeSelection } from "../homeSelection";
import { startDiagram } from "../newDiagram";
import { NewMenu } from "../NewMenu";

vi.mock("../newDiagram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../newDiagram")>()),
  startDiagram: vi.fn(),
}));
vi.mock("../../../shared/lib/systemClipboard", () => ({
  readClipboardText: vi.fn(async () => null),
}));

const mockedStart = vi.mocked(startDiagram);
const mockedInvoke = vi.mocked(invoke);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);

/** Payments › Checkout, and E2 … E10 — the deepest level, where no folder can go */
const library = (): FolderMeta[] => {
  let deepest: FolderMeta = { id: "e10", name: "E10", updatedAt: 1, diagrams: [], folders: [] };
  for (let k = 9; k >= 2; k--) {
    deepest = { id: `e${k}`, name: `E${k}`, updatedAt: 1, diagrams: [], folders: [deepest] };
  }
  return [
    {
      id: "pay",
      name: "Payments",
      updatedAt: 5,
      diagrams: [],
      folders: [{ id: "chk", name: "Checkout", updatedAt: 5, diagrams: [], folders: [] }],
    },
    { id: "e1", name: "E1", updatedAt: 1, diagrams: [], folders: [deepest] },
  ];
};

/**
 * The New menu (#231 D9, Q2, `Home-States` 1): one menu for the header's
 * New ▾, the dashed card and the board's + — START's six, a rule, New folder.
 */
describe("New menu (#231 D9, T20)", () => {
  let listing: FolderMeta[] = [];
  beforeEach(() => {
    mockedStart.mockReset();
    resetTabsForTests();
    useHomeSelection.getState().clear();
    useAppStore.setState({ folderRenameRequest: null });
    useHomeMode.setState({ mode: "cards" });
    listing = library();
    useLibraryStore.setState({ folders: library(), readFailed: false });
    showHomeTab({ kind: "folder", folder: "pay" });
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "create_folder") {
        const { id } = args as { id: string };
        const pay = findFolder(listing, "pay")!.folder;
        pay.folders = [
          { id, name: "New folder", updatedAt: 9, diagrams: [], folders: [] },
          ...pay.folders,
        ];
      }
      if (cmd === "list_library") return structuredClone(listing);
      return undefined;
    });
  });

  /** opened from Home's sheet — the header's New ▾, the dashed card */
  const open = (id = "pay") => {
    const onClose = vi.fn();
    const sheet = document.createElement("main");
    const opener = document.createElement("button");
    sheet.append(opener);
    document.body.append(sheet);
    const folders = useLibraryStore.getState().folders!;
    render(
      <NewMenu
        at={{ x: 0, y: 0 }}
        folder={findFolder(folders, id)!.folder}
        folders={folders}
        opener={{ current: opener }}
        onClose={onClose}
      />,
    );
    return { onClose, opener };
  };
  const labels = () => screen.getAllByRole("menuitem").map((i) => i.textContent);

  it("named 'New in {name}' — six START items, a separator, New folder (FolderPlus)", () => {
    open();
    const menu = screen.getByRole("menu", { name: "New in Payments" });
    expect(labels()).toEqual([
      "Blank diagram",
      "Flowchart",
      "Sequence",
      "Class",
      "ERD",
      "From Mermaid…",
      "New folder",
    ]);
    const folder = screen.getByRole("menuitem", { name: "New folder" });
    // the one rule, right before New folder
    expect(menu.querySelectorAll("hr")).toHaveLength(1);
    expect(folder.previousElementSibling?.tagName).toBe("HR");
    expect(folder.querySelector("svg")).toHaveClass("lucide-folder-plus");
  });

  it("the deepest level has neither New folder nor the separator (#229 D9)", () => {
    open("e10");
    expect(screen.getByRole("menu", { name: "New in E10" })).toBeInTheDocument();
    expect(labels()).not.toContain("New folder");
    expect(screen.getByRole("menu").querySelector("hr")).toBeNull();
  });

  it("choosing a kind creates that kind in this folder", async () => {
    const user = userEvent.setup();
    const { onClose, opener } = open();
    await user.click(screen.getByRole("menuitem", { name: "Sequence" }));
    expect(mockedStart).toHaveBeenCalledWith("sequence", "pay");
    expect(onClose).toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });

  it("From Mermaid… opens the dialog — on close, focus returns to the opening button", async () => {
    const user = userEvent.setup();
    const { onClose, opener } = open();
    await user.click(screen.getByRole("menuitem", { name: "From Mermaid…" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "New diagram from Mermaid" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });

  it("New folder — creates it in this folder and keeps the view, selects the new card and requests its name field (D8)", async () => {
    const user = userEvent.setup();
    const { onClose, opener } = open();
    await user.click(screen.getByRole("menuitem", { name: "New folder" }));
    expect(onClose).toHaveBeenCalled();
    // until the card's field takes it
    expect(opener).toHaveFocus();
    await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
    const { id, parent } = calls("create_folder")[0]![1] as { id: string; parent?: string };
    expect(parent).toBe("pay");
    await waitFor(() => expect(useAppStore.getState().folderRenameRequest?.id).toBe(id));
    expect(useHomeSelection.getState()).toMatchObject({ folder: "pay", key: `folder:${id}` });
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
  });

  it("if the user moved to another folder meanwhile — neither selects nor requests the name field (#218 D15)", async () => {
    const user = userEvent.setup();
    const serve = mockedInvoke.getMockImplementation()!;
    // the disk answers a little late
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "create_folder") await new Promise((r) => setTimeout(r, 40));
      return serve(cmd, args);
    });
    open();
    await user.click(screen.getByRole("menuitem", { name: "New folder" }));
    act(() => showHomeTab({ kind: "folder", folder: "chk" }));
    await waitFor(() => expect(calls("list_library").length).toBeGreaterThan(0));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
    expect(useHomeSelection.getState().key).toBeNull();
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
  });

  /** the disk answers a little late — what the user does meanwhile is `meanwhile` */
  const makeSlowly = async (meanwhile: () => void) => {
    const user = userEvent.setup();
    const serve = mockedInvoke.getMockImplementation()!;
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "create_folder") await new Promise((r) => setTimeout(r, 40));
      return serve(cmd, args);
    });
    open();
    await user.click(screen.getByRole("menuitem", { name: "New folder" }));
    act(meanwhile);
    await waitFor(() => expect(calls("list_library").length).toBeGreaterThan(0));
    await act(() => new Promise((r) => setTimeout(r, 20)));
  };

  it("if focus left the sheet meanwhile (a tree name field) — neither selects nor requests the name field (#231 W1)", async () => {
    const field = document.createElement("input");
    document.body.append(field);
    await makeSlowly(() => field.focus());
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
    expect(useHomeSelection.getState().key).toBeNull();
    expect(field).toHaveFocus();
    field.remove();
  });

  it("if the user switched to Canvas meanwhile — does not request the name field (#231 C1)", async () => {
    await makeSlowly(() => useHomeMode.getState().setMode("canvas"));
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
  });
});
