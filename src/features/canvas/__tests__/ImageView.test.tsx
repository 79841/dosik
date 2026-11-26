import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useCanvasUiStore } from "../canvasUiStore";
import { useToastStore } from "../../../shared/lib/toastStore";
import { handleCanvasKeyDown, handleCanvasKeyUp } from "../canvasKeymap";
import { ImageView, viewCaption } from "../ImageView";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const ORIGINAL = "/Users/someone/Desktop/shot.png";

const image = (id: string, data: { original?: string; label?: string } = {}) => {
  const base = makeNode({ id, shape: "image" });
  return { ...base, data: { ...base.data, src: PNG, label: "", ...data } };
};

/** the picture finished loading at this natural size (jsdom decodes nothing) */
const loaded = (width: number, height: number) => {
  const img = screen.getByRole("img");
  Object.defineProperty(img, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: height, configurable: true });
  fireEvent.load(img);
  return img;
};

const viewed = () => useCanvasUiStore.getState().imageView;
const open = (id: string) => act(() => useCanvasUiStore.getState().setImageView(id));
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  URL.createObjectURL = vi.fn(() => "blob:original");
  URL.revokeObjectURL = vi.fn();
  useCanvasUiStore.getState().setImageView(null);
  useDiagramStore
    .getState()
    .loadDoc(
      makeDoc(
        [image("plain", { label: "Sign-up page" }), image("linked", { original: ORIGINAL })],
        [],
      ),
      null,
    );
});

afterEach(() => useCanvasUiStore.getState().setImageView(null));

describe("the bar's words (#279)", () => {
  it("names the original, or the stored copy's size, and a link that broke", () => {
    const size = { width: 2880, height: 1800 };
    expect(viewCaption(size, { original: true, missing: false })).toBe("Original · 2,880 × 1,800");
    expect(viewCaption(size, { original: false, missing: false })).toBe("2,880 × 1,800");
    expect(viewCaption(size, { original: false, missing: true })).toBe(
      "2,880 × 1,800 · Original not found",
    );
  });
});

