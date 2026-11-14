import { ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DiagramNode } from "../../../shared/lib/types";
import { ShapeNode } from "../ShapeNode";

/**
 * The canvas half of #160 / #210, rendered rather than grepped (#160):
 * which branch draws the label decides whether the canvas and the exports agree.
 */
const renderNode = (data: Partial<DiagramNode["data"]>, height = 84) =>
  render(
    <ReactFlowProvider>
      {/* @ts-expect-error passes only what ShapeNode reads, not all of NodeProps */}
      <ShapeNode
        id="n1"
        selected={false}
        width={160}
        height={height}
        data={{ label: "Orders", shape: "rect", color: "mono", ...data }}
      />
    </ReactFlowProvider>,
  ).container;

const tagOf = (c: Element) => c.querySelector("span.uppercase");
const stepOf = (c: Element) => c.querySelector("span.rounded-full");
const decoratedStack = (c: Element) => c.querySelector(".flex-col.gap-0\\.5");

describe("decorations on the canvas (#160, Studio #210)", () => {
  it("draws icon, description and badge — on a tall box the icon sits above the label", () => {
    const c = renderNode({ icon: "database", description: "Postgres 16", badge: "v2" });
    const stack = decoratedStack(c);
    expect(stack?.querySelector("svg.h-6.w-6 path")).not.toBeNull();
    expect(c.textContent).toContain("Orders");
    expect(c.textContent).toContain("Postgres 16");
    expect(tagOf(c)?.textContent).toBe("v2");
    expect(tagOf(c)?.querySelector("svg")).toBeNull();
  });

  it("puts the icon left of the label on a short box", () => {
    const c = renderNode({ icon: "cloud" }, 56);
    expect(c.querySelector("svg.h-\\[18px\\].w-\\[18px\\] path")).not.toBeNull();
    expect(c.querySelector("svg.h-6.w-6")).toBeNull();
  });

  it("keeps the label where it was with only a badge — no piece layout (same rule as export)", () => {
    const c = renderNode({ badge: "v2" });
    expect(tagOf(c)?.textContent).toBe("v2");
    expect(decoratedStack(c)).toBeNull();
  });

  it("draws a number badge as a numbered circle", () => {
    const c = renderNode({ badge: "2" });
    expect(stepOf(c)?.textContent).toBe("2");
    expect(tagOf(c)).toBeNull();
  });

  it("does not draw a badge left in the file on non-box shapes", () => {
    const c = renderNode({ shape: "class", badge: "stray" });
    expect(tagOf(c)).toBeNull();
    expect(stepOf(c)).toBeNull();
  });
});
