import { describe, expect, it } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { createShapeNode } from "../../../shared/lib/store/nodeFactory";
import type { DiagramNode } from "../../../shared/lib/types";
import { BORDER_TITLE, SURFACE_LIGHT } from "../../../shared/lib/palette";
import { toMermaid } from "../markdown";
import { nodeLabelLayout } from "../../../shared/lib/nodeLayout";
import { renderVectorSvg } from "../vectorSvg";

const frame = (id: string, label: string, x: number, y: number, w: number, h: number) =>
  ({
    ...createShapeNode("frame", { x, y }, { id, label, width: w, height: h }),
  }) as DiagramNode;
const box = (id: string, label: string, x: number, y: number) =>
  createShapeNode("rect", { x, y }, { id, label });

describe("Frame export (#170 D9)", () => {
  it("Vector SVG: the title is set into the top border (canvas-colored patch), with no shadow (#210 D10)", () => {
    const f = frame("f", "VPC", 0, 0, 400, 300);
    const layout = nodeLabelLayout(f, 400, 300)!;
    expect(layout).toMatchObject({
      x: BORDER_TITLE.inset + BORDER_TITLE.padX,
      centerY: 0,
      anchor: "start",
      lines: ["VPC"],
      fontWeight: 600,
    });
    const svg = renderVectorSvg(makeDoc([f], []));
    expect(svg).toContain("VPC");
    const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
    const g = dom.querySelector('[data-node="f"]')!;
    expect(g.querySelector(`rect[fill="${SURFACE_LIGHT.canvasBg}"]`)).not.toBeNull();
    expect(g.querySelector("[filter]")).toBeNull();
    // the exported file has no hit targets
    expect(g.querySelector(".pointer-events-auto")).toBeNull();
  });

  it("Frame badge: a number is a numbered circle in the top-right corner, anything else is a tag set into the top border (#210 D23)", () => {
    const step = { ...frame("f", "VPC", 0, 0, 400, 300) };
    step.data = { ...step.data, badge: "2" };
    const tag = { ...frame("t", "Edge", 500, 0, 400, 300) };
    tag.data = { ...tag.data, badge: "beta" };
    const dom = new DOMParser().parseFromString(
      renderVectorSvg(makeDoc([step, tag], [])),
      "image/svg+xml",
    );
    const circle = dom.querySelector('[data-node="f"] circle');
    expect(circle?.getAttribute("cx")).toBe("400");
    expect(circle?.getAttribute("cy")).toBe("0");
    expect(dom.querySelector('[data-node="f"]')?.textContent).toContain("2");
    expect(dom.querySelector('[data-node="t"]')?.textContent).toContain("BETA");
  });

  it("Mermaid: a frame badge goes into the subgraph title as [badge]", () => {
    const f = { ...frame("vpc", "VPC", 0, 0, 600, 400) };
    f.data = { ...f.data, badge: "1" };
    expect(toMermaid(makeDoc([f, box("api", "API", 40, 60)], []))).toContain('["VPC [1]"]');
  });

  it("Mermaid: the badge of an untitled frame becomes Frame [badge]", () => {
    const f = { ...frame("vpc", "", 0, 0, 600, 400) };
    f.data = { ...f.data, badge: "beta" };
    expect(toMermaid(makeDoc([f, box("api", "API", 40, 60)], []))).toContain('["Frame [beta]"]');
  });

  it("An empty title becomes Frame, as on the canvas", () => {
    expect(nodeLabelLayout(frame("f", "", 0, 0, 400, 300), 400, 300)?.lines).toEqual(["Frame"]);
  });

  it("Mermaid: frames are subgraphs — nodes go in the innermost frame, and frames inside frames nest", () => {
    const out = toMermaid(
      makeDoc(
        [
          frame("vpc", "VPC", 0, 0, 600, 400),
          frame("sub", "Subnet", 20, 200, 300, 180),
          box("api", "API", 40, 60),
          box("db", "DB", 40, 260),
          box("cdn", "CDN", 800, 60),
        ],
        [],
      ),
    );
    // api in VPC (not in Subnet), db in Subnet, cdn in neither
    expect(out).toContain(
      [
        '    subgraph vpc["VPC"]',
        '        subgraph sub["Subnet"]',
        "            db",
        "        end",
        "        api",
        "    end",
      ].join("\n"),
    );
    expect(out.split("\n").filter((l) => l.trim() === "cdn")).toEqual([]);
    // a frame is never declared as a node box
    expect(out.split("\n").filter((l) => l.trim() === 'vpc["VPC"]')).toEqual([]);
  });

  it("Mermaid: two frames of the same size don't vanish — one contains the other (#170)", () => {
    const out = toMermaid(
      makeDoc([frame("p", "P", 0, 0, 300, 200), frame("q", "Q", 0, 0, 300, 200)], []),
    );
    expect(out.match(/subgraph/g)).toHaveLength(2);
  });

  it("Mermaid: three frames of the same size don't vanish either (#172)", () => {
    const out = toMermaid(
      makeDoc(
        [
          frame("p", "P", 0, 0, 300, 200),
          frame("q", "Q", 0, 0, 300, 200),
          frame("r", "R", 0, 0, 300, 200),
          box("n", "N", 20, 40),
        ],
        [],
      ),
    );
    expect(out.match(/subgraph/g)).toHaveLength(3);
  });
});
