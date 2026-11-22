import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import type { DiagramDoc } from "../../../shared/lib/types";
import { useAppStore } from "../appStore";
import type { FolderMeta } from "../libraryApi";
import { useLibraryStore } from "../libraryStore";
import {
  closeRemovedDiagrams,
  openLibraryDiagram,
  openPathInTab,
  resetTabsForTests,
} from "../tabActions";
import { resetUnsavedGuardForTests } from "../unsavedGuard";
import { flushAutosave, resetAutosaveForTests, useAutosave } from "../useAutosave";
import { FILES_CHANGED_EVENT, LIBRARY_CHANGED_EVENT, useLibraryWatch } from "../useLibraryWatch";

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const ids = () => useDiagramStore.getState().nodes.map((n) => n.id);
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);

const doc = (title: string, ...nodes: string[]): DiagramDoc => ({
  version: 1,
  title,
  nodes: nodes.map((id) => makeNode({ id })),
  edges: [],
});

/** a project holding the diagrams named */
const project = (...diagrams: string[]): FolderMeta[] => [
  {
    id: "pay",
    name: "Payments",
    updatedAt: 1,
    folders: [],
    diagrams: diagrams.map((id) => ({ id, title: id, updatedAt: 1, readable: true })),
  },
];

let library: Record<string, { doc: DiagramDoc; stamp: string }>;
let listing: FolderMeta[];
let files: Record<string, string>;
let handlers: Record<string, (event: { payload: unknown }) => void>;

const serve = () =>
  mockedInvoke.mockImplementation(async (cmd, args) => {
    const a = args as { id?: string; path?: string };
    if (cmd === "list_library") return listing;
    if (cmd === "load_project") {
      const entry = library[a.id!];
      if (!entry) throw new Error("no such diagram");
      return { contents: JSON.stringify(entry.doc), name: entry.doc.title, stamp: entry.stamp };
    }
    if (cmd === "read_text_file") {
      if (files[a.path!] === undefined) throw new Error("No such file");
      return files[a.path!];
    }
    return undefined;
  });

const emit = (event: string, payload: unknown) =>
  act(() => {
    handlers[event]?.({ payload });
  });

