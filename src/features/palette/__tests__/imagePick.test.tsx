import { invoke } from "@tauri-apps/api/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { SHAPE_GROUPS } from "../../../shared/lib/palette";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import type { DecodedImage } from "../../canvas/imageInput";
import { useAppStore } from "../../library/appStore";
import { openDocument, resetTabsForTests } from "../../library/tabActions";
import { resetUnsavedGuardForTests } from "../../library/unsavedGuard";
import { resetAutosaveForTests } from "../../library/useAutosave";

// the file dialog and the decoding are the platform's; each answers when the test says so
const picked = vi.hoisted(() => ({
  file: null as null | ((picture: { blob: Blob; original?: string } | null) => void),
}));
vi.mock("../../canvas/imageFiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../canvas/imageFiles")>()),
  pickImageFile: vi.fn(
    () =>
      new Promise<{ blob: Blob; original?: string } | null>((resolve) => (picked.file = resolve)),
  ),
}));
vi.mock("../../canvas/imageInput", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../canvas/imageInput")>()),
  imageFromBlob: vi.fn(
    async (): Promise<DecodedImage> => ({
      src: "data:image/png;base64,iVBORw0KGgo=",
      width: 40,
      height: 20,
    }),
  ),
}));

import { ShapePalette } from "../ShapePalette";

const images = (nodes = useDiagramStore.getState().nodes) =>
  nodes.filter((n) => n.data.shape === "image");
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);
const imageGroup = SHAPE_GROUPS.find((g) => g.shapes.includes("image"))!;

const pickImage = async () => {
  const user = userEvent.setup();
  render(
    <ReactFlowProvider>
      <ShapePalette />
    </ReactFlowProvider>,
  );
  // Images picks a file straight away — no flyout (#219 T8)
  await user.click(screen.getByRole("button", { name: imageGroup.label }));
  await vi.waitFor(() => expect(picked.file).not.toBeNull());
};

describe("palette Image — goes only into the document it was picked for (#218)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    picked.file = null;
    openDocument(makeDoc([], [], "A"), { projectId: "a" });
  });

  it("lands at the screen center when nothing changed", async () => {
    await pickImage();
    picked.file!({ blob: new Blob([], { type: "image/png" }), original: "/pics/picked.png" });
    await vi.waitFor(() => expect(images()).toHaveLength(1));
    // the picked file is linked for the image view
    expect(images()[0]!.data.original).toBe("/pics/picked.png");
    expect(toasts()).toEqual([]);
  });

  it("moving to another tab while picking — goes into no document, shows a toast", async () => {
    await pickImage();
    openDocument(makeDoc([], [], "B"), { projectId: "b" });
    picked.file!({ blob: new Blob([], { type: "image/png" }) });
    await vi.waitFor(() =>
      expect(toasts()).toEqual([
        "You left the diagram before the picture was added — add it again",
      ]),
    );
    expect(images()).toEqual([]);
    const left = useAppStore.getState().tabs.find((t) => t.projectId === "a")!;
    expect(images(left.doc!.nodes)).toEqual([]);
  });
});
