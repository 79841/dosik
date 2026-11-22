import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { registerViewportRead } from "../../canvas/canvasViewport";
import { useAppStore } from "../appStore";
import { blankDoc } from "../libraryApi";
import { useLibraryStore } from "../libraryStore";
import {
  activateTab,
  closeActiveTab,
  closeTab,
  openDocument,
  openLibraryDiagram,
  openPathInTab,
  pruneUnlisted,
  resetTabsForTests,
  restoreActiveTab,
  showHomeTab,
} from "../tabActions";
import { type DocTab, newTab, SESSION_KEY } from "../tabModel";
import { useTabSession } from "../tabSession";
import { hasUnsavedExternalChanges, resetUnsavedGuardForTests } from "../unsavedGuard";
import { resetAutosaveForTests } from "../useAutosave";
import { likeRust } from "../../../test/rustAnswers";

const mockedInvoke = vi.mocked(invoke);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const app = () => useAppStore.getState();
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);
const saved = () => JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");

const doc = (title: string) => ({ ...blankDoc(), title });

/** load_project answers from `files`; `pending` ids wait for `release` */
const serve = (files: Record<string, string>, pending: Record<string, () => void> = {}) =>
  mockedInvoke.mockImplementation(
    likeRust(async (cmd, args) => {
      if (cmd === "load_project") {
        const { id } = args as { id: string };
        if (id in pending) await new Promise<void>((resolve) => (pending[id] = resolve));
        if (!(id in files)) throw new Error(`no such diagram: ${id}`);
        // a document with pages: never shipped, never opened (#229 D2)
        if (files[id] === "BOOK")
          return '{"version":2,"title":"Book","pages":[{"id":"p","name":"P","nodes":[],"edges":[]}]}';
        return JSON.stringify(doc(files[id]!));
      }
      if (cmd === "read_text_file") return JSON.stringify(doc("External"));
      return undefined;
    }),
  );

/** tabs as the app starts with them: from the session, none read yet */
const restored = (...ids: string[]): DocTab[] =>
  ids.map((projectId) => newTab({ projectId, filePath: null, title: `Saved ${projectId}` }, false));
const startWith = (...ids: string[]) =>
  app().commitTabs({ tabs: restored(...ids), activeTab: null });

