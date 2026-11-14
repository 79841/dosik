import { invoke } from "@tauri-apps/api/core";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import type { DiagramDoc } from "../../../shared/lib/types";
import { registerViewportRead } from "../../canvas/canvasViewport";
import { useAppStore } from "../appStore";
import { DASHBOARD, type HomeView } from "../homeView";
import { blankDoc } from "../libraryApi";
import { useLibraryStore } from "../libraryStore";
import {
  closeActiveDocumentTab,
  closeDocumentTab,
  cycleTabs,
  goToNthTab,
  goToTab,
  newDiagram,
  openFileAnywhere,
  openFromLibrary,
  returnHome,
  showRecent,
  viewInHome,
} from "../navigation";
import { openDocument, resetTabsForTests } from "../tabActions";
import { hasUnsavedExternalChanges, resetUnsavedGuardForTests } from "../unsavedGuard";
import { resetAutosaveForTests, useAutosave } from "../useAutosave";

const WORK: HomeView = { kind: "folder", folder: "work" };
const mockedInvoke = vi.mocked(invoke);
const mockedAsk = vi.mocked(ask);
const mockedOpen = vi.mocked(open);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);
/** lets the writes and reads already under way land */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const book = (title: string): DiagramDoc => ({ version: 1, title, nodes: [], edges: [] });

/** load_project answers from `files`; every other command resolves undefined */
const serve = (files: Record<string, unknown> = {}) =>
  mockedInvoke.mockImplementation(async (cmd, args) => {
    if (cmd === "load_project") {
      const { id } = args as { id: string };
      if (!(id in files)) throw new Error(`no such diagram: ${id}`);
      return JSON.stringify(files[id]);
    }
    if (cmd === "read_text_file") return JSON.stringify({ ...blankDoc(), title: "External" });
    return undefined;
  });

/** an external file with one edit that is not on disk (#123) */
const editedExternalFile = () => {
  openDocument(makeDoc([], []), { filePath: "/tmp/ext.dosik.json" });
  useDiagramStore.getState().addNode("rect", { x: 10, y: 10 });
  expect(hasUnsavedExternalChanges()).toBe(true);
};

