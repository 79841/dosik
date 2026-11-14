import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useCanvasUiStore } from "../canvasUiStore";
import { DropNodeMenu } from "../DropNodeMenu";
import { EdgeContextMenu } from "../EdgeContextMenu";

/**
 * #80 — clicking the "canvas" outside a menu must close the menu too.
 * The React Flow canvas's pan/drag handling (d3-based) stops propagation of
 * pointerdown/mousedown, so a bubble-phase window listener never sees canvas clicks.
 * Here a stopPropagation listener on body models exactly that situation.
 */
const swallow = (e: Event): void => e.stopPropagation();

const swallowOnBody = () => {
  document.body.addEventListener("pointerdown", swallow);
  document.body.addEventListener("mousedown", swallow);
};

const clickCanvas = () => {
  // The actual input order on the canvas (= body): pointerdown → mousedown
  fireEvent.pointerDown(document.body);
  fireEvent.mouseDown(document.body);
};

beforeEach(() => {
  useDiagramStore
    .getState()
    .loadDoc(
      makeDoc(
        [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
        [makeEdge({ id: "e", source: "a", target: "b" })],
      ),
      null,
    );
});

afterEach(() => {
  document.body.removeEventListener("pointerdown", swallow);
  document.body.removeEventListener("mousedown", swallow);
});

describe("drop menu closes on outside click (#80)", () => {
  beforeEach(() => {
    useCanvasUiStore.getState().setDropMenu({
      fromId: "a",
      fromHandle: "right",
      flowX: 200,
      flowY: 100,
      clientX: 400,
      clientY: 300,
    });
  });

  it("closes even when clicking the canvas, which stops propagation", () => {
    render(<DropNodeMenu />);
    swallowOnBody();
    clickCanvas();
    expect(useCanvasUiStore.getState().dropMenu).toBeNull();
  });

  it("does not close on clicks inside the menu", () => {
    const { container } = render(<DropNodeMenu />);
    const inside = container.querySelector("button")!;
    fireEvent.pointerDown(inside);
    fireEvent.mouseDown(inside);
    expect(useCanvasUiStore.getState().dropMenu).not.toBeNull();
  });
});

describe("edge context menu closes on outside click (#80)", () => {
  beforeEach(() => {
    useCanvasUiStore.getState().setEdgeMenu({ edgeId: "e", clientX: 400, clientY: 300 });
  });

  it("closes even when clicking the canvas, which stops propagation", () => {
    render(<EdgeContextMenu />);
    swallowOnBody();
    clickCanvas();
    expect(useCanvasUiStore.getState().edgeMenu).toBeNull();
  });

  it("does not close on clicks inside the menu", () => {
    const { container } = render(<EdgeContextMenu />);
    const inside = container.querySelector("button")!;
    fireEvent.pointerDown(inside);
    fireEvent.mouseDown(inside);
    expect(useCanvasUiStore.getState().edgeMenu).not.toBeNull();
  });
});
