import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { handleCanvasKeyDown } from "../canvasKeymap";

// the system clipboard is Tauri's; here it holds no picture unless a test says so
const clipboard = vi.hoisted(() => ({
  readClipboardImage: vi.fn(
    async () => null as null | { rgba: Uint8Array; width: number; height: number },
  ),
  writeClipboardText: vi.fn(async () => {}),
  hasClipboardImage: vi.fn(async () => false),
  readClipboardText: vi.fn(async () => null as string | null),
}));
vi.mock("../../../shared/lib/systemClipboard", () => clipboard);

/** lets the async half of Cmd+V (the clipboard read) finish */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** A keydown that records whether the handler claimed it. */
const press = (
  key: string,
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
  tagName = "DIV",
  {
    editable = false,
    nokey = false,
    nodelete = false,
  }: { editable?: boolean; nokey?: boolean; nodelete?: boolean } = {},
): { prevented: boolean } => {
  let prevented = false;
  const event = {
    key,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    target: {
      tagName,
      getAttribute: (a: string) => (a === "contenteditable" && editable ? "true" : null),
      isContentEditable: editable,
      closest: (sel: string) =>
        (sel === ".nokey" && nokey) || (sel === ".nodelete" && nodelete) ? {} : null,
    },
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as KeyboardEvent;
  handleCanvasKeyDown(event);
  return { prevented };
};

describe(".nodelete — blocks only deletion and lets undo and clipboard through (#129)", () => {
  beforeEach(() => {
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "a" })], []), null);
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
  });

  it("Backspace does not reach — shapes must not be deleted from the chat panel's handles and buttons", () => {
    press("Backspace", {}, "DIV", { nodelete: true });
    expect(useDiagramStore.getState().nodes).toHaveLength(1);
    // Without nodelete, the same spot deletes
    press("Backspace");
    expect(useDiagramStore.getState().nodes).toHaveLength(0);
  });

  it("Cmd+Z reaches — with nokey, undo would die", () => {
    useDiagramStore.getState().updateNodeData("a", { label: "changed" });
    expect(useDiagramStore.getState().nodes[0]!.data.label).toBe("changed");
    press("z", { meta: true }, "DIV", { nodelete: true });
    expect(useDiagramStore.getState().nodes[0]!.data.label).not.toBe("changed");
  });
});

