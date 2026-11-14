import { invoke } from "@tauri-apps/api/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useThemeStore } from "../../../shared/lib/theme";
import { blankDoc } from "../../library/libraryApi";
import { loadPicture, resetPreviewCacheForTests } from "../diagramPreview";
import { DiagramThumbnail } from "../DiagramThumbnail";

const mockedInvoke = vi.mocked(invoke);

/** an IntersectionObserver the test fires by hand — jsdom has none */
let fire: ((visible: boolean) => void) | null = null;
/** the options the last observer was made with */
let observedWith: IntersectionObserverInit | undefined;
/** how many times a box was handed to an observer */
let observed = 0;
class ManualObserver {
  constructor(
    private readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    observedWith = options;
  }
  observe() {
    observed += 1;
    fire = (visible) =>
      this.callback(
        [{ isIntersecting: visible } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
  }
  disconnect() {
    fire = null;
  }
  unobserve() {}
}

describe("thumbnails load when visible (#161)", () => {
  beforeEach(() => {
    resetPreviewCacheForTests();
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(JSON.stringify(blankDoc()));
    observed = 0;
    observedWith = undefined;
    globalThis.IntersectionObserver = ManualObserver as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    // restore jsdom's absence of it for the other tests
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  it("does not load off screen, loads when it comes in", async () => {
    render(<DiagramThumbnail id="d1" updatedAt={1} lazy />);
    expect(mockedInvoke).not.toHaveBeenCalled();
    act(() => fire?.(false));
    expect(mockedInvoke).not.toHaveBeenCalled();
    act(() => fire?.(true));
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("load_project", { id: "d1" }));
  });

  it("drops the image when far away and restores it from cache on return — an unbounded list holds only up to the cache cap (#220)", async () => {
    const { container } = render(
      <main>
        <DiagramThumbnail id="d1" updatedAt={1} lazy />
      </main>,
    );
    // measured against Home's scroller, a screen's worth beyond it
    expect(observedWith?.root).toBe(container.querySelector("main"));
    expect(observedWith?.rootMargin).toBe("100% 100%");
    act(() => fire?.(true));
    await waitFor(() => expect(screen.getByText("Empty diagram")).toBeInTheDocument());
    act(() => fire?.(false));
    expect(screen.queryByText("Empty diagram")).toBeNull();
    // asked for nothing out there: a still tone
    expect(container.querySelector(".animate-pulse")).toBeNull();
    act(() => fire?.(true));
    await waitFor(() => expect(screen.getByText("Empty diagram")).toBeInTheDocument());
    // the second time is the cache's
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("inside a horizontally scrolling strip, that strip is the reference — nudging the strip does not drop the image (#220)", () => {
    const { container } = render(
      <main>
        <ol style={{ overflowX: "auto" }}>
          <li>
            <DiagramThumbnail id="d1" updatedAt={1} lazy />
          </li>
        </ol>
      </main>,
    );
    expect(observedWith?.root).toBe(container.querySelector("ol"));
    expect(observedWith?.rootMargin).toBe("100% 100%");
  });

  it('the board (lazy="visible") measures against the viewport itself — without a one-screen margin (#221)', () => {
    render(
      <main>
        <DiagramThumbnail id="d1" updatedAt={1} lazy="visible" />
      </main>,
    );
    expect(observed).toBe(1);
    expect(observedWith).toBeUndefined();
  });

  it("a finished image shows right away even before the observer reports, and drops when reported far (#221 D19)", async () => {
    await loadPicture("d1", 1, "light");
    render(<DiagramThumbnail id="d1" updatedAt={1} lazy />);
    expect(screen.getByText("Empty diagram")).toBeInTheDocument();
    act(() => fire?.(false));
    expect(screen.queryByText("Empty diagram")).toBeNull();
  });

  it("loads right away when not lazy", async () => {
    render(<DiagramThumbnail id="d2" updatedAt={1} />);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("load_project", { id: "d2" }));
  });
});

describe("thumbnail — image and size (#220 D14, #229 D17, T13)", () => {
  const drawn = {
    version: 1,
    title: "Drawn",
    nodes: [
      {
        id: "n",
        type: "shape",
        position: { x: 0, y: 0 },
        data: { label: "On the canvas", shape: "rect", color: "mono" },
      },
    ],
    edges: [],
  };
  const empty = { version: 1, title: "Empty", nodes: [], edges: [] };

  beforeEach(() => {
    resetPreviewCacheForTests();
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (_cmd, args) =>
      JSON.stringify((args as { id: string }).id === "e1" ? empty : drawn),
    );
  });

  it("draws the diagram — never larger than its natural size", async () => {
    const { container } = render(<DiagramThumbnail id="d1" updatedAt={1} />);
    const img = await waitFor(() => {
      const found = container.querySelector("img");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(decodeURIComponent(img.getAttribute("src") ?? "")).toContain("On the canvas");
    expect(img).toHaveClass("max-h-full", "max-w-full");
    expect(img).not.toHaveClass("h-full");
    expect(img).not.toHaveClass("w-full");
  });

  it("an empty diagram shows 'Empty diagram', an unreadable one 'No preview'", async () => {
    render(<DiagramThumbnail id="e1" updatedAt={1} />);
    expect(await screen.findByText("Empty diagram")).toBeInTheDocument();
    mockedInvoke.mockRejectedValue(new Error("gone"));
    render(<DiagramThumbnail id="d9" updatedAt={1} />);
    expect(await screen.findByText("No preview")).toBeInTheDocument();
  });

  it("a new revision of the same diagram (only updatedAt changed) keeps the last image until drawn — the pulse does not flicker (#220)", async () => {
    const src = (container: HTMLElement) =>
      decodeURIComponent(container.querySelector("img")?.getAttribute("src") ?? "");
    const { container, rerender } = render(<DiagramThumbnail id="d1" updatedAt={1} />);
    await waitFor(() => expect(src(container)).toContain("On the canvas"));

    let land: (text: string) => void = () => {};
    mockedInvoke.mockReturnValue(new Promise((resolve) => (land = resolve)));
    rerender(<DiagramThumbnail id="d1" updatedAt={2} />);
    // the last picture stays while the new one is read and drawn
    expect(container.firstChild).not.toHaveClass("animate-pulse");
    expect(src(container)).toContain("On the canvas");
    const edited = structuredClone(drawn);
    edited.nodes[0]!.data.label = "Edited since";
    await act(async () => land(JSON.stringify(edited)));
    await waitFor(() => expect(src(container)).toContain("Edited since"));

    // another diagram's picture is not this one's stand-in
    mockedInvoke.mockReturnValue(new Promise(() => {}));
    rerender(<DiagramThumbnail id="d2" updatedAt={1} />);
    expect(container.firstChild).toHaveClass("animate-pulse");
  });

  it("bg-frame pulse while loading", () => {
    mockedInvoke.mockReturnValue(new Promise(() => {}));
    const { container } = render(<DiagramThumbnail id="d1" updatedAt={1} />);
    expect(container.firstChild).toHaveClass("animate-pulse", "bg-frame");
  });
});

describe("thumbnail — does not redraw when far away (#221 D19, T32)", () => {
  const shape = {
    version: 1,
    title: "One",
    nodes: [
      {
        id: "n",
        type: "shape",
        position: { x: 0, y: 0 },
        data: { label: "Drawn", shape: "rect", color: "mono" },
      },
    ],
    edges: [],
  };

  beforeEach(() => {
    resetPreviewCacheForTests();
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(JSON.stringify(shape));
  });

  it("with defer, does not load and shows only a quiet plate (no pulse) — loads once released", async () => {
    const { container, rerender } = render(<DiagramThumbnail id="d1" updatedAt={1} defer />);
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(container.firstChild).toHaveClass("bg-frame");
    expect(container.firstChild).not.toHaveClass("animate-pulse");
    rerender(<DiagramThumbnail id="d1" updatedAt={1} />);
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("load_project", { id: "d1" }));
  });

  it("with a finished image, shows it right away even with defer", async () => {
    await loadPicture("d1", 1, "light");
    mockedInvoke.mockClear();
    const { container } = render(<DiagramThumbnail id="d1" updatedAt={1} defer />);
    expect(container.querySelector("img")).not.toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("labelClassName applies to the 'No preview'·'Empty diagram' text", async () => {
    mockedInvoke.mockResolvedValue(JSON.stringify(blankDoc()));
    render(<DiagramThumbnail id="d2" updatedAt={1} labelClassName="text-[14px]" />);
    expect(await screen.findByText("Empty diagram")).toHaveClass("text-[14px]");
  });
});

describe("a lazy thumbnail keeps observing even when it starts with a finished image (#221)", () => {
  const drawn = (label: string) =>
    JSON.stringify({
      version: 1,
      title: "One",
      nodes: [
        {
          id: "n",
          type: "shape",
          position: { x: 0, y: 0 },
          data: { label, shape: "rect", color: "mono" },
        },
      ],
      edges: [],
    });
  const src = (container: HTMLElement) =>
    decodeURIComponent(container.querySelector("img")?.getAttribute("src") ?? "");
  const theme = useThemeStore.getState().theme;

  beforeEach(() => {
    resetPreviewCacheForTests();
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(drawn("Before"));
    fire = null;
    observed = 0;
    globalThis.IntersectionObserver = ManualObserver as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    useThemeStore.setState({ theme });
  });

  it("keeps observing the box even when it starts with a finished image", async () => {
    await loadPicture("d1", 1, theme);
    const { container } = render(<DiagramThumbnail id="d1" updatedAt={1} lazy />);
    expect(container.querySelector("img")).not.toBeNull();
    expect(observed).toBe(1);
  });

  it("held list → new list (only updatedAt changed): keeps the current image and draws the new revision when visible", async () => {
    // a picture drawn on an earlier visit to Home
    await loadPicture("d1", 1, theme);
    const { container, rerender } = render(<DiagramThumbnail id="d1" updatedAt={1} lazy />);
    expect(src(container)).toContain("Before");
    // the fresh listing: the diagram was edited meanwhile
    mockedInvoke.mockResolvedValue(drawn("After"));
    rerender(<DiagramThumbnail id="d1" updatedAt={2} lazy />);
    expect(src(container)).toContain("Before");
    act(() => fire?.(true));
    await waitFor(() => expect(src(container)).toContain("After"));
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("on a theme change, draws in that theme when visible — does not stay on the pulse", async () => {
    useThemeStore.setState({ theme: "light" });
    await loadPicture("d1", 1, "light");
    const { container } = render(<DiagramThumbnail id="d1" updatedAt={1} lazy />);
    expect(container.querySelector("img")).not.toBeNull();
    act(() => useThemeStore.setState({ theme: "dark" }));
    act(() => fire?.(true));
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector(".animate-pulse")).toBeNull();
    // the dark picture is drawn from a read of its own
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
  });
});

describe("board thumbnails request only while currently visible (#221)", () => {
  /** one observer per box, each fired by hand — the board shows many at once */
  const watched = new Map<Element, (visible: boolean) => void>();
  class BoxObserver {
    private readonly boxes: Element[] = [];
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(el: Element) {
      this.boxes.push(el);
      watched.set(el, (visible) =>
        this.callback(
          [{ isIntersecting: visible, target: el } as unknown as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        ),
      );
    }
    disconnect() {
      for (const el of this.boxes) watched.delete(el);
    }
    unobserve() {}
  }
  const show = (defer: boolean) => (
    <>
      {["a", "b", "c"].map((id) => (
        <div key={id} data-testid={id}>
          <DiagramThumbnail id={id} updatedAt={1} lazy="visible" defer={defer} />
        </div>
      ))}
    </>
  );
  const box = (id: string) => screen.getByTestId(id).firstElementChild!;
  const toggle = (id: string, visible: boolean) => act(() => watched.get(box(id))?.(visible));
  const read = () => mockedInvoke.mock.calls.map(([, args]) => (args as { id: string }).id).sort();

  beforeEach(() => {
    resetPreviewCacheForTests();
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(JSON.stringify(blankDoc()));
    watched.clear();
    globalThis.IntersectionObserver = BoxObserver as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  it("coming back after zooming far out (defer) loads only what is visible now — not what passed by", async () => {
    const { rerender } = render(show(true));
    // panned across all three while zoomed far out, then left with only b in view
    for (const id of ["a", "b", "c"]) toggle(id, true);
    toggle("a", false);
    toggle("c", false);
    expect(mockedInvoke).not.toHaveBeenCalled();
    rerender(show(false));
    await waitFor(() => expect(read()).toEqual(["b"]));
    // c comes back into view: now it is read
    toggle("c", true);
    await waitFor(() => expect(read()).toEqual(["b", "c"]));
  });

  it("leaving drops the image (quiet plate), coming back shows the cached image right away — no reload", async () => {
    render(show(false));
    toggle("a", true);
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("Empty diagram"));
    toggle("a", false);
    // what is held for it is the cache's to keep or let go, within its budget
    expect(screen.getByTestId("a")).not.toHaveTextContent("Empty diagram");
    expect(box("a")).toHaveClass("bg-frame");
    expect(box("a")).not.toHaveClass("animate-pulse");
    toggle("a", true);
    expect(screen.getByTestId("a")).toHaveTextContent("Empty diagram");
    expect(read()).toEqual(["a"]);
  });

  it("a finished image shows right away even before the observer reports — no placeholder flicker on first draw", async () => {
    await loadPicture("a", 1, useThemeStore.getState().theme);
    render(show(false));
    expect(screen.getByTestId("a")).toHaveTextContent("Empty diagram");
  });

  it("no pulse while not visible — only requested ones pulse", () => {
    mockedInvoke.mockReturnValue(new Promise(() => {}));
    render(show(false));
    expect(box("b")).not.toHaveClass("animate-pulse");
    toggle("b", true);
    expect(box("b")).toHaveClass("animate-pulse");
  });
});
