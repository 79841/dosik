import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { useAppStore } from "../appStore";
import { blankDoc } from "../libraryApi";
import { useLibraryStore } from "../libraryStore";
import { openFileAnywhere } from "../navigation";
import { openExternalFile, saveCurrentProjectNow } from "../projectActions";
import { openDocument, resetTabsForTests, showHomeTab } from "../tabActions";
import { resetUnsavedGuardForTests } from "../unsavedGuard";
import { resetAutosaveForTests } from "../useAutosave";

const mockedInvoke = vi.mocked(invoke);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);

/** Open… and the toolbar's Save — the rest is `tabActions`' own (#218) */
describe("projectActions (#114)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useLibraryStore.setState({ folders: [], readFailed: false });
    mockedInvoke.mockResolvedValue(undefined);
  });

  it("saveCurrentProjectNow writes even with no changes (explicit Save), on the same chain as autosave", async () => {
    openDocument(blankDoc(), { projectId: "p1" });
    await saveCurrentProjectNow("p1");
    await saveCurrentProjectNow("p1");
    expect(calls("save_project")).toHaveLength(2);
    expect(calls("save_project")[0]![1]).toMatchObject({ id: "p1" });
  });

  it("openExternalFile: picking a file opens it as an external file and goes to the editor; cancelling stays on Home", async () => {
    vi.mocked(open).mockResolvedValueOnce(null);
    expect(await openExternalFile()).toBe(false);
    expect(useAppStore.getState().view).toBe("home");

    vi.mocked(open).mockResolvedValueOnce("/tmp/ext.dosik.json");
    mockedInvoke.mockImplementation(async (cmd) =>
      cmd === "read_text_file" ? JSON.stringify({ ...blankDoc(), title: "External" }) : undefined,
    );
    expect(await openExternalFile()).toBe("shown");
    expect(useAppStore.getState().view).toBe("editor");
    expect(useDiagramStore.getState().filePath).toBe("/tmp/ext.dosik.json");
    expect(useDiagramStore.getState().projectId).toBeNull();
  });

  it("Open file… — a multi-page document toasts an error with that reason, the screen stays (#229 D2, T20)", async () => {
    useToastStore.getState().dismissAll();
    vi.mocked(open).mockResolvedValueOnce("/tmp/book.dosik.json");
    mockedInvoke.mockImplementation(async (cmd) =>
      cmd === "read_text_file"
        ? '{"version":2,"title":"Book","pages":[{"id":"p","name":"P","nodes":[],"edges":[]}]}'
        : undefined,
    );
    await openFileAnywhere();
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual([
      "Error: This diagram has pages — Dosik now opens one-canvas diagrams only",
    ]);
    expect(useAppStore.getState()).toMatchObject({ view: "home", tabs: [] });
  });

  it("openExternalFile: picking an already open file switches to its tab without rereading — false (#218 D9)", async () => {
    mockedInvoke.mockImplementation(async (cmd) =>
      cmd === "read_text_file" ? JSON.stringify({ ...blankDoc(), title: "External" }) : undefined,
    );
    vi.mocked(open).mockResolvedValueOnce("/tmp/ext.dosik.json");
    await openExternalFile();
    showHomeTab();
    vi.mocked(open).mockResolvedValueOnce("/tmp/ext.dosik.json");
    expect(await openExternalFile()).toBe(false);
    expect(calls("read_text_file")).toHaveLength(1);
    expect(useAppStore.getState().tabs).toHaveLength(1);
    expect(useDiagramStore.getState().filePath).toBe("/tmp/ext.dosik.json");
  });
});
