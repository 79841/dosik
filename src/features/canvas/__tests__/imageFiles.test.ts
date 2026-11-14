import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { describe, expect, it, vi } from "vitest";

import { useToastStore } from "../../../shared/lib/toastStore";
import {
  droppedImagePaths,
  IMAGE_EXTENSIONS,
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
