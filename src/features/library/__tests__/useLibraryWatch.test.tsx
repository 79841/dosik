import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import type { DiagramDoc } from "../../../shared/lib/types";
import { useAppStore } from "../appStore";
import type { FolderMeta } from "../libraryApi";
import { useLibraryStore } from "../libraryStore";
import { openLibraryDiagram, openPathInTab, resetTabsForTests } from "../tabActions";
import { resetUnsavedGuardForTests } from "../unsavedGuard";
import { resetAutosaveForTests } from "../useAutosave";
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
