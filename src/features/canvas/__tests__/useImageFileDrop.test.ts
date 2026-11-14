import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { useAppStore } from "../../library/appStore";
import { openDocument, resetTabsForTests } from "../../library/tabActions";
import { resetUnsavedGuardForTests } from "../../library/unsavedGuard";
import { resetAutosaveForTests } from "../../library/useAutosave";
import type { DecodedImage } from "../imageInput";

// decoding needs createImageBitmap and a real <canvas>, which jsdom lacks —
// each picture is handed over when the test says so
const decode = vi.hoisted(() => ({ next: [] as ((image: DecodedImage) => void)[] }));
vi.mock("../imageInput", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../imageInput")>()),
  imageFromBlob: vi.fn(() => new Promise<DecodedImage>((resolve) => decode.next.push(resolve))),
}));

import { placeBlobs } from "../useImageFileDrop";

const PICTURE: DecodedImage = { src: "data:image/png;base64,iVBORw0KGgo=", width: 40, height: 20 };
const blob = () => async () => new Blob([], { type: "image/png" });
const store = () => useDiagramStore.getState();
const images = (nodes = store().nodes) => nodes.filter((n) => n.data.shape === "image");
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);
/** lets the awaits before a decode starts run */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("image drop — goes only into the document it was dropped on (#218)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    decode.next = [];
    openDocument(makeDoc([], [], "A"), { projectId: "a" });
  });

  it("lands where it was dropped when nothing changed", async () => {
    const dropping = placeBlobs([blob()], { x: 100, y: 100 });
    await settle();
    decode.next.shift()!(PICTURE);
    await dropping;
    expect(images()).toHaveLength(1);
    expect(toasts()).toEqual([]);
  });

  it("moving to another tab while reading — goes into no document, one toast", async () => {
    const dropping = placeBlobs([blob(), blob()], { x: 100, y: 100 });
    await settle();
    openDocument(makeDoc([], [], "B"), { projectId: "b" });
    decode.next.shift()!(PICTURE);
    await dropping;
    expect(images()).toEqual([]);
    const left = useAppStore.getState().tabs.find((t) => t.projectId === "a")!;
    expect(images(left.doc!.nodes)).toEqual([]);
    expect(toasts()).toEqual(["You left the diagram before the picture was added — add it again"]);
    // the rest of the drop is not read either
    expect(decode.next).toEqual([]);
  });

  it("leaving after the first of several images went in — only what went in stays", async () => {
    const dropping = placeBlobs([blob(), blob()], { x: 100, y: 100 });
    await settle();
    decode.next.shift()!(PICTURE);
    await vi.waitFor(() => expect(decode.next).toHaveLength(1));
    expect(images()).toHaveLength(1);
    openDocument(makeDoc([], [], "B"), { projectId: "b" });
    decode.next.shift()!(PICTURE);
    await dropping;
    expect(images()).toEqual([]);
    const left = useAppStore.getState().tabs.find((t) => t.projectId === "a")!;
    expect(images(left.doc!.nodes)).toHaveLength(1);
    expect(toasts()).toHaveLength(1);
  });
});
