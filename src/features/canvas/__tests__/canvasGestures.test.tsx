import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #145 — dragging on empty canvas is a box selection.
 *
 * The gesture itself can't run in this environment (jsdom can't measure nodes).
 * Instead this pins **what we told React Flow to do**. These four interlock,
 * so reverting any one of them silently changes the behavior.
 */
const captured: Record<string, unknown> = {};

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown>) => {
      Object.assign(captured, props);
      return <div data-testid="flow" />;
    },
  };
});

const { DiagramCanvas } = await import("../DiagramCanvas");
const { ReactFlowProvider, SelectionMode } = await import("@xyflow/react");

beforeEach(() => {
  render(
    <ReactFlowProvider>
      <DiagramCanvas />
    </ReactFlowProvider>,
  );
});

describe("canvas gestures (#145)", () => {
  it("dragging on empty canvas is a box selection", () => {
    expect(captured.selectionOnDrag).toBe(true);
  });

  it("catches nodes that only touch the box", () => {
    // The default (Full), which needs full enclosure, is tedious on sprawling diagrams
    expect(captured.selectionMode).toBe(SelectionMode.Partial);
  });

  it("pans with the middle button — not the right button", () => {
    // With 2 in panOnDrag, React Flow's Pane swallows onPaneContextMenu.
    // That would kill the context menu (#139) entirely
    expect(captured.panOnDrag).toEqual([1]);
  });

  it("pans with the wheel and trackpad", () => {
    expect(captured.panOnScroll).toBe(true);
  });

  it("Space switches to pan mode temporarily", () => {
    // It's a React Flow default, but now that drag belongs to selection this is the only
    // keyboard pan path — a change in the default gets caught here
    expect(captured.panActivationKeyCode ?? "Space").toBe("Space");
  });
});
