import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hasClipboardPicture,
  readClipboardPicture,
  readClipboardText,
  writeClipboardText,
} from "../systemClipboard";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
}));

describe("a clipboard picture crosses as a file, through Rust", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("reads what Rust found — copied picture files or a picture's bytes", async () => {
    const files = { kind: "files", paths: ["/a.png"] };
    vi.mocked(invoke).mockResolvedValueOnce(files);
    expect(await readClipboardPicture()).toEqual(files);
    expect(invoke).toHaveBeenLastCalledWith("read_clipboard_picture");
  });

  it("null when there is none or no Tauri — does not throw", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    expect(await readClipboardPicture()).toBeNull();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("no Tauri"));
    expect(await readClipboardPicture()).toBeNull();
  });

  it("checks for one without carrying it over", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true);
    expect(await hasClipboardPicture()).toBe(true);
    expect(invoke).toHaveBeenLastCalledWith("clipboard_has_picture");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("no Tauri"));
    expect(await hasClipboardPicture()).toBe(false);
  });
});

describe("reading clipboard text (#200)", () => {
  it("returns the text", async () => {
    vi.mocked(readText).mockResolvedValueOnce("flowchart LR");
    expect(await readClipboardText()).toBe("flowchart LR");
  });

  it("null when there is no text or no Tauri — does not throw", async () => {
    vi.mocked(readText).mockRejectedValueOnce(new Error("not text"));
    expect(await readClipboardText()).toBeNull();
  });
});

describe("writing clipboard text — returns whether it worked (#238 T11)", () => {
  it("true when written", async () => {
    vi.mocked(writeText).mockResolvedValueOnce(undefined);
    expect(await writeClipboardText("/a/b")).toBe(true);
    expect(writeText).toHaveBeenLastCalledWith("/a/b");
  });

  it("false when it cannot write — does not throw", async () => {
    vi.mocked(writeText).mockRejectedValueOnce(new Error("no Tauri"));
    expect(await writeClipboardText("/a/b")).toBe(false);
  });
});
