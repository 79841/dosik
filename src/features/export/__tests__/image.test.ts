import { afterEach, describe, expect, it, vi } from "vitest";

import { makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { SURFACE_DARK, SURFACE_LIGHT } from "../../../shared/lib/palette";
import { useThemeStore } from "../../../shared/lib/theme";

const { toPngMock, toSvgMock } = vi.hoisted(() => ({
  toPngMock: vi.fn(),
  toSvgMock: vi.fn(),
}));

vi.mock("html-to-image", () => ({ toPng: toPngMock, toSvg: toSvgMock }));

const { renderPngBase64, renderSvgText } = await import("../image");
const { useDiagramStore } = await import("../../../shared/lib/store");
const { makeEdge, makeDoc } = await import("../../../shared/lib/__tests__/testFixtures");

const mountViewport = () => {
  const el = document.createElement("div");
  el.className = "react-flow__viewport";
  document.body.appendChild(el);
  return el;
};

afterEach(() => {
  document.body.innerHTML = "";
  useThemeStore.setState({ theme: "light" });
  // the global clearAllMocks keeps implementations — a `mockRejectedValue` set
  // by one test would otherwise leak into a later test that relies on the
  // default (a test that sets its own mock is unaffected)
  toPngMock.mockReset();
  toSvgMock.mockReset();
});

describe("export/image", () => {
  const nodes = [makeNode({ id: "a", x: 0, y: 0, width: 100, height: 50 })];

  it("Throws a clear error when there is no viewport", async () => {
    await expect(renderPngBase64(nodes)).rejects.toThrow("Nothing to export");
  });

  it("Throws an error when there are no nodes", async () => {
    mountViewport();
    await expect(renderPngBase64([])).rejects.toThrow("Nothing to export");
  });

  it("PNG: strips the data URL prefix and returns only the base64", async () => {
    mountViewport();
    toPngMock.mockResolvedValue("data:image/png;base64,QUJDREVG");
    const base64 = await renderPngBase64(nodes);
    expect(base64).toBe("QUJDREVG");
    // The padding, background and resolution options are passed through
    const options = toPngMock.mock.calls[0]?.[1];
    expect(options?.backgroundColor).toBe("#FFFFFF");
    expect(SURFACE_LIGHT.canvasBg).toBe("#FFFFFF");
    expect(options?.pixelRatio).toBe(2);
    expect(options?.width).toBe(100 + 96);
    expect(options?.height).toBe(50 + 96);
  });

  it("Exports with the dark canvas background in the dark theme", async () => {
    mountViewport();
    useThemeStore.setState({ theme: "dark" });
    toPngMock.mockResolvedValue("data:image/png;base64,QQ==");
    await renderPngBase64(nodes);
    const options = toPngMock.mock.calls.at(-1)?.[1];
    expect(options?.backgroundColor).toBe("#1C1C1C");
    expect(SURFACE_DARK.canvasBg).toBe("#1C1C1C");
  });

  it("SVG: decodes the URI encoding and returns the SVG string", async () => {
    mountViewport();
    toSvgMock.mockResolvedValue(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg>한글 라벨</svg>")}`,
    );
    const svg = await renderSvgText(nodes);
    expect(svg).toBe("<svg>한글 라벨</svg>");
  });

  it("The agent edit flash is excluded by the render filter — the minimap and controls are gone (#219 D11, T31)", async () => {
    mountViewport();
    toPngMock.mockResolvedValue("data:image/png;base64,QQ==");
    await renderPngBase64(nodes);
    const filter = toPngMock.mock.calls.at(-1)?.[1]?.filter as (n: HTMLElement) => boolean;
    const flash = document.createElement("div");
    flash.className = "agent-flash";
    const normal = document.createElement("div");
    expect(filter(flash)).toBe(false);
    expect(filter(normal)).toBe(true);
    expect(filter.toString()).not.toContain("minimap");
    expect(filter.toString()).not.toContain("controls");
  });
});

describe("export/image — selection chrome", () => {
  /** Records the selection state at the moment of capture */
  const captureSelection = () => {
    const seen: { nodes: string[]; edges: string[] }[] = [];
    toPngMock.mockImplementation(async () => {
      const st = useDiagramStore.getState();
      seen.push({
        nodes: st.nodes.filter((n) => n.selected).map((n) => n.id),
        edges: st.edges.filter((e) => e.selected).map((e) => e.id),
      });
      return "data:image/png;base64,AAA";
    });
    return seen;
  };

  const seedSelected = () => {
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [
            makeNode({ id: "a", x: 0, y: 0, width: 100, height: 50 }),
            makeNode({ id: "b", x: 200 }),
          ],
          [makeEdge({ id: "e1", source: "a", target: "b" })],
        ),
        null,
      );
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => (n.id === "a" ? { ...n, selected: true } : n)),
      edges: st.edges.map((e) => ({ ...e, selected: true })),
    }));
    mountViewport();
  };

  const nodesOf = () => useDiagramStore.getState().nodes;

  it("Nothing is selected during capture", async () => {
    seedSelected();
    const seen = captureSelection();

    await renderPngBase64(nodesOf());

    expect(seen).toEqual([{ nodes: [], edges: [] }]);
  });

  it("Restores the selection after capture", async () => {
    seedSelected();
    captureSelection();

    await renderPngBase64(nodesOf());

    const st = useDiagramStore.getState();
    expect(st.nodes.filter((n) => n.selected).map((n) => n.id)).toEqual(["a"]);
    expect(st.edges.filter((e) => e.selected).map((e) => e.id)).toEqual(["e1"]);
  });

  it("Restores the selection even when capture fails", async () => {
    seedSelected();
    toPngMock.mockRejectedValue(new Error("boom"));

    await expect(renderPngBase64(nodesOf())).rejects.toThrow("boom");

    expect(useDiagramStore.getState().nodes.filter((n) => n.selected)).toHaveLength(1);
  });

  it("Restores the selection even when SVG capture fails", async () => {
    seedSelected();
    toSvgMock.mockRejectedValue(new Error("boom"));

    await expect(renderSvgText(nodesOf())).rejects.toThrow("boom");

    expect(useDiagramStore.getState().nodes.filter((n) => n.selected)).toHaveLength(1);
  });

  it("Does not create an undo frame", async () => {
    seedSelected();
    captureSelection();
    useDiagramStore.setState({ past: [] });

    await renderPngBase64(nodesOf());

    expect(useDiagramStore.getState().past).toHaveLength(0);
  });

  it("Both DOM capture functions follow the same rule", async () => {
    seedSelected();
    const svgSeen: string[][] = [];
    toSvgMock.mockImplementation(async () => {
      svgSeen.push(
        useDiagramStore
          .getState()
          .nodes.filter((n) => n.selected)
          .map((n) => n.id),
      );
      return "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E";
    });
    const pngSeen = captureSelection();

    await renderPngBase64(nodesOf());
    await renderSvgText(nodesOf());

    expect(svgSeen).toEqual([[]]);
    expect(pngSeen).toEqual([{ nodes: [], edges: [] }]);
  });

  it("Leaves the store untouched when nothing is selected", async () => {
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "a" })], []), null);
    mountViewport();
    const before = useDiagramStore.getState().nodes;
    captureSelection();

    await renderPngBase64(before);

    expect(useDiagramStore.getState().nodes).toBe(before);
  });
  it("Agent edit flashes are also removed during capture and restored", async () => {
    seedSelected();
    const stamp = { a: 1234 };
    useDiagramStore.setState({ touched: stamp });
    const seen: Record<string, number>[] = [];
    toPngMock.mockImplementation(async () => {
      seen.push(useDiagramStore.getState().touched);
      return "data:image/png;base64,AAA";
    });

    await renderPngBase64(nodesOf());

    expect(seen).toEqual([{}]);
    expect(useDiagramStore.getState().touched).toEqual(stamp);
  });

  it("The flash overlay element is excluded by the filter", async () => {
    seedSelected();
    let filter: ((el: HTMLElement) => boolean) | undefined;
    toPngMock.mockImplementation(async (_el: HTMLElement, opts: { filter: typeof filter }) => {
      filter = opts.filter;
      return "data:image/png;base64,AAA";
    });

    await renderPngBase64(nodesOf());

    const flash = document.createElement("div");
    flash.className = "agent-flash";
    expect(filter?.(flash)).toBe(false);
    expect(filter?.(document.createElement("div"))).toBe(true);
  });
  it("Restoring does not overwrite agent edit stamps that arrive during capture", async () => {
    seedSelected();
    useDiagramStore.setState({ touched: { a: 1, shared: 1 } });
    toPngMock.mockImplementation(async () => {
      // During capture the AI touches b anew and stamps shared again
      useDiagramStore.setState((st) => ({ touched: { ...st.touched, b: 2, shared: 9 } }));
      return "data:image/png;base64,AAA";
    });

    await renderPngBase64(nodesOf());

    // For overlapping ids the latest value stamped during capture wins — this pins the merge order too
    expect(useDiagramStore.getState().touched).toEqual({ a: 1, b: 2, shared: 9 });
  });
});
