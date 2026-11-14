import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeClipboardText } from "../../../shared/lib/systemClipboard";
import { useToastStore } from "../../../shared/lib/toastStore";
import { libraryPath, showInFinder } from "../libraryApi";
import { copyItemPath, showItemInFinder } from "../libraryActions";

vi.mock("../../../shared/lib/systemClipboard", () => ({ writeClipboardText: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const toasts = () => useToastStore.getState().toasts.map((t) => ({ text: t.text, kind: t.kind }));
const PATH = {
  path: "/Users/u/Library/Application Support/x/projects/Pkear8FSk7",
  shown: "~/Library/Application Support/x/projects/Pkear8FSk7",
};

/** a folder's or diagram's place on disk, and Finder (#238 R1·R4) */
describe("real path API (#238 T2)", () => {
  beforeEach(() => mockedInvoke.mockReset());

  it("libraryPath passes the kind and id to library_path and gets {path, shown}", async () => {
    mockedInvoke.mockResolvedValueOnce(PATH);
    expect(await libraryPath("folder", "Pkear8FSk7")).toEqual(PATH);
    expect(mockedInvoke).toHaveBeenLastCalledWith("library_path", {
      kind: "folder",
      id: "Pkear8FSk7",
    });
  });

  it("showInFinder passes the kind and id to show_in_finder — not the path", async () => {
    await showInFinder("diagram", "bZhMHwxXLe");
    expect(mockedInvoke).toHaveBeenLastCalledWith("show_in_finder", {
      kind: "diagram",
      id: "bZhMHwxXLe",
    });
  });
});

describe("Copy Path (#238 T3)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    vi.mocked(writeClipboardText).mockReset();
    useToastStore.getState().dismissAll();
  });

  it("writes the absolute path to the clipboard and toasts 'Path copied'", async () => {
    mockedInvoke.mockResolvedValueOnce(PATH);
    vi.mocked(writeClipboardText).mockResolvedValueOnce(true);
    await copyItemPath("folder", "Pkear8FSk7");
    // the whole path, not the `~` one: a tilde means nothing outside a shell
    expect(writeClipboardText).toHaveBeenCalledWith(PATH.path);
    expect(toasts()).toEqual([{ text: "Path copied", kind: "info" }]);
  });

  it("toasts an error when the path cannot be read — the clipboard is untouched", async () => {
    mockedInvoke.mockRejectedValueOnce('no such folder: "gone"');
    await copyItemPath("folder", "gone");
    expect(writeClipboardText).not.toHaveBeenCalled();
    expect(toasts()).toEqual([{ text: 'Error: no such folder: "gone"', kind: "error" }]);
  });

  it("toasts an error when the clipboard write fails", async () => {
    mockedInvoke.mockResolvedValueOnce(PATH);
    vi.mocked(writeClipboardText).mockResolvedValueOnce(false);
    await copyItemPath("diagram", "bZhMHwxXLe");
    expect(toasts()).toEqual([{ text: "Error: Couldn't copy the path", kind: "error" }]);
  });
});

describe("Show in Finder (#238 T4)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    useToastStore.getState().dismissAll();
  });

  it("says nothing when it opens", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await showItemInFinder("folder", "Pkear8FSk7");
    expect(mockedInvoke).toHaveBeenLastCalledWith("show_in_finder", {
      kind: "folder",
      id: "Pkear8FSk7",
    });
    expect(toasts()).toEqual([]);
  });

  it("toasts an error when it cannot open — does not throw", async () => {
    mockedInvoke.mockRejectedValueOnce("Failed to open path");
    await expect(showItemInFinder("diagram", "x")).resolves.toBeUndefined();
    expect(toasts()).toEqual([{ text: "Error: Failed to open path", kind: "error" }]);
  });
});
