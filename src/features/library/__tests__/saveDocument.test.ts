import { invoke } from "@tauri-apps/api/core";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { COMMIT_DRAFTS_EVENT } from "../../../shared/lib/commitDrafts";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { useAppStore } from "../appStore";
import { saveActiveDocument } from "../saveDocument";
import { activateTab, closeActiveTab, openDocument, resetTabsForTests } from "../tabActions";
import { hasUnsavedExternalChanges, resetUnsavedGuardForTests } from "../unsavedGuard";
import { resetAutosaveForTests } from "../useAutosave";
import { likeRust } from "../../../test/rustAnswers";

const mockedInvoke = vi.mocked(invoke);
const mockedSave = vi.mocked(save);
const mockedAsk = vi.mocked(ask);

const toasts = () => useToastStore.getState().toasts.map((t) => t.text);
const written = (): { path: string; contents: string } | undefined =>
  mockedInvoke.mock.calls.find(([cmd]) => cmd === "write_text_file")?.[1] as
    | { path: string; contents: string }
    | undefined;

/** an external file in its tab, then one edit that is not on disk */
const openExternalAndEdit = (path: string | null = "/tmp/ext.dosik.json") => {
  if (path) openDocument(makeDoc([], [], "Ext"), { filePath: path });
  else {
    openDocument(makeDoc([], [], "Ext"), { filePath: "/tmp/seed.dosik.json" });
    act(() => useDiagramStore.getState().setFilePath(null));
  }
  useDiagramStore.getState().addNode("rect", { x: 10, y: 10 });
};

/**
 * Save — the toolbar's button on an external file and ⌘S (#219 D5). One
 * function, the toolbar's old `handleSave`: a library diagram is written now
 * (it is autosaved anyway), an external file goes to its path, or to one a
 * dialog picks.
 */
