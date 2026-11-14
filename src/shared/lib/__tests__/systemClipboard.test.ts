import { readImage, readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { describe, expect, it, vi } from "vitest";

import {
  hasClipboardImage,
  readClipboardImage,
  readClipboardText,
  writeClipboardText,
} from "../systemClipboard";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readImage: vi.fn(),
  readText: vi.fn(),
  writeText: vi.fn(),
}));

const fakeImage = (close = vi.fn(async () => {})) => ({
  size: vi.fn(async () => ({ width: 1, height: 1 })),
  rgba: vi.fn(async () => new Uint8Array(4)),
  close,
});

describe("closes the clipboard image resource after reading (#155)", () => {
  it("reading for paste", async () => {
    const image = fakeImage();
    vi.mocked(readImage).mockResolvedValueOnce(image as never);
    expect(await readClipboardImage()).toMatchObject({ width: 1, height: 1 });
    expect(image.close).toHaveBeenCalledOnce();
  });

  it("also when only checking it exists — without fetching pixels", async () => {
    const image = fakeImage();
    vi.mocked(readImage).mockResolvedValueOnce(image as never);
    expect(await hasClipboardImage()).toBe(true);
    expect(image.close).toHaveBeenCalledOnce();
    expect(image.rgba).not.toHaveBeenCalled();
  });

  it("closes even when the read fails, and a failed close does not change the result", async () => {
    const image = fakeImage(
      vi.fn(async () => {
        throw new Error("gone");
      }),
    );
    image.rgba.mockRejectedValueOnce(new Error("decode"));
    vi.mocked(readImage).mockResolvedValueOnce(image as never);
    expect(await readClipboardImage()).toBeNull();
    expect(image.close).toHaveBeenCalledOnce();
  });

  it("has nothing to close when there is no image", async () => {
    vi.mocked(readImage).mockRejectedValueOnce(new Error("no image"));
    expect(await hasClipboardImage()).toBe(false);
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
