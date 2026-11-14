import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "../../../shared/lib/toastStore";
import type { FolderMeta, ItemKey } from "../libraryApi";
import { placeItem, resetPlacementsForTests } from "../libraryActions";
import { useLibraryStore } from "../libraryStore";
import { childKey, childrenOf } from "../libraryTree";
import { resetTabsForTests } from "../tabActions";
import { resetAutosaveForTests } from "../useAutosave";

/**
 * A listing that started earlier but lands later must not undo a newer one,
 * nor a place just written (#230 — `list_library` runs off the main
 * thread, so listings and writes cross).
 */

const mockedInvoke = vi.mocked(invoke);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);

const project = (order: ItemKey[]): FolderMeta[] => [
  {
    id: "pay",
    name: "Payments",
    updatedAt: 1,
    diagrams: [
      { id: "a", title: "A", updatedAt: 1, readable: true },
      { id: "b", title: "B", updatedAt: 1, readable: true },
    ],
    folders: [],
    order,
  },
];
const keysOfPay = () => childrenOf(useLibraryStore.getState().folders![0]!).map(childKey);

/** list_library answers in the order the test lets them go — each with the listing asked */
let answers: { listing: FolderMeta[]; go: () => void }[] = [];
let writeGo: () => void = () => undefined;
const serve = (listing: () => FolderMeta[]) =>
  mockedInvoke.mockImplementation(async (cmd) => {
    if (cmd === "list_library") {
      const asked = listing();
      await new Promise<void>((go) => answers.push({ listing: asked, go }));
      return asked;
    }
    if (cmd === "reorder_item") await new Promise<void>((go) => (writeGo = go));
    return undefined;
  });

describe("late listings (#230)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetTabsForTests();
    resetPlacementsForTests();
    useToastStore.getState().dismissAll();
    mockedInvoke.mockReset();
    answers = [];
    useLibraryStore.setState({ folders: project(["diagram:a", "diagram:b"]), readFailed: false });
  });

  it("a listing that started first but arrived later does not overwrite a newer one", async () => {
    let disk: ItemKey[] = ["diagram:a", "diagram:b"];
    serve(() => project(disk));
    const older = useLibraryStore.getState().refresh();
    disk = ["diagram:b", "diagram:a"];
    const newer = useLibraryStore.getState().refresh();
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    answers[1]!.go();
    await newer;
    expect(keysOfPay()).toEqual(["diagram:b", "diagram:a"]);
    answers[0]!.go();
    await older;
    expect(keysOfPay()).toEqual(["diagram:b", "diagram:a"]);
  });

  it("a written spot is placed only after the reread listing arrives — an older listing started before it cannot revert it by arriving late", async () => {
    let disk: ItemKey[] = ["diagram:a", "diagram:b"];
    serve(() => project(disk));
    const placing = placeItem("diagram:b", { parent: "pay", index: 0 });
    expect(keysOfPay()).toEqual(["diagram:b", "diagram:a"]);
    // someone else's listing, asked while the write is on its way: the old order
    const stale = useLibraryStore.getState().refresh();
    await vi.waitFor(() => expect(calls("reorder_item")).toHaveLength(1));
    disk = ["diagram:b", "diagram:a"];
    writeGo();
    // the listing the write asks for lands first
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    answers[1]!.go();
    expect(await placing).toBe(true);
    expect(keysOfPay()).toEqual(["diagram:b", "diagram:a"]);
    // then the stale one
    answers[0]!.go();
    await stale;
    expect(keysOfPay()).toEqual(["diagram:b", "diagram:a"]);
  });
});