describe("session restore (#218 D15, T31)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useLibraryStore.setState({ folders: [], readFailed: false });
    useToastStore.getState().dismissAll();
    serve({ p1: "One", p2: "Two", p3: "Three" });
  });

  it("reads and opens only the active tab — the rest when they first become active", async () => {
    startWith("p1", "p2", "p3");
    await restoreActiveTab("p2");
    expect(calls("load_project")).toEqual([["load_project", { id: "p2" }]]);
    expect(useDiagramStore.getState()).toMatchObject({ projectId: "p2", title: "Two" });
    expect(app().tabs.map((t) => t.loaded)).toEqual([false, true, false]);
    await activateTab(app().tabs[0]!.id);
    expect(useDiagramStore.getState().title).toBe("One");
    expect(calls("load_project")).toHaveLength(2);
  });

  it("reads nothing when Home was active", async () => {
    startWith("p1");
    await restoreActiveTab(null);
    expect(calls("load_project")).toHaveLength(0);
    expect(app().view).toBe("home");
  });

  it("yields when something else becomes active during the read — what was read stays in its tab", async () => {
    const pending: Record<string, () => void> = { p1: () => {} };
    serve({ p1: "One" }, pending);
    startWith("p1");
    const restoring = restoreActiveTab("p1");
    expect(app().tabs[0]!.loading).toBe(true);
    // a file the OS handed over lands first
    openDocument(doc("From Finder"), { filePath: "/x/finder.dosik.json" });
    pending.p1!();
    await restoring;
    expect(useDiagramStore.getState().title).toBe("From Finder");
    expect(app().tabs[0]).toMatchObject({ loaded: true, loading: false, title: "One" });
    expect(app().tabs[0]!.doc?.title).toBe("One");
  });

  it("clicking two unread tabs in a row — the later one wins, and a read that finished first yields too", async () => {
    const pending: Record<string, () => void> = { p1: () => {}, p2: () => {} };
    serve({ p1: "One", p2: "Two" }, pending);
    startWith("p1", "p2");
    const [one, two] = app().tabs;
    const first = activateTab(one!.id);
    const second = activateTab(two!.id);
    await waitFor(() => expect(calls("load_project")).toHaveLength(2));
    pending.p1!();
    await first;
    // the first read is done, but the user asked for the second since
    expect(app().view).toBe("home");
    pending.p2!();
    await second;
    expect(useDiagramStore.getState().title).toBe("Two");
    expect(app().tabs.map((t) => t.loaded)).toEqual([true, true]);
  });

  describe("a tab being read — the later request wins (#218)", () => {
    const pending: Record<string, () => void> = {};
    const tabFor = (projectId: string) => app().tabs.find((t) => t.projectId === projectId)!;
    beforeEach(() => {
      for (const id of Object.keys(pending)) delete pending[id];
    });

    it("clicking the same tab twice reads once and opens that tab", async () => {
      pending.p1 = () => {};
      serve({ p1: "One" }, pending);
      startWith("p1");
      const first = activateTab(tabFor("p1").id);
      const second = activateTab(tabFor("p1").id);
      pending.p1!();
      await Promise.all([first, second]);
      expect(calls("load_project")).toHaveLength(1);
      expect(useDiagramStore.getState().title).toBe("One");
    });

    it("going to Y while X is being read and then clicking X again opens X", async () => {
      pending.p1 = () => {};
      serve({ p1: "One", p2: "Two" }, pending);
      startWith("p1", "p2");
      const first = activateTab(tabFor("p1").id);
      await activateTab(tabFor("p2").id);
      expect(useDiagramStore.getState().title).toBe("Two");
      const again = activateTab(tabFor("p1").id);
      pending.p1!();
      await Promise.all([first, again]);
      expect(useDiagramStore.getState().title).toBe("One");
      expect(calls("load_project")).toHaveLength(2);
    });

    it("closing the active tab while its right neighbour is being read — the neighbour opens, not Home", async () => {
      pending.p2 = () => {};
      serve({ p1: "One", p2: "Two" }, pending);
      startWith("p1", "p2");
      await activateTab(tabFor("p1").id);
      const reading = activateTab(tabFor("p2").id);
      expect(await closeActiveTab()).toBe(true);
      expect(app().view).toBe("home");
      pending.p2!();
      await reading;
      await waitFor(() => expect(app().view).toBe("editor"));
      expect(useDiagramStore.getState().title).toBe("Two");
    });

    it("when the closed tab's neighbour is not read yet — shows Home, reads, then opens it", async () => {
      pending.p2 = () => {};
      serve({ p1: "One", p2: "Two" }, pending);
      startWith("p1", "p2");
      await activateTab(tabFor("p1").id);
      await closeActiveTab();
      expect(app().view).toBe("home");
      expect(tabFor("p2").loading).toBe(true);
      pending.p2!();
      await waitFor(() => expect(app().view).toBe("editor"));
      expect(useDiagramStore.getState().title).toBe("Two");
    });

    it("a tab closed during its read does not come back or take the screen", async () => {
      pending.p1 = () => {};
      serve({ p1: "One" }, pending);
      startWith("p1", "p2");
      const reading = activateTab(tabFor("p1").id);
      await closeTab(tabFor("p1").id);
      pending.p1!();
      await reading;
      expect(app().tabs.map((t) => t.projectId)).toEqual(["p2"]);
      expect(app().view).toBe("home");
    });

    it("no toast when the read of a tab closed during the read fails", async () => {
      pending.gone = () => {};
      serve({}, pending);
      startWith("gone", "p2");
      const reading = activateTab(tabFor("gone").id);
      await closeTab(tabFor("gone").id);
      pending.gone!();
      await reading;
      expect(app().tabs.map((t) => t.projectId)).toEqual(["p2"]);
      expect(toasts()).toEqual([]);
    });

    it("a tab being read is not dropped even if missing from the listing — the read decides", async () => {
      pending.p1 = () => {};
      serve({ p1: "One" }, pending);
      startWith("p1", "p2");
      const reading = activateTab(tabFor("p1").id);
      pruneUnlisted(new Set());
      expect(app().tabs.map((t) => t.projectId)).toEqual(["p1"]);
      pending.p1!();
      await reading;
      expect(useDiagramStore.getState().title).toBe("One");
    });

    it("when switching fails after the read — not 'Couldn't reopen', and the read tab stays", async () => {
      serve({ p1: "One", p2: "Two" });
      startWith("p1", "p2");
      await activateTab(tabFor("p1").id);
      const off = registerViewportRead(() => {
        throw new Error("boom");
      });
      try {
        await expect(activateTab(tabFor("p2").id)).rejects.toThrow("boom");
      } finally {
        off();
      }
      expect(app().tabs.map((t) => [t.projectId, t.loaded])).toEqual([
        ["p1", true],
        ["p2", true],
      ]);
      expect(tabFor("p2").loading).toBe(false);
      expect(toasts()).toEqual([]);
    });

    describe("clicking Home or the active tab, and opening, are requests too (#218)", () => {
      it("clicking the Home tab while a restored tab is being read — even when already on Home — the read tab does not take the screen", async () => {
        pending.p1 = () => {};
        serve({ p1: "One" }, pending);
        startWith("p1");
        const restoring = restoreActiveTab("p1");
        showHomeTab();
        pending.p1!();
        await restoring;
        expect(app().view).toBe("home");
        expect(tabFor("p1")).toMatchObject({ loaded: true, loading: false });
        expect(tabFor("p1").doc?.title).toBe("One");
      });

      it("clicking a project in the sidebar does the same — Home shows that project", async () => {
        pending.p1 = () => {};
        serve({ p1: "One" }, pending);
        startWith("p1");
        const restoring = restoreActiveTab("p1");
        showHomeTab({ kind: "folder", folder: "work" });
        pending.p1!();
        await restoring;
        expect(app()).toMatchObject({
          view: "home",
          homeView: { kind: "folder", folder: "work" },
        });
      });

      it("clicking the currently active tab again during a read stays on that tab", async () => {
        pending.p2 = () => {};
        serve({ p1: "One", p2: "Two" }, pending);
        startWith("p1", "p2");
        await activateTab(tabFor("p1").id);
        const reading = activateTab(tabFor("p2").id);
        await activateTab(tabFor("p1").id);
        pending.p2!();
        await reading;
        expect(useDiagramStore.getState().title).toBe("One");
        expect(tabFor("p2")).toMatchObject({ loaded: true, loading: false });
      });

      it("clicking unread B while X opens from the tree — B opens even if X finishes first, and X only gets a tab", async () => {
        pending.p2 = () => {};
        pending.p3 = () => {};
        serve({ p1: "One", p2: "Two", p3: "Three" }, pending);
        startWith("p1", "p2");
        const opening = openLibraryDiagram("p3");
        const reading = activateTab(tabFor("p2").id);
        pending.p3!();
        await opening;
        // X has its tab, read, at the end of the strip — not on screen
        expect(app().view).toBe("home");
        expect(tabFor("p3")).toMatchObject({ loaded: true, title: "Three" });
        expect(tabFor("p3").doc?.title).toBe("Three");
        pending.p2!();
        await reading;
        expect(useDiagramStore.getState().title).toBe("Two");
        expect(app().tabs.map((t) => t.projectId)).toEqual(["p1", "p2", "p3"]);
        // and it comes up as read, without reading again
        await activateTab(tabFor("p3").id);
        expect(useDiagramStore.getState()).toMatchObject({ projectId: "p3", title: "Three" });
        expect(calls("load_project")).toHaveLength(2);
      });

      it("clicking X again after B (joining its read) makes X win", async () => {
        pending.p2 = () => {};
        pending.p3 = () => {};
        serve({ p1: "One", p2: "Two", p3: "Three" }, pending);
        startWith("p1", "p2");
        const opening = openLibraryDiagram("p3");
        const reading = activateTab(tabFor("p2").id);
        const again = openLibraryDiagram("p3");
        pending.p2!();
        await reading;
        expect(app().view).toBe("home");
        pending.p3!();
        await Promise.all([opening, again]);
        expect(useDiagramStore.getState().title).toBe("Three");
        expect(calls("load_project")).toHaveLength(2);
      });

      it("clicking B while an external file is being read — the file tab is created clean and B opens", async () => {
        let fileRead!: () => void;
        const files: Record<string, string> = { p2: "Two" };
        pending.p2 = () => {};
        mockedInvoke.mockImplementation(
          likeRust(async (cmd, args) => {
            if (cmd === "read_text_file") {
              await new Promise<void>((resolve) => (fileRead = resolve));
              return JSON.stringify(doc("External"));
            }
            if (cmd === "load_project") {
              const { id } = args as { id: string };
              await new Promise<void>((resolve) => (pending[id] = resolve));
              return JSON.stringify(doc(files[id]!));
            }
            return undefined;
          }),
        );
        startWith("p2");
        const opening = openPathInTab("/x/ext.dosik.json");
        const reading = activateTab(tabFor("p2").id);
        await waitFor(() => expect(fileRead).toBeDefined());
        fileRead();
        expect(await opening).toBe(true);
        expect(app().view).toBe("home");
        await waitFor(() => expect(calls("load_project")).toHaveLength(1));
        pending.p2!();
        await reading;
        expect(useDiagramStore.getState().title).toBe("Two");
        const file = app().tabs.find((t) => t.filePath === "/x/ext.dosik.json")!;
        expect(file.doc?.title).toBe("External");
        // nothing was edited: closing it does not ask
        await activateTab(file.id);
        expect(useDiagramStore.getState().filePath).toBe("/x/ext.dosik.json");
        expect(hasUnsavedExternalChanges()).toBe(false);
        expect(await closeActiveTab()).toBe(true);
      });
    });
  });

  it("drops the tab and toasts when it cannot be read", async () => {
    startWith("gone", "p1");
    await restoreActiveTab("gone");
    expect(app().tabs.map((t) => t.projectId)).toEqual(["p1"]);
    expect(toasts()).toEqual(["Couldn't reopen “Saved gone”"]);
    expect(app().view).toBe("home");
  });

  it("a tab holding a multi-page document is dropped with 'Couldn't reopen' too (#229 D2, T20)", async () => {
    serve({ p1: "One", book: "BOOK" });
    startWith("book", "p1");
    await restoreActiveTab("book");
    expect(app().tabs.map((t) => t.projectId)).toEqual(["p1"]);
    expect(toasts()).toEqual(["Couldn't reopen “Saved book”"]);
    expect(app().view).toBe("home");
  });

  it("an unloaded tab missing from a successful listing is dropped silently, and kept when the listing fails", async () => {
    startWith("p1", "p2");
    renderHook(() => useTabSession());
    act(() => useLibraryStore.setState({ folders: [], readFailed: true }));
    expect(app().tabs).toHaveLength(2);
    act(() =>
      useLibraryStore.setState({
        folders: [
          {
            id: "f",
            name: "F",
            updatedAt: 1,
            diagrams: [{ id: "p2", title: "Two", updatedAt: 1, readable: false }],
            folders: [],
          },
        ],
        readFailed: false,
      }),
    );
    expect(app().tabs.map((t) => t.projectId)).toEqual(["p2"]);
  });

  it("an unloaded tab whose diagram a project holds out of reach stays (#253)", () => {
    startWith("p1", "p2");
    renderHook(() => useTabSession());
    act(() =>
      useLibraryStore.setState({
        folders: [
          {
            id: "f",
            name: "F",
            updatedAt: 0,
            diagrams: [],
            folders: [],
            missing: true,
            held: ["p1"],
          },
        ],
        readFailed: false,
      }),
    );
    expect(app().tabs.map((t) => t.projectId)).toEqual(["p1"]);
  });

  it("a diagram in nested folders is in the listing too — its tab stays (#229 D8)", () => {
    startWith("p1", "p2");
    renderHook(() => useTabSession());
    act(() =>
      useLibraryStore.setState({
        folders: [
          {
            id: "f",
            name: "F",
            updatedAt: 1,
            diagrams: [],
            folders: [
              {
                id: "sub",
                name: "Sub",
                updatedAt: 1,
                diagrams: [{ id: "p1", title: "One", updatedAt: 1, readable: true }],
                folders: [],
              },
            ],
          },
        ],
        readFailed: false,
      }),
    );
    expect(app().tabs.map((t) => t.projectId)).toEqual(["p1"]);
    expect(toasts()).toEqual([]);
  });
});