describe("image view — over the whole window (#279)", () => {
  it("shows nothing until an image is opened", () => {
    render(<ImageView />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("an image with no file to link — the stored copy, named by its alt text; small: no Fit or 100%", () => {
    render(<ImageView />);
    open("plain");
    const dialog = screen.getByRole("dialog", { name: "Sign-up page" });
    expect((dialog as HTMLDialogElement).open).toBe(true);
    const img = loaded(400, 300);
    expect(img).toHaveAttribute("src", PNG);
    expect(screen.getByRole("toolbar", { name: "Image view" })).toHaveTextContent("400 × 300");
    expect(screen.queryByRole("button", { name: "Fit" })).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("read_image_file", expect.anything());
  });

  it("a linked file still there — the original, at its own size", async () => {
    vi.mocked(invoke).mockResolvedValue({ mime: "image/png", base64: "iVBORw==" });
    render(<ImageView />);
    open("linked");
    expect(invoke).toHaveBeenCalledWith("read_image_file", { path: ORIGINAL });
    await settle();
    expect(screen.getByRole("img")).toHaveAttribute("src", "blob:original");
    loaded(2880, 1800);
    expect(screen.getByRole("toolbar", { name: "Image view" })).toHaveTextContent(
      "Original · 2,880 × 1,800",
    );
  });

  it("a linked file gone — the stored copy, and the bar says the original was not found", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("No such file"));
    render(<ImageView />);
    open("linked");
    await settle();
    expect(screen.getByRole("img")).toHaveAttribute("src", PNG);
    loaded(1600, 1000);
    expect(screen.getByRole("toolbar", { name: "Image view" })).toHaveTextContent(
      "1,600 × 1,000 · Original not found",
    );
  });

  it("larger than the window — Fit first, 100% from the bar or a click, back by a click that does not drag", () => {
    render(<ImageView />);
    open("plain");
    loaded(2880, 1800);
    const fit = screen.getByRole("button", { name: "Fit" });
    const actual = screen.getByRole("button", { name: "100%" });
    expect(fit).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(actual);
    expect(actual).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("image-view-scroller")).toContainElement(screen.getByRole("img"));
    // a click on the picture at 100% goes back to Fit
    const img = screen.getByRole("img");
    fireEvent.pointerDown(img, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(img, { button: 0, clientX: 11, clientY: 10 });
    expect(screen.getByRole("button", { name: "Fit" })).toHaveAttribute("aria-pressed", "true");
    // and a click on the picture at Fit zooms in
    fireEvent.click(screen.getByRole("img"));
    expect(screen.getByRole("button", { name: "100%" })).toHaveAttribute("aria-pressed", "true");
  });

  it("at 100%, dragging the picture pans it and stays at 100%", () => {
    render(<ImageView />);
    open("plain");
    loaded(2880, 1800);
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    const scroller = screen.getByTestId("image-view-scroller");
    const img = screen.getByRole("img");
    fireEvent.pointerDown(img, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(img, { clientX: 60, clientY: 80 });
    fireEvent.pointerUp(img, { button: 0, clientX: 60, clientY: 80 });
    expect(scroller.scrollLeft).toBe(40);
    expect(scroller.scrollTop).toBe(20);
    expect(screen.getByRole("button", { name: "100%" })).toHaveAttribute("aria-pressed", "true");
  });

  it.each([
    ["Escape", () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })],
    ["Space", () => fireEvent.keyDown(screen.getByRole("dialog"), { key: " " })],
    [
      "the close button",
      () => fireEvent.click(screen.getByRole("button", { name: "Close image" })),
    ],
    ["a click beside the picture", () => fireEvent.click(screen.getByRole("img").parentElement!)],
  ])("closes with %s, back to the canvas", (_, close) => {
    render(<ImageView />);
    open("plain");
    loaded(400, 300);
    act(close);
    expect(viewed()).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a click on a small picture itself keeps it open", () => {
    render(<ImageView />);
    open("plain");
    fireEvent.click(loaded(400, 300));
    expect(viewed()).toBe("plain");
  });

  it("the original read after the view closed is dropped", async () => {
    let answer: (file: { mime: string; base64: string }) => void = () => undefined;
    vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    render(<ImageView />);
    open("linked");
    fireEvent.click(screen.getByRole("button", { name: "Close image" }));
    answer({ mime: "image/png", base64: "iVBORw==" });
    await settle();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("lets the original's URL go when it closes", async () => {
    vi.mocked(invoke).mockResolvedValue({ mime: "image/png", base64: "iVBORw==" });
    render(<ImageView />);
    open("linked");
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Close image" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:original");
  });

  it("closes with its picture — the node deleted, turned into a box, or another document on screen", () => {
    render(<ImageView />);
    open("plain");
    act(() => useDiagramStore.getState().deleteElements(["plain"], []));
    expect(viewed()).toBeNull();
    open("linked");
    act(() => useDiagramStore.getState().updateNodeData("linked", { shape: "rounded" }));
    expect(viewed()).toBeNull();
    act(() => useDiagramStore.getState().loadDoc(makeDoc([image("other")], []), null));
    open("other");
    act(() => useDiagramStore.getState().loadDoc(makeDoc([image("other")], []), null));
    expect(viewed()).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("image view — focus (#279)", () => {
  it("opens with the focus on the view itself, and gives it back on close", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    render(<ImageView />);
    open("plain");
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: "Close image" }));
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe("image view — keys, clicks, and a picture that changes (#279)", () => {
  it("Space closes it for good — the canvas does not take the same key as a tap to open it again", () => {
    window.addEventListener("keydown", handleCanvasKeyDown);
    window.addEventListener("keyup", handleCanvasKeyUp);
    try {
      useDiagramStore.setState((s) => ({
        nodes: s.nodes.map((n) => ({ ...n, selected: n.id === "plain" })),
      }));
      render(<ImageView />);
      open("plain");
      const dialog = screen.getByRole("dialog");
      act(() => {
        fireEvent.keyDown(dialog, { key: " " });
        fireEvent.keyUp(dialog, { key: " " });
      });
      expect(viewed()).toBeNull();
    } finally {
      window.removeEventListener("keydown", handleCanvasKeyDown);
      window.removeEventListener("keyup", handleCanvasKeyUp);
    }
  });

  it("Space on a focused button presses the button, not the close", () => {
    render(<ImageView />);
    open("plain");
    loaded(2880, 1800);
    const actual = screen.getByRole("button", { name: "100%" });
    actual.focus();
    fireEvent.keyDown(actual, { key: " " });
    expect(viewed()).toBe("plain");
  });

  it("at 100%, a click on the picture goes back to Fit though the captured release reports the scroller", () => {
    render(<ImageView />);
    open("plain");
    loaded(2880, 1800);
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    const scroller = screen.getByTestId("image-view-scroller");
    fireEvent.pointerDown(screen.getByRole("img"), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(scroller, { button: 0, clientX: 10, clientY: 10 });
    expect(viewed()).toBe("plain");
    expect(screen.getByRole("button", { name: "Fit" })).toHaveAttribute("aria-pressed", "true");
  });

  it("at 100%, a click beside the picture closes it", () => {
    render(<ImageView />);
    open("plain");
    loaded(2880, 1800);
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    const scroller = screen.getByTestId("image-view-scroller");
    act(() => {
      fireEvent.pointerDown(scroller, { button: 0, clientX: 5, clientY: 5 });
      fireEvent.pointerUp(scroller, { button: 0, clientX: 5, clientY: 5 });
    });
    expect(viewed()).toBeNull();
  });

  it("a new picture sent while it is open shows that picture, not the old original", async () => {
    vi.mocked(invoke).mockResolvedValue({ mime: "image/png", base64: "iVBORw==" });
    render(<ImageView />);
    open("linked");
    await settle();
    expect(screen.getByRole("img")).toHaveAttribute("src", "blob:original");
    const other = "data:image/png;base64,AAAA";
    act(() => {
      useDiagramStore
        .getState()
        .applyOps([{ op: "update_node", id: "linked", set: { src: other } }]);
    });
    await settle();
    expect(screen.getByRole("img")).toHaveAttribute("src", other);
    loaded(400, 300);
    expect(screen.getByRole("toolbar", { name: "Image view" })).toHaveTextContent(/^400 × 300$/);
  });

  it("an image that lost its picture opens nothing, and the view is left closed", () => {
    const lost = makeNode({ id: "lost", shape: "image" });
    act(() => useDiagramStore.getState().loadDoc(makeDoc([lost], []), null));
    render(<ImageView />);
    open("lost");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(viewed()).toBeNull();
  });

  it("closed because its node went away, the focus still goes back", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    render(<ImageView />);
    open("plain");
    act(() => useDiagramStore.getState().deleteElements(["plain"], []));
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("notices raised while it is open show inside it", () => {
    render(<ImageView />);
    open("plain");
    act(() => {
      useToastStore.getState().pushToast("Saved", "info");
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("Saved");
    act(() => useToastStore.getState().dismissAll());
  });
});
