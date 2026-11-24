import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Position, ReactFlowProvider } from "@xyflow/react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { commitDrafts } from "../../../shared/lib/commitDrafts";
import { typeText } from "../../canvas/__tests__/editorTestUtils";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { useCanvasUiStore } from "../../canvas/canvasUiStore";
import { handleCanvasKeyDown } from "../../canvas/canvasKeymap";
import { LabeledEdge } from "../../canvas/LabeledEdge";
import { ShapeNode } from "../../canvas/ShapeNode";
import { handleAppKeyDown } from "../../chrome/appKeymap";
import { DocumentTabs } from "../../chrome/DocumentTabs";
import { EditBar } from "../../editbar/EditBar";
import { openDocument, resetTabsForTests } from "../tabActions";
import { resetUnsavedGuardForTests } from "../unsavedGuard";
import { resetAutosaveForTests } from "../useAutosave";
import { likeRust } from "../../../test/rustAnswers";

// the label being edited rides ViewportPortal (#93), whose target only a full
// canvas has — put it in the page, where an <input> is an HTML one
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  ViewportPortal: ({ children }: { children: React.ReactNode }) =>
    createPortal(children, document.body),
}));

const mockedInvoke = vi.mocked(invoke);
const store = () => useDiagramStore.getState();

/** what the last library write put on disk */
const savedDoc = () => {
  const call = mockedInvoke.mock.calls.filter(([cmd]) => cmd === "save_project").at(-1);
  const { contents } = (call?.[1] ?? {}) as { contents?: string };
  return contents ? JSON.parse(contents) : undefined;
};

/** ⌘S where the focus is, through the window's listeners the way the app has them */
const pressSave = async (target: Element) => {
  mockedInvoke.mockClear();
  fireEvent.keyDown(target, { key: "s", code: "KeyS", metaKey: true });
  await waitFor(() =>
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(["Saved"]),
  );
};

const appKeys = (e: KeyboardEvent) => handleAppKeyDown(e, true);

/**
 * ⌘S saves what is being typed without ending the edit (#219).
 * It used to blur whatever had the focus: the label editor closed, the focus
 * fell to the page, and the next Backspace deleted the shape that had just
 * been labelled; the chat, the API key and the title fields lost the focus
 * too. Now every open editor of the document writes its text and stays open
 * — its focus and caret where they were — and nothing else is touched.
 */
