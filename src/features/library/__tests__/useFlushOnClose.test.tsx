import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { likeRust } from "../../../test/rustAnswers";
import { blankDoc } from "../libraryApi";
import { openDocument, resetTabsForTests } from "../tabActions";
import { resetUnsavedGuardForTests } from "../unsavedGuard";
import { resetAutosaveForTests, useAutosave } from "../useAutosave";
import { useFlushOnClose } from "../useFlushOnClose";

const mockedInvoke = vi.mocked(invoke);
const mockedWindow = vi.mocked(getCurrentWindow);
type CloseEvent = { preventDefault: ReturnType<typeof vi.fn<() => void>> };
type CloseHandler = (event: CloseEvent) => Promise<void> | void;
const mockedAsk = vi.mocked(ask);
const closeEvent = (): CloseEvent => ({ preventDefault: vi.fn<() => void>() });

describe("useFlushOnClose (#114)", () => {
  let closeHandler: CloseHandler | null;
  let unlisten: ReturnType<typeof vi.fn<() => void>>;
  let resolveListen!: (fn: () => void) => void;

  beforeEach(() => {
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
    resetTabsForTests();
    // saves answered as Rust answers them: written
    mockedInvoke.mockImplementation(likeRust());
    closeHandler = null;
    unlisten = vi.fn<() => void>();
    mockedWindow.mockReturnValue({
      onCloseRequested: vi.fn((handler: CloseHandler) => {
        closeHandler = handler;
        return new Promise<() => void>((resolve) => {
          resolveListen = resolve;
        });
      }),
    } as never);
  });

  it("writes a pending autosave on the window close request", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => {
        useAutosave();
        useFlushOnClose();
      });
      resolveListen(unlisten);
      openDocument(blankDoc(), { projectId: "p1" });
      useDiagramStore.getState().setTitle("Last words");
      expect(closeHandler).not.toBeNull();
      const event = closeEvent();
      await closeHandler!(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      const saves = mockedInvoke.mock.calls.filter(([c]) => c === "save_project");
      expect(saves).toHaveLength(1);
      expect(JSON.parse((saves[0]![1] as { contents: string }).contents).title).toBe("Last words");
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks when an external file has unsaved changes, and cancelling blocks the close (#123)", async () => {
    renderHook(() => useFlushOnClose());
    resolveListen(unlisten);
    openDocument(makeDoc([], []), { filePath: "/tmp/ext.dosik.json" });
    useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
    const event = closeEvent();
    await closeHandler!(event);
    expect(mockedAsk).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(useDiagramStore.getState().nodes).toHaveLength(1);
  });

  it("asks about dirty external tabs, active and inactive, all at once — combined wording, flush on discard (#218 T35)", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => {
        useAutosave();
        useFlushOnClose();
      });
      resolveListen(unlisten);
      openDocument(makeDoc([], []), { filePath: "/tmp/a.dosik.json" });
      useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
      openDocument(makeDoc([], []), { filePath: "/tmp/clean.dosik.json" });
      openDocument(makeDoc([], []), { filePath: "/tmp/b.dosik.json" });
      useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
      openDocument(blankDoc(), { projectId: "p1" });
      useDiagramStore.getState().setTitle("Last words");
      const cancel = closeEvent();
      await closeHandler!(cancel);
      expect(mockedAsk).toHaveBeenCalledTimes(1);
      expect(mockedAsk.mock.calls[0]![0]).toBe(
        "2 files have unsaved changes — “a.dosik.json”, “b.dosik.json”. Discard them?",
      );
      expect(cancel.preventDefault).toHaveBeenCalledTimes(1);
      // the library diagram's waiting autosave is written before the question
      // — a save that could not reach it would be asked about too
      const saves = () => mockedInvoke.mock.calls.filter(([c]) => c === "save_project");
      expect(saves()).toHaveLength(1);
      expect(JSON.parse((saves()[0]![1] as { contents: string }).contents).title).toBe(
        "Last words",
      );

      mockedAsk.mockResolvedValue(true);
      const discard = closeEvent();
      await closeHandler!(discard);
      expect(discard.preventDefault).not.toHaveBeenCalled();
      expect(saves()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("choosing discard does not block the close; with no changes it does not ask", async () => {
    renderHook(() => useFlushOnClose());
    resolveListen(unlisten);
    openDocument(makeDoc([], []), { filePath: "/tmp/ext.dosik.json" });
    const clean = closeEvent();
    await closeHandler!(clean);
    expect(mockedAsk).not.toHaveBeenCalled();
    expect(clean.preventDefault).not.toHaveBeenCalled();

    useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
    mockedAsk.mockResolvedValue(true);
    const dirty = closeEvent();
    await closeHandler!(dirty);
    expect(mockedAsk).toHaveBeenCalledTimes(1);
    expect(dirty.preventDefault).not.toHaveBeenCalled();
  });

  it("closing the window while typing a label writes that label too — commit comes before flush (#218)", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => {
        useAutosave();
        useFlushOnClose();
      });
      resolveListen(unlisten);
      openDocument(makeDoc([makeNode({ id: "n1", label: "old" })], []), { projectId: "p1" });
      const editor = document.createElement("textarea");
      document.body.append(editor);
      editor.focus();
      editor.addEventListener("blur", () =>
        useDiagramStore.getState().updateNodeData("n1", { label: "Payment" }),
      );
      const event = closeEvent();
      await closeHandler!(event);
      editor.remove();
      expect(event.preventDefault).not.toHaveBeenCalled();
      const saves = mockedInvoke.mock.calls.filter(([c]) => c === "save_project");
      expect(saves).toHaveLength(1);
      expect((saves[0]![1] as { contents: string }).contents).toContain("Payment");
    } finally {
      vi.useRealTimers();
    }
  });

  it("unregisters on the spot when registration finishes after unmount", async () => {
    const { unmount } = renderHook(() => useFlushOnClose());
    unmount();
    resolveListen(unlisten);
    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it("quietly does nothing outside Tauri (the window API throws)", () => {
    mockedWindow.mockImplementation(() => {
      throw new TypeError("no __TAURI_INTERNALS__");
    });
    expect(() => renderHook(() => useFlushOnClose())).not.toThrow();
  });
});