describe("useLibraryWatch — what changes on disk outside the app (#253)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    useLibraryStore.setState({ folders: [], readFailed: false });
    library = {
      p1: { doc: doc("Checkout", "a"), stamp: "0-1-aa" },
      p2: { doc: doc("Ledger", "l"), stamp: "0-2-bb" },
    };
    listing = project("p1", "p2");
    files = {};
    handlers = {};
    mockedListen.mockImplementation(async (event, handler) => {
      handlers[event] = handler as (event: { payload: unknown }) => void;
      return () => {};
    });
    serve();
  });

  it("lists the library again and reads again the open diagrams the change names", async () => {
    await openLibraryDiagram("p1");
    renderHook(() => useLibraryWatch());
    await waitFor(() => expect(handlers[LIBRARY_CHANGED_EVENT]).toBeDefined());
    library.p1 = { doc: doc("Checkout", "a", "b"), stamp: "1-2-cc" };
    const lists = calls("list_library").length;
    emit(LIBRARY_CHANGED_EVENT, { changed: ["p1", "not-open"] });
    await waitFor(() => expect(ids()).toEqual(["a", "b"]));
    expect(calls("list_library")).toHaveLength(lists + 1);
    expect(useLibraryStore.getState().folders).toEqual(listing);
    expect(toasts()).toEqual([]);
  });

  it("events the watch lost: the library listed again and every read tab read again", async () => {
    await openLibraryDiagram("p1");
    renderHook(() => useLibraryWatch());
    await waitFor(() => expect(handlers[LIBRARY_CHANGED_EVENT]).toBeDefined());
    library.p1 = { doc: doc("Checkout", "a", "unseen"), stamp: "1-2-cc" };
    emit(LIBRARY_CHANGED_EVENT, { changed: [], rescan: true });
    await waitFor(() => expect(ids()).toEqual(["a", "unseen"]));
  });

  it("an open diagram the listing no longer has is closed, with a toast", async () => {
    await openLibraryDiagram("p1");
    await openLibraryDiagram("p2");
    renderHook(() => useLibraryWatch());
    await waitFor(() => expect(handlers[LIBRARY_CHANGED_EVENT]).toBeDefined());
    listing = project("p2");
    emit(LIBRARY_CHANGED_EVENT, { changed: ["p1"] });
    await waitFor(() =>
      expect(useAppStore.getState().tabs.map((t) => t.projectId)).toEqual(["p2"]),
    );
    expect(toasts()).toEqual(["“Checkout” was removed outside Dosik"]);
  });

  it("an open diagram a project holds out of reach — not found, or in a folder that cannot be read — stays open", async () => {
    await openLibraryDiagram("p1");
    await openLibraryDiagram("p2");
    renderHook(() => useLibraryWatch());
    await waitFor(() => expect(handlers[LIBRARY_CHANGED_EVENT]).toBeDefined());
    listing = [{ ...project()[0]!, missing: true, held: ["p1", "p2"] }];
    delete library.p1;
    emit(LIBRARY_CHANGED_EVENT, { changed: ["p1", "p2"] });
    await waitFor(() => expect(useLibraryStore.getState().folders).toEqual(listing));
    expect(useAppStore.getState().tabs.map((t) => t.projectId)).toEqual(["p1", "p2"]);
    expect(toasts()).toEqual([]);
  });

  it("a diagram whose save could not reach it saves again once a listing has it", async () => {
    renderHook(() => useAutosave());
    await openLibraryDiagram("p1");
    renderHook(() => useLibraryWatch());
    await waitFor(() => expect(handlers[LIBRARY_CHANGED_EVENT]).toBeDefined());
    let answer: unknown = { kind: "unreachable" };
    const served = mockedInvoke.getMockImplementation();
    mockedInvoke.mockImplementation(async (cmd, args) =>
      cmd === "save_project" ? answer : served?.(cmd, args),
    );
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "mine", label: "mine", x: 0, y: 0 } }]);
    await flushAutosave();
    expect(calls("save_project")).toHaveLength(1);
    answer = { kind: "saved", name: "Checkout", stamp: "9-9-99" };
    emit(LIBRARY_CHANGED_EVENT, { changed: [] });
    await waitFor(() => expect(calls("save_project")).toHaveLength(2));
  });

  it("while a save waits for its diagram, the library is listed again every 30 seconds", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      renderHook(() => useLibraryWatch());
      const lists = () => calls("list_library").length;
      // nothing waits: nothing is listed for it
      await vi.advanceTimersByTimeAsync(60_000);
      const before = lists();
      expect(before).toBe(0);
      let answer: unknown = { kind: "unreachable" };
      const served = mockedInvoke.getMockImplementation();
      mockedInvoke.mockImplementation(async (cmd, args) =>
        cmd === "save_project" ? answer : served?.(cmd, args),
      );
      useDiagramStore
        .getState()
        .applyOps([{ op: "add_node", node: { id: "mine", label: "mine", x: 0, y: 0 } }]);
      await flushAutosave();
      await vi.advanceTimersByTimeAsync(29_000);
      expect(lists()).toBe(before);
      // the file can be read again: the listing that comes saves it
      answer = { kind: "saved", name: "Checkout", stamp: "9-9-99" };
      await vi.advanceTimersByTimeAsync(1_000);
      expect(lists()).toBe(before + 1);
      await vi.waitFor(() => expect(calls("save_project")).toHaveLength(2));
      // saved: no more listings for it
      await vi.advanceTimersByTimeAsync(60_000);
      expect(lists()).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the 30-second listing is not for a tab kept when its diagram went", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      renderHook(() => useLibraryWatch());
      const served = mockedInvoke.getMockImplementation();
      mockedInvoke.mockImplementation((cmd, args) =>
        cmd === "save_project" ? Promise.resolve({ kind: "unreachable" }) : served!(cmd, args),
      );
      useDiagramStore
        .getState()
        .applyOps([{ op: "add_node", node: { id: "mine", label: "mine", x: 0, y: 0 } }]);
      await flushAutosave();
      // gone from the listing, and kept when asked: no listing brings it back
      vi.mocked(ask).mockResolvedValue(false);
      await closeRemovedDiagrams(new Set(["p1"]));
      expect(useAppStore.getState().tabs).toHaveLength(1);
      const lists = calls("list_library").length;
      await vi.advanceTimersByTimeAsync(90_000);
      expect(calls("list_library")).toHaveLength(lists);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the 30-second listing waits while one is still on its way — a share that does not answer", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      renderHook(() => useLibraryWatch());
      const served = mockedInvoke.getMockImplementation();
      let answer: (folders: FolderMeta[]) => void = () => {};
      mockedInvoke.mockImplementation((cmd, args) => {
        if (cmd === "save_project") return Promise.resolve({ kind: "unreachable" });
        // a listing that does not come back for long
        if (cmd === "list_library") {
          return new Promise((resolve) => {
            answer = resolve;
          });
        }
        return served!(cmd, args);
      });
      onTestFinished(() => answer(listing));
      useDiagramStore
        .getState()
        .applyOps([{ op: "add_node", node: { id: "mine", label: "mine", x: 0, y: 0 } }]);
      await flushAutosave();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(calls("list_library")).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(90_000);
      expect(calls("list_library")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("coming back to the window waits for a save on its way before it reads the tabs again", async () => {
    renderHook(() => useAutosave());
    await openLibraryDiagram("p1");
    renderHook(() => useLibraryWatch());
    await waitFor(() => expect(handlers[LIBRARY_CHANGED_EVENT]).toBeDefined());
    let land!: (answer: unknown) => void;
    const served = mockedInvoke.getMockImplementation();
    mockedInvoke.mockImplementation((cmd, args) => {
      if (cmd !== "save_project") return served!(cmd, args);
      // the file is written; the answer is on its way
      library.p1 = { doc: doc("Checkout", "a", "mine"), stamp: "5-5-ee" };
      return new Promise((resolve) => {
        land = resolve;
      });
    });
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "mine", label: "mine", x: 0, y: 0 } }]);
    const written = flushAutosave();
    await waitFor(() => expect(calls("save_project")).toHaveLength(1));
    const reads = calls("load_project").length;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {});
    expect(calls("load_project")).toHaveLength(reads);
    land({ kind: "saved", name: "Checkout", stamp: "5-5-ee" });
    await written;
    await waitFor(() => expect(calls("list_library").length).toBeGreaterThan(0));
    // its own write is no change from outside
    expect(toasts()).toEqual([]);
    expect(ids()).toEqual(["a", "mine"]);
  });

  it("a listing that fails closes nothing", async () => {
    await openLibraryDiagram("p1");
    renderHook(() => useLibraryWatch());
    await waitFor(() => expect(handlers[LIBRARY_CHANGED_EVENT]).toBeDefined());
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_library") throw new Error("no access");
      if (cmd === "load_project") throw new Error("no access");
      return undefined;
    });
    emit(LIBRARY_CHANGED_EVENT, { changed: ["p1"] });
    await waitFor(() => expect(useLibraryStore.getState().readFailed).toBe(true));
    expect(useAppStore.getState().tabs).toHaveLength(1);
  });

  it("something new turned up: the library is listed again, no tab is read", async () => {
    await openLibraryDiagram("p1");
    renderHook(() => useLibraryWatch());
    await waitFor(() => expect(handlers[LIBRARY_CHANGED_EVENT]).toBeDefined());
    const reads = calls("load_project").length;
    listing = project("p1", "p2", "p3");
    emit(LIBRARY_CHANGED_EVENT, { changed: [] });
    await waitFor(() => expect(useLibraryStore.getState().folders).toEqual(listing));
    expect(calls("load_project")).toHaveLength(reads);
  });

  it("an external file written to is read again; one removed closes", async () => {
    files["/x/a.dosik"] = JSON.stringify(doc("A", "a"));
    files["/x/b.dosik"] = JSON.stringify(doc("B", "b"));
    await openPathInTab("/x/a.dosik");
    await openPathInTab("/x/b.dosik");
    renderHook(() => useLibraryWatch());
    await waitFor(() => expect(handlers[FILES_CHANGED_EVENT]).toBeDefined());
    files["/x/b.dosik"] = JSON.stringify(doc("B", "b", "c"));
    emit(FILES_CHANGED_EVENT, { changed: ["/x/b.dosik"], removed: ["/x/a.dosik"] });
    await waitFor(() => expect(ids()).toEqual(["b", "c"]));
    expect(useAppStore.getState().tabs.map((t) => t.filePath)).toEqual(["/x/b.dosik"]);
    expect(toasts()).toEqual(["“A” was removed outside Dosik"]);
  });

  it("coming back to the window looks again: the library, every read tab, every external file", async () => {
    files["/x/a.dosik"] = JSON.stringify(doc("A", "a"));
    await openPathInTab("/x/a.dosik");
    await openLibraryDiagram("p1");
    renderHook(() => useLibraryWatch());
    await waitFor(() => expect(handlers[LIBRARY_CHANGED_EVENT]).toBeDefined());
    library.p1 = { doc: doc("Checkout", "a", "missed"), stamp: "2-3-dd" };
    files["/x/a.dosik"] = JSON.stringify(doc("A", "a", "missed too"));
    const lists = calls("list_library").length;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(ids()).toEqual(["a", "missed"]));
    expect(calls("list_library")).toHaveLength(lists + 1);
    const external = useAppStore.getState().tabs.find((t) => t.filePath === "/x/a.dosik");
    await waitFor(() =>
      expect(external && useAppStore.getState().tabs[0]?.doc?.nodes.map((n) => n.id)).toEqual([
        "a",
        "missed too",
      ]),
    );
  });

  it("says once how many diagrams the move of the older library left behind", async () => {
    const served = mockedInvoke.getMockImplementation();
    mockedInvoke.mockImplementation(async (cmd, args) =>
      cmd === "take_left_behind" ? 2 : served?.(cmd, args),
    );
    renderHook(() => useLibraryWatch());
    await waitFor(() =>
      expect(toasts()).toEqual([
        "Error: 2 diagrams couldn't be moved — they stay in the old library folder",
      ]),
    );
    expect(calls("take_left_behind")).toHaveLength(1);
  });

  it("one left behind is said so; none, nothing", async () => {
    let left = 1;
    const served = mockedInvoke.getMockImplementation();
    mockedInvoke.mockImplementation(async (cmd, args) =>
      cmd === "take_left_behind" ? left : served?.(cmd, args),
    );
    const { unmount } = renderHook(() => useLibraryWatch());
    await waitFor(() =>
      expect(toasts()).toEqual([
        "Error: 1 diagram couldn't be moved — it stays in the old library folder",
      ]),
    );
    unmount();
    useToastStore.getState().dismissAll();
    left = 0;
    renderHook(() => useLibraryWatch());
    await waitFor(() => expect(calls("take_left_behind")).toHaveLength(2));
    expect(toasts()).toEqual([]);
  });

  it("asks again after each listing until the move has told — a move tried again later counts too", async () => {
    // the first move failed: the question fails with it, until a listing moves it
    let moved = false;
    const served = mockedInvoke.getMockImplementation();
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd !== "take_left_behind") return served?.(cmd, args);
      if (!moved) throw new Error("moving the older library failed");
      return 3;
    });
    renderHook(() => useLibraryWatch());
    await waitFor(() => expect(calls("take_left_behind")).toHaveLength(1));
    // a listing that fails moves nothing
    useLibraryStore.setState({ folders: [], readFailed: true });
    await act(async () => {});
    expect(calls("take_left_behind")).toHaveLength(1);
    // a listing lands: the move went through this time
    moved = true;
    useLibraryStore.setState({ folders: project("p1"), readFailed: false });
    await waitFor(() =>
      expect(toasts()).toEqual([
        "Error: 3 diagrams couldn't be moved — they stay in the old library folder",
      ]),
    );
    // told: never asked again
    useLibraryStore.setState({ folders: project("p1", "p2"), readFailed: false });
    await act(async () => {});
    expect(calls("take_left_behind")).toHaveLength(2);
    expect(toasts()).toHaveLength(1);
  });

  it("tells Rust which external files are open, as the strip changes", async () => {
    files["/x/a.dosik"] = JSON.stringify(doc("A", "a"));
    renderHook(() => useLibraryWatch());
    const watched = () => calls("watch_files").map(([, a]) => (a as { paths: string[] }).paths);
    expect(watched()).toEqual([[]]);
    await act(() => openPathInTab("/x/a.dosik"));
    expect(watched().at(-1)).toEqual(["/x/a.dosik"]);
    // a library diagram changes nothing of it
    const sent = watched().length;
    await act(() => openLibraryDiagram("p1"));
    expect(watched()).toHaveLength(sent);
  });
});
