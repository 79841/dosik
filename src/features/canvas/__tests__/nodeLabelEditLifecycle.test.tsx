import { ReactFlowProvider } from "@xyflow/react";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useCanvasUiStore } from "../canvasUiStore";
import { ShapeNode } from "../ShapeNode";

/**
 * #105 — node label edit state must not survive a document swap.
 *
 * React keys nodes by id. If a new document contains the same id, the same ShapeNode
 * instance is reused, and if the edit state were local the editor would carry over still open.
 * The textarea is an uncontrolled input using defaultValue, so **the old document's text** stays,
 * and blur writes it into the new document's node.
 */
const renderNode = (id: string) => {
  const node = useDiagramStore.getState().nodes.find((n) => n.id === id)!;
  return render(
    <ReactFlowProvider>
      <ShapeNode
        id={id}
        type="shape"
        data={node.data}
        selected={false}
        dragging={false}
        zIndex={0}
        isConnectable
        positionAbsoluteX={node.position.x}
        positionAbsoluteY={node.position.y}
        width={node.width}
        height={node.height}
        deletable
        draggable
        selectable
      />
    </ReactFlowProvider>,
  );
};

describe("node label edit state lifecycle", () => {
  beforeEach(() => {
    useDiagramStore
      .getState()
      .loadDoc(makeDoc([makeNode({ id: "n1", label: "n1 in A" })], []), null);
    useCanvasUiStore.getState().setNodeTextEdit(null);
  });

  it("records an open edit in shared state — not component-local", () => {
    renderNode("n1");
    act(() => {
      useDiagramStore.getState().requestEditLabel("n1");
    });

    expect(useCanvasUiStore.getState().nodeTextEdit?.nodeId).toBe("n1");
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("replacing with a document containing the same id clears the edit state", () => {
    renderNode("n1");
    act(() => {
      useDiagramStore.getState().requestEditLabel("n1");
    });
    expect(useCanvasUiStore.getState().nodeTextEdit?.nodeId).toBe("n1");

    act(() => {
      useDiagramStore
        .getState()
        .loadDoc(makeDoc([makeNode({ id: "n1", label: "n1 in B" })], []), "/b.dosik.json");
    });

    expect(useCanvasUiStore.getState().nodeTextEdit).toBeNull();
  });

  it("set_diagram containing the same id also clears the edit state", () => {
    // Bridge clients choose ids themselves, so reuse is routine
    renderNode("n1");
    act(() => {
      useDiagramStore.getState().requestEditLabel("n1");
    });

    act(() => {
      useDiagramStore.getState().applyOps([
        {
          op: "set_diagram",
          doc: makeDoc([makeNode({ id: "n1", label: "n1 from the bridge" })], []),
        },
      ]);
    });

    expect(useCanvasUiStore.getState().nodeTextEdit).toBeNull();
  });

  it("the bridge's clear also clears the edit state", () => {
    // clear doesn't bump docVersion, but the nodes empty out, so the existence check catches it
    renderNode("n1");
    act(() => {
      useDiagramStore.getState().requestEditLabel("n1");
    });

    act(() => {
      useDiagramStore.getState().applyOps([{ op: "clear" }]);
    });

    expect(useCanvasUiStore.getState().nodeTextEdit).toBeNull();
  });

  it("drops the edit state when the node disappears", () => {
    renderNode("n1");
    act(() => {
      useDiagramStore.getState().requestEditLabel("n1");
    });

    act(() => {
      useDiagramStore.getState().deleteElements(["n1"], []);
    });

    expect(useCanvasUiStore.getState().nodeTextEdit).toBeNull();
  });

  it("closes the editor once the edit state clears, so the old label can't be written into the new document", () => {
    renderNode("n1");
    act(() => {
      useDiagramStore.getState().requestEditLabel("n1");
    });
    expect(screen.queryByRole("textbox")).toBeTruthy();

    act(() => {
      useDiagramStore
        .getState()
        .loadDoc(makeDoc([makeNode({ id: "n1", label: "n1 in B" })], []), "/b.dosik.json");
    });

    // The textarea unmounts, so blur doesn't fire = there's no updateNodeData path
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(useDiagramStore.getState().nodes[0]!.data.label).toBe("n1 in B");
  });
});
