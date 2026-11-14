import { invoke } from "@tauri-apps/api/core";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { useAppStore } from "../appStore";
import { blankDoc, type FolderMeta, type ItemKey } from "../libraryApi";
import { moveFolderTo, placeItem, resetPlacementsForTests } from "../libraryActions";
import { useLibraryStore } from "../libraryStore";
import { childKey, childrenOf, findFolder } from "../libraryTree";
import { openDocument, resetTabsForTests } from "../tabActions";
import { resetAutosaveForTests, useAutosave } from "../useAutosave";

/** one way in for a drag, ⌥↑/⌥↓, the picker (#230 D13, T21) */

const mockedInvoke = vi.mocked(invoke);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const order = () => mockedInvoke.mock.calls.map(([c]) => c);
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);

const library = (): FolderMeta[] => [
  {
    id: "pay",
    name: "Payments",
    updatedAt: 3,
    diagrams: [
      { id: "led", title: "Ledger", updatedAt: 1, readable: true },
      { id: "pyt", title: "Payouts", updatedAt: 1, readable: true },
    ],
    folders: [
      {
        id: "chk",
        name: "Checkout",
        updatedAt: 3,
        diagrams: [{ id: "ord", title: "Order", updatedAt: 3, readable: true }],
        folders: [],
        order: ["diagram:ord"],
      },
      { id: "arc", name: "Archive", updatedAt: 1, diagrams: [], folders: [], order: [] },
    ],
    order: ["folder:chk", "diagram:led", "diagram:pyt", "folder:arc"],
  },
  { id: "onb", name: "Onboarding", updatedAt: 1, diagrams: [], folders: [], order: [] },
];

const keysIn = (id: string): ItemKey[] => {
  const folders = useLibraryStore.getState().folders ?? [];
  const found = findFolder(folders, id);
  return found ? childrenOf(found.folder).map(childKey) : [];
};

/** writes that wait until `release` — what the screen shows meanwhile */
let release: () => void = () => undefined;
let hold = false;
let fail: string | null = null;
const serve = () =>
  mockedInvoke.mockImplementation(async (cmd) => {
    if (cmd === "list_library") return library();
    if (["reorder_item", "move_project", "move_folder"].includes(cmd)) {
      if (hold) await new Promise<void>((r) => (release = r));
      if (fail) throw new Error(fail);
    }
    return undefined;
  });

