import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LIFELINE_ACTIVATION_W, SHAPE_KINDS } from "../../../shared/lib/palette";
import { useCanvasUiStore } from "../canvasUiStore";
import { FrameSvg } from "../FrameSvg";
import { FragmentSvg, LifelineSvg } from "../ShapeNode";
import { ShapeSvg } from "../ShapeSvg";

describe("ShapeSvg", () => {
  it("renders an SVG element for every shape except text/anchor", () => {
    // icon is drawn by IconNodeSvg, not ShapeSvg
    for (const shape of SHAPE_KINDS.filter((s) => s !== "text" && s !== "anchor" && s !== "icon")) {
      const { container, unmount } = render(
        <svg>
          <ShapeSvg shape={shape} width={160} height={56} fill="#eee" cap="#ddd" stroke="#333" />
        </svg>,
      );
      expect(container.querySelector("rect, ellipse, polygon, path"), shape).not.toBeNull();
      unmount();
    }
  });

  const BOXES = [
    "rect",
    "rounded",
    "ellipse",
    "diamond",
    "parallelogram",
    "cylinder",
    "hexagon",
    "sticky",
  ] as const;

  it("Studio: the 8 box shapes draw only a fill, no outline (#210 D3)", () => {
    for (const shape of BOXES) {
      const { container, unmount } = render(
        <svg>
          <ShapeSvg
            shape={shape}
            width={160}
            height={80}
            fill="#EAE8E4"
            cap="#DEDBD6"
            stroke="#4A4743"
          />
        </svg>,
      );
      for (const el of container.querySelectorAll("rect, ellipse, polygon, path")) {
        const stroke = el.getAttribute("stroke");
        expect(stroke === null || stroke === "none", `${shape}: stroke=${stroke}`).toBe(true);
      }
      unmount();
    }
  });

  it("Studio: the cylinder lid uses the cap tone", () => {
    const { container } = render(
      <svg>
        <ShapeSvg
          shape="cylinder"
          width={120}
          height={90}
          fill="#EAE8E4"
          cap="#DEDBD6"
          stroke="#4A4743"
        />
      </svg>,
    );
    expect(container.querySelector("ellipse")?.getAttribute("fill")).toBe("#DEDBD6");
    expect(container.querySelector("path")?.getAttribute("fill")).toBe("#EAE8E4");
  });

  it("Studio: rectangle corners are 6; rounded rectangles 14, capped at half the height", () => {
    const rx = (shape: "rect" | "rounded", h: number) => {
      const { container, unmount } = render(
        <svg>
          <ShapeSvg
            shape={shape}
            width={160}
            height={h}
            fill="#EAE8E4"
            cap="#DEDBD6"
            stroke="#4A4743"
          />
        </svg>,
      );
      const value = Number(container.querySelector("rect")?.getAttribute("rx"));
      unmount();
      return value;
    };
    expect(rx("rect", 56)).toBe(6);
    expect(rx("rounded", 80)).toBe(14);
    expect(rx("rounded", 20)).toBeLessThanOrEqual(10);
  });

  it("lifeline preview renders the header rect and a dashed line", () => {
    const { container } = render(
      <svg>
        <ShapeSvg shape="lifeline" width={120} height={360} fill="#eee" cap="#ddd" stroke="#333" />
      </svg>,
    );
    expect(container.querySelector("rect")).not.toBeNull();
    expect(container.querySelector("line")?.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("the text shape renders nothing", () => {
    const { container } = render(
      <svg>
        <ShapeSvg shape="text" width={160} height={56} fill="#eee" cap="#ddd" stroke="#333" />
      </svg>,
    );
    expect(container.querySelector("rect, ellipse, polygon, path")).toBeNull();
  });
});

describe("LifelineSvg", () => {
  /** Picks out only activation bars — the header rect spans the node's full width, so width tells them apart */
  const activationBars = (container: HTMLElement) =>
    [...container.querySelectorAll("rect")].filter(
      (r) => r.getAttribute("width") === String(LIFELINE_ACTIVATION_W),
    );

  it("renders activation bars clamped to the header/node range", () => {
    const { container } = render(
      <svg>
        <LifelineSvg
          width={120}
          height={360}
          fill="#eee"
          line="#B5B0A9"
          act="#E2DFDA"
          ink="#1A1918"
          activations={[
            { y0: 80, y1: 160 },
            { y0: 10, y1: 100 }, // starts above the header → clamped below the header
            { y0: 350, y1: 500 }, // runs off the node → clamped to the bottom
            { y0: 500, y1: 600 }, // fully out of range → not rendered
          ]}
        />
      </svg>,
    );
    const bars = activationBars(container);
    expect(bars).toHaveLength(3);
    expect(bars[1]?.getAttribute("y")).toBe("40");
    expect(Number(bars[2]?.getAttribute("y")) + Number(bars[2]?.getAttribute("height"))).toBe(360);
  });

  it("the head tile fills the node's width — no gap with a line reaching it from above (#210)", () => {
    const { container } = render(
      <svg>
        <LifelineSvg width={120} height={360} fill="#eee" line="#aaa" act="#ddd" ink="#111" />
      </svg>,
    );
    const head = container.querySelector("rect")!;
    expect(Number(head.getAttribute("x") ?? 0)).toBe(0);
    expect(Number(head.getAttribute("y") ?? 0)).toBe(0);
    expect(head.getAttribute("width")).toBe("120");
  });

  it("Studio: the head is a borderless tile, the line a gray dashed line, activation bars a borderless tone (#210 D12)", () => {
    const { container } = render(
      <svg>
        <LifelineSvg
          width={120}
          height={360}
          fill="#eee"
          line="#B5B0A9"
          act="#E2DFDA"
          ink="#1A1918"
          activations={[{ y0: 80, y1: 160 }]}
          destroyY={300}
        />
      </svg>,
    );
    const header = container.querySelector("rect");
    expect(header?.getAttribute("fill")).toBe("#eee");
    expect(header?.getAttribute("stroke")).toBeNull();
    expect(container.querySelector("line[stroke-dasharray]")?.getAttribute("stroke")).toBe(
      "#B5B0A9",
    );
    const bar = activationBars(container)[0];
    expect(bar?.getAttribute("fill")).toBe("#E2DFDA");
    expect(bar?.getAttribute("stroke")).toBeNull();
    for (const mark of container.querySelectorAll("line:not([stroke-dasharray])")) {
      expect(mark.getAttribute("stroke")).toBe("#1A1918");
    }
  });

  it("renders without bars when there are no activations", () => {
    const { container } = render(
      <svg>
        <LifelineSvg
          width={120}
          height={360}
          fill="#eee"
          line="#B5B0A9"
          act="#E2DFDA"
          ink="#1A1918"
        />
      </svg>,
    );
    expect(activationBars(container)).toHaveLength(0);
  });
});

describe("useCanvasUiStore", () => {
  it("each setter updates only its own state", () => {
    const s = useCanvasUiStore.getState();
    s.setArrowMode(true);
    s.setSnapTarget({ nodeId: "n1", handle: "right", point: { x: 1, y: 2 } });
    s.setEdgeMenu({ edgeId: "e1", clientX: 10, clientY: 20 });
    s.setEdgeLabelEdit({ edgeId: "e1", which: "center" });
    s.setCopiedEdgeStyle({ variant: "dashed" });

    const state = useCanvasUiStore.getState();
    expect(state.arrowMode).toBe(true);
    expect(state.snapTarget?.nodeId).toBe("n1");
    expect(state.edgeMenu?.edgeId).toBe("e1");
    expect(state.edgeLabelEdit?.which).toBe("center");
    expect(state.copiedEdgeStyle).toEqual({ variant: "dashed" });

    s.setArrowMode(false);
    s.setSnapTarget(null);
    s.setEdgeMenu(null);
    s.setEdgeLabelEdit(null);
    s.setCopiedEdgeStyle(null);
    expect(useCanvasUiStore.getState().arrowMode).toBe(false);
    expect(useCanvasUiStore.getState().snapTarget).toBeNull();
  });
});

describe("LifelineSvg — destroy marker", () => {
  const render1 = (destroyY?: number) =>
    render(
      <svg>
        <LifelineSvg
          width={120}
          height={360}
          fill="#eee"
          line="#B5B0A9"
          act="#E2DFDA"
          ink="#1A1918"
          destroyY={destroyY}
        />
      </svg>,
    );

  it("without destroyY the dashed line runs to the bottom and there is no X", () => {
    const { container } = render1();
    const dash = container.querySelector("line[stroke-dasharray]");
    expect(Number(dash?.getAttribute("y2"))).toBeGreaterThan(350);
    // The X is two segments without dasharray
    expect(container.querySelectorAll("line:not([stroke-dasharray])")).toHaveLength(0);
  });

  it("with destroyY the dashed line stops there and the X's two segments are drawn", () => {
    const { container } = render1(240);
    const dash = container.querySelector("line[stroke-dasharray]");
    expect(Number(dash?.getAttribute("y2"))).toBe(240);
    const marks = container.querySelectorAll("line:not([stroke-dasharray])");
    expect(marks).toHaveLength(2);
    // The two segments cross at destroyY
    for (const m of marks) {
      const y1 = Number(m.getAttribute("y1"));
      const y2 = Number(m.getAttribute("y2"));
      expect((y1 + y2) / 2).toBe(240);
    }
  });

  it("does not draw an out-of-range destroyY (render rule)", () => {
    const { container } = render1(900);
    expect(container.querySelectorAll("line:not([stroke-dasharray])")).toHaveLength(0);
    expect(
      Number(container.querySelector("line[stroke-dasharray]")?.getAttribute("y2")),
    ).toBeGreaterThan(350);
  });
});

describe("FrameSvg (#210 D10)", () => {
  it("is a dashed line in the frame color with no fill, r10", () => {
    const { container } = render(
      <svg>
        <FrameSvg width={400} height={300} line="#E08A2C" interactive={false} />
      </svg>,
    );
    const rect = container.querySelector("rect");
    expect(rect?.getAttribute("fill")).toBe("none");
    expect(rect?.getAttribute("stroke")).toBe("#E08A2C");
    expect(rect?.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(rect?.getAttribute("stroke-width")).toBe("1.5");
    expect(rect?.getAttribute("rx")).toBe("10");
  });
});

describe("FragmentSvg", () => {
  const draw = (kind: "alt" | "loop" | "opt" | "par" | "critical", branches?: number) =>
    render(
      <svg>
        <FragmentSvg
          width={420}
          height={200}
          line="#A9A49D"
          text="#6F6C67"
          patch="#F8F7F5"
          kind={kind}
          branches={branches}
        />
      </svg>,
    );

  it("sets the operator into the top border of the dashed box — no notch tab (#210 D11)", () => {
    const { container } = draw("loop");
    const frame = container.querySelector("rect[stroke-dasharray]");
    expect(frame?.getAttribute("fill")).toBe("none");
    expect(frame?.getAttribute("stroke")).toBe("#A9A49D");
    expect(frame?.getAttribute("rx")).toBe("10");
    expect(container.querySelector("path")).toBeNull();
    const op = [...container.querySelectorAll("text")].find((t) => t.textContent === "loop");
    expect(op?.getAttribute("y")).toBe("0");
    // a canvas-coloured patch under the operator cuts the dashes
    expect(container.querySelector('rect[fill="#F8F7F5"]')).not.toBeNull();
  });

  it("alt places one fewer divider than branches, evenly spaced", () => {
    const { container } = draw("alt", 3);
    const dividers = container.querySelectorAll("line");
    expect(dividers).toHaveLength(2);
    const ys = [...dividers].map((l) => Number(l.getAttribute("y1")));
    // Height 200 split in three → about 66.7, 133.3
    expect(ys[0]).toBeCloseTo(200 / 3, 1);
    expect(ys[1]).toBeCloseTo((200 / 3) * 2, 1);
  });

  it("has no dividers unless alt", () => {
    expect(draw("opt", 3).container.querySelectorAll("line")).toHaveLength(0);
    expect(draw("loop").container.querySelectorAll("line")).toHaveLength(0);
  });

  it("alt without a branch count defaults to 2 branches, 1 divider", () => {
    expect(draw("alt").container.querySelectorAll("line")).toHaveLength(1);
  });
});

describe("sticky silhouette", () => {
  const draw = (w: number, h: number) => {
    const { container } = render(
      <svg aria-label="c">
        <ShapeSvg
          shape="sticky"
          width={w}
          height={h}
          fill="#FBEFD9"
          cap="#F3DFB8"
          stroke="#A65809"
        />
      </svg>,
    );
    return container;
  };

  const paths = (w: number, h: number) =>
    [...draw(w, h).querySelectorAll("path")].map((p) => p.getAttribute("d") ?? "");

  /** every (x, y) the path visits, so each axis can be checked against its own side */
  const points = (d: string): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = [];
    // commands here are M/H/V/Q/L/Z; walk them so H and V map to the right axis
    let x = 0;
    let y = 0;
    for (const token of d.match(/[MHVQLZ][^MHVQLZ]*/g) ?? []) {
      const kind = token[0];
      const args = (token.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      if (kind === "M" || kind === "L") {
        x = args[0]!;
        y = args[1]!;
      } else if (kind === "H") {
        x = args[0]!;
      } else if (kind === "V") {
        y = args[0]!;
      } else if (kind === "Q") {
        // the control point is not visited, but it decides how far the curve
        // bulges — a control point outside the box draws outside the box
        out.push({ x: args[0]!, y: args[1]! });
        x = args[2]!;
        y = args[3]!;
      } else continue;
      out.push({ x, y });
    }
    return out;
  };

  /** the diagonal cut: the two body vertices that are neither on x=w nor y=h alone */
  const cutLine = (body: string) => {
    const m = body.match(/V ([\d.]+)\s+L ([\d.]+) ([\d.]+)/);
    if (!m) throw new Error(`no cut in ${body}`);
    return { fromY: Number(m[1]), toX: Number(m[2]), toY: Number(m[3]) };
  };

  it("the body is a path with a cut corner, not a rect", () => {
    const c = draw(170, 120);
    expect(c.querySelector("rect")).toBeNull();
    expect(c.querySelectorAll("path")).toHaveLength(2);
  });

  it("keeps the corner cut at palette size too, not turning into a pill", () => {
    expect(paths(30, 20)[0]).toMatch(/L \d/);
  });

  it.each([
    [170, 120],
    [30, 20],
    [12, 8],
    [40, 200], // a tall box — mixing up the axes shows up here
  ])("%i×%i: both paths stay inside the box", (w, h) => {
    for (const d of paths(w, h)) {
      for (const { x, y } of points(d)) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(w);
        expect(y).toBeLessThanOrEqual(h);
      }
    }
  });

  it.each([
    [170, 120],
    [30, 20],
    [12, 8],
    [40, 200],
  ])("%i×%i: the fold triangle meets the spot the body cut away", (w, h) => {
    const [body, flap] = paths(w, h);
    const cut = cutLine(body!);
    const corners = points(flap!);

    // The triangle's hypotenuse = the body's cut line. Both ends must match exactly to join
    expect(corners).toContainEqual({ x: cut.toX, y: cut.fromY });
    expect(corners).toContainEqual({ x: cut.toX, y: cut.toY });
    // The third vertex is inside the box (not in the cut-away outside)
    const inner = corners.find((p) => p.x !== cut.toX);
    expect(inner?.y).toBe(cut.fromY);
    expect(inner?.x).toBeGreaterThan(cut.toX);
  });

  it("shows the folded face — a cap tone one step darker than the body (#210)", () => {
    const flap = draw(170, 120).querySelectorAll("path")[1];
    expect(flap?.getAttribute("fill")).toBe("#F3DFB8");
    expect(flap?.getAttribute("fill")).not.toBe("#FBEFD9");
  });

  it("fills the body with no outline (#210 D3)", () => {
    // Pinning only the triangle's fill and leaving out the body would be lopsided — a hollow sticky is a regression too
    const body = draw(170, 120).querySelectorAll("path")[0];
    expect(body?.getAttribute("fill")).toBe("#FBEFD9");
    const stroke = body?.getAttribute("stroke");
    expect(stroke === null || stroke === "none").toBe(true);
  });

  it("has rounded corners — square corners don't read as a sticky note", () => {
    // The first vertex is where the top-left corner starts, so it's inset by the radius
    const first = points(paths(170, 120)[0]!)[0]!;
    expect(first.x).toBeGreaterThan(2);
  });

  it("puts the fold at the bottom-right corner", () => {
    const flap = points(paths(170, 120)[1]!);
    for (const { x, y } of flap) {
      expect(x).toBeGreaterThan(170 / 2);
      expect(y).toBeGreaterThan(120 / 2);
    }
  });

  it("keeps the fold big enough to recognize at small sizes too", () => {
    // The old ratio (min(22, w*0.18, h*0.25)) gave 5px at 30×20, which fails here
    const foldAt = (w: number, h: number) => {
      const cut = cutLine(paths(w, h)[0]!);
      return h - cut.fromY;
    };
    expect(foldAt(30, 20)).toBeGreaterThanOrEqual(Math.min(30, 20) * 0.3);
    expect(foldAt(170, 120)).toBeGreaterThan(foldAt(30, 20));
  });
});
