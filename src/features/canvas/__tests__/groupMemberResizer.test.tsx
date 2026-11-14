import { ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { ShapeNode } from "../ShapeNode";

const store = () => useDiagramStore.getState();

const renderSelected = (id: string) => {
  const node = store().nodes.find((n) => n.id === id)!;
  return render(
    <ReactFlowProvider>
      <ShapeNode
        id={id}
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
  ).container;
};
const resizeHandles = (c: Element) => c.querySelectorAll(".react-flow__resize-control.handle");

describe("group members hide their own resize handles (#179)", () => {
  beforeEach(() => {
    store().loadDoc(makeDoc([], []), null);
    store().enterGroup(null);
    store().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 300, y: 0 } },
      { op: "add_node", node: { id: "solo", label: "S", x: 600, y: 0 } },
      { op: "group", ids: ["a", "b"], id: "g1" },
    ]);
  });

  it("a shape outside a group has handles when selected", () => {
    expect(resizeHandles(renderSelected("solo")).length).toBeGreaterThan(0);
  });

  const pick = (...ids: string[]) =>
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => ({ ...n, selected: ids.includes(n.id) })),
    }));

  it("members selected with their group have none — the group box has them", () => {
    pick("a", "b");
    expect(resizeHandles(renderSelected("a"))).toHaveLength(0);
  });

  it("a member of a partly selected group (e.g. grouped by an agent) keeps its own handles (#179)", () => {
    pick("a");
    expect(resizeHandles(renderSelected("a")).length).toBeGreaterThan(0);
  });

  it("entering a group and picking one shows that shape's handles", () => {
    store().pickInGroup("a");
    expect(resizeHandles(renderSelected("a")).length).toBeGreaterThan(0);
  });
});
