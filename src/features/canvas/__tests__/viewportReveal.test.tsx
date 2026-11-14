import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { revealViewport } from "../../../shared/lib/store/reveal";
import { ViewportReveal } from "../ViewportReveal";

/** the viewport is React Flow's; what can be pinned is the call made on it */
const viewport = vi.hoisted(() => ({ fitView: vi.fn(), setViewport: vi.fn() }));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useReactFlow: () => viewport,
    // the pane is 1000×800, looked at 150% zoomed in
    useStoreApi: () => ({ getState: () => ({ width: 1000, height: 800, transform: [0, 0, 1.5] }) }),
  };
});

describe("ViewportReveal (#81, #117)", () => {
  beforeEach(() => useDiagramStore.setState({ revealRequest: null }));

  it("does nothing without a request", () => {
    render(<ViewportReveal />);
    expect(viewport.fitView).not.toHaveBeenCalled();
    expect(viewport.setViewport).not.toHaveBeenCalled();
  });

  it("fit request → fitView(maxZoom 1), and the handled request is cleared", () => {
    render(<ViewportReveal />);
    act(() => useDiagramStore.setState({ revealRequest: { key: 7, mode: "fit" } }));
    expect(viewport.fitView).toHaveBeenCalledTimes(1);
    expect(viewport.fitView).toHaveBeenCalledWith({ maxZoom: 1 });
    expect(viewport.setViewport).not.toHaveBeenCalled();
    expect(useDiagramStore.getState().revealRequest).toBeNull();
  });

  it("when a pasted box goes off screen, pans to its center keeping the zoom — no zooming (#200)", () => {
    render(<ViewportReveal />);
    act(() =>
      useDiagramStore.setState({
        revealRequest: {
          key: 9,
          mode: "center",
          bounds: { x: 1000, y: 0, width: 2000, height: 400 },
        },
      }),
    );
    expect(viewport.fitView).not.toHaveBeenCalled();
    // the box's centre (2000, 200) lands on the pane's centre (500, 400) at 1.5
    expect(viewport.setViewport).toHaveBeenCalledWith({
      x: 500 - 2000 * 1.5,
      y: 400 - 200 * 1.5,
      zoom: 1.5,
    });
    expect(useDiagramStore.getState().revealRequest).toBeNull();
  });

  it("does not move when the pasted box is fully visible — it was pasted at the mouse position", () => {
    render(<ViewportReveal />);
    // the pane shows flow x 0..666, y 0..533 at 1.5
    act(() =>
      useDiagramStore.setState({
        revealRequest: {
          key: 15,
          mode: "center",
          bounds: { x: 100, y: 100, width: 300, height: 200 },
        },
      }),
    );
    expect(viewport.setViewport).not.toHaveBeenCalled();
    expect(useDiagramStore.getState().revealRequest).toBeNull();
  });

  it("origin request → origin, 100%", () => {
    render(<ViewportReveal />);
    act(() => useDiagramStore.setState({ revealRequest: { key: 8, mode: "origin" } }));
    expect(viewport.setViewport).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 1 });
    expect(viewport.fitView).not.toHaveBeenCalled();
    expect(useDiagramStore.getState().revealRequest).toBeNull();
  });

  it("reacts to each of several consecutive requests", () => {
    render(<ViewportReveal />);
    act(() => useDiagramStore.setState({ revealRequest: { key: 10, mode: "fit" } }));
    act(() => useDiagramStore.setState({ revealRequest: { key: 11, mode: "origin" } }));
    act(() => useDiagramStore.setState({ revealRequest: { key: 12, mode: "fit" } }));
    expect(viewport.fitView).toHaveBeenCalledTimes(2);
    expect(viewport.setViewport).toHaveBeenCalledTimes(1);
    expect(useDiagramStore.getState().revealRequest).toBeNull();
  });

  it("viewport request → that exact viewport, no fit — when returning to a tab (#218 T7)", () => {
    render(<ViewportReveal />);
    act(() =>
      useDiagramStore.setState({
        revealRequest: { key: 21, mode: "viewport", viewport: { x: -120, y: 40, zoom: 1.75 } },
      }),
    );
    expect(viewport.setViewport).toHaveBeenCalledWith({ x: -120, y: 40, zoom: 1.75 });
    expect(viewport.fitView).not.toHaveBeenCalled();
    expect(useDiagramStore.getState().revealRequest).toBeNull();
  });

  it("revealViewport uses a new key each time — returning to the same viewport twice is handled both times (#218)", () => {
    const a = revealViewport({ x: 1, y: 2, zoom: 1 });
    const b = revealViewport({ x: 1, y: 2, zoom: 1 });
    expect(a).toMatchObject({ mode: "viewport", viewport: { x: 1, y: 2, zoom: 1 } });
    expect(b.key).not.toBe(a.key);
  });

  it("also handles a request already pending at mount", () => {
    useDiagramStore.setState({ revealRequest: { key: 9, mode: "fit" } });
    render(<ViewportReveal />);
    expect(viewport.fitView).toHaveBeenCalledTimes(1);
    expect(useDiagramStore.getState().revealRequest).toBeNull();
  });
});
