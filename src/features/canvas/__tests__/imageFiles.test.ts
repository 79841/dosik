import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { useToastStore } from "../../../shared/lib/toastStore";
import {
  droppedImageFiles,
  droppedImagePaths,
  IMAGE_EXTENSIONS,
  IMAGE_FILE_MAX_BYTES,
  isImagePath,
  pickImageFile,
  readImageFile,
} from "../imageFiles";

describe("image files (#8)", () => {
  it("accepts only image extensions — the same list as Rust (images.rs)", () => {
    expect(isImagePath("/a/b/Shot.PNG")).toBe(true);
    expect(isImagePath("/a/photo.jpeg")).toBe(true);
    expect(isImagePath("/a/diagram.svg")).toBe(false);
    expect(isImagePath("/a/notes")).toBe(false);
    expect(IMAGE_EXTENSIONS).toEqual(["png", "jpg", "jpeg", "gif", "webp"]);
  });

  it("explains why when a drop has no images — instead of acting like nothing happened (#155)", () => {
    const before = useToastStore.getState().toasts.length;
    expect(droppedImagePaths(["/a/spec.pdf"])).toEqual([]);
    expect(useToastStore.getState().toasts.length).toBe(before + 1);
    expect(useToastStore.getState().toasts.at(-1)?.text).toMatch(/png, jpg, jpeg, gif, webp/);
    // With images mixed in, take just the images, quietly
    expect(droppedImagePaths(["/a/spec.pdf", "/a/shot.png"])).toEqual(["/a/shot.png"]);
    expect(useToastStore.getState().toasts.length).toBe(before + 1);
  });

  it("turns base64 from Rust into a typed Blob", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ mime: "image/png", base64: "iVBORw==" });
    const blob = await readImageFile("/tmp/a.png");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("read_image_file", { path: "/tmp/a.png" });
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(4);
  });

  it("the file picker shows only images, and cancelling reads nothing", async () => {
    vi.mocked(open).mockResolvedValueOnce(null);
    await expect(pickImageFile()).resolves.toBeNull();
    expect(vi.mocked(open)).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: "Image", extensions: IMAGE_EXTENSIONS }],
    });
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("read_image_file", expect.anything());
  });
});

describe("picture files dropped on the page itself — Windows, where the webview keeps file drops (spec R8)", () => {
  const file = (name: string, bytes = 10) => {
    const f = new File([], name);
    Object.defineProperty(f, "size", { value: bytes });
    return f;
  };
  const toasts = () => useToastStore.getState().toasts.map((t) => t.text);

  it("keeps the pictures by the same extension rule as Finder's paths", () => {
    useToastStore.getState().dismissAll();
    const shot = file("Shot.PNG");
    const photo = file("photo.webp");
    expect(droppedImageFiles([shot, file("notes.txt"), photo])).toEqual([shot, photo]);
    expect(toasts()).toEqual([]);
  });

  it("no picture among them: the same toast as a drop from Finder", () => {
    useToastStore.getState().dismissAll();
    expect(droppedImageFiles([file("spec.pdf")])).toEqual([]);
    expect(toasts()).toEqual([
      "Error: Only png, jpg, jpeg, gif, webp pictures can be dropped here",
    ]);
  });

  it("a picture past Rust's limit is not read — said in Rust's words", () => {
    useToastStore.getState().dismissAll();
    const big = file("huge.png", IMAGE_FILE_MAX_BYTES + 1);
    const ok = file("fine.png", IMAGE_FILE_MAX_BYTES);
    expect(droppedImageFiles([big, ok])).toEqual([ok]);
    expect(toasts()).toEqual([
      "Error: huge.png: the image is too large (25 MB; the limit is 25 MB)",
    ]);
  });

  it("the limit is the one images.rs reads Finder's files with", () => {
    const rust = readFileSync(join(process.cwd(), "src-tauri/src/images.rs"), "utf8");
    expect(rust).toContain("const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;");
    expect(IMAGE_FILE_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});