describe("⌘S saves the text being typed and editing continues (#219)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(likeRust());
    useCanvasUiStore.getState().setNodeTextEdit(null);
    useCanvasUiStore.getState().setEdgeLabelEdit(null);
    window.addEventListener("keydown", appKeys, true);
    window.addEventListener("keydown", handleCanvasKeyDown);
  });
  afterEach(() => {
    window.removeEventListener("keydown", appKeys, true);
    window.removeEventListener("keydown", handleCanvasKeyDown);
  });

  const openWith = (nodes = [makeNode({ id: "n1", label: "Old" })], edges = [] as never[]) => {
    act(() => {
      openDocument(makeDoc(nodes, edges, "Doc"), { projectId: "p1" });
    });
  };

  it("shape label: what was saved is what is typed, the editor stays open and focused — a following Backspace does not delete the shape", async () => {
    openWith();
    act(() =>
      useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) })),
    );
    const node = store().nodes[0]!;
    render(
      <ReactFlowProvider>
        <ShapeNode
          id="n1"
          type="shape"
          data={node.data}
          selected
          dragging={false}
          zIndex={0}
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          width={node.width}
          height={node.height}
          deletable
          draggable
          selectable
        />
      </ReactFlowProvider>,
    );
    act(() => store().requestEditLabel("n1"));
    const editor = screen.getByRole("textbox");
    expect(editor).toHaveFocus();
    typeText(editor, "Typed");

    await pressSave(editor);

    expect(savedDoc()?.nodes[0].data.label).toBe("Typed");
    expect(store().nodes[0]!.data.label).toBe("Typed");
    expect(useCanvasUiStore.getState().nodeTextEdit?.nodeId).toBe("n1");
    expect(screen.getByRole("textbox")).toBe(editor);
    expect(editor).toHaveFocus();
    expect(editor).toHaveTextContent("Typed");

    fireEvent.keyDown(editor, { key: "Backspace" });
    expect(store().nodes.map((n) => n.id)).toEqual(["n1"]);
  });

  it("edge label: saved, and the input stays open and focused", async () => {
    openWith([makeNode({ id: "a", x: 0, y: 0 }), makeNode({ id: "b", x: 300, y: 0 })], [
      {
        ...makeEdge({ id: "e", source: "a", target: "b", label: "flow" }),
        sourceHandle: "right-50",
        targetHandle: "left-50",
      },
    ] as never[]);
    const edge = store().edges[0]!;
    render(
      <ReactFlowProvider>
        <svg aria-label="canvas">
          <LabeledEdge
            id="e"
            source="a"
            target="b"
            sourceX={160}
            sourceY={28}
            targetX={300}
            targetY={28}
            sourcePosition={Position.Right}
            targetPosition={Position.Left}
            sourceHandleId={edge.sourceHandle}
            targetHandleId={edge.targetHandle}
            data={edge.data}
          />
        </svg>
      </ReactFlowProvider>,
    );
    act(() => useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "e", which: "center" }));
    const field = screen.getByRole("textbox");
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "retry" } });

    await pressSave(field);

    expect(savedDoc()?.edges[0].data.label).toBe("retry");
    expect(useCanvasUiStore.getState().edgeLabelEdit).toEqual({ edgeId: "e", which: "center" });
    expect(screen.getByRole("textbox")).toBe(field);
    expect(field).toHaveFocus();
  });

  it("document title: saving from the tab's input leaves the input open", async () => {
    openWith();
    render(<DocumentTabs />);
    fireEvent.doubleClick(screen.getByRole("tab", { name: /^Doc/ }));
    const field = screen.getByRole("textbox", { name: "Diagram title" });
    fireEvent.change(field, { target: { value: "Renamed" } });

    await pressSave(field);

    expect(savedDoc()?.title).toBe("Renamed");
    expect(screen.getByRole("textbox", { name: "Diagram title" })).toBe(field);
    expect(field).toHaveFocus();
  });

  it("edit bar text field (Stereotype): saved and focus stays — leaving afterwards does not write twice", async () => {
    openWith([makeNode({ id: "n1", label: "Order", shape: "class" })]);
    act(() =>
      useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) })),
    );
    render(<EditBar />);
    fireEvent.click(screen.getByRole("button", { name: "Class" }));
    const field = screen.getByRole("textbox", { name: "Stereotype" });
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "entity" } });

    await pressSave(field);

    expect(savedDoc()?.nodes[0].data.stereotype).toBe("entity");
    expect(field).toHaveFocus();
    const undoSteps = store().past.length;
    fireEvent.blur(field);
    expect(store().past.length).toBe(undoSteps);
  });

  it("edit bar number field: saved and focus stays — typing the same number again after Escape writes that too", () => {
    act(() => {
      openDocument(makeDoc([], [], "Doc"), { projectId: "p1" });
      store().applyOps([
        { op: "add_node", node: { id: "l", label: "L", shape: "lifeline", x: 0, y: 0 } },
        { op: "add_activation", lifeline: "l", y0: 100, y1: 180 },
      ]);
      useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
    });
    const y0 = () => store().nodes[0]!.data.activations?.[0]?.y0;
    render(<EditBar />);
    fireEvent.click(screen.getByRole("button", { name: "Activations" }));
    const start = screen.getByRole("spinbutton", { name: "Activation 1 start" });
    act(() => start.focus());
    fireEvent.change(start, { target: { value: "150" } });

    act(() => commitDrafts());
    expect(y0()).toBe(150);
    expect(start).toHaveFocus();
    expect(start).toHaveValue(150);

    // Escape drops the draft; the agent moves the activation; the same number typed again is written
    fireEvent.keyDown(start, { key: "Escape" });
    act(() =>
      useDiagramStore.setState((s) => ({
        nodes: s.nodes.map((n) => ({
          ...n,
          data: { ...n.data, activations: [{ y0: 120, y1: 180 }] },
        })),
      })),
    );
    fireEvent.change(start, { target: { value: "150" } });
    fireEvent.blur(start);
    expect(y0()).toBe(150);
  });

  it("inputs outside the document (chat, search, API key) are untouched — focus and value stay", async () => {
    openWith();
    const chat = document.createElement("textarea");
    chat.setAttribute("aria-label", "Message");
    const blurred = vi.fn();
    chat.addEventListener("blur", blurred);
    document.body.append(chat);
    try {
      act(() => chat.focus());
      chat.value = "half a question";
      await pressSave(chat);
      expect(chat).toHaveFocus();
      expect(chat).toHaveValue("half a question");
      expect(blurred).not.toHaveBeenCalled();
    } finally {
      chat.remove();
    }
  });
});
