import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  classify,
  formatSize,
  fromBase64,
  fromFile,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  pickFiles,
  fromFiles,
  readDroppedFiles,
  roomFor,
  sniffImage,
  TEXT_INLINE_MAX,
  toAttachment,
  toBase64,
  tooLarge,
} from "../attachments";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const bytes = (text: string) => new TextEncoder().encode(text);

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];

describe("classify", () => {
  it("a picture by its bytes — a .png that is a JPEG is a JPEG", () => {
    expect(classify("shot.PNG", "image/png", new Uint8Array(PNG))).toEqual({
      kind: "image",
      mime: "image/png",
    });
    expect(classify("shot.png", "image/png", new Uint8Array(JPEG))).toEqual({
      kind: "image",
      mime: "image/jpeg",
    });
    expect(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe("image/gif");
    expect(sniffImage(bytes("RIFF....WEBP"))).toBe("image/webp");
    expect(sniffImage(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("a PDF by its bytes", () => {
    expect(classify("spec.pdf", "", bytes("%PDF-1.7"))).toEqual({
      kind: "pdf",
      mime: "application/pdf",
    });
    expect(classify("not.pdf", "", new Uint8Array([0, 1])).kind).toBe("file");
  });

  it("a picture the vendors do not read is one to convert", () => {
    expect(classify("IMG_0001.HEIC", "", new Uint8Array([0, 0, 0, 24])).kind).toBe("convert");
    expect(classify("scan.tiff", "", new Uint8Array([0x49, 0x49])).kind).toBe("convert");
  });

  it("words: UTF-8 all the way with no NUL — multi-byte included", () => {
    expect(classify("notes.md", "", bytes("# café · 日本語"))).toEqual({
      kind: "text",
      mime: "text/plain",
      text: "# café · 日本語",
    });
    expect(classify("data.json", "application/json", bytes("{}"))).toMatchObject({ kind: "text" });
  });

  it("a text file too long to go inside the message keeps no words", () => {
    const long = classify("big.log", "", new Uint8Array(TEXT_INLINE_MAX + 1).fill(0x61));
    expect(long).toEqual({ kind: "text", mime: "text/plain" });
  });

  it("anything else is a file: NUL bytes, broken UTF-8", () => {
    expect(classify("flows.sketch", "", new Uint8Array([80, 75, 0, 4]))).toEqual({
      kind: "file",
      mime: "application/octet-stream",
    });
    expect(classify("x.bin", "", new Uint8Array([0xff, 0xfe, 0xfd])).kind).toBe("file");
  });
});

describe("sizes and limits", () => {
  it("formats a size the way a person reads it", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(4 * 1024)).toBe("4 KB");
    expect(formatSize(1.25 * 1024 * 1024)).toBe("1.3 MB");
    expect(formatSize(2 * 1024 * 1024)).toBe("2 MB");
    expect(formatSize(24 * 1024 * 1024)).toBe("24 MB");
  });

  it("says which file is too large and the limit", () => {
    expect(tooLarge("report.zip", 24 * 1024 * 1024)).toBe(
      "report.zip is too large (24 MB; the limit is 20 MB)",
    );
  });

  it("reads only as many files as there is room for, and names the rest", async () => {
    expect(roomFor(8)).toBe(2);
    expect(roomFor(12)).toBe(0);
    const files = ["a.txt", "b.txt", "c.txt"].map((n) => new File(["x"], n));
    const loaded = await fromFiles(files, 2);
    expect(loaded.attachments.map((a) => a.name)).toEqual(["a.txt", "b.txt"]);
    expect(loaded.errors).toEqual([
      `Up to ${MAX_ATTACHMENTS} files per message: c.txt not attached`,
    ]);
  });
});

describe("toAttachment", () => {
  it("round-trips the bytes as base64, and keeps the base64 it was given", async () => {
    const a = await toAttachment("a.txt", "", bytes("hello"));
    expect(a).toMatchObject({ name: "a.txt", kind: "text", size: 5, text: "hello" });
    expect(new TextDecoder().decode(fromBase64(a.base64))).toBe("hello");
    expect(toBase64(new Uint8Array([0xff, 0, 1]))).toBe("/wAB");
    const given = await toAttachment("b.txt", "", bytes("hi"), undefined, "GIVEN");
    expect(given.base64).toBe("GIVEN");
  });

  it("a picture that fits goes as it is", async () => {
    const fitImage = vi.fn(async () => "keep" as const);
    const a = await toAttachment("small.png", "", new Uint8Array(PNG), fitImage, "B64");
    expect(fitImage).toHaveBeenCalledWith(expect.any(Blob), false);
    expect(a).toMatchObject({ kind: "image", mime: "image/png", base64: "B64" });
  });

  it("a picture too big or too wide goes redrawn", async () => {
    const fitImage = vi.fn(async () => new Blob([new Uint8Array(10)], { type: "image/jpeg" }));
    const a = await toAttachment("huge.png", "", new Uint8Array(PNG), fitImage, "OLD");
    expect(a).toMatchObject({ kind: "image", mime: "image/jpeg", size: 10 });
    expect(a.base64).not.toBe("OLD");
  });

  it("refuses a picture it cannot bring under the limit", async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    await expect(toAttachment("huge.png", "", big, async () => null)).rejects.toThrow(
      "huge.png is too large to send as a picture",
    );
  });

  it("converts a HEIC the webview can decode; one it cannot stays a plain file", async () => {
    const png = vi.fn(async () => new Blob([new Uint8Array(PNG)], { type: "image/png" }));
    const heic = await toAttachment("IMG_1.heic", "", new Uint8Array([0, 0, 0, 24]), png);
    expect(png).toHaveBeenCalledWith(expect.any(Blob), true);
    expect(heic).toMatchObject({ kind: "image", mime: "image/png" });
    const unreadable = await toAttachment(
      "IMG_2.heic",
      "",
      new Uint8Array([0, 0, 0, 24]),
      async () => null,
    );
    expect(unreadable).toMatchObject({ kind: "file" });
  });
});

describe("fromFile", () => {
  it("names a pasted screenshot that came without a name", async () => {
    const file = new File([new Uint8Array(PNG)], "", { type: "image/png" });
    expect(await fromFile(file, async () => "keep")).toMatchObject({
      name: "pasted.png",
      kind: "image",
    });
  });

  it("refuses a file past 20 MB before reading it", async () => {
    const file = new File(["x"], "big.zip");
    Object.defineProperty(file, "size", { value: 21 * 1024 * 1024 });
    await expect(fromFile(file)).rejects.toThrow(
      "big.zip is too large (21 MB; the limit is 20 MB)",
    );
  });
});

describe("files Rust reads", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("the file dialog's picks become attachments; refusals become errors", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { name: "notes.md", size: 5, mime: "text/plain", base64: toBase64(bytes("hello")) },
      { name: "big.zip", size: 0, error: "big.zip is too large (21 MB; the limit is 20 MB)" },
    ]);
    const { attachments, errors } = await pickFiles(10);
    expect(invoke).toHaveBeenCalledWith("pick_chat_files", { room: 10 });
    expect(attachments.map((a) => [a.name, a.kind])).toEqual([["notes.md", "text"]]);
    expect(errors).toEqual(["big.zip is too large (21 MB; the limit is 20 MB)"]);
  });

  it("names the files Rust left unread for want of room", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { name: "a.txt", size: 1, base64: toBase64(bytes("a")) },
      { name: "b.txt", size: 0, left: true },
    ]);
    const { attachments, errors } = await pickFiles(1);
    expect(attachments.map((a) => a.name)).toEqual(["a.txt"]);
    expect(errors).toEqual([`Up to ${MAX_ATTACHMENTS} files per message: b.txt not attached`]);
  });

  it("asks only for the dropped paths", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await readDroppedFiles(["/x/a.png"], 3);
    expect(invoke).toHaveBeenCalledWith("read_dropped_files", { paths: ["/x/a.png"], room: 3 });
  });
});
