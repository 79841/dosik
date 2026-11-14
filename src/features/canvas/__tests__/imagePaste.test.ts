import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { openDocument, resetTabsForTests } from "../../library/tabActions";
import { resetUnsavedGuardForTests } from "../../library/unsavedGuard";
import { resetAutosaveForTests } from "../../library/useAutosave";

type Picture = { rgba: Uint8Array; width: number; height: number };

// the system clipboard is Tauri's: each read answers when the test says so
const clipboard = vi.hoisted(() => ({
  image: null as null | ((picture: Picture | null) => void),
  text: null as null | ((text: string | null) => void),
}));
vi.mock("../../../shared/lib/systemClipboard", () => ({
  readClipboardImage: vi.fn(
    () => new Promise<Picture | null>((resolve) => (clipboard.image = resolve)),
  ),
  readClipboardText: vi.fn(
    () => new Promise<string | null>((resolve) => (clipboard.text = resolve)),
  ),
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
    const place = vi.spyOn(imagePasteDeps, "placeFromRgba").mockImplementation(() => "img");
    const pasting = pasteOntoCanvas();
    await vi.waitFor(() => expect(clipboard.image).not.toBeNull());
    openDocument(makeDoc([], [], "B"), { projectId: "b" });
    clipboard.image!({ rgba: new Uint8Array(4), width: 1, height: 1 });
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
