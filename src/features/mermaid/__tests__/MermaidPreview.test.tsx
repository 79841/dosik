import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useThemeStore } from "../../../shared/lib/theme";
import { Toaster } from "../../../shared/ui/Toaster";
import { useChatStore } from "../../ai/chatStore";
import { toMermaid } from "../../export/markdown";

const renderMermaid = vi.hoisted(() =>
  vi.fn(
    async (code: string, theme: string) =>
      `<svg data-theme="${theme}"><text>${code.length}</text></svg>`,
  ),
);
vi.mock("../renderMermaid", () => ({ renderMermaid }));

const clipboard = vi.hoisted(() => ({ writeText: vi.fn(async (_text: string) => {}) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: clipboard.writeText }));

const { MermaidPreview, resetPreviewForTests } = await import("../MermaidPreview");

const load = (
  nodes = [makeNode({ id: "a", label: "Start" }), makeNode({ id: "b", label: "End", x: 300 })],
) =>
  useDiagramStore
    .getState()
    .loadDoc(
      makeDoc(nodes, nodes.length > 1 ? [makeEdge({ id: "e", source: "a", target: "b" })] : []),
      null,
    );

const diagramCode = () => toMermaid(useDiagramStore.getState().toDoc());

beforeEach(() => {
  vi.clearAllMocks();
  // the last drawing outlives a mount on purpose; tests must not inherit it
  resetPreviewForTests();
  useChatStore.setState({ mermaidMode: "preview" });
  useThemeStore.getState().setTheme("light");
  load();
});

