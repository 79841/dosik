import { type InvokeArgs, invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import type { DiagramDoc } from "../../../shared/lib/types";
import { savedFor } from "../../../test/rustAnswers";
import { useAppStore } from "../appStore";
import { useLibraryStore } from "../libraryStore";
import {
  activateTab,
  closeRemovedDiagrams,
  closeRemovedFile,
  closeTab,
  confirmDiscardTabs,
  externalPaths,
  openLibraryDiagram,
  openPathInTab,
  readLibraryIds,
  reloadDiagram,
  reloadExternalFile,
  resetTabsForTests,
  resumeReachable,
} from "../tabActions";
import { newTab } from "../tabModel";
import {
  hasUnsavedExternalChanges,
  markExternalSaved,
  resetUnsavedGuardForTests,
} from "../unsavedGuard";
import {
  AUTOSAVE_DEBOUNCE_MS,
  baseStampOf,
  flushAutosave,
  pausedProjects,
  resetAutosaveForTests,
  useAutosave,
  writeProjectThroughChain,
} from "../useAutosave";

const mockedInvoke = vi.mocked(invoke);
const mockedAsk = vi.mocked(ask);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const store = () => useDiagramStore.getState();
const app = () => useAppStore.getState();
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);
const ids = () => store().nodes.map((n) => n.id);
const add = (id: string) =>
  store().applyOps([{ op: "add_node", node: { id, label: id, x: 0, y: 0 } }]);

const doc = (title: string, ...nodes: string[]): DiagramDoc => ({
  version: 1,
  title,
  nodes: nodes.map((id) => makeNode({ id })),
  edges: [],
});

/** what the disk holds: library diagrams by id (with a stamp), external files by path */
let library: Record<string, { doc: DiagramDoc; stamp: string }>;
let files: Record<string, string>;
/** what `save_project` answers next — written, by default, under a fresh stamp */
let saveAnswer: (args: unknown) => unknown;
let stamps = 0;

const serve = () =>
  mockedInvoke.mockImplementation(async (cmd, args) => {
    const a = args as { id?: string; path?: string };
    if (cmd === "load_project") {
      const entry = library[a.id!];
      if (!entry) throw new Error(`no such diagram: ${a.id}`);
      return { contents: JSON.stringify(entry.doc), name: entry.doc.title, stamp: entry.stamp };
    }
    if (cmd === "read_text_file") {
      const text = files[a.path!];
      if (text === undefined) throw new Error(`${a.path}: No such file`);
      return text;
    }
    if (cmd === "save_project") return saveAnswer(args);
    return undefined;
  });

/** a save that went through: under its title, with a fresh stamp */
const written = (args: unknown) => ({
  ...savedFor(args as InvokeArgs),
  stamp: `s${++stamps}-9-ss`,
});

/** the diagram `id` changed on disk by someone else */
const writeOutside = (id: string, next: DiagramDoc) => {
  stamps++;
  library[id] = { doc: next, stamp: `${stamps}-${JSON.stringify(next).length}-x${stamps}` };
};

