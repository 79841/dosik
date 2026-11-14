import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { groupBox } from "../../../shared/lib/store/groupResize";
import { GROUP_OUTLINE_PAD } from "../../../shared/lib/store/groups";
import { GroupResizeHandles } from "../GroupOutlines";

const store = () => useDiagramStore.getState();
const node = (id: string) => store().nodes.find((n) => n.id === id)!;

// a 100×50 at (0,0) and one at (200,100): members' box 300×150
const setup = () => {
  store().loadDoc(makeDoc([], []), null);
  store().applyOps([
    { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0, width: 100, height: 50 } },
    { op: "add_node", node: { id: "b", label: "B", x: 200, y: 100, width: 100, height: 50 } },
    { op: "group", ids: ["a", "b"], id: "g1" },
  ]);
};
/** the outline the canvas would draw around g1's members as they are now */
const outline = () => {
  const b = groupBox(store().nodes.filter((n) => n.data.groupId === "g1"));
  return {
    x: b.x - GROUP_OUTLINE_PAD,
    y: b.y - GROUP_OUTLINE_PAD,
    w: b.width + GROUP_OUTLINE_PAD * 2,
    h: b.height + GROUP_OUTLINE_PAD * 2,
  };
};
const handle = (c: Element, which: string) =>
  c.querySelector(`[data-group-handle="${which}"]`) as HTMLElement;
const drag = (el: HTMLElement, dx: number, dy: number) => {
  fireEvent.pointerDown(el, { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 500 + dx / 2, clientY: 500 + dy / 2, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 500 + dx, clientY: 500 + dy, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: 500 + dx, clientY: 500 + dy, pointerId: 1 });
};

describe("group box resize handles (#179)", () => {
  beforeEach(setup);

  it("has four corners and four sides", () => {
    const { container } = render(<GroupResizeHandles groupId="g1" box={outline()} zoom={1} />);
    expect(container.querySelectorAll("[data-group-handle]")).toHaveLength(8);
  });

  it("dragging the bottom right scales members proportionally — one undo", () => {
    const depth = store().past.length;
    const { container } = render(<GroupResizeHandles groupId="g1" box={outline()} zoom={1} />);
    drag(handle(container, "bottom-right"), 300, 150);
    expect(node("a")).toMatchObject({ position: { x: 0, y: 0 }, width: 200, height: 100 });
    expect(node("b")).toMatchObject({ position: { x: 400, y: 200 }, width: 200, height: 100 });
    expect(store().past.length).toBe(depth + 1);
    expect(store().groupResizing).toBeNull();
  });

  it("divides screen movement by the zoom", () => {
    const { container } = render(<GroupResizeHandles groupId="g1" box={outline()} zoom={2} />);
    drag(handle(container, "right"), 600, 0);
    expect(node("b")).toMatchObject({ position: { x: 400, y: 100 }, width: 200, height: 50 });
  });

  it("changes nothing on a plain click", () => {
    const depth = store().past.length;
    const { container } = render(<GroupResizeHandles groupId="g1" box={outline()} zoom={1} />);
    drag(handle(container, "left"), 1, 1);
    expect(node("a").width).toBe(100);
    expect(store().past.length).toBe(depth);
  });

  it("stops members at their own minimum size (40×28) even when dragged far inward", () => {
    const { container } = render(<GroupResizeHandles groupId="g1" box={outline()} zoom={1} />);
    drag(handle(container, "bottom-right"), -1000, -1000);
    expect(node("a")).toMatchObject({ width: 40, height: 28 });
    // the box stopped at 120×84 — without the limit both would pile up at the origin
    expect(node("b").position).toEqual({ x: 80, y: 56 });
  });

  it("keeps the aspect ratio of a group containing an image when dragged by a corner", () => {
    store().loadDoc(makeDoc([], []), null);
    const r = store().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0, width: 100, height: 50 } },
      {
        op: "add_node",
        node: {
          id: "img",
          label: "pic",
          shape: "image",
          src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          x: 200,
          y: 100,
          width: 100,
          height: 50,
        },
      },
      { op: "group", ids: ["a", "img"], id: "g1" },
    ]);
    expect(r.errors).toEqual([]);
    const { container } = render(<GroupResizeHandles groupId="g1" box={outline()} zoom={1} />);
    drag(handle(container, "bottom-right"), 300, 10);
    const img = node("img");
    expect(img.width! / img.height!).toBeCloseTo(2, 1);
    expect(node("a").width! / node("a").height!).toBeCloseTo(2, 1);
  });

  it("nudging a group with a member below the minimum size doesn't make the box jump larger (#179)", () => {
    store().applyOps([
      { op: "add_node", node: { id: "t", label: "T", x: 300, y: 140, width: 10, height: 10 } },
      { op: "group", ids: ["a", "b", "t"], id: "g1" },
    ]);
    const { container } = render(<GroupResizeHandles groupId="g1" box={outline()} zoom={1} />);
    drag(handle(container, "bottom-right"), -10, -10);
    // the others shrink a little, not jump; the tiny one alone is lifted to its floor
    expect(node("a").width).toBeLessThanOrEqual(100);
    expect(node("a").height).toBeLessThanOrEqual(50);
    expect(node("b").width).toBeLessThanOrEqual(100);
    expect(node("t")).toMatchObject({ width: 40, height: 28 });
  });
});