describe("Mermaid preview (#194)", () => {
  it("The code view shows only the Mermaid code — without the fence (```), highlighted (#198)", async () => {
    useChatStore.setState({ mermaidMode: "code" }); // the code pane fills only while it shows
    render(<MermaidPreview />);
    const code = await screen.findByLabelText("Mermaid code");
    expect(code.textContent).toBe(diagramCode());
    expect(code.textContent).not.toContain("```");
    // the diagram keyword and the link are marked as such
    expect(code.querySelector('[data-token="keyword"]')?.textContent).toBe("flowchart");
    expect(code.querySelector('[data-token="arrow"]')).not.toBeNull();
  });

  it("The drawing is centered in the drawing pane — scrolls from the top when it overflows vertically (#198)", async () => {
    // jsdom computes no layout: the classes that do the centring stand in for it
    render(<MermaidPreview />);
    const figure = await screen.findByRole("img", { name: /^Mermaid diagram/ });
    // m-auto in a flex box: centred both ways, yet a drawing larger than the
    // pane still scrolls from its top-left instead of being cut off
    expect(figure.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["flex", "overflow-auto", "[&>svg]:m-auto"]),
    );
  });

  it("Draws the rendered diagram in the app theme", async () => {
    render(<MermaidPreview />);
    const figure = await screen.findByRole("img", { name: /^Mermaid diagram/ });
    await waitFor(() => expect(figure.querySelector("svg")).not.toBeNull());
    expect(renderMermaid).toHaveBeenLastCalledWith(diagramCode(), "light");
    expect(figure.querySelector("svg")?.getAttribute("data-theme")).toBe("light");
  });

  it("Follows edits on the canvas", async () => {
    useChatStore.setState({ mermaidMode: "code" }); // the code pane fills only while it shows
    render(<MermaidPreview />);
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1));
    act(() => {
      useDiagramStore
        .getState()
        .applyOps([{ op: "add_node", node: { id: "c", label: "Retry", x: 0, y: 200 } }]);
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Mermaid code").textContent).toContain("Retry"),
    );
    await waitFor(() => expect(renderMermaid).toHaveBeenLastCalledWith(diagramCode(), "light"));
  });

  it("Shows a hint and does not render when there are no shapes to draw", async () => {
    load([]);
    render(<MermaidPreview />);
    expect(await screen.findByText(/Nothing to preview yet/)).toBeInTheDocument();
    expect(renderMermaid).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Copy Mermaid" })).toBeNull();
  });

  it("When Mermaid can't draw it, shows the reason and keeps the code", async () => {
    useChatStore.setState({ mermaidMode: "code" }); // the code pane fills only while it shows
    renderMermaid.mockRejectedValueOnce(new Error("Parse error on line 3"));
    render(<MermaidPreview />);
    expect(await screen.findByText(/Mermaid couldn't draw this/)).toBeInTheDocument();
    expect(screen.getByText(/Parse error on line 3/)).toBeInTheDocument();
    expect(screen.getByLabelText("Mermaid code").textContent).toContain(diagramCode());
  });

  it("Copy puts the visible block on the clipboard as is", async () => {
    const user = userEvent.setup();
    render(
      <>
        <MermaidPreview />
        <Toaster />
      </>,
    );
    await user.click(await screen.findByRole("button", { name: "Copy Mermaid" }));
    expect(clipboard.writeText).toHaveBeenCalledWith(`\`\`\`mermaid\n${diagramCode()}\n\`\`\``);
    expect(await screen.findByText("Copied as Mermaid block")).toBeInTheDocument();
  });

  it("An old render that finishes late does not overwrite the new drawing", async () => {
    let releaseOld: (svg: string) => void = () => {};
    renderMermaid.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseOld = resolve;
        }),
    );
    render(<MermaidPreview />);
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(1));
    act(() => {
      useDiagramStore
        .getState()
        .applyOps([{ op: "add_node", node: { id: "c", label: "New", x: 0, y: 200 } }]);
    });
    const figure = screen.getByRole("img", { name: /^Mermaid diagram/ });
    // the new drawing landed: the mock writes the code's length into it
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(figure.textContent).toBe(String(diagramCode().length)));
    const fresh = figure.innerHTML;
    await act(async () => releaseOld("<svg data-old></svg>"));
    expect(figure.innerHTML).toBe(fresh);
  });

  it("Coming back after switching views shows the last drawing right away — and does not redraw for the same code and theme", async () => {
    const first = render(<MermaidPreview />);
    const figure = await screen.findByRole("img", { name: /^Mermaid diagram/ });
    await waitFor(() => expect(figure.querySelector("svg")).not.toBeNull());
    first.unmount();
    render(<MermaidPreview />);
    expect(
      screen.getByRole("img", { name: /^Mermaid diagram/ }).querySelector("svg"),
    ).not.toBeNull();
    expect(renderMermaid).toHaveBeenCalledTimes(1);
  });

  it("Coming back after the document or theme changed does not show the old drawing or old error", async () => {
    renderMermaid.mockRejectedValueOnce(new Error("Parse error on line 3"));
    const first = render(<MermaidPreview />);
    expect(await screen.findByText(/Mermaid couldn't draw this/)).toBeInTheDocument();
    first.unmount();
    // fixed while the chat was showing
    load([makeNode({ id: "x", label: "Fixed" })]);
    renderMermaid.mockImplementationOnce(() => new Promise<string>(() => {}));
    render(<MermaidPreview />);
    expect(screen.queryByText(/Mermaid couldn't draw this/)).toBeNull();
    expect(screen.getByRole("img", { name: /^Mermaid diagram/ }).querySelector("svg")).toBeNull();

    resetPreviewForTests();
    cleanup();
    const again = render(<MermaidPreview />);
    await waitFor(() => expect(renderMermaid).toHaveBeenLastCalledWith(diagramCode(), "light"));
    again.unmount();
    act(() => useThemeStore.getState().setTheme("dark"));
    renderMermaid.mockImplementationOnce(() => new Promise<string>(() => {}));
    render(<MermaidPreview />);
    expect(renderMermaid).toHaveBeenLastCalledWith(diagramCode(), "dark");
  });

  it("Says so while drawing", async () => {
    renderMermaid.mockImplementationOnce(() => new Promise<string>(() => {}));
    render(<MermaidPreview />);
    const figure = screen.getByRole("img", { name: /^Mermaid diagram/ });
    expect(figure).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Drawing…")).toBeInTheDocument();
  });

  it("The drawing pane can also be reached and scrolled with the keyboard", async () => {
    render(<MermaidPreview />);
    expect(await screen.findByRole("img", { name: /^Mermaid diagram/ })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("With only free arrows it gives the reason instead of saying there is nothing", async () => {
    // a free arrow: two anchors and the line between them (lone anchors are pruned on load)
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [
            makeNode({ id: "p", shape: "anchor", width: 12, height: 12 }),
            makeNode({ id: "q", shape: "anchor", x: 200, width: 12, height: 12 }),
          ],
          [makeEdge({ id: "free", source: "p", target: "q" })],
        ),
        null,
      );
    render(<MermaidPreview />);
    expect(await screen.findByText(/Free arrows have no Mermaid form/)).toBeInTheDocument();
    expect(renderMermaid).not.toHaveBeenCalled();
  });

  it("While the same document is being edited, keeps the current drawing and redraws — the drawing does not vanish on every edit", async () => {
    render(<MermaidPreview />);
    const figure = await screen.findByRole("img", { name: /^Mermaid diagram/ });
    await waitFor(() => expect(figure.querySelector("svg")).not.toBeNull());
    renderMermaid.mockImplementationOnce(() => new Promise<string>(() => {}));
    act(() => {
      useDiagramStore
        .getState()
        .applyOps([{ op: "add_node", node: { id: "c", label: "More", x: 0, y: 200 } }]);
    });
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledTimes(2));
    expect(figure.querySelector("svg")).not.toBeNull();
    expect(figure).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Drawing…")).toBeNull();
  });

  it("Switches between preview and code — one at a time, Copy in both, and the code is filled only when visible", async () => {
    const user = userEvent.setup();
    render(<MermaidPreview />);
    const preview = screen.getByRole("button", { name: "Preview" });
    const code = screen.getByRole("button", { name: "Code" });
    expect(preview).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("img", { name: /^Mermaid diagram/ })).toBeVisible();
    expect(screen.getByLabelText("Mermaid code")).not.toBeVisible();
    // hidden, it holds no tokens to rebuild on every edit
    expect(screen.getByLabelText("Mermaid code").textContent).toBe("");

    await user.click(code);
    expect(code).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Mermaid code")).toBeVisible();
    expect(screen.getByLabelText("Mermaid code").textContent).toBe(diagramCode());
    expect(screen.queryByRole("img", { name: /^Mermaid diagram/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy Mermaid" })).toBeInTheDocument();
  });

  it("Previews only the selection when there is one — otherwise the whole diagram", async () => {
    useChatStore.setState({ mermaidMode: "code" }); // the code pane fills only while it shows
    act(() => {
      useDiagramStore.setState((st) => ({
        nodes: st.nodes.map((n) => ({ ...n, selected: n.id === "a" })),
      }));
    });
    render(<MermaidPreview />);
    const code = () => screen.getByLabelText("Mermaid code").textContent ?? "";
    expect(code()).toContain("Start");
    expect(code()).not.toContain("End");
    expect(screen.getByText("Selection")).toBeInTheDocument();
    // the figure is hidden behind the code here; its name still says the scope
    expect(
      screen.getByRole("img", { name: "Mermaid diagram — selection", hidden: true }),
    ).toBeInTheDocument();

    act(() => useDiagramStore.getState().clearSelection());
    await waitFor(() => expect(code()).toContain("End"));
    // a diagram is one canvas (#229 D4)
    expect(screen.getByText("Whole diagram")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Mermaid diagram — whole diagram", hidden: true }),
    ).toBeInTheDocument();
  });

  it("Reports what Mermaid could not hold — the same list the export writes", async () => {
    const pic = makeNode({ id: "pic", label: "Logo", shape: "image", x: 600 });
    load([
      makeNode({ id: "a", label: "Start" }),
      makeNode({ id: "b", label: "End", x: 300 }),
      { ...pic, data: { ...pic.data, src: "data:image/png;base64,iVBORw0KGgo=" } },
    ]);
    render(<MermaidPreview />);
    expect(await screen.findByText(/Not in Mermaid/)).toHaveTextContent("Not in Mermaid: pictures");
  });

  it("No notice when everything fits", async () => {
    render(<MermaidPreview />);
    await screen.findByRole("img", { name: /^Mermaid diagram/ });
    expect(screen.queryByText(/Not in Mermaid/)).toBeNull();
  });
});
