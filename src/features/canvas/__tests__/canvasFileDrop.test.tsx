import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Files dropped on the canvas itself — Windows, where the webview keeps file
 * drops so the shape strip's HTML5 drag works (`dragDropEnabled: false`). The
 * drop runs where React Flow would call it, with the event a drop makes.
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
const placing = vi.hoisted(() => ({ placeBlobs: vi.fn(async () => {}) }));
vi.mock("../useImageFileDrop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../useImageFileDrop")>()),
  placeBlobs: placing.placeBlobs,
  useImageFileDrop: () => {},
}));

const { DiagramCanvas } = await import("../DiagramCanvas");
const { ReactFlowProvider } = await import("@xyflow/react");
const { useToastStore } = await import("../../../shared/lib/toastStore");

const file = (name: string) => new File(["x"], name);
/** what a drop carrying these files hands the canvas */
const drop = (files: File[]) => {
  const event = {
    clientX: 10,
    clientY: 20,
    preventDefault: vi.fn(),
    dataTransfer: { files, getData: () => "" },
  };
  (captured.onDrop as (e: unknown) => void)(event);
  return event;
};

describe("files dropped on the canvas (spec R8)", () => {
  beforeEach(() => {
    placing.placeBlobs.mockClear();
    useToastStore.getState().dismissAll();
    render(
      <ReactFlowProvider>
        <DiagramCanvas />
      </ReactFlowProvider>,
    );
  });

  it("pictures become image nodes where they were dropped", () => {
    const e = drop([file("shot.png"), file("notes.txt"), file("photo.JPG")]);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(placing.placeBlobs).toHaveBeenCalledTimes(1);
    expect((placing.placeBlobs.mock.calls[0] as unknown[])[0]).toHaveLength(2);
  });

  it("no picture among them: the toast, and the drop is still the canvas's — the webview opens nothing", () => {
    const e = drop([file("spec.pdf")]);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(placing.placeBlobs).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual([
      "Error: Only png, jpg, jpeg, gif, webp pictures can be dropped here",
    ]);
  });

  it("a drop with no files and no shape is left alone", () => {
    const e = drop([]);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(placing.placeBlobs).not.toHaveBeenCalled();
  });
});