describe("starting from the saved session (#218 D15)", () => {
  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("tabs are created unread and the hook opens the active tab", async () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        v: 1,
        tabs: [
          { projectId: "p1", title: "One" },
          { projectId: "p2", title: "Two" },
        ],
        active: "p2",
      }),
    );
    vi.resetModules();
    const appStore = await import("../appStore");
    const session = await import("../tabSession");
    const store = await import("../../../shared/lib/store");
    // the fresh module graph has its own Tauri mock
    const core = await import("@tauri-apps/api/core");
    vi.mocked(core.invoke).mockImplementation(
      likeRust(async (cmd, args) =>
        cmd === "load_project"
          ? JSON.stringify(doc((args as { id: string }).id === "p2" ? "Two" : "One"))
          : undefined,
      ),
    );
    expect(appStore.useAppStore.getState()).toMatchObject({ view: "home", activeTab: null });
    expect(
      appStore.useAppStore.getState().tabs.map((t) => [t.projectId, t.title, t.loaded]),
    ).toEqual([
      ["p1", "One", false],
      ["p2", "Two", false],
    ]);
    renderHook(() => session.useTabSession());
    await waitFor(() => expect(appStore.useAppStore.getState().view).toBe("editor"));
    expect(store.useDiagramStore.getState()).toMatchObject({ projectId: "p2", title: "Two" });
  });
});

describe("saving the session (#218 D15, T32)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    serve({ p1: "One", p2: "Two" });
  });

  it("updates on every open, switch and close, and external tabs are dropped", async () => {
    renderHook(() => useTabSession());
    await openLibraryDiagram("p1");
    expect(saved()).toEqual({ v: 1, tabs: [{ projectId: "p1", title: "One" }], active: "p1" });
    await openPathInTab("/x/e.dosik.json");
    await openLibraryDiagram("p2");
    expect(saved().tabs.map((t: { projectId: string }) => t.projectId)).toEqual(["p1", "p2"]);
    expect(saved().active).toBe("p2");
    await activateTab(null);
    expect(saved().active).toBeNull();
    await activateTab(app().tabs[0]!.id);
    await closeActiveTab();
    expect(saved()).toEqual({ v: 1, tabs: [{ projectId: "p2", title: "Two" }], active: null });
  });

  it("does not throw when storage is blocked", async () => {
    renderHook(() => useTabSession());
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      await expect(openLibraryDiagram("p1")).resolves.toBeUndefined();
      expect(useDiagramStore.getState().projectId).toBe("p1");
    } finally {
      setItem.mockRestore();
    }
  });
});
