import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { describe, expect, it, vi } from "vitest";

import {
  Copy,
  FolderInput,
  FolderMinus,
  FolderPlus,
  FolderSearch,
  Locate,
  SquareArrowOutUpRight,
  SquarePlus,
  Trash2,
} from "lucide-react";

import { useAppStore } from "../appStore";
import { DASHBOARD } from "../homeView";
import type { FolderMeta } from "../libraryApi";
import { diagramMenuItems, folderMenuItems, projectsMenuItems } from "../libraryMenus";
import { useLibraryStore } from "../libraryStore";
import { showInLabel } from "../fileManager";

/** "Show in …" as this web view names its file manager (#238 D10) */
const SHOW_IN = showInLabel();

const folder = (): FolderMeta => ({
  folders: [],
  id: "work",
  name: "Work",
  updatedAt: 1,
  diagrams: [{ id: "p1", title: "Checkout", updatedAt: 1, readable: true }],
});
/** label, with "—" for a rule before it — the menu as the canvas draws it */
const shape = (items: ReturnType<typeof diagramMenuItems>) =>
  items.flatMap((i) => (i.separatorBefore ? ["—", i.label] : [i.label]));
const item = (items: ReturnType<typeof diagramMenuItems>, label: string) =>
  items.find((i) => i.label === label)!;
/** Show in Finder · Copy Path, a group of their own before Rename (#238 R2) */
const FINDER = ["—", SHOW_IN, "Copy Path"];

describe("row menu items — the tree and Home share one list (#217 D10, #220 D11, #229 D11)", () => {
  it("project/folder = New diagram · New folder · — · Show in Finder · Copy Path · — · Rename · — · Delete", () => {
    const rename = vi.fn();
    const newFolder = vi.fn();
    const items = folderMenuItems(folder(), rename, { newFolder });
    expect(shape(items)).toEqual([
      "New diagram",
      "New folder",
      ...FINDER,
      "—",
      "Rename",
      "—",
      "Delete",
    ]);
    item(items, "New folder").onSelect();
    expect(newFolder).toHaveBeenCalled();
    item(items, "Rename").onSelect();
    expect(rename).toHaveBeenCalled();
    expect(item(items, "Rename").takesFocus).toBe(true);
    expect(item(items, "Delete").danger).toBe(true);
  });

  it("without New folder that item is absent — the canvas frame menu (#229 D18)", () => {
    const extra = { label: "Collapse", onSelect: vi.fn() };
    const items = folderMenuItems(folder(), vi.fn(), { afterRename: [extra] });
    expect(shape(items)).toEqual([
      "New diagram",
      ...FINDER,
      "—",
      "Rename",
      "Collapse",
      "—",
      "Delete",
    ]);
  });

  it("diagram = Open · — · Show in Finder · Copy Path · — · Rename · Move to… · — · Delete — no Move when there is nowhere to move", () => {
    const diagram = folder().diagrams[0]!;
    const picker = vi.fn();
    const items = diagramMenuItems(diagram, picker);
    expect(shape(items)).toEqual(["Open", ...FINDER, "—", "Rename", "Move to…", "—", "Delete"]);
    // Rename's title field takes the focus (or the caller does, when it fails)
    expect(item(items, "Rename").takesFocus).toBe(true);
    // Move to… opens the picker beside the menu (#229 D13)
    expect(item(items, "Move to…").picker).toBe(picker);
    expect(shape(diagramMenuItems(diagram, null))).toEqual([
      "Open",
      ...FINDER,
      "—",
      "Rename",
      "—",
      "Delete",
    ]);
  });

  it("folder Move to… — after Rename, opens the side picker (#230 D11·D12)", () => {
    const picker = vi.fn();
    const items = folderMenuItems(folder(), vi.fn(), { newFolder: vi.fn(), move: picker });
    expect(shape(items)).toEqual([
      "New diagram",
      "New folder",
      ...FINDER,
      "—",
      "Rename",
      "Move to…",
      "—",
      "Delete",
    ]);
    expect(item(items, "Move to…").picker).toBe(picker);
    expect(item(items, "Move to…").takesFocus).toBe(true);
  });

  it("icons match the canvas menu — New diagram square-plus, New folder folder-plus, Open square-arrow-out-up-right (#230 D11)", () => {
    const items = folderMenuItems(folder(), vi.fn(), { newFolder: vi.fn() });
    expect(items[0]!.icon).toBe(SquarePlus);
    expect(items[1]!.icon).toBe(FolderPlus);
    expect(diagramMenuItems(folder().diagrams[0]!, null)[0]!.icon).toBe(SquareArrowOutUpRight);
  });

  it("Show in Finder folder-search, Copy Path copy (#238 R2)", () => {
    for (const items of [
      folderMenuItems(folder(), vi.fn()),
      diagramMenuItems(folder().diagrams[0]!, null),
    ]) {
      expect(item(items, SHOW_IN).icon).toBe(FolderSearch);
      expect(item(items, "Copy Path").icon).toBe(Copy);
    }
  });
});