describe("placeItem (#230 D13, T21)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetTabsForTests();
    resetPlacementsForTests();
    useLibraryStore.setState({ folders: library(), readFailed: false });
    useToastStore.getState().dismissAll();
    mockedInvoke.mockReset();
    hold = false;
    fail = null;
    serve();
  });

  it("same parent — reorder_item, the screen changes first and there is no toast", async () => {
    hold = true;
    const placing = placeItem("diagram:pyt", { parent: "pay", index: 1 });
    expect(keysIn("pay")).toEqual(["folder:chk", "diagram:pyt", "diagram:led", "folder:arc"]);
    await vi.waitFor(() => expect(calls("reorder_item")).toHaveLength(1));
    release();
    expect(await placing).toBe(true);
    expect(calls("reorder_item")[0]![1]).toEqual({ parent: "pay", item: "diagram:pyt", index: 1 });
    expect(calls("move_project")).toHaveLength(0);
    expect(toasts()).toEqual([]);
    expect(calls("list_library")).toHaveLength(1);
  });

  it("project order — without parent", async () => {
    expect(await placeItem("folder:onb", { parent: null, index: 0 })).toBe(true);
    expect(calls("reorder_item")[0]![1]).toEqual({ item: "folder:onb", index: 0 });
  });

  it("another parent — move_project for diagrams, move_folder for folders, reported with a toast", async () => {
    expect(await placeItem("diagram:led", { parent: "chk", index: 0 })).toBe(true);
    expect(calls("move_project")[0]![1]).toEqual({ id: "led", folder: "chk", index: 0 });
    expect(await placeItem("folder:chk", { parent: "arc", index: 0 })).toBe(true);
    expect(calls("move_folder")[0]![1]).toEqual({ id: "chk", parent: "arc", index: 0 });
    expect(toasts()).toEqual(["Moved “Ledger” to Checkout", "Moved “Checkout” to Archive"]);
  });

  it("writes nothing for the same spot or a place it cannot go", async () => {
    expect(await placeItem("diagram:led", { parent: "pay", index: 1 })).toBe(false);
    expect(await placeItem("folder:chk", { parent: "chk", index: 0 })).toBe(false);
    expect(await placeItem("folder:pay", { parent: "onb", index: 0 })).toBe(false);
    expect(await placeItem("diagram:led", { parent: null, index: 0 })).toBe(false);
    expect(await placeItem("diagram:ghost", { parent: "pay", index: 0 })).toBe(false);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("writes happen in turn — the second after the first finishes, the screen right away", async () => {
    hold = true;
    const first = placeItem("diagram:pyt", { parent: "pay", index: 1 });
    const second = placeItem("diagram:pyt", { parent: "pay", index: 0 });
    expect(keysIn("pay")).toEqual(["diagram:pyt", "folder:chk", "diagram:led", "folder:arc"]);
    await vi.waitFor(() => expect(calls("reorder_item")).toHaveLength(1));
    release();
    await first;
    await vi.waitFor(() => expect(calls("reorder_item")).toHaveLength(2));
    release();
    await second;
    expect(calls("reorder_item").map(([, a]) => (a as { index: number }).index)).toEqual([1, 0]);
  });

  it("a pending reorder is reapplied even when another listing arrives mid-write", async () => {
    hold = true;
    const placing = placeItem("diagram:pyt", { parent: "pay", index: 0 });
    await vi.waitFor(() => expect(calls("reorder_item")).toHaveLength(1));
    // a listing someone else asked for — Rust has not written the order yet
    await useLibraryStore.getState().refresh();
    expect(keysIn("pay")[0]).toBe("diagram:pyt");
    release();
    await placing;
  });

  it("on failure, a toast + reread — the screen goes back to the truth", async () => {
    fail = "disk full";
    expect(await placeItem("diagram:pyt", { parent: "pay", index: 0 })).toBe(false);
    expect(toasts().some((t) => t.includes("disk full"))).toBe(true);
    expect(keysIn("pay")).toEqual(["folder:chk", "diagram:led", "diagram:pyt", "folder:arc"]);
  });

  it("finishes autosave first only when the file moves — the tab stays", async () => {
    renderHook(() => useAutosave());
    openDocument(blankDoc(), { projectId: "ord" });
    useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
    await placeItem("folder:chk", { parent: "arc", index: 0 });
    expect(order().indexOf("save_project")).toBeGreaterThanOrEqual(0);
    expect(order().indexOf("save_project")).toBeLessThan(order().indexOf("move_folder"));
    expect(useAppStore.getState().tabs.map((t) => t.projectId)).toEqual(["ord"]);
  });

  it("a stray diagram moves into a real folder — exactly where the drag showed it (#230)", async () => {
    const stray: FolderMeta = {
      id: "my-diagrams",
      name: "My Diagrams",
      updatedAt: 0,
      stray: true,
      diagrams: [{ id: "lost", title: "Lost", updatedAt: 0, readable: true }],
      folders: [],
      order: ["diagram:lost"],
    };
    useLibraryStore.setState({ folders: [...library(), stray] });
    expect(await placeItem("diagram:lost", { parent: "pay", index: 1 })).toBe(true);
    expect(calls("move_project")[0]![1]).toEqual({ id: "lost", folder: "pay", index: 1 });
    expect(toasts()).toEqual(["Moved “Lost” to Payments"]);
  });

  it("reordering within the same parent does not wait for autosave — the file does not move (#230)", async () => {
    renderHook(() => useAutosave());
    openDocument(blankDoc(), { projectId: "led" });
    useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
    await placeItem("diagram:pyt", { parent: "pay", index: 0 });
    expect(calls("reorder_item")).toHaveLength(1);
    // the edit waits for its own autosave: no save came before the reorder
    expect(order().slice(0, order().indexOf("reorder_item"))).not.toContain("save_project");
  });

  it("moveFolderTo — to the top of the folder the picker chose", async () => {
    const chk = library()[0]!.folders[0]!;
    expect(await moveFolderTo(chk, "onb")).toBe(true);
    expect(calls("move_folder")[0]![1]).toEqual({ id: "chk", parent: "onb", index: 0 });
    expect(toasts()).toEqual(["Moved “Checkout” to Onboarding"]);
  });
});
