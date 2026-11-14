import { ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { createShapeNode, useDiagramStore } from "../../../shared/lib/store";
import type { DiagramNode } from "../../../shared/lib/types";
import { ShapeNode } from "../ShapeNode";

/**
 * A fragment frame covers the whole interaction, so its root must not swallow
 * clicks meant for the lifelines and messages inside it. Only the painted parts
 * (frame stroke, operator tab, guard label) and the resize handles are grabbable.
 *
 * The effective browser hit-testing can't be exercised here — coordinate clicks
 * don't reach the Tauri webview — so this pins the pointer-events wiring instead.
 */
const renderNode = (shape: DiagramNode["data"]["shape"], selected = true) => {
  useDiagramStore
    .getState()
    .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
  return render(
    <ReactFlowProvider>
      <ShapeNode
        id="n"
        type="shape"
        selected={selected}
        dragging={false}
        deletable
        selectable
        draggable
        zIndex={0}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        width={420}
        height={200}
        data={{ label: "cond", shape, color: "violet", fragmentKind: "alt" }}
      />
    </ReactFlowProvider>,
  );
};

describe("fragment node className (wrapper pass-through)", () => {
  it("frame nodes turn off the wrapper via node.style (className won't do)", () => {
    // NodeWrapper writes pointerEvents:'all' **inline** on the wrapper and then
    // spreads ...node.style after it. A class can't beat inline styles, so it has to be style.
    expect(createShapeNode("fragment", { x: 0, y: 0 }).style).toEqual({ pointerEvents: "none" });
    expect(createShapeNode("rect", { x: 0, y: 0 }).style).toBeUndefined();
  });

  it("restores that className on frames on file load too", () => {
    useDiagramStore.getState().loadDoc(
      {
        version: 1,
        title: "t",
        nodes: [
          {
            id: "f",
            type: "shape",
            position: { x: 0, y: 0 },
            width: 420,
            height: 200,
            data: { label: "c", shape: "fragment", color: "violet", fragmentKind: "alt" },
          },
        ],
        edges: [],
      } as never,
      null,
    );
    expect(useDiagramStore.getState().nodes[0]?.style).toEqual({ pointerEvents: "none" });
  });
});

describe("style derives from shape (a single sync point)", () => {
  const setup = () => {
    useDiagramStore
      .getState()
      .loadDoc({ version: 1, title: "t", nodes: [], edges: [] } as never, null);
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "f", label: "F", shape: "fragment", x: 0, y: 0 } },
      { op: "add_node", node: { id: "r", label: "R", x: 600, y: 0 } },
    ] as never);
  };
  const styleOf = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id)?.style;

  it("drops the style when the bridge turns a fragment into another shape", () => {
    setup();
    useDiagramStore
      .getState()
      .applyOps([{ op: "update_node", id: "f", set: { shape: "rect" } }] as never);
    // If it stayed, the node could not be clicked, dragged or resized at all
    expect(styleOf("f")).toBeUndefined();
  });

  it("adds the style when the bridge turns another shape into a fragment", () => {
    setup();
    useDiagramStore
      .getState()
      .applyOps([{ op: "update_node", id: "r", set: { shape: "fragment" } }] as never);
    expect(styleOf("r")).toEqual({ pointerEvents: "none" });
  });

  it("filters out stale style on file load", () => {
    useDiagramStore.getState().loadDoc(
      {
        version: 1,
        title: "t",
        nodes: [
          {
            id: "b",
            type: "shape",
            position: { x: 0, y: 0 },
            width: 160,
            height: 56,
            style: { pointerEvents: "none" },
            data: { label: "B", shape: "rect", color: "violet" },
          },
        ],
        edges: [],
      } as never,
      null,
    );
    expect(styleOf("b")).toBeUndefined();
  });
});

describe("fragment pointer events", () => {
  beforeEach(() => {
    useDiagramStore
      .getState()
      .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
  });

  it("lets clicks through the frame's root", () => {
    const { container } = renderNode("fragment");
    expect(container.querySelector("div.group")?.className).toContain("pointer-events-none");
  });

  it("does not revive the SVG root — it's a CSS box and would catch the whole empty interior", () => {
    const { container } = renderNode("fragment");
    expect(container.querySelector("svg")?.getAttribute("class")).not.toContain(
      "pointer-events-auto",
    );
  });

  it("targets only painted children (dashed border, operator and its patch) (#210 D11)", () => {
    const { container } = renderNode("fragment");
    const svg = container.querySelector("svg");
    // Border rect (fill=none, so only the stroke), the operator text set into the border and the patch behind it
    expect(svg?.querySelectorAll("rect.pointer-events-auto").length).toBeGreaterThanOrEqual(2);
    expect(svg?.querySelector("text.pointer-events-auto")).toBeTruthy();
  });

  it("the guard label catches only its text, not the container", () => {
    const { container } = renderNode("fragment");
    const box = container.querySelector("div.group > div.flex");
    expect(box?.className).toContain("pointer-events-none");
    const span = box?.querySelector("span");
    expect(span?.className).toContain("pointer-events-auto");
    // Content width, not a full-width strip, so it doesn't span the top
    expect(span?.className).toContain("w-max");
  });

  it("other shapes are caught at the root as usual", () => {
    const { container } = renderNode("rect");
    expect(container.querySelector("div.group")?.className).not.toContain("pointer-events-none");
    expect(container.querySelector("svg")?.getAttribute("class")).not.toContain(
      "pointer-events-auto",
    );
  });
});