describe("navigation (#217 D2·D4·D5·D22, #218 D18)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useLibraryStore.setState({ folders: [], readFailed: false });
    useToastStore.getState().dismissAll();
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
    mockedOpen.mockReset();
    mockedOpen.mockResolvedValue(null);
    serve({ p1: book("Checkout"), p2: book("Ledger") });
  });

  describe("openFromLibrary", () => {
    it("opens a diagram with load_project and goes to the editor (T18)", async () => {
      await openFromLibrary("p1");
      expect(calls("load_project")).toEqual([["load_project", { id: "p1" }]]);
      expect(useAppStore.getState().view).toBe("editor");
      expect(useDiagramStore.getState()).toMatchObject({ projectId: "p1", title: "Checkout" });
    });

    it("does not reread a diagram that is already open (T18)", async () => {
      await openFromLibrary("p1");
      await openFromLibrary("p1");
      expect(calls("load_project")).toHaveLength(1);
    });

    it("toasts an error when it cannot open and stays on the current screen", async () => {
      await openFromLibrary("ghost");
      expect(toasts()).toEqual(["Error: no such diagram: ghost"]);
      expect(useAppStore.getState().view).toBe("home");
    });

    it("opens a new tab without asking even when an external file has unsaved changes — that file stays in its tab (#218 D8)", async () => {
      editedExternalFile();
      await openFromLibrary("p1");
      expect(mockedAsk).not.toHaveBeenCalled();
      expect(useDiagramStore.getState()).toMatchObject({ projectId: "p1" });
      expect(useAppStore.getState().tabs.map((t) => t.filePath ?? t.projectId)).toEqual([
        "/tmp/ext.dosik.json",
        "p1",
      ]);
    });

    it("an open (inactive) diagram — switches to its tab without rereading and keeps undo history (#218 D19)", async () => {
      await openFromLibrary("p1");
      useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
      await openFromLibrary("p2");
      await openFromLibrary("p1");
      expect(useDiagramStore.getState().projectId).toBe("p1");
      expect(useDiagramStore.getState().past).toHaveLength(1);
      expect(calls("load_project")).toHaveLength(2);
    });
  });

  describe("views — viewInHome (#220 D2, T7)", () => {
    it("viewInHome — activates the Home tab and changes the view; document tabs stay (#218 D3)", async () => {
      await openFromLibrary("p1");
      viewInHome({ kind: "recent" });
      expect(useAppStore.getState()).toMatchObject({ view: "home", homeView: { kind: "recent" } });
      expect(useAppStore.getState().tabs.map((t) => t.projectId)).toEqual(["p1"]);
    });

    it("viewInHome(focus) — a move inside the sheet requests title focus, a sidebar move does not (D16)", () => {
      const before = useAppStore.getState().homeFocus;
      viewInHome({ kind: "recent" });
      expect(useAppStore.getState().homeFocus).toBe(before);
      viewInHome({ kind: "folder", folder: "work" }, true);
      expect(useAppStore.getState().homeFocus).toBe(before + 1);
    });

    it("there is no way to view a diagram — no preview, so no viewDiagram either (#231 D1·D11)", async () => {
      const navigation: Record<string, unknown> = await import("../navigation");
      expect(navigation.viewDiagram).toBeUndefined();
    });
  });

  describe("viewInHome · returnHome", () => {
    it("from the editor to a project — that project's Home, the document stays in its tab (#218 D18)", async () => {
      await openFromLibrary("p1");
      viewInHome(WORK);
      expect(useAppStore.getState()).toMatchObject({ view: "home", homeView: WORK });
      expect(useDiagramStore.getState().projectId).toBeNull();
      expect(useAppStore.getState().tabs.map((t) => t.projectId)).toEqual(["p1"]);
    });

    it("on Home, only the screen changes", async () => {
      viewInHome(WORK);
      expect(useAppStore.getState()).toMatchObject({ view: "home", homeView: WORK });
      viewInHome(DASHBOARD);
      expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
    });

    it("Home tab — back to the last Home view; nothing happens on Home (D2)", async () => {
      useAppStore.getState().setHomeView(WORK);
      await openFromLibrary("p1");
      returnHome();
      expect(useAppStore.getState()).toMatchObject({ view: "home", homeView: WORK });
      const before = useAppStore.getState();
      returnHome();
      expect(useAppStore.getState()).toBe(before);
    });

    it("unsaved changes in an external file — going Home does not ask, and coming back keeps them (#218 D8)", async () => {
      editedExternalFile();
      viewInHome(WORK);
      expect(mockedAsk).not.toHaveBeenCalled();
      expect(useAppStore.getState().view).toBe("home");
      mockedOpen.mockResolvedValue("/tmp/ext.dosik.json");
      await openFileAnywhere();
      expect(useDiagramStore.getState().nodes).toHaveLength(1);
      expect(hasUnsavedExternalChanges()).toBe(true);
    });
  });

  it("Recent — to Home's Recent view, the document stays in its tab (#220 D10)", async () => {
    await openFromLibrary("p1");
    useAppStore.getState().setHomeView(WORK);
    showRecent();
    expect(useAppStore.getState()).toMatchObject({ view: "home", homeView: { kind: "recent" } });
    expect(useAppStore.getState().tabs).toHaveLength(1);
  });

  describe("newDiagram — shared by the toolbar, tree rows and Home", () => {
    it("creates it in that project and opens a new tab — unsaved external changes stay in their tab without asking (T21, #218 D11)", async () => {
      editedExternalFile();
      await newDiagram("work");
      expect(mockedAsk).not.toHaveBeenCalled();
      expect(calls("save_project")[0]![1]).toMatchObject({ folder: "work" });
      expect(useAppStore.getState().view).toBe("editor");
      expect(useAppStore.getState().tabs.map((t) => t.filePath ?? t.projectId)).toEqual([
        "/tmp/ext.dosik.json",
        useDiagramStore.getState().projectId,
      ]);
    });

    it("toasts an error when it cannot create and stays on the current screen", async () => {
      mockedInvoke.mockImplementation(async (cmd) => {
        if (cmd === "save_project") throw new Error("disk full");
        return undefined;
      });
      await newDiagram();
      expect(toasts()).toEqual(["Error: disk full"]);
      expect(useAppStore.getState().view).toBe("home");
    });
  });

  describe("openFileAnywhere (T23)", () => {
    it("pick, read, go to the editor — 'Diagram opened', starting in the saved state", async () => {
      mockedOpen.mockResolvedValue("/tmp/x.dosik.json");
      await openFileAnywhere();
      expect(useAppStore.getState().view).toBe("editor");
      expect(useDiagramStore.getState()).toMatchObject({
        filePath: "/tmp/x.dosik.json",
        title: "External",
      });
      expect(hasUnsavedExternalChanges()).toBe(false);
      expect(toasts()).toEqual(["Diagram opened"]);
    });

    it("clicking elsewhere while reading opens it as a background tab — and the toast says so (#218)", async () => {
      let fileRead: () => void = () => {};
      mockedInvoke.mockImplementation(async (cmd) => {
        if (cmd !== "read_text_file") return undefined;
        await new Promise<void>((resolve) => (fileRead = resolve));
        return JSON.stringify({ ...blankDoc(), title: "External" });
      });
      mockedOpen.mockResolvedValue("/tmp/x.dosik.json");
      const opening = openFileAnywhere();
      await settle();
      returnHome();
      fileRead();
      await opening;
      expect(useAppStore.getState().view).toBe("home");
      expect(useAppStore.getState().tabs.map((t) => t.filePath)).toEqual(["/tmp/x.dosik.json"]);
      expect(toasts()).toEqual(["Diagram opened in a new tab"]);
    });

    it("opening from a library diagram does not write the external file into that project", async () => {
      await openFromLibrary("p1");
      mockedOpen.mockResolvedValue("/tmp/x.dosik.json");
      await openFileAnywhere();
      // the library project is not written into by the external file
      expect(useDiagramStore.getState().projectId).toBeNull();
      expect(calls("save_project")).toHaveLength(0);
    });

    it("an already open file — switches to its tab without rereading, no toast (#218 T21)", async () => {
      mockedOpen.mockResolvedValue("/tmp/x.dosik.json");
      await openFileAnywhere();
      await openFromLibrary("p1");
      useToastStore.getState().dismissAll();
      await openFileAnywhere();
      expect(calls("read_text_file")).toHaveLength(1);
      expect(useDiagramStore.getState().filePath).toBe("/tmp/x.dosik.json");
      expect(toasts()).toEqual([]);
    });

    it("rereads the listing on leaving a library diagram only if something was written — after the write, so the row shows what was written (#217, #218)", async () => {
      renderHook(() => useAutosave());
      await openFromLibrary("p1");
      await openFromLibrary("p2");
      await settle();
      // nothing was edited: the listing still says what the files say
      expect(calls("list_library")).toHaveLength(0);
      useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
      mockedOpen.mockResolvedValue("/tmp/x.dosik.json");
      await openFileAnywhere();
      await vi.waitFor(() => expect(calls("list_library")).toHaveLength(1));
      const order = mockedInvoke.mock.calls.map(([c]) => c);
      expect(order.indexOf("save_project")).toBeLessThan(order.indexOf("list_library"));
      // from an external file the library has nothing new to show
      mockedOpen.mockResolvedValue("/tmp/y.dosik.json");
      await openFileAnywhere();
      await settle();
      expect(calls("list_library")).toHaveLength(1);
    });

    it("cancelling the picker changes nothing", async () => {
      await openFileAnywhere();
      expect(useAppStore.getState().view).toBe("home");
      expect(toasts()).toEqual([]);
    });

    it("goes to the picker without asking even when an external file has unsaved changes (#218 D8)", async () => {
      editedExternalFile();
      await openFileAnywhere();
      expect(mockedAsk).not.toHaveBeenCalled();
      expect(mockedOpen).toHaveBeenCalledTimes(1);
    });

    it("a broken file toasts an error — the document survives", async () => {
      useDiagramStore.getState().setTitle("Survivor");
      mockedOpen.mockResolvedValue("/tmp/broken.dosik.json");
      mockedInvoke.mockImplementation(async (cmd) =>
        cmd === "read_text_file" ? '{"nodes":"nope"}' : undefined,
      );
      await openFileAnywhere();
      expect(toasts()).toEqual(["Error: Not a valid diagram file"]);
      expect(useDiagramStore.getState().title).toBe("Survivor");
    });
  });
});

