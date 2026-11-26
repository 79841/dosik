import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { openDocument, resetTabsForTests } from "../../library/tabActions";
import { resetUnsavedGuardForTests } from "../../library/unsavedGuard";
import { resetAutosaveForTests } from "../../library/useAutosave";

type Picture = { kind: "files"; paths: string[] } | { kind: "data"; mime: string; base64: string };

// the system clipboard is Tauri's: each read answers when the test says so
const clipboard = vi.hoisted(() => ({
  image: null as null | ((picture: Picture | null) => void),
  text: null as null | ((text: string | null) => void),
}));
vi.mock("../../../shared/lib/systemClipboard", () => ({
  readClipboardPicture: vi.fn(
    () => new Promise<Picture | null>((resolve) => (clipboard.image = resolve)),
  ),
  readClipboardText: vi.fn(
    () => new Promise<string | null>((resolve) => (clipboard.text = resolve)),
  ),
}));

// decoding needs createImageBitmap, which jsdom lacks — the rest of imageInput is real
vi.mock("../imageInput", async (original) => ({
  ...(await original<typeof import("../imageInput")>()),
  imageFromBlob: vi.fn(async () => ({
    src: "data:image/png;base64,iVBORw==",
    width: 2,
    height: 1,
  })),
}));

import { imagePasteDeps, pasteOntoCanvas } from "../imagePaste";

const store = () => useDiagramStore.getState();
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);
const LEFT = "You left the diagram before it was pasted — paste again";

describe("⌘V — pastes only into the document where it was pressed (#218)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    clipboard.image = null;
    clipboard.text = null;
    openDocument(makeDoc([makeNode({ id: "a" })], [], "A"), { projectId: "a" });
  });

  it("moving to another tab while the clipboard image is read — doesn't place it, shows a toast", async () => {
    const place = vi.spyOn(imagePasteDeps, "placeBlobs").mockResolvedValue();
    const pasting = pasteOntoCanvas();
    await vi.waitFor(() => expect(clipboard.image).not.toBeNull());
    openDocument(makeDoc([], [], "B"), { projectId: "b" });
    clipboard.image!({ kind: "data", mime: "image/png", base64: "iVBORw==" });
    await pasting;
    expect(place).not.toHaveBeenCalled();
    expect(toasts()).toEqual([LEFT]);
    place.mockRestore();
  });

  it("leaving while text is read — doesn't paste the shape buffer either", async () => {
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
    store().copySelection();
    const paste = vi.spyOn(store(), "paste");
    const pasting = pasteOntoCanvas();
    await vi.waitFor(() => expect(clipboard.image).not.toBeNull());
    clipboard.image!(null);
    await vi.waitFor(() => expect(clipboard.text).not.toBeNull());
    openDocument(makeDoc([], [], "B"), { projectId: "b" });
    clipboard.text!("just some text");
    await pasting;
    expect(paste).not.toHaveBeenCalled();
    expect(store().nodes).toEqual([]);
    expect(toasts()).toEqual([LEFT]);
    paste.mockRestore();
  });

  it("pastes as before when nothing changed", async () => {
    const paste = vi.spyOn(store(), "paste");
    const pasting = pasteOntoCanvas();
    await vi.waitFor(() => expect(clipboard.image).not.toBeNull());
    clipboard.image!(null);
    await vi.waitFor(() => expect(clipboard.text).not.toBeNull());
    clipboard.text!("just some text");
    await pasting;
    expect(paste).toHaveBeenCalledOnce();
    expect(toasts()).toEqual([]);
    paste.mockRestore();
  });
});

describe("⌘V — a picture crosses as a file, not as pixels", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    clipboard.image = null;
    clipboard.text = null;
    openDocument(makeDoc([], [], "A"), { projectId: "a" });
  });

  it("picture files copied in Finder or Explorer — each read from its file, as a drop reads it", async () => {
    const place = vi.spyOn(imagePasteDeps, "placeBlobs").mockResolvedValue();
    const pasting = pasteOntoCanvas();
    await vi.waitFor(() => expect(clipboard.image).not.toBeNull());
    clipboard.image!({ kind: "files", paths: ["/pics/a.png", "/pics/b.jpg"] });
    await pasting;
    expect(place).toHaveBeenCalledOnce();
    const [loads] = place.mock.calls[0]!;
    expect(loads).toHaveLength(2);
    vi.mocked(invoke).mockResolvedValue({ mime: "image/png", base64: "iVBORw==" });
    const first = await loads[0]!();
    expect(invoke).toHaveBeenCalledWith("read_image_file", { path: "/pics/a.png" });
    expect(first.type).toBe("image/png");
    // the shape buffer and the text are not looked at once a picture is there
    expect(clipboard.text).toBeNull();
    place.mockRestore();
  });

  it("a picture's own bytes (a screenshot's PNG) — placed as that file", async () => {
    const place = vi.spyOn(imagePasteDeps, "placeBlobs").mockResolvedValue();
    const pasting = pasteOntoCanvas();
    await vi.waitFor(() => expect(clipboard.image).not.toBeNull());
    clipboard.image!({ kind: "data", mime: "image/png", base64: "iVBORw==" });
    await pasting;
    const [loads] = place.mock.calls[0]!;
    expect(loads).toHaveLength(1);
    const blob = await loads[0]!();
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
    place.mockRestore();
  });

  it("copied files that hold no picture — says only pictures paste, and pastes nothing else", async () => {
    useDiagramStore.setState((st) => ({ nodes: st.nodes.map((n) => ({ ...n, selected: true })) }));
    const pasting = pasteOntoCanvas();
    await vi.waitFor(() => expect(clipboard.image).not.toBeNull());
    clipboard.image!({ kind: "files", paths: ["/docs/report.pdf", "/docs/photo.heic"] });
    await pasting;
    expect(toasts()).toEqual(["Error: Only png, jpg, jpeg, gif, webp pictures can be pasted here"]);
    expect(invoke).not.toHaveBeenCalledWith("read_image_file", expect.anything());
    expect(clipboard.text).toBeNull();
  });

  it("moving to another tab while a copied file is read — places it nowhere, says to paste again (#218)", async () => {
    let answer: (file: { mime: string; base64: string }) => void = () => undefined;
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "read_image_file" ? new Promise((resolve) => (answer = resolve)) : undefined,
    );
    const pasting = pasteOntoCanvas();
    await vi.waitFor(() => expect(clipboard.image).not.toBeNull());
    clipboard.image!({ kind: "files", paths: ["/pics/a.png"] });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("read_image_file", { path: "/pics/a.png" }),
    );
    openDocument(makeDoc([], [], "B"), { projectId: "b" });
    answer({ mime: "image/png", base64: "iVBORw==" });
    await pasting;
    expect(store().nodes).toEqual([]);
    expect(toasts()).toEqual([LEFT]);
  });

  it("a copied picture file pastes as an image node when nothing changed", async () => {
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "read_image_file" ? { mime: "image/png", base64: "iVBORw==" } : undefined,
    );
    const pasting = pasteOntoCanvas();
    await vi.waitFor(() => expect(clipboard.image).not.toBeNull());
    clipboard.image!({ kind: "files", paths: ["/pics/a.png"] });
    await pasting;
    expect(store().nodes.map((n) => n.data.shape)).toEqual(["image"]);
    expect(toasts()).toEqual([]);
  });
});