describe("reading tabs again when their file changes outside the app (#253 D12, D13)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    useLibraryStore.setState({ folders: [], readFailed: false });
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
    stamps = 0;
    library = {
      p1: { doc: doc("Checkout", "a"), stamp: "0-1-aa" },
      p2: { doc: doc("Ledger", "l"), stamp: "0-2-bb" },
    };
    files = {};
    saveAnswer = written;
    serve();
  });
  afterEach(() => vi.useRealTimers());

  describe("a library diagram", () => {
    it("with no edits of its own, read again quietly — the canvas stays, ⌘Z brings back what it showed", async () => {
      await openLibraryDiagram("p1");
      const reveal = store().revealRequest;
      if (reveal) store().consumeReveal(reveal.key);
      const steps = store().past.length;
      writeOutside("p1", doc("Checkout", "a", "b"));
      await reloadDiagram("p1");
      expect(ids()).toEqual(["a", "b"]);
      expect(store().revealRequest).toBeNull();
      expect(store().past).toHaveLength(steps + 1);
      expect(toasts()).toEqual([]);
      expect(baseStampOf("p1")).toBe(library.p1!.stamp);
      store().undo();
      expect(ids()).toEqual(["a"]);
    });

    it("as the tab last saw it, nothing happens — no read into the document, no undo step", async () => {
      await openLibraryDiagram("p1");
      const steps = store().past.length;
      await reloadDiagram("p1");
      expect(store().past).toHaveLength(steps);
      // the same contents written again: nothing either
      library.p1 = { ...library.p1!, stamp: "5-1-aa" };
      await reloadDiagram("p1");
      expect(store().past).toHaveLength(steps);
    });

    it("with edits the file lacks, the file wins — a toast says so, ⌘Z brings the edits back, they are not written", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      add("mine");
      writeOutside("p1", doc("Checkout", "a", "theirs"));
      await reloadDiagram("p1");
      expect(ids()).toEqual(["a", "theirs"]);
      expect(toasts()).toEqual(["“Checkout” changed outside Dosik — reloaded"]);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
      await flushAutosave();
      expect(calls("save_project")).toHaveLength(0);
      store().undo();
      expect(ids()).toEqual(["a", "mine"]);
      // the edits brought back are written, over the file as it is now
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      expect(calls("save_project")).toHaveLength(1);
      expect(calls("save_project")[0]![1]).toMatchObject({ base: library.p1!.stamp });
    });

    it("a tab not on screen has its snapshot read again; ⌘Z there brings back what it held", async () => {
      await openLibraryDiagram("p1");
      await openLibraryDiagram("p2");
      writeOutside("p1", doc("Checkout", "a", "b"));
      await reloadDiagram("p1");
      expect(ids()).toEqual(["l"]);
      const tab = app().tabs.find((t) => t.projectId === "p1")!;
      expect(tab.doc?.nodes.map((n) => n.id)).toEqual(["a", "b"]);
      await activateTab(tab.id);
      expect(ids()).toEqual(["a", "b"]);
      store().undo();
      expect(ids()).toEqual(["a"]);
    });

    it("a tab restored and not read yet is left to be read when it is opened", async () => {
      const restored = newTab({ projectId: "p1", filePath: null, title: "Checkout" }, false);
      app().commitTabs({ tabs: [restored], activeTab: null });
      writeOutside("p1", doc("Checkout", "a", "b"));
      await reloadDiagram("p1");
      expect(calls("load_project")).toHaveLength(0);
      expect(readLibraryIds()).toEqual([]);
    });

    it("a save refused as changed on disk reads the file again, with the toast", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      writeOutside("p1", doc("Checkout", "a", "theirs"));
      saveAnswer = () => ({ kind: "changedOnDisk" });
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(ids()).toEqual(["a", "theirs"]));
      expect(toasts()).toEqual(["“Checkout” changed outside Dosik — reloaded"]);
      store().undo();
      expect(ids()).toEqual(["a", "mine"]);
    });

    it("a save refused as changed on disk whose file cannot be read says so once — its edits stay", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => ({ kind: "changedOnDisk" });
      const theirs = library.p1!;
      delete library.p1;
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() =>
        expect(toasts()).toEqual([
          "Error: “Checkout” changed outside Dosik and can't be read — not saved",
        ]),
      );
      add("more");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await flushAutosave();
      expect(calls("save_project")).toHaveLength(2);
      expect(toasts()).toHaveLength(1);
      expect(ids()).toEqual(["a", "mine", "more"]);
      // readable again: the file wins, as ever, and a later failure is told again
      library.p1 = { ...theirs, doc: doc("Checkout", "a", "theirs"), stamp: "7-7-77" };
      add("again");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(ids()).toEqual(["a", "theirs"]));
      expect(toasts().at(-1)).toBe("“Checkout” changed outside Dosik — reloaded");
    });

    it("a save refused as gone closes the tab with a toast, and nothing is written again", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => ({ kind: "gone" });
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(app().tabs).toEqual([]));
      expect(toasts()).toEqual(["“Checkout” was removed outside Dosik"]);
      add("after");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
      expect(calls("save_project")).toHaveLength(1);
    });

    it("a save refused as out of reach keeps the tab and its edits, says so once, and saves no more", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => ({ kind: "unreachable" });
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() =>
        expect(toasts()).toEqual(["Error: Can't reach “Checkout” — not saved"]),
      );
      expect(app().tabs).toHaveLength(1);
      expect(ids()).toEqual(["a", "mine"]);
      add("more");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
      await flushAutosave();
      expect(calls("save_project")).toHaveLength(1);
      expect(toasts()).toHaveLength(1);
    });

    it("out of reach with edits, its tab counts as unsaved — ⌘W and closing the window ask, by its title", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p2");
      await openLibraryDiagram("p1");
      saveAnswer = () => ({ kind: "unreachable" });
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(toasts()).toHaveLength(1));
      const active = app().activeTab!;
      mockedAsk.mockResolvedValue(false);
      expect(await closeTab(active)).toBe(false);
      expect(mockedAsk).toHaveBeenLastCalledWith(
        "“Checkout” has unsaved changes. Discard them?",
        expect.objectContaining({ okLabel: "Discard" }),
      );
      expect(app().tabs).toHaveLength(2);
      expect(await confirmDiscardTabs()).toBe(false);
      expect(mockedAsk).toHaveBeenCalledTimes(2);
      // a tab beside it with nothing held: closes without a word
      const other = app().tabs.find((t) => t.projectId === "p2")!.id;
      expect(await closeTab(other)).toBe(true);
      expect(mockedAsk).toHaveBeenCalledTimes(2);
      mockedAsk.mockResolvedValue(true);
      expect(await closeTab(active)).toBe(true);
      expect(app().tabs).toEqual([]);
    });

    it("out of reach with edits, a tab kept beside the screen asks too", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => ({ kind: "unreachable" });
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(toasts()).toHaveLength(1));
      await openLibraryDiagram("p2");
      mockedAsk.mockResolvedValue(false);
      expect(await confirmDiscardTabs()).toBe(false);
      expect(mockedAsk).toHaveBeenLastCalledWith(
        "“Checkout” has unsaved changes. Discard them?",
        expect.anything(),
      );
    });

    it("removed outside while out of reach, its edits are asked about before its tab closes", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => ({ kind: "unreachable" });
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(toasts()).toHaveLength(1));
      // kept: the tab and its edits stay
      mockedAsk.mockResolvedValue(false);
      await closeRemovedDiagrams(new Set(["p1"]));
      expect(mockedAsk).toHaveBeenLastCalledWith(
        "“Checkout” has unsaved changes. Discard them?",
        expect.anything(),
      );
      expect(app().tabs).toHaveLength(1);
      expect(ids()).toEqual(["a", "mine"]);
      // asked once: the next look at the library leaves it be
      await closeRemovedDiagrams(new Set(["p1"]));
      expect(mockedAsk).toHaveBeenCalledTimes(1);
      expect(app().tabs).toHaveLength(1);
      // closed by the user: asked as ever, and nothing waits for it any more
      mockedAsk.mockResolvedValue(true);
      expect(await closeTab(app().activeTab!)).toBe(true);
      expect(mockedAsk).toHaveBeenCalledTimes(2);
      expect(pausedProjects()).toEqual([]);
    });

    it("kept after asking, a removed diagram is asked about again once a save of it got through", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => ({ kind: "unreachable" });
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(toasts()).toHaveLength(1));
      mockedAsk.mockResolvedValue(false);
      await closeRemovedDiagrams(new Set(["p1"]));
      // reached again and saved, then out of reach and gone once more
      saveAnswer = written;
      resumeReachable(new Set(["p1"]));
      await flushAutosave();
      saveAnswer = () => ({ kind: "unreachable" });
      add("more");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await flushAutosave();
      await closeRemovedDiagrams(new Set(["p1"]));
      expect(mockedAsk).toHaveBeenCalledTimes(2);
    });

    it("out of reach, saying so once — a listing that has it again and a save that fails again say nothing more", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => ({ kind: "unreachable" });
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(toasts()).toHaveLength(1));
      // listed again, its file still unread: tried again, and not said again
      resumeReachable(new Set(["p1"]));
      await flushAutosave();
      expect(calls("save_project")).toHaveLength(2);
      expect(toasts()).toHaveLength(1);
      // saved once, then out of reach again: said again
      saveAnswer = written;
      resumeReachable(new Set(["p1"]));
      await flushAutosave();
      saveAnswer = () => ({ kind: "unreachable" });
      add("more");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(toasts()).toHaveLength(2));
    });

    it("a save that failed leaves edits only the tab has — closing asks until a save gets through", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => {
        throw new Error("No space left on device");
      };
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(toasts()).toHaveLength(1));
      mockedAsk.mockResolvedValue(false);
      expect(await closeTab(app().activeTab!)).toBe(false);
      expect(mockedAsk).toHaveBeenLastCalledWith(
        "“Checkout” has unsaved changes. Discard them?",
        expect.anything(),
      );
      // the next save gets through: nothing left to ask about
      saveAnswer = written;
      add("more");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await flushAutosave();
      expect(await closeTab(app().activeTab!)).toBe(true);
      expect(mockedAsk).toHaveBeenCalledTimes(1);
    });

    it("a save that failed is tried once more before the question — and through, nothing is asked", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p2");
      saveAnswer = () => {
        throw new Error("Too many open files");
      };
      add("ledger edit");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await openLibraryDiagram("p1");
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await flushAutosave();
      expect(calls("save_project")).toHaveLength(2);
      // the disk is back: closing tries each again, and asks nothing
      saveAnswer = written;
      mockedAsk.mockResolvedValue(false);
      expect(await confirmDiscardTabs()).toBe(true);
      expect(mockedAsk).not.toHaveBeenCalled();
      const sent = calls("save_project")
        .slice(2)
        .map(([, a]) => (a as { id: string }).id)
        .sort();
      expect(sent).toEqual(["p1", "p2"]);
      expect(await closeTab(app().activeTab!)).toBe(true);
      expect(mockedAsk).not.toHaveBeenCalled();
    });

    it("a tab kept for the edits a failed save left saves no more on its own — an explicit save says where it went", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => {
        throw new Error("EIO");
      };
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(toasts()).toHaveLength(1));
      // gone from the listing, kept when asked
      await closeRemovedDiagrams(new Set(["p1"]));
      saveAnswer = () => ({ kind: "gone" });
      const before = calls("save_project").length;
      for (const n of ["b", "c", "d"]) {
        add(n);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      }
      await flushAutosave();
      expect(calls("save_project")).toHaveLength(before);
      expect(toasts()).toEqual(["Error: EIO"]);
      expect(pausedProjects()).toEqual(["p1"]);
      // an explicit save still tries, and says it went nowhere
      await writeProjectThroughChain("p1", true);
      await vi.waitFor(() =>
        expect(toasts()).toEqual(["Error: EIO", "Error: “Checkout” is gone from disk — not saved"]),
      );
      expect(app().tabs).toHaveLength(1);
    });

    it("closing a tab whose save, tried once more, finds its diagram gone asks once", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => {
        throw new Error("EIO");
      };
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(toasts()).toHaveLength(1));
      saveAnswer = () => ({ kind: "gone" });
      mockedAsk.mockResolvedValue(false);
      expect(await closeTab(app().activeTab!)).toBe(false);
      await vi.advanceTimersByTimeAsync(10);
      expect(mockedAsk).toHaveBeenCalledTimes(1);
      expect(app().tabs).toHaveLength(1);
      // kept: the next look at the library does not ask again
      await closeRemovedDiagrams(new Set(["p1"]));
      expect(mockedAsk).toHaveBeenCalledTimes(1);
      // closing the window asks once too, and closes on Discard
      mockedAsk.mockResolvedValue(true);
      expect(await confirmDiscardTabs()).toBe(true);
      expect(mockedAsk).toHaveBeenCalledTimes(2);
    });

    it("a tab whose saves waited, closed, waits no more", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => ({ kind: "unreachable" });
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(pausedProjects()).toEqual(["p1"]));
      mockedAsk.mockResolvedValue(true);
      expect(await closeTab(app().activeTab!)).toBe(true);
      expect(pausedProjects()).toEqual([]);
    });

    it("closing right after an edit asks when that edit's save cannot reach its diagram", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => ({ kind: "unreachable" });
      add("mine");
      // within the autosave's wait: nothing has been refused yet
      mockedAsk.mockResolvedValue(false);
      expect(await closeTab(app().activeTab!)).toBe(false);
      expect(mockedAsk).toHaveBeenLastCalledWith(
        "“Checkout” has unsaved changes. Discard them?",
        expect.anything(),
      );
      add("again");
      expect(await confirmDiscardTabs()).toBe(false);
      expect(mockedAsk).toHaveBeenCalledTimes(2);
    });

    it("out of reach, an explicit save Rust finds gone asks before its tab closes", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => ({ kind: "unreachable" });
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(toasts()).toHaveLength(1));
      saveAnswer = () => ({ kind: "gone" });
      // kept: the edits only it holds stay
      await writeProjectThroughChain("p1", true);
      await vi.waitFor(() => expect(mockedAsk).toHaveBeenCalledTimes(1));
      expect(app().tabs).toHaveLength(1);
      expect(ids()).toEqual(["a", "mine"]);
      // kept before, saved again and gone again: not asked, said
      await writeProjectThroughChain("p1", true);
      await vi.waitFor(() =>
        expect(toasts()).toContain("Error: “Checkout” is gone from disk — not saved"),
      );
      expect(mockedAsk).toHaveBeenCalledTimes(1);
      expect(app().tabs).toHaveLength(1);
      // let go when closed: asked as ever
      mockedAsk.mockResolvedValue(true);
      expect(await closeTab(app().activeTab!)).toBe(true);
      expect(mockedAsk).toHaveBeenCalledTimes(2);
    });

    it("out of reach, an explicit save Rust finds gone, let go: closed as removed", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => ({ kind: "unreachable" });
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(toasts()).toHaveLength(1));
      saveAnswer = () => ({ kind: "gone" });
      mockedAsk.mockResolvedValue(true);
      await writeProjectThroughChain("p1", true);
      await vi.waitFor(() => expect(app().tabs).toEqual([]));
      expect(toasts()).toContain("“Checkout” was removed outside Dosik");
      expect(pausedProjects()).toEqual([]);
    });

    it("listed again, a diagram out of reach is saved — on screen, and kept in a tab beside it", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p2");
      saveAnswer = () => ({ kind: "unreachable" });
      add("ledger edit");
      await openLibraryDiagram("p1");
      add("checkout edit");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await flushAutosave();
      expect(calls("save_project")).toHaveLength(2);
      saveAnswer = written;
      // the project is back: the listing has both again
      resumeReachable(new Set(["p1", "p2"]));
      await flushAutosave();
      const sent = calls("save_project")
        .slice(2)
        .map(([, a]) => {
          const { id, contents } = a as { id: string; contents: string };
          return [id, (JSON.parse(contents) as DiagramDoc).nodes.map((n) => n.id)];
        });
      expect(sent.sort()).toEqual([
        ["p1", ["a", "checkout edit"]],
        ["p2", ["l", "ledger edit"]],
      ]);
      // saving as ever from now on
      add("after");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      expect(calls("save_project")).toHaveLength(5);
    });

    it("removed outside: its tabs close with a toast each, and a pending edit is dropped, not written", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p2");
      await openLibraryDiagram("p1");
      add("pending");
      closeRemovedDiagrams(new Set(["p1", "p2", "never-open"]));
      expect(app().tabs).toEqual([]);
      expect(toasts().sort()).toEqual([
        "“Checkout” was removed outside Dosik",
        "“Ledger” was removed outside Dosik",
      ]);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
      await flushAutosave();
      expect(calls("save_project")).toHaveLength(0);
    });

    it("a write queued before the read is dropped — it would put back what the read replaced", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      let finish!: (answer: unknown) => void;
      saveAnswer = () =>
        new Promise((resolve) => {
          finish = resolve;
        });
      add("one");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      add("two");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      // the second write waits behind the first
      expect(calls("save_project")).toHaveLength(1);
      writeOutside("p1", doc("Checkout", "theirs"));
      await reloadDiagram("p1");
      expect(ids()).toEqual(["theirs"]);
      finish({ kind: "changedOnDisk" });
      await flushAutosave();
      await vi.waitFor(() =>
        expect(toasts()).toContain("“Checkout” changed outside Dosik — reloaded"),
      );
      expect(calls("save_project")).toHaveLength(1);
      expect(ids()).toEqual(["theirs"]);
    });
  });

  describe("an external file (Open file…)", () => {
    const path = "/x/mine.dosik";

    it("read again the same way; what this app wrote there is no change", async () => {
      files[path] = JSON.stringify(doc("Mine", "a"));
      await openPathInTab(path);
      files[path] = JSON.stringify(doc("Mine", "a", "b"));
      await reloadExternalFile(path);
      expect(ids()).toEqual(["a", "b"]);
      expect(toasts()).toEqual([]);
      expect(hasUnsavedExternalChanges()).toBe(false);
      store().undo();
      expect(ids()).toEqual(["a"]);
      // a Save of its own, then an edit: the file holds what it wrote, and the edit stays
      const written = JSON.stringify(store().toDoc(), null, 2);
      files[path] = written;
      markExternalSaved(written);
      add("later");
      const steps = store().past.length;
      await reloadExternalFile(path);
      expect(ids()).toEqual(["a", "later"]);
      expect(store().past).toHaveLength(steps);
    });

    it("with unsaved edits, the file wins and a toast says so", async () => {
      files[path] = JSON.stringify(doc("Mine", "a"));
      await openPathInTab(path);
      add("mine");
      expect(hasUnsavedExternalChanges()).toBe(true);
      files[path] = JSON.stringify(doc("Mine", "a", "theirs"));
      await reloadExternalFile(path);
      expect(ids()).toEqual(["a", "theirs"]);
      expect(toasts()).toEqual(["“Mine” changed outside Dosik — reloaded"]);
      expect(hasUnsavedExternalChanges()).toBe(false);
    });

    it("half written or no diagram: left as it is until the next change", async () => {
      files[path] = JSON.stringify(doc("Mine", "a"));
      await openPathInTab(path);
      files[path] = '{"nodes": [';
      await reloadExternalFile(path);
      expect(ids()).toEqual(["a"]);
      expect(toasts()).toEqual([]);
    });

    it("removed: a clean tab closes with a toast; one with unsaved edits stays — only it holds them", async () => {
      files[path] = JSON.stringify(doc("Mine", "a"));
      files["/x/other.dosik"] = JSON.stringify(doc("Other", "o"));
      await openPathInTab(path);
      await openPathInTab("/x/other.dosik");
      add("unsaved");
      expect(externalPaths()).toEqual([path, "/x/other.dosik"]);
      closeRemovedFile(path);
      closeRemovedFile("/x/other.dosik");
      expect(app().tabs.map((t) => t.filePath)).toEqual(["/x/other.dosik"]);
      expect(toasts()).toEqual([
        "“Mine” was removed outside Dosik",
        "“Other” was removed outside Dosik",
      ]);
    });
  });
});