describe("what Show in Finder · Copy Path point at (#238 T5·T6)", () => {
  const mockedInvoke = vi.mocked(invoke);

  it("the folder menu points at that folder — kind folder, its id", () => {
    mockedInvoke.mockReset();
    const items = folderMenuItems(folder(), vi.fn());
    item(items, SHOW_IN).onSelect();
    expect(mockedInvoke).toHaveBeenLastCalledWith("show_in_finder", { kind: "folder", id: "work" });
    item(items, "Copy Path").onSelect();
    expect(mockedInvoke).toHaveBeenLastCalledWith("library_path", { kind: "folder", id: "work" });
  });

  it("the diagram menu points at that file — kind diagram, its id", () => {
    mockedInvoke.mockReset();
    const items = diagramMenuItems(folder().diagrams[0]!, null);
    item(items, SHOW_IN).onSelect();
    expect(mockedInvoke).toHaveBeenLastCalledWith("show_in_finder", { kind: "diagram", id: "p1" });
    item(items, "Copy Path").onSelect();
    expect(mockedInvoke).toHaveBeenLastCalledWith("library_path", { kind: "diagram", id: "p1" });
  });
});

describe("the menu's 'Show in …' follows the webview's operating system (#238 D10)", () => {
  it.each([
    [
      "macOS",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      "Show in Finder",
    ],
    [
      "Windows",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      "Show in File Explorer",
    ],
  ])("%s → %s", (_, ua, label) => {
    const agent = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
    try {
      expect(folderMenuItems(folder(), vi.fn()).map((i) => i.label)).toContain(label);
      expect(diagramMenuItems(folder().diagrams[0]!, null).map((i) => i.label)).toContain(label);
    } finally {
      agent.mockRestore();
    }
  });
});

describe("a project not found, a folder added from elsewhere (#253 R7·R8, Sidebar-Library ②③, Sidebar-States ①)", () => {
  const mockedInvoke = vi.mocked(invoke);
  const lost = (): FolderMeta => ({ ...folder(), diagrams: [], missing: true });
  const added = (): FolderMeta => ({ ...folder(), added: true });

  it("not found: Locate… · — · Remove from Library, whatever else the caller offers", () => {
    const items = folderMenuItems(lost(), vi.fn(), {
      newFolder: vi.fn(),
      move: vi.fn(),
      afterRename: [{ label: "Collapse", onSelect: vi.fn() }],
    });
    expect(shape(items)).toEqual(["Locate…", "—", "Remove from Library"]);
    expect(item(items, "Locate…").icon).toBe(Locate);
    expect(item(items, "Remove from Library").icon).toBe(FolderMinus);
    // it removes a record, not files: no danger tint
    expect(item(items, "Remove from Library").danger).toBeFalsy();
  });

  it("added from elsewhere: the menu ends in Remove from Library in place of Delete", () => {
    const items = folderMenuItems(added(), vi.fn(), { newFolder: vi.fn() });
    expect(shape(items)).toEqual([
      "New diagram",
      "New folder",
      ...FINDER,
      "—",
      "Rename",
      "—",
      "Remove from Library",
    ]);
    expect(item(items, "Remove from Library").icon).toBe(FolderMinus);
    // in the default location it keeps Delete, to the Trash
    const kept = folderMenuItems(folder(), vi.fn());
    expect(item(kept, "Delete").icon).toBe(Trash2);
    expect(kept.some((i) => i.label === "Remove from Library")).toBe(false);
  });

  it("Locate… asks Rust for the picker; Remove from Library removes the record with no question, then the caller hears of it", async () => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd) =>
      cmd === "list_library" ? [] : cmd === "locate_project" ? "cancelled" : undefined,
    );
    vi.mocked(ask).mockReset();
    useLibraryStore.setState({ folders: [added()], readFailed: false });
    useAppStore.setState({ homeView: DASHBOARD });
    item(folderMenuItems(lost(), vi.fn()), "Locate…").onSelect();
    expect(mockedInvoke).toHaveBeenLastCalledWith("locate_project", { id: "work" });
    const onDeleted = vi.fn();
    item(folderMenuItems(added(), vi.fn(), { onDeleted }), "Remove from Library").onSelect();
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(mockedInvoke).toHaveBeenCalledWith("remove_project", { id: "work" });
    expect(onDeleted.mock.calls[0]![0]).toMatchObject({ homeView: DASHBOARD });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("the projects menu (#256 R1, Sidebar-Library ①④)", () => {
  it("New project · Add folder…, with the artboard's folder-plus and folder-input; New project is the caller's", () => {
    const newProject = vi.fn();
    const items = projectsMenuItems(newProject);
    expect(shape(items)).toEqual(["New project", "Add folder…"]);
    expect(item(items, "New project").icon).toBe(FolderPlus);
    expect(item(items, "Add folder…").icon).toBe(FolderInput);
    // New project names the folder in place: the field takes the focus
    expect(item(items, "New project").takesFocus).toBe(true);
    expect(item(items, "Add folder…").takesFocus).toBeUndefined();
    item(items, "New project").onSelect();
    expect(newProject).toHaveBeenCalledOnce();
    vi.mocked(invoke).mockResolvedValueOnce({ kind: "cancelled" });
    item(items, "Add folder…").onSelect();
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith("add_library_folder");
  });
});
