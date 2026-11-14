import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { Toaster } from "../../../shared/ui/Toaster";
import { ViewportReveal } from "../../canvas/ViewportReveal";
import { newDiagram, openFileAnywhere } from "../navigation";
import { resetTabsForTests } from "../tabActions";
import { resetUnsavedGuardForTests } from "../unsavedGuard";
import { resetAutosaveForTests } from "../useAutosave";

/**
 * The viewport is React Flow's, not the store's. Opening leaves a reveal
 * request in the store and `ViewportReveal` (rendered alongside, as in App)
 * acts on it — what can be pinned is the call that reaches React Flow. A real
 * fitView never resolves without a rendered canvas (it waits for measurement).
 *
 * These ran through the toolbar's New and Open until #219 took both out of
 * it (D4); every New and Open file… is the same `navigation` call.
 */
const viewport = vi.hoisted(() => ({ fitView: vi.fn(), setViewport: vi.fn() }));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useReactFlow: () => viewport,
    // ViewportReveal reads the pane's size for a paste's reveal (#200)
    useStoreApi: () => ({ getState: () => ({ width: 1000, height: 800, transform: [0, 0, 1] }) }),
  };
});

const mockedInvoke = vi.mocked(invoke);
const mockedOpen = vi.mocked(open);

const reset = () => {
  resetTabsForTests();
  useToastStore.getState().dismissAll();
  // the reset itself leaves a reveal request; tests start from none
  useDiagramStore.setState({ revealRequest: null });
  resetAutosaveForTests();
  resetUnsavedGuardForTests();
  mockedInvoke.mockReset();
  mockedInvoke.mockResolvedValue(undefined);
};

const renderReveal = () =>
  render(
    <>
      <Toaster />
      <ViewportReveal />
    </>,
  );

/**
 * a valid file body with one node. Its far-off coordinates are decoration —
 * fitView is a mock here, so only *whether* it is called is pinned.
 */
const farAwayDoc = () => {
  useDiagramStore
    .getState()
    .applyOps([{ op: "add_node", node: { id: "far", label: "Far", x: 4000, y: 3000 } }]);
  const body = JSON.stringify(useDiagramStore.getState().toDoc());
  reset();
  return body;
};

describe("fit-on-open (#81)", () => {
  beforeEach(reset);

  it("Open: a file with content fits the viewport with fitView — without zooming past 100%", async () => {
    mockedOpen.mockResolvedValue("/tmp/far.dosik.json");
    mockedInvoke.mockResolvedValue(farAwayDoc());
    renderReveal();
    await openFileAnywhere();
    expect(await screen.findByText("Diagram opened")).toBeInTheDocument();
    expect(viewport.fitView).toHaveBeenCalledTimes(1);
    expect(viewport.fitView).toHaveBeenCalledWith({ maxZoom: 1 });
    expect(viewport.setViewport).not.toHaveBeenCalled();
  });

  it("Open: an empty file has nothing to fit, so the viewport returns to the origin", async () => {
    mockedOpen.mockResolvedValue("/tmp/empty.dosik.json");
    mockedInvoke.mockResolvedValue(
      JSON.stringify({ version: 1, title: "Empty", nodes: [], edges: [] }),
    );
    renderReveal();
    await openFileAnywhere();
    expect(await screen.findByText("Diagram opened")).toBeInTheDocument();
    expect(viewport.setViewport).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 1 });
    expect(viewport.fitView).not.toHaveBeenCalled();
  });

  it("Open: a file with only orphan anchors loads empty, so the viewport returns to the origin — a queued fit must not jump to the first shape", async () => {
    mockedOpen.mockResolvedValue("/tmp/ghost.dosik.json");
    // an anchor with no edge is pruned by loadDoc; the file says "one node",
    // the store ends up with none
    mockedInvoke.mockResolvedValue(
      JSON.stringify({
        version: 1,
        title: "Ghost",
        nodes: [
          {
            id: "p",
            type: "shape",
            position: { x: 4000, y: 3000 },
            data: { label: "", shape: "anchor", color: "violet" },
          },
        ],
        edges: [],
      }),
    );
    renderReveal();
    await openFileAnywhere();
    expect(await screen.findByText("Diagram opened")).toBeInTheDocument();
    expect(useDiagramStore.getState().nodes).toHaveLength(0);
    expect(viewport.setViewport).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 1 });
    expect(viewport.fitView).not.toHaveBeenCalled();
  });

  it("Open: a broken file leaves the document alive, so the viewport is not touched either", async () => {
    mockedOpen.mockResolvedValue("/tmp/broken.dosik.json");
    mockedInvoke.mockResolvedValue(JSON.stringify({ nodes: [{ bad: true }], edges: [] }));
    renderReveal();
    await openFileAnywhere();
    // the "Error: " is read out, not drawn (#231 D18) — the alert says the sentence whole
    expect(await screen.findByRole("alert")).toHaveTextContent(/Error: Invalid diagram file/);
    expect(viewport.fitView).not.toHaveBeenCalled();
    expect(viewport.setViewport).not.toHaveBeenCalled();
  });

  it("cancelling Open does not touch the viewport", async () => {
    mockedOpen.mockResolvedValue(null);
    renderReveal();
    await openFileAnywhere();
    expect(mockedOpen).toHaveBeenCalled();
    expect(viewport.fitView).not.toHaveBeenCalled();
    expect(viewport.setViewport).not.toHaveBeenCalled();
  });

  it("New: returns to the origin along with the empty document", async () => {
    renderReveal();
    await newDiagram();
    await waitFor(() => expect(viewport.setViewport).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 1 }));
    expect(viewport.fitView).not.toHaveBeenCalled();
  });
});
