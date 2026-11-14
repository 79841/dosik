import { ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ShapeKind } from "../../../shared/lib/types";
import { ShapeNode } from "../ShapeNode";

/**
 * #99 — the **other half** of the bug where dragging from a lifeline to itself didn't connect.
 *
 * Fixing `isConnectionAllowed` (the distance check) alone changed nothing, because
 * there was no handle to drop on over the source node in the first place — `BodyTargetHandle`
 * was turned off by `fromNode.id !== nodeId`, and the only one left was the `line`
 * handle where the drag started, so React Flow ruled it invalid as "same node · same handle".
 *
 * Real drags don't reach the webview in this environment, so the in-progress connection is
 * faked with `useConnection`, pinning only **whether a drop target appears**.
 */
const mockConnection = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return { ...actual, useConnection: () => mockConnection.current };
});

const renderNode = (shape: ShapeKind, id = "n1") =>
  render(
    <ReactFlowProvider>
      {/* @ts-expect-error passes only the props ShapeNode reads */}
      <ShapeNode
        id={id}
        selected={false}
        width={shape === "lifeline" ? 110 : 160}
        height={shape === "lifeline" ? 320 : 56}
        data={{ label: "A", shape, color: "violet" }}
      />
    </ReactFlowProvider>,
  ).container;

/** Whether there is a body handle used as a drop target */
const hasBodyTarget = (c: Element) =>
  Boolean(c.querySelector('.react-flow__handle[data-handleid="body"]'));

describe("drop target on the node itself (#99)", () => {
  it("a drag started from a lifeline creates a drop target on its own body", () => {
    mockConnection.current = { inProgress: true, fromNode: { id: "n1" } };
    expect(hasBodyTarget(renderNode("lifeline"))).toBe(true);
  });

  it("a drag started from a box creates no drop target on its own body", () => {
    // This fix covers lifelines only (2026-08-23)
    mockConnection.current = { inProgress: true, fromNode: { id: "n1" } };
    expect(hasBodyTarget(renderNode("rounded"))).toBe(false);
  });

  it("drags from another node get a drop target regardless of kind", () => {
    mockConnection.current = { inProgress: true, fromNode: { id: "other" } };
    expect(hasBodyTarget(renderNode("lifeline"))).toBe(true);
    expect(hasBodyTarget(renderNode("rounded"))).toBe(true);
  });

  it("has no drop target when not dragging — it doesn't eat normal clicks", () => {
    mockConnection.current = { inProgress: false, fromNode: null };
    expect(hasBodyTarget(renderNode("lifeline"))).toBe(false);
    expect(hasBodyTarget(renderNode("rounded"))).toBe(false);
  });

  it("fragments still have no drop target (#28)", () => {
    mockConnection.current = { inProgress: true, fromNode: { id: "other" } };
    expect(hasBodyTarget(renderNode("fragment"))).toBe(false);
  });

  it("renders the body handle after the lifeline's line handle — so elementFromPoint finds it first", () => {
    mockConnection.current = { inProgress: true, fromNode: { id: "n1" } };
    const handles = [...renderNode("lifeline").querySelectorAll(".react-flow__handle")].map((h) =>
      h.getAttribute("data-handleid"),
    );
    expect(handles.indexOf("body")).toBeGreaterThan(handles.indexOf("line"));
  });
});