describe("newDiagram — +, ⌘T, ⌘N (#218 D11)", () => {
  beforeEach(() => {
    resetTabsForTests();
    useToastStore.getState().dismissAll();
  });

  it("opens a new diagram in a new tab, toasts on failure", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await newDiagram();
    expect(useAppStore.getState().tabs).toHaveLength(1);
    expect(useDiagramStore.getState().projectId).not.toBeNull();
    mockedInvoke.mockRejectedValueOnce(new Error("disk full"));
    await newDiagram();
    expect(useAppStore.getState().tabs).toHaveLength(1);
    expect(toasts()).toEqual(["Error: disk full"]);
  });
});

/**
 * Closing asks about unsaved edits through the dialog plugin, and switching
 * can fail after a read (#218): from the strip, the keys and the menu
 * each failure is a toast, never an unhandled rejection.
 */
describe("closing and switching tabs — failures toast (#218)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    mockedAsk.mockReset();
    serve({ p1: book("Checkout"), p2: book("Ledger") });
  });

  it("toasts when the confirmation dialog fails; the tab stays and it returns false", async () => {
    editedExternalFile();
    mockedAsk.mockRejectedValue(new Error("dialog gone"));
    const tab = useAppStore.getState().activeTab!;
    expect(await closeDocumentTab(tab)).toBe(false);
    expect(await closeActiveDocumentTab()).toBe(false);
    expect(toasts()).toEqual(["Error: dialog gone", "Error: dialog gone"]);
    expect(useAppStore.getState().tabs).toHaveLength(1);
  });

  it("no toast when closing or switching succeeds", async () => {
    await openFromLibrary("p1");
    await openFromLibrary("p2");
    const [first, second] = useAppStore.getState().tabs;
    await goToTab(first!.id);
    expect(useDiagramStore.getState().projectId).toBe("p1");
    await cycleTabs(1);
    expect(useDiagramStore.getState().projectId).toBe("p2");
    await goToNthTab(1);
    expect(useAppStore.getState().view).toBe("home");
    expect(await closeDocumentTab(second!.id)).toBe(true);
    await goToTab(first!.id);
    expect(await closeActiveDocumentTab()).toBe(true);
    expect(useAppStore.getState().tabs).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  it("toasts when switching fails", async () => {
    await openFromLibrary("p1");
    await openFromLibrary("p2");
    const [first] = useAppStore.getState().tabs;
    const off = registerViewportRead(() => {
      throw new Error("boom");
    });
    try {
      await goToTab(first!.id);
      await cycleTabs(-1);
      await goToNthTab(2);
    } finally {
      off();
    }
    expect(toasts()).toEqual(["Error: boom", "Error: boom", "Error: boom"]);
  });
});
