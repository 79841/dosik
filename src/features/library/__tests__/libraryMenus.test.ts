import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import { Copy, FolderPlus, FolderSearch, SquareArrowOutUpRight, SquarePlus } from "lucide-react";

import type { FolderMeta } from "../libraryApi";
import { diagramMenuItems, folderMenuItems } from "../libraryMenus";
import { showInLabel } from "../fileManager";

/** "Show in …" as this web view names its file manager (#238 D10) */
const SHOW_IN = showInLabel();

const folder = (stray = false): FolderMeta => ({
  folders: [],
  id: "work",
  name: "Work",
  updatedAt: 1,
  diagrams: [{ id: "p1", title: "Checkout", updatedAt: 1, readable: true }],
  ...(stray ? { stray: true } : {}),
});
/** label, with "—" for a rule before it — the menu as the canvas draws it */
const shape = (items: ReturnType<typeof diagramMenuItems>) =>
  items.flatMap((i) => (i.separatorBefore ? ["—", i.label] : [i.label]));
const item = (items: ReturnType<typeof diagramMenuItems>, label: string) =>
  items.find((i) => i.label === label)!;
/** Show in Finder · Copy Path, a group of their own before Rename (#238 R2) */
const FINDER = ["—", SHOW_IN, "Copy Path"];

describe("row menu items — the tree and Home share one list (#217 D10, #220 D11, #229 D11)", () => {
  it("project/folder = New diagram · New folder · — · Show in Finder · Copy Path · — · Rename · — · Delete, none for stray", () => {
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
    expect(folderMenuItems(folder(true), rename, { newFolder })).toEqual([]);
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
    expect(folderMenuItems(folder(true), vi.fn(), { afterRename: [extra] })).toEqual([]);
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