describe("handleCanvasKeyDown", () => {
  beforeEach(() => {
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "a" })], []), null);
    // The buffer is meant to survive loadDoc — loadDoc already resets pasteCount
    useDiagramStore.setState({ clipboard: null });
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: true })),
    }));
  });

  it("Cmd+C calls copySelection", () => {
    const spy = vi.spyOn(useDiagramStore.getState(), "copySelection");

    const { prevented } = press("c", { meta: true });

    expect(spy).toHaveBeenCalledOnce();
    expect(prevented).toBe(true);
    spy.mockRestore();
  });

  it("Cmd+V calls paste — when the system clipboard has no image", async () => {
    press("c", { meta: true });
    const spy = vi.spyOn(useDiagramStore.getState(), "paste");

    const { prevented } = press("v", { meta: true });
    await settle();

    expect(spy).toHaveBeenCalledOnce();
    expect(prevented).toBe(true);
    spy.mockRestore();
  });

  it("Cmd+C does not swallow the event when there is nothing to copy", () => {
    // Cancelling keydown stops the copy command that follows — if the canvas
    // copied nothing, the event belongs to someone else (spec R7)
    useDiagramStore.getState().clearSelection();

    expect(press("c", { meta: true }).prevented).toBe(false);
  });

  it("the canvas takes Cmd+V even with an empty buffer — the system clipboard may hold an image (#8)", () => {
    // Nothing else on the canvas takes ⌘V. While typing text it is left alone, as in the test below
    expect(useDiagramStore.getState().clipboard).toBeNull();

    expect(press("v", { meta: true }).prevented).toBe(true);
  });

  it("Ctrl+C / Ctrl+V behave the same (Windows · Linux)", async () => {
    expect(press("c", { ctrl: true }).prevented).toBe(true);
    expect(press("v", { ctrl: true }).prevented).toBe(true);
    await settle();

    expect(useDiagramStore.getState().nodes).toHaveLength(2);
  });

  it("a copy-paste round trip actually makes a copy", async () => {
    press("c", { meta: true });
    press("v", { meta: true });
    await settle();

    expect(useDiagramStore.getState().nodes).toHaveLength(2);
  });

  it("copying shapes while an image is on the clipboard overwrites it with the label — so the old image doesn't hijack ⌘V (#8)", async () => {
    clipboard.writeClipboardText.mockClear();
    clipboard.hasClipboardImage.mockResolvedValueOnce(true);
    press("c", { meta: true });
    await settle();
    expect(clipboard.writeClipboardText).toHaveBeenCalledWith("a");
  });

  it("leaves the system clipboard alone when there is no image — a copied URL survives (#155)", async () => {
    clipboard.writeClipboardText.mockClear();
    press("c", { meta: true });
    await settle();
    expect(clipboard.writeClipboardText).not.toHaveBeenCalled();
  });

  it("cut does the same — overwrites only when there is an image", async () => {
    clipboard.writeClipboardText.mockClear();
    clipboard.hasClipboardImage.mockResolvedValueOnce(true);
    press("x", { meta: true });
    await settle();
    expect(clipboard.writeClipboardText).toHaveBeenCalledWith("a");
  });

  it("pastes images at the mouse position too", async () => {
    const { registerPointerAt } = await import("../canvasViewport");
    const off = registerPointerAt(() => ({ x: 700, y: 300 }));
    const pasteImage = await import("../imagePaste");
    const place = vi
      .spyOn(pasteImage.imagePasteDeps, "placeFromRgba")
      .mockImplementation(() => "img");
    clipboard.readClipboardImage.mockResolvedValueOnce({
      rgba: new Uint8Array(4),
      width: 1,
      height: 1,
    });
    press("v", { meta: true });
    await settle();
    expect(place).toHaveBeenCalledWith(expect.any(Uint8Array), 1, 1, { x: 700, y: 300 });
    off();
    place.mockRestore();
  });

  it("pastes the image when the system clipboard has one — before the shape buffer", async () => {
    press("c", { meta: true });
    const paste = vi.spyOn(useDiagramStore.getState(), "paste");
    const pasteImage = await import("../imagePaste");
    const place = vi
      .spyOn(pasteImage.imagePasteDeps, "placeFromRgba")
      .mockImplementation(() => "img");
    clipboard.readClipboardImage.mockResolvedValueOnce({
      rgba: new Uint8Array(4),
      width: 1,
      height: 1,
    });

    press("v", { meta: true });
    await settle();

    expect(place).toHaveBeenCalledOnce();
    expect(paste).not.toHaveBeenCalled();
    place.mockRestore();
    paste.mockRestore();
  });

  it("draws Mermaid code from the clipboard — before the shape buffer (#200)", {
    timeout: 15000,
  }, async () => {
    press("c", { meta: true });
    // the copy's own look at the clipboard finishes first
    await settle();
    const paste = vi.spyOn(useDiagramStore.getState(), "paste");
    clipboard.readClipboardText.mockResolvedValueOnce("```mermaid\nflowchart LR\n  x --> y\n```");

    press("v", { meta: true });
    await vi.waitFor(
      () => {
        const toasts = useToastStore.getState().toasts.map((t) => t.text);
        expect(useDiagramStore.getState().nodes, toasts.join("; ")).toHaveLength(3);
      },
      { timeout: 10000 },
    );

    const labels = useDiagramStore.getState().nodes.map((n) => n.data.label);
    expect(labels).toEqual(["a", "x", "y"]);
    expect(useDiagramStore.getState().edges).toHaveLength(1);
    expect(paste).not.toHaveBeenCalled();
    paste.mockRestore();
  });

  it("draws Mermaid where the mouse is — that point is the block's center", {
    timeout: 15000,
  }, async () => {
    const { registerPointerAt } = await import("../canvasViewport");
    const off = registerPointerAt(() => ({ x: 3000, y: 2000 }));
    clipboard.readClipboardText.mockResolvedValueOnce("flowchart LR\n  x --> y");
    press("v", { meta: true });
    await vi.waitFor(() => expect(useDiagramStore.getState().nodes).toHaveLength(3), {
      timeout: 10000,
    });
    off();
    const drawn = useDiagramStore.getState().nodes.filter((n) => n.id !== "a");
    const left = Math.min(...drawn.map((n) => n.position.x));
    const right = Math.max(...drawn.map((n) => n.position.x + (n.width ?? 0)));
    const top = Math.min(...drawn.map((n) => n.position.y));
    const bottom = Math.max(...drawn.map((n) => n.position.y + (n.height ?? 0)));
    expect((left + right) / 2).toBeCloseTo(3000, -1);
    expect((top + bottom) / 2).toBeCloseTo(2000, -1);
  });

  it("plain text pastes the shape buffer as before", async () => {
    press("c", { meta: true });
    await settle();
    const paste = vi.spyOn(useDiagramStore.getState(), "paste");
    clipboard.readClipboardText.mockResolvedValueOnce("just some text");
    press("v", { meta: true });
    await settle();
    expect(paste).toHaveBeenCalledOnce();
    paste.mockRestore();
  });

  it("an image takes precedence over Mermaid", async () => {
    const pasteImage = await import("../imagePaste");
    const place = vi
      .spyOn(pasteImage.imagePasteDeps, "placeFromRgba")
      .mockImplementation(() => "img");
    clipboard.readClipboardImage.mockResolvedValueOnce({
      rgba: new Uint8Array(4),
      width: 1,
      height: 1,
    });
    press("v", { meta: true });
    await settle();
    expect(place).toHaveBeenCalledOnce();
    // the picture is pasted without even reading the text
    expect(clipboard.readClipboardText).not.toHaveBeenCalled();
    expect(useDiagramStore.getState().nodes).toHaveLength(1);
    place.mockRestore();
  });

  it("copying shapes overwrites Mermaid on the clipboard with the label — so old Mermaid doesn't hijack ⌘V", async () => {
    clipboard.writeClipboardText.mockClear();
    clipboard.readClipboardText.mockResolvedValueOnce("sequenceDiagram\n  a->>b: hi");
    press("c", { meta: true });
    await settle();
    expect(clipboard.writeClipboardText).toHaveBeenCalledWith("a");
  });

  it("does not read the label the app wrote on copy as Mermaid — a shape named 'pie chart' pastes as a shape", async () => {
    useDiagramStore.getState().updateNodeData("a", { label: "pie chart" });
    clipboard.hasClipboardImage.mockResolvedValueOnce(true);
    press("c", { meta: true });
    await settle();
    expect(clipboard.writeClipboardText).toHaveBeenLastCalledWith("pie chart");

    const paste = vi.spyOn(useDiagramStore.getState(), "paste");
    clipboard.readClipboardText.mockResolvedValueOnce("pie chart");
    press("v", { meta: true });
    await settle();
    expect(paste).toHaveBeenCalledOnce();
    paste.mockRestore();
  });

  it("⌘V right after ⌘C reads after the copy overwrote the clipboard — so old Mermaid isn't drawn", async () => {
    clipboard.writeClipboardText.mockClear();
    // the copy's look at the clipboard is slow (IPC); the paste comes before it ends
    clipboard.hasClipboardImage.mockImplementationOnce(
      () => new Promise((r) => setTimeout(() => r(true), 30)),
    );
    const paste = vi.spyOn(useDiagramStore.getState(), "paste");
    press("c", { meta: true });
    press("v", { meta: true });
    await vi.waitFor(() => expect(paste).toHaveBeenCalledOnce());
    const wrote = clipboard.writeClipboardText.mock.invocationCallOrder[0]!;
    const read = clipboard.readClipboardText.mock.invocationCallOrder.at(-1)!;
    expect(wrote).toBeLessThan(read);
    paste.mockRestore();
  });

  it("does not intercept while editing a label (INPUT · TEXTAREA)", () => {
    const copy = vi.spyOn(useDiagramStore.getState(), "copySelection");
    const paste = vi.spyOn(useDiagramStore.getState(), "paste");

    for (const tag of ["INPUT", "TEXTAREA"]) {
      expect(press("c", { meta: true }, tag).prevented).toBe(false);
      expect(press("v", { meta: true }, tag).prevented).toBe(false);
    }

    expect(copy).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
    copy.mockRestore();
    paste.mockRestore();
  });

  it("leaves combinations with Alt or Shift alone", () => {
    const copy = vi.spyOn(useDiagramStore.getState(), "copySelection");
    const paste = vi.spyOn(useDiagramStore.getState(), "paste");

    expect(press("c", { meta: true, shift: true }).prevented).toBe(false);
    expect(press("v", { meta: true, alt: true }).prevented).toBe(false);

    expect(copy).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
    copy.mockRestore();
    paste.mockRestore();
  });

  it("lets c and v without modifiers pass through", () => {
    const copy = vi.spyOn(useDiagramStore.getState(), "copySelection");

    expect(press("c").prevented).toBe(false);

    expect(copy).not.toHaveBeenCalled();
    copy.mockRestore();
  });

  it("Cmd+X calls cut", () => {
    expect(press("x", { meta: true }).prevented).toBe(true);

    expect(useDiagramStore.getState().nodes).toHaveLength(0);
    expect(useDiagramStore.getState().clipboard).not.toBeNull();
  });

  it("Cmd+D calls duplicate — clipboard untouched", () => {
    expect(press("d", { meta: true }).prevented).toBe(true);

    expect(useDiagramStore.getState().nodes).toHaveLength(2);
    expect(useDiagramStore.getState().clipboard).toBeNull();
  });

  it("Cmd+X and Cmd+D do not swallow the event when nothing is selected", () => {
    useDiagramStore.getState().clearSelection();

    expect(press("x", { meta: true }).prevented).toBe(false);
    expect(press("d", { meta: true }).prevented).toBe(false);
    expect(useDiagramStore.getState().nodes).toHaveLength(1);
  });

  it("leaves Cmd+Shift+X and Cmd+Alt+D alone", () => {
    expect(press("x", { meta: true, shift: true }).prevented).toBe(false);
    expect(press("d", { meta: true, alt: true }).prevented).toBe(false);

    expect(useDiagramStore.getState().nodes).toHaveLength(1);
  });

  it("does not intercept Cmd+X or Cmd+D while editing a label", () => {
    for (const tag of ["INPUT", "TEXTAREA"]) {
      expect(press("x", { meta: true }, tag).prevented).toBe(false);
      expect(press("d", { meta: true }, tag).prevented).toBe(false);
    }

    expect(useDiagramStore.getState().nodes).toHaveLength(1);
  });

  it("#110: Delete removes nodes and edges together in one frame", () => {
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [makeNode({ id: "a" }), makeNode({ id: "b" })],
          [makeEdge({ id: "e1", source: "a", target: "b" })],
        ),
        null,
      );
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: n.id === "a" })),
    }));
    const before = useDiagramStore.getState().past.length;

    expect(press("Delete").prevented).toBe(true);

    expect(useDiagramStore.getState().nodes.map((n) => n.id)).toEqual(["b"]);
    expect(useDiagramStore.getState().edges).toHaveLength(0);
    expect(useDiagramStore.getState().past.length - before).toBe(1);
  });

  it("#110: one undo after Delete brings nodes and edges back together", () => {
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [makeNode({ id: "a" }), makeNode({ id: "b" })],
          [makeEdge({ id: "e1", source: "a", target: "b" })],
        ),
        null,
      );
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: n.id === "a" })),
    }));
    press("Delete");

    useDiagramStore.getState().undo();

    expect(
      useDiagramStore
        .getState()
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(useDiagramStore.getState().edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("Backspace behaves the same", () => {
    expect(press("Backspace").prevented).toBe(true);
    expect(useDiagramStore.getState().nodes).toHaveLength(0);
  });

  it("Delete does not swallow the event when nothing is selected", () => {
    useDiagramStore.getState().clearSelection();
    const before = useDiagramStore.getState().past.length;

    expect(press("Delete").prevented).toBe(false);

    expect(useDiagramStore.getState().past.length).toBe(before);
  });

  it("Backspace while editing a label deletes characters — not shapes", () => {
    for (const tag of ["INPUT", "TEXTAREA"]) {
      expect(press("Backspace", {}, tag).prevented).toBe(false);
    }

    expect(useDiagramStore.getState().nodes).toHaveLength(1);
  });

  it("Cmd+Delete and Alt+Delete also delete — modifiers are ignored, as React Flow did", () => {
    expect(press("Delete", { meta: true }).prevented).toBe(true);
    expect(useDiagramStore.getState().nodes).toHaveLength(0);
  });

  it("a bare delete key does not delete shapes when a <select> has focus", () => {
    // Every <select> in the inspector lives in a panel that appears 'when something is selected'.
    // Pressing Backspace with focus left on it after picking a value deleted the shape that opened the panel.
    expect(press("Backspace", {}, "SELECT").prevented).toBe(false);
    expect(press("Delete", {}, "SELECT").prevented).toBe(false);

    expect(useDiagramStore.getState().nodes).toHaveLength(1);
  });

  it("modifier combinations still reach the canvas when a <select> has focus", () => {
    // React Flow's useKeyPress defaults actInsideInputWithModifier to true —
    // modifier combinations stay alive inside input elements; only delete is left out.
    // Right after changing a value with a select is exactly when you want to undo, so Cmd+Z matters most.
    const undo = vi.spyOn(useDiagramStore.getState(), "undo");

    expect(press("z", { meta: true }, "SELECT").prevented).toBe(true);
    expect(press("c", { meta: true }, "SELECT").prevented).toBe(true);
    expect(press("d", { meta: true }, "SELECT").prevented).toBe(true);

    expect(undo).toHaveBeenCalledOnce();
    undo.mockRestore();
  });

  it("fields being typed in, and .nokey, take every key", () => {
    for (const t of [
      ["INPUT", {}],
      ["TEXTAREA", {}],
      ["DIV", { editable: true }],
      ["DIV", { nokey: true }],
    ] as const) {
      expect(press("Backspace", {}, t[0], t[1]).prevented).toBe(false);
      expect(press("z", { meta: true }, t[0], t[1]).prevented).toBe(false);
      expect(press("c", { meta: true }, t[0], t[1]).prevented).toBe(false);
    }

    expect(useDiagramStore.getState().nodes).toHaveLength(1);
  });

  it('contenteditable="false" is not an input element', () => {
    // Checking with hasAttribute would treat false as true and kill every canvas key
    const el = { tagName: "DIV", getAttribute: () => "false", isContentEditable: false };
    let prevented = false;
    handleCanvasKeyDown({
      key: "Backspace",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: el,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as KeyboardEvent);

    expect(prevented).toBe(true);
  });

  it("lets modifier combinations that aren't ours (Cmd+A etc.) pass through", () => {
    const copy = vi.spyOn(useDiagramStore.getState(), "copySelection");
    const paste = vi.spyOn(useDiagramStore.getState(), "paste");

    expect(press("a", { meta: true }).prevented).toBe(false);
    expect(press("s", { meta: true }).prevented).toBe(false);

    expect(copy).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
    copy.mockRestore();
    paste.mockRestore();
  });

  it("Cmd+Z is undo, Cmd+Shift+Z is redo (existing behavior regression)", () => {
    const undo = vi.spyOn(useDiagramStore.getState(), "undo");
    const redo = vi.spyOn(useDiagramStore.getState(), "redo");

    press("z", { meta: true });
    press("z", { meta: true, shift: true });

    expect(undo).toHaveBeenCalledOnce();
    expect(redo).toHaveBeenCalledOnce();
    undo.mockRestore();
    redo.mockRestore();
  });

  it("Enter opens label editing for a single selected node (existing behavior regression)", () => {
    press("Enter");

    expect(useDiagramStore.getState().editRequestId).toBe("a");
  });

  it("Enter does nothing when several are selected", () => {
    useDiagramStore
      .getState()
      .loadDoc(makeDoc([makeNode({ id: "a" }), makeNode({ id: "b" })], []), null);
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));

    expect(press("Enter").prevented).toBe(false);

    expect(useDiagramStore.getState().editRequestId).toBeNull();
  });

  it("Enter does nothing when a single image is selected — like double-click (#155)", () => {
    const image = makeNode({ id: "i", shape: "image" });
    useDiagramStore.getState().loadDoc(makeDoc([image], []), null);
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));

    expect(press("Enter").prevented).toBe(false);
    expect(useDiagramStore.getState().editRequestId).toBeNull();
  });
});
