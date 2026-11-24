import { ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { CLASS_NAME_H, CLASS_STEREOTYPE_H, CLASS_TEXT_PAD } from "../../../shared/lib/classShape";
import { ENTITY_HEADER_H, ENTITY_TEXT_PAD } from "../../../shared/lib/entityShape";
import { BORDER_TITLE, FRAGMENT_GUARD } from "../../../shared/lib/palette";
import { useDiagramStore } from "../../../shared/lib/store";
import { useCanvasUiStore } from "../canvasUiStore";
import { ShapeNode } from "../ShapeNode";

/** the node; with its label editor open unless `editing` is false */
const renderNode = (id: string, editing = true) => {
  const node = useDiagramStore.getState().nodes.find((n) => n.id === id)!;
  act(() =>
    useCanvasUiStore.getState().setNodeTextEdit(editing ? { nodeId: id, part: "label" } : null),
  );
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
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        width={node.width}
        height={node.height}
        deletable
        draggable
        selectable
      />
    </ReactFlowProvider>,
  ).container;
};
/** the node, with its label editor open */
const renderEditing = (id: string) => renderNode(id);

/** the band the editor is laid in */
const editorBand = (c: Element) =>
  c.querySelector("[contenteditable=true]")!.parentElement!.parentElement as HTMLElement;
/** the open editor — the editable text itself */
const editorOf = (c: Element) => c.querySelector("[contenteditable=true]") as HTMLElement;
/** the names the box's own drawing paints */
const paintedText = (c: Element) => [...c.querySelectorAll("svg text")].map((t) => t.textContent);

describe("the name editor sits where the name is drawn (#174)", () => {
  beforeEach(() => {
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "c", label: "TestClass", shape: "class", x: 0, y: 0 } },
      {
        op: "update_node",
        id: "c",
        set: { attributes: ["name:string", "hello:string"], methods: ["+ save(): boolean"] },
      },
      { op: "add_node", node: { id: "s", label: "Repo", shape: "class", x: 300, y: 0 } },
      { op: "update_node", id: "s", set: { stereotype: "interface" } },
      {
        op: "add_node",
        node: { id: "e", label: "users", shape: "entity", columns: ["id uuid PK"], x: 0, y: 300 },
      },
    ]);
  });

  it("class: the name cell, not the box center — the drawn name hides", () => {
    const c = renderEditing("c");
    const band = editorBand(c);
    expect(band.style.top).toBe("0px");
    expect(band.style.height).toBe(`${CLASS_NAME_H}px`);
    expect(band.style.bottom).toBe("");
    expect(paintedText(c)).not.toContain("TestClass");
    expect(paintedText(c)).toContain("name:string");
    // the name is left-aligned on the card's header strip (#210 D13)
    expect(editorOf(c)).toHaveClass("text-left");
    expect(band.style.paddingLeft).toBe(`${CLASS_TEXT_PAD}px`);
  });

  it("with a stereotype: the name cell below that line — inside the box", () => {
    const c = renderEditing("s");
    expect(editorBand(c).style.top).toBe(`${CLASS_STEREOTYPE_H}px`);
    const node = useDiagramStore.getState().nodes.find((n) => n.id === "s")!;
    expect(CLASS_STEREOTYPE_H + CLASS_NAME_H).toBeLessThanOrEqual(node.height!);
    expect(paintedText(c)).not.toContain("Repo");
  });

  it("entity: the header band", () => {
    const c = renderEditing("e");
    const band = editorBand(c);
    expect(band.style.top).toBe("0px");
    expect(band.style.height).toBe(`${ENTITY_HEADER_H}px`);
    expect(paintedText(c)).not.toContain("users");
    expect(editorOf(c)).toHaveClass("text-left");
    expect(band.style.paddingLeft).toBe(`${ENTITY_TEXT_PAD}px`);
  });

  it("turns off autocapitalize, autocorrect and spellcheck in the editor", () => {
    const area = editorOf(renderEditing("c"));
    expect(area.getAttribute("autocapitalize")).toBe("off");
    expect(area.getAttribute("autocorrect")).toBe("off");
    expect(area.getAttribute("spellcheck")).toBe("false");
  });
});

describe("a box's description stays put while its label is edited (#174)", () => {
  beforeEach(() => {
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
    useDiagramStore.getState().applyOps([
      {
        op: "add_node",
        node: {
          id: "b",
          label: "test",
          description: "Postgres 16",
          badge: "NEW",
          x: 0,
          y: 0,
          height: 84,
        },
      },
    ]);
  });

  it("puts the editor at the label and leaves the description below it", () => {
    const c = renderEditing("b");
    const area = editorOf(c);
    expect(area).toHaveTextContent("test");
    expect(c.textContent).toContain("Postgres 16");
    // the editor and the description share the decorated stack
    const stack = c.querySelector(".flex-col.gap-0\\.5")!;
    expect(stack.contains(area)).toBe(true);
    expect(stack.textContent).toContain("Postgres 16");
  });
});

describe("the title editor opens where the title was shown — left-aligned (#181)", () => {
  beforeEach(() => {
    act(() => useCanvasUiStore.getState().setNodeTextEdit(null));
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
    useDiagramStore.getState().applyOps([
      {
        op: "add_node",
        node: {
          id: "f",
          label: "Hello world",
          shape: "frame",
          x: 0,
          y: 0,
          width: 600,
          height: 400,
        },
      },
      {
        op: "add_node",
        node: { id: "g", label: "x > 0", shape: "fragment", x: 0, y: 500, width: 300, height: 200 },
      },
    ]);
  });

  it("frame: the title sits on the top border, text from the left — not centered (#210 D10)", () => {
    const c = renderEditing("f");
    const band = editorBand(c);
    expect(band.style.top).toBe(`${-BORDER_TITLE.height / 2}px`);
    expect(band.style.height).toBe(`${BORDER_TITLE.height}px`);
    expect(band.style.left).toBe(`${BORDER_TITLE.inset}px`);
    const editor = editorOf(c);
    expect(editor).toHaveClass("text-left");
    expect(editor).not.toHaveClass("text-center");
  });

  it("a fragment's condition starts at the inner top left, from the left (#210 D11)", () => {
    const c = renderEditing("g");
    const band = editorBand(c);
    expect(band.style.left).toBe(`${FRAGMENT_GUARD.left}px`);
    expect(band.style.top).toBe(`${FRAGMENT_GUARD.top}px`);
    expect(band.style.height).toBe(`${FRAGMENT_GUARD.height}px`);
    const editor = editorOf(c);
    expect(editor).toHaveClass("text-left");
    expect(editor).not.toHaveClass("text-center");
  });

  it("the drawn condition is left-aligned too — the same spot as the editor even when lines wrap (#181)", () => {
    const container = renderNode("g", false);
    const drawn = [...container.querySelectorAll("span")].find((el) => el.textContent === "x > 0")!;
    expect(drawn).toHaveClass("text-left");
    expect(drawn).not.toHaveClass("text-center");
  });
});
