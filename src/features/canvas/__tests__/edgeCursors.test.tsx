import { Position, ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { LabeledEdge } from "../LabeledEdge";

/**
 * #99 — if grabbing the line and grabbing a grip show the same cursor, you can't tell what will happen.
 * The body always **moves what you grabbed** (y for messages, the whole arrow for free arrows), so
 * it is `move`. Only grips that resize use a resize cursor.
 */
const seedSelfMessage = () =>
  useDiagramStore.getState().loadDoc(
    makeDoc(
      [makeNode({ id: "L", shape: "lifeline", x: 0, y: 0, width: 120, height: 400 })],
      [
        {
          ...makeEdge({ id: "e", source: "L", target: "L", label: "validate" }),
          sourceHandle: "right-30",
          targetHandle: "right-45",
          selected: true,
        },
      ],
    ),
    null,
  );

const renderEdge = () => {
  const edge = useDiagramStore.getState().edges[0]!;
  const { container } = render(
    <ReactFlowProvider>
      <svg aria-label="canvas">
        <LabeledEdge
          id="e"
          source={edge.source}
          target={edge.target}
          sourceX={60}
          sourceY={120}
          targetX={60}
          targetY={180}
          sourcePosition={Position.Right}
          targetPosition={Position.Right}
          sourceHandleId={edge.sourceHandle}
          targetHandleId={edge.targetHandle}
          selected
          data={edge.data}
        />
      </svg>
    </ReactFlowProvider>,
  );
  return container;
};

/** The transparent hit stroke — what users call "the line" */
const bodyCursor = (c: Element) => {
  const hit = [...c.querySelectorAll("path")].find(
    (p) => p.getAttribute("stroke") === "transparent",
  );
  return (hit as SVGPathElement | undefined)?.style.cursor;
};

describe("edge cursors (#99)", () => {
  it("a message body is move — it must differ from the height grip's resize", () => {
    seedSelfMessage();
    expect(bodyCursor(renderEdge())).toBe("move");
  });

  it("a connected regular edge's body is unchanged", () => {
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [makeNode({ id: "a" }), makeNode({ id: "b", x: 400 })],
        [
          {
            ...makeEdge({ id: "e", source: "a", target: "b" }),
            sourceHandle: "right",
            targetHandle: "left",
            selected: true,
          },
        ],
      ),
      null,
    );
    // Edges that slide a segment get pointer; edges that move as a whole get move
    expect(["pointer", "move"]).toContain(bodyCursor(renderEdge()));
  });
});
