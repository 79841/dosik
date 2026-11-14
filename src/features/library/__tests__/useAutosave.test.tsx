import { invoke } from "@tauri-apps/api/core";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { blankDoc } from "../libraryApi";
import {
  AUTOSAVE_DEBOUNCE_MS,
  flushAutosave,
  resetAutosaveForTests,
  useAutosave,
} from "../useAutosave";

const mockedInvoke = vi.mocked(invoke);
const saves = () => mockedInvoke.mock.calls.filter(([cmd]) => cmd === "save_project");
const addNode = (id: string) =>
  useDiagramStore.getState().applyOps([{ op: "add_node", node: { id, label: id, x: 0, y: 0 } }]);

describe("useAutosave (#114)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAutosaveForTests();
    useDiagramStore.getState().loadDoc(blankDoc(), null);
    useToastStore.getState().dismissAll();
    mockedInvoke.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("opening a project by itself does not save", () => {
    renderHook(() => useAutosave());
    useDiagramStore.getState().openProject("p1", blankDoc());
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(saves()).toHaveLength(0);
  });

  it("saves once 500ms after a change — consecutive changes merge into one", async () => {
    renderHook(() => useAutosave());
    useDiagramStore.getState().openProject("p1", blankDoc());
    addNode("a");
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 100);
    addNode("b");
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(saves()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves()).toHaveLength(1);
    const [, args] = saves()[0]!;
    expect(args).toMatchObject({ id: "p1" });
    expect(JSON.parse((args as { contents: string }).contents).nodes).toHaveLength(2);
  });

  it("saves title changes too", async () => {
    renderHook(() => useAutosave());
    useDiagramStore.getState().openProject("p1", blankDoc());
    useDiagramStore.getState().setTitle("Renamed");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(JSON.parse((saves()[0]![1] as { contents: string }).contents).title).toBe("Renamed");
  });

  it("flushAutosave writes the pending save right away — the timer does not write again afterwards", async () => {
    renderHook(() => useAutosave());
    useDiagramStore.getState().openProject("p1", blankDoc());
    addNode("a");
    await flushAutosave();
    expect(saves()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(saves()).toHaveLength(1);
  });

  it("flush writes nothing when nothing is pending", async () => {
    renderHook(() => useAutosave());
    await flushAutosave();
    expect(saves()).toHaveLength(0);
  });

  it("does not autosave external files (filePath)", async () => {
    renderHook(() => useAutosave());
    useDiagramStore.getState().loadDoc(blankDoc(), "/tmp/mine.dosik.json");
    addNode("a");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(saves()).toHaveLength(0);
  });

  it("does not autosave a document that lives nowhere (both null) either", async () => {
    renderHook(() => useAutosave());
    addNode("a");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(saves()).toHaveLength(0);
  });

  it("reports a save failure with an error toast and does not let the exception escape", async () => {
    renderHook(() => useAutosave());
    useDiagramStore.getState().openProject("p1", blankDoc());
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "save_project") throw new Error("disk full");
      return undefined;
    });
    addNode("a");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(["Error: disk full"]);
  });

  it("does not write with the old id if the document changed after scheduling — an external file does not end up in a project", async () => {
    renderHook(() => useAutosave());
    useDiagramStore.getState().openProject("p1", blankDoc());
    addNode("a");
    // Open without a flush: the external document replaces the store before the timer fires
    useDiagramStore
      .getState()
      .loadDoc({ ...blankDoc(), title: "Someone's file" }, "/tmp/x.dosik.json");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(saves()).toHaveLength(0);
  });

  it("flush waits until a write already in progress finishes", async () => {
    renderHook(() => useAutosave());
    useDiagramStore.getState().openProject("p1", blankDoc());
    let finish!: () => void;
    mockedInvoke.mockImplementation(
      (cmd) =>
        new Promise((resolve) => {
          if (cmd === "save_project") finish = () => resolve(undefined);
          else resolve(undefined);
        }),
    );
    addNode("a");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(saves()).toHaveLength(1);
    let flushed = false;
    const flushing = flushAutosave().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    finish();
    await flushing;
    expect(flushed).toBe(true);
  });

  it("changes that do not actually alter the document (selection, measurement) do not rewrite the file", async () => {
    renderHook(() => useAutosave());
    useDiagramStore.getState().openProject("p1", blankDoc());
    addNode("a");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(saves()).toHaveLength(1);
    // what React Flow does on click / mount: a new node array with only selection or measurement changed
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => ({ ...n, selected: true, measured: { width: 160, height: 56 } })),
    }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(saves()).toHaveLength(1);
    // a real edit still writes
    addNode("b");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(saves()).toHaveLength(2);
  });

  it("undoing back to earlier bytes during a slow write still writes that state again", async () => {
    renderHook(() => useAutosave());
    useDiagramStore.getState().openProject("p1", blankDoc());
    // only the first write is slow; the writes queued behind it resolve at once
    let finish: (() => void) | null = null;
    mockedInvoke.mockImplementation(
      (cmd) =>
        new Promise((resolve) => {
          if (cmd === "save_project" && finish === null) finish = () => resolve(undefined);
          else resolve(undefined);
        }),
    );
    addNode("a");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(saves()).toHaveLength(1); // C1 in flight
    useDiagramStore.getState().undo(); // back to C0 while C1 is still writing
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    finish!();
    await flushAutosave();
    // C0 must follow C1 to the file — it is not "already written"
    expect(saves()).toHaveLength(2);
    expect(JSON.parse((saves()[1]![1] as { contents: string }).contents).nodes).toHaveLength(0);
  });

  it("after a failed write, the next schedule writes again even with the same bytes", async () => {
    renderHook(() => useAutosave());
    useDiagramStore.getState().openProject("p1", blankDoc());
    let fail = true;
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "save_project" && fail) throw new Error("disk full");
      return undefined;
    });
    addNode("a");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(saves()).toHaveLength(1);
    fail = false;
    // the retry comes from the next change; here it is an identical-bytes change
    useDiagramStore.setState((st) => ({ nodes: [...st.nodes] }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(saves()).toHaveLength(2);
  });

  it("after two failures in a row, returning to the bytes from the first failure still writes — rollback is relative to the disk", async () => {
    renderHook(() => useAutosave());
    useDiagramStore.getState().openProject("p1", blankDoc());
    let fail = true;
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "save_project" && fail) throw new Error("disk full");
      return undefined;
    });
    addNode("a"); // C1 — fails
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    addNode("b"); // C2 — fails
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(saves()).toHaveLength(2);
    fail = false;
    useDiagramStore.getState().undo(); // back to C1, which never reached the disk
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(saves()).toHaveLength(3);
    const written = JSON.parse((saves()[2]![1] as { contents: string }).contents);
    expect(written.nodes.map((n: { id: string }) => n.id)).toEqual(["a"]);
  });

  it("flushing right before switching projects writes with the previous project id", async () => {
    renderHook(() => useAutosave());
    useDiagramStore.getState().openProject("p1", blankDoc());
    addNode("a");
    // what the toolbar does before switching: flush, then open the next one
    const flushing = flushAutosave();
    useDiagramStore.getState().openProject("p2", blankDoc());
    await flushing;
    expect(saves()).toHaveLength(1);
    expect(saves()[0]![1]).toMatchObject({ id: "p1" });
  });
});