describe("saveActiveDocument (#219 D5, T20)", () => {
  beforeEach(() => {
    resetTabsForTests();
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    useToastStore.getState().dismissAll();
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(likeRust());
    mockedSave.mockReset();
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
  });

  it("a library diagram is written right away without a dialog and says 'Saved'", async () => {
    openDocument(makeDoc([], [], "Mine"), { projectId: "p1" });
    await saveActiveDocument();
    expect(mockedInvoke).toHaveBeenCalledWith(
      "save_project",
      expect.objectContaining({ id: "p1" }),
    );
    expect(mockedSave).not.toHaveBeenCalled();
    expect(toasts()).toEqual(["Saved"]);
  });

  it("an external file is written to its path and the baseline moves — closing does not ask", async () => {
    openExternalAndEdit();
    await saveActiveDocument();
    expect(written()?.path).toBe("/tmp/ext.dosik.json");
    expect(mockedSave).not.toHaveBeenCalled();
    expect(toasts()).toEqual(["Saved"]);
    expect(await closeActiveTab()).toBe(true);
    expect(mockedAsk).not.toHaveBeenCalled();
  });

  it("without a path, a dialog picks one — a .dosik by default (#253 R11) — and that path becomes the document's", async () => {
    openExternalAndEdit(null);
    mockedSave.mockResolvedValue("/tmp/picked.dosik");
    await saveActiveDocument();
    expect(mockedSave).toHaveBeenCalledWith({
      defaultPath: "Ext.dosik",
      filters: [{ name: "Dosik Diagram", extensions: ["dosik"] }],
    });
    expect(written()?.path).toBe("/tmp/picked.dosik");
    expect(useDiagramStore.getState().filePath).toBe("/tmp/picked.dosik");
    expect(toasts()).toEqual(["Saved"]);
  });

  it("cancelling the dialog writes nothing and says nothing", async () => {
    openExternalAndEdit(null);
    mockedSave.mockResolvedValue(null);
    await saveActiveDocument();
    expect(written()).toBeUndefined();
    expect(toasts()).toEqual([]);
  });

  it("a failed write only toasts an error — the baseline remains, so closing asks", async () => {
    openExternalAndEdit();
    mockedInvoke.mockImplementation(
      likeRust(async (cmd: string) => {
        if (cmd === "write_text_file") throw new Error("disk full");
        return undefined;
      }),
    );
    await saveActiveDocument();
    expect(toasts()).toEqual(["Error: disk full"]);
    expect(await closeActiveTab()).toBe(false);
    expect(mockedAsk).toHaveBeenCalledTimes(1);
  });

  it("bridge edits that arrive during the write are not saved", async () => {
    openExternalAndEdit();
    let release: () => void = () => {};
    mockedInvoke.mockImplementation(
      likeRust((cmd: string) =>
        cmd === "write_text_file"
          ? new Promise<void>((resolve) => {
              release = resolve;
            })
          : Promise.resolve(undefined),
      ),
    );
    const saving = saveActiveDocument();
    await waitFor(() => expect(written()).toBeDefined());
    useDiagramStore
      .getState()
      .applyOps([{ op: "set_diagram", doc: makeDoc([makeNode({ id: "agent" })], []) }]);
    release();
    await saving;
    expect(toasts()).toEqual(["Saved"]);
    expect(await closeActiveTab()).toBe(false);
    expect(mockedAsk).toHaveBeenCalledTimes(1);
  });

  /**
   * A Save awaits the dialog and the disk, and the tabs can move meanwhile
   * (⌘W from the menu while the sheet is up, a file the OS hands over, a slow
   * volume). What the write did belongs to the document it wrote — never to
   * the one on screen when it lands (#218).
   */
  it("moving to another tab during the write keeps the path and baseline on the tab that saved — the current tab is untouched (#218)", async () => {
    openExternalAndEdit();
    const fileTab = useAppStore.getState().activeTab as string;
    let release: () => void = () => {};
    mockedInvoke.mockImplementation(
      likeRust((cmd: string) =>
        cmd === "write_text_file"
          ? new Promise<void>((resolve) => {
              release = resolve;
            })
          : Promise.resolve(undefined),
      ),
    );
    const saving = saveActiveDocument();
    await waitFor(() => expect(written()).toBeDefined());
    openDocument(makeDoc([], [], "Library"), { projectId: "p1" });
    release();
    await saving;
    expect(toasts()).toEqual(["Saved"]);
    // the library diagram on screen is not the file
    expect(useDiagramStore.getState()).toMatchObject({ projectId: "p1", filePath: null });
    expect(useAppStore.getState().tabs.find((t) => t.projectId === "p1")?.filePath).toBeNull();
    // the file's own tab is saved: back on it, closing does not ask
    await activateTab(fileTab);
    expect(useDiagramStore.getState().filePath).toBe("/tmp/ext.dosik.json");
    expect(hasUnsavedExternalChanges()).toBe(false);
    expect(await closeActiveTab()).toBe(true);
    expect(mockedAsk).not.toHaveBeenCalled();
  });

  it("when a tab opens while the save dialog is up — the chosen path attaches to the tab that started the save (#218)", async () => {
    openExternalAndEdit(null);
    const fileTab = useAppStore.getState().activeTab as string;
    let pick: (path: string) => void = () => {};
    mockedSave.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          pick = resolve;
        }),
    );
    const saving = saveActiveDocument();
    await waitFor(() => expect(mockedSave).toHaveBeenCalled());
    openDocument(makeDoc([], [], "Library"), { projectId: "p1" });
    pick("/tmp/picked.dosik.json");
    await saving;
    expect(toasts()).toEqual(["Saved"]);
    expect(useDiagramStore.getState()).toMatchObject({ projectId: "p1", filePath: null });
    expect(useAppStore.getState().tabs.find((t) => t.id === fileTab)?.filePath).toBe(
      "/tmp/picked.dosik.json",
    );
  });

  it("an open editor's text goes into the file as typed — the editor is not blurred (#219)", async () => {
    openExternalAndEdit();
    // an editor of the document, the way the label and title fields answer Save
    const input = document.createElement("input");
    input.value = "Typed just now";
    const onBlur = vi.fn();
    input.addEventListener("blur", onBlur);
    const write = () => useDiagramStore.getState().setTitle(input.value);
    window.addEventListener(COMMIT_DRAFTS_EVENT, write);
    document.body.append(input);
    input.focus();
    try {
      await saveActiveDocument();
      expect(input).toHaveFocus();
      expect(onBlur).not.toHaveBeenCalled();
      expect(JSON.parse(written()?.contents ?? "{}").title).toBe("Typed just now");
    } finally {
      window.removeEventListener(COMMIT_DRAFTS_EVENT, write);
      input.remove();
    }
  });

  it("does nothing on Home", async () => {
    useAppStore.setState({ view: "home" });
    await saveActiveDocument();
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(mockedSave).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });
});
