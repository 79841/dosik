import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useSidebarStore } from "../../../shared/lib/sidebarLayout";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { likeRust } from "../../../test/rustAnswers";
import { handleAppKeyDown } from "../../chrome/appKeymap";
import { openDocument, resetTabsForTests } from "../../library/tabActions";
import { FOCUS_RING } from "../../../shared/lib/palette";
import { clampChatWidth, MAX_CHAT_WIDTH, MIN_CHAT_WIDTH } from "../panelWidth";

vi.mock("../cliProvider", () => ({
  sendWithClaudeCli: vi.fn(),
}));
vi.mock("../apiProvider", () => ({ sendWithApi: vi.fn() }));
vi.mock("../codexProvider", () => ({
  sendWithCodexCli: vi.fn(),
}));
vi.mock("../openaiProvider", () => ({ sendWithOpenAi: vi.fn() }));

// jsdom has no Element.scrollTo; the panel autoscrolls its message list
const scrollTo = vi.fn();
Element.prototype.scrollTo = scrollTo;

vi.mock("../../mermaid/renderMermaid", () => ({
  renderMermaid: vi.fn(async () => "<svg></svg>"),
}));

const { ChatPanel } = await import("../ChatPanel");
const { useSettingsStore } = await import("../../settings/settingsStore");
const { SIDE_PANEL_ID, useChatStore } = await import("../chatStore");
const { Toolbar } = await import("../../toolbar/Toolbar");
const { handleCanvasKeyDown } = await import("../../canvas/canvasKeymap");

// the panel opens on the chat unless a test switches it (#194). The width
// tests measure against the window: the library sidebar is hidden, so the
// content is the whole window (#217 D24 has its own test below)
beforeEach(() => {
  useChatStore.setState({ view: "chat" });
  useSidebarStore.setState({ hidden: true });
});

/**
 * Canvas selection can't be driven in this environment (coordinate clicks don't
 * reach the Tauri webview), so the selection chip is covered here instead of by
 * a visual check.
 */
const select = (opts: { node?: boolean; edge?: boolean }) => {
  useDiagramStore.setState({
    nodes: [
      { ...makeNode({ id: "n1", label: "Start" }), selected: opts.node ?? false },
      makeNode({ id: "n2", label: "End" }),
    ],
    edges: [
      { ...makeEdge({ id: "e1", source: "n1", target: "n2" }), selected: opts.edge ?? false },
    ],
  });
};

describe("message list auto-scroll", () => {
  beforeEach(() => {
    useChatStore.setState({ open: true, busy: false, messages: [], cliSessionId: null });
    scrollTo.mockClear();
  });

  it("scrolls to the bottom when a new message arrives", async () => {
    render(<ChatPanel />);
    scrollTo.mockClear();
    await act(async () => {
      useChatStore.getState().addMessage("user", "hello");
    });
    expect(scrollTo).toHaveBeenCalled();
  });

  it("scrolls down when the thinking indicator turns on too", async () => {
    render(<ChatPanel />);
    scrollTo.mockClear();
    await act(async () => {
      useChatStore.getState().setBusy(true);
    });
    expect(scrollTo).toHaveBeenCalled();
  });
});

describe("width resizing (#129, #219 T23)", () => {
  const handle = () => screen.getByLabelText("Resize chat panel");

  beforeEach(() => {
    useChatStore.setState({
      open: true,
      busy: false,
      messages: [],
      cliSessionId: null,
      width: 320,
    });
  });

  it("runs the handle along the edge (16px gap top and bottom) — overriding the hr default height of 0 (#166)", () => {
    render(<ChatPanel />);
    const cls = handle().className;
    // preflight sets `hr { height: 0 }`; without h-auto the band cannot be grabbed
    expect(cls).toMatch(/(^|\s)h-auto(\s|$)/);
    expect(cls).toMatch(/(^|\s)inset-y-4(\s|$)/);
    // the band itself stays inside the panel — never over the canvas
    expect(cls.split(/\s+/)).not.toContain("-translate-x-1/2");
    expect(cls).toMatch(/(^|\s)left-0(\s|$)/);
  });

  it("shows one short bar just left of the panel, only on hover, drag or focus (#166)", () => {
    render(<ChatPanel />);
    const tokens = handle().className.split(/\s+/);
    // one short bar (40px) left of the panel edge — no full-height line
    // overflow-visible: the browser clips an <hr>'s content, which would hide the bar
    expect(tokens).toEqual(
      expect.arrayContaining([
        "before:right-full",
        "before:h-10",
        "before:px-1",
        "overflow-visible",
      ]),
    );
    expect(tokens.some((t) => t.startsWith("after:"))).toBe(false);
    // hidden — and out of hit testing — until the edge is hovered or focused
    expect(tokens).toEqual(
      expect.arrayContaining([
        "before:invisible",
        "hover:before:visible",
        "focus-visible:before:visible",
      ]),
    );
    fireEvent.pointerDown(handle(), { button: 0, isPrimary: true, clientX: 500 });
    expect(handle().className.split(/\s+/)).toEqual(
      expect.arrayContaining(["before:visible", "before:bg-primary"]),
    );
    fireEvent.pointerUp(window, { clientX: 500 });
  });

  it("centers the hint in an empty chat and keeps one voice", () => {
    render(<ChatPanel />);
    const hint = screen.getByText(/Draw a login flow/);
    expect(hint.parentElement?.className).toContain("items-center");
    expect(hint.parentElement?.className).toContain("h-full");
    // the placeholder speaks in the third person; the hint must not answer in the first
    expect(hint.textContent).not.toMatch(/\bAsk me\b/);
  });

  it("leaves no text glyphs — every icon is an svg", () => {
    useChatStore.setState({ busy: true, messages: [] });
    const { container } = render(<ChatPanel />);
    expect(container.textContent).not.toMatch(/[✕↑✎✦⚙⟳✓]/);
    expect(screen.getByLabelText("Send").querySelector("svg")).toBeInTheDocument();
  });

  it("disables the button when it cannot send, and hover does not revive it", () => {
    render(<ChatPanel />);
    const send = screen.getByLabelText("Send");
    expect(send).toBeDisabled();
    expect(send.className).toContain("disabled:hover:bg-primary/35");
  });

  /** the drag coalesces to one update per frame */
  const drag = async (clientX: number) => {
    fireEvent.pointerMove(window, { clientX, pointerId: 1, isPrimary: true });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
  };
  const grab = (clientX: number) =>
    fireEvent.pointerDown(handle(), { clientX, pointerId: 1, isPrimary: true, button: 0 });

  it("changes the width when the left edge is dragged — wider the further left", async () => {
    const { container } = render(<ChatPanel />);
    const aside = container.querySelector("aside") as HTMLElement;
    expect(aside.style.width).toBe("320px");
    grab(900);
    await drag(820);
    expect(useChatStore.getState().width).toBe(400);
    fireEvent.pointerUp(window, { pointerId: 1 });
    // the drag is over: the width is remembered, and later moves do nothing
    await drag(600);
    expect(useChatStore.getState().width).toBe(400);
    expect(localStorage.getItem("dosik.chat-panel-width")).toBe("400");
  });

  it("keeps the drag within range", async () => {
    render(<ChatPanel />);
    grab(900);
    await drag(5000);
    expect(useChatStore.getState().width).toBe(MIN_CHAT_WIDTH);
    await drag(-5000);
    expect(useChatStore.getState().width).toBe(clampChatWidth(MAX_CHAT_WIDTH, window.innerWidth));
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("does not start a drag from a non-primary button or a second pointer", async () => {
    render(<ChatPanel />);
    fireEvent.pointerDown(handle(), { clientX: 900, button: 2, isPrimary: true, pointerId: 1 });
    await drag(820);
    expect(useChatStore.getState().width).toBe(320);

    grab(900);
    // a second finger must not stack a second set of listeners
    fireEvent.pointerDown(handle(), { clientX: 900, button: 0, isPrimary: false, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 700, pointerId: 2, isPrimary: false });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(useChatStore.getState().width).toBe(320);
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(document.body.style.cursor).toBe("");
  });

  it("does not lock the cursor when the panel disappears mid-drag", async () => {
    const { unmount } = render(<ChatPanel />);
    grab(900);
    expect(document.body.style.cursor).toBe("col-resize");
    unmount();
    expect(document.body.style.cursor).toBe("");
    // the listeners went with it
    const before = useChatStore.getState().width;
    await drag(700);
    expect(useChatStore.getState().width).toBe(before);
  });

  it("shrinks the panel with the window but keeps the chosen width for when the window grows back", async () => {
    useChatStore.setState({ width: 560 });
    const { container } = render(<ChatPanel />);
    const aside = () => container.querySelector("aside") as HTMLElement;
    expect(aside().style.width).toBe("560px");

    const original = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", { value: 900, configurable: true });
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(aside().style.width).toBe(`${clampChatWidth(560, 900)}px`);
      // the store still holds what the user chose
      expect(useChatStore.getState().width).toBe(560);

      Object.defineProperty(window, "innerWidth", { value: original, configurable: true });
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(aside().style.width).toBe("560px");
    } finally {
      Object.defineProperty(window, "innerWidth", { value: original, configurable: true });
    }
  });

  it("resizes from the keyboard too — left arrow widens, Home goes to the minimum", () => {
    render(<ChatPanel />);
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(useChatStore.getState().width).toBe(336);
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(useChatStore.getState().width).toBe(320);
    // the handle reports where it is for assistive tech
    expect(handle()).toHaveAttribute("aria-valuenow", "320");
    expect(handle()).toHaveAttribute("aria-valuemin", String(MIN_CHAT_WIDTH));
    fireEvent.keyDown(handle(), { key: "Home" });
    expect(useChatStore.getState().width).toBe(MIN_CHAT_WIDTH);
    fireEvent.keyDown(handle(), { key: "End" });
    expect(useChatStore.getState().width).toBe(clampChatWidth(MAX_CHAT_WIDTH, window.innerWidth));
    // the ceiling it reports is the one it actually has in this window
    expect(handle()).toHaveAttribute(
      "aria-valuemax",
      String(clampChatWidth(MAX_CHAT_WIDTH, window.innerWidth)),
    );
  });
});

describe("content width (#217 D24, T38)", () => {
  beforeEach(() => {
    useChatStore.setState({
      open: true,
      busy: false,
      messages: [],
      cliSessionId: null,
      width: 720,
    });
  });

  it("caps at the content width, not the window — minus the docked sidebar", () => {
    useSidebarStore.setState({ hidden: false, width: 248 });
    const { container, unmount } = render(<ChatPanel />);
    const content = window.innerWidth - 248;
    expect((container.querySelector("aside") as HTMLElement).style.width).toBe(
      `${clampChatWidth(720, content)}px`,
    );
    expect(screen.getByRole("separator", { name: "Resize chat panel" })).toHaveAttribute(
      "aria-valuemax",
      String(clampChatWidth(MAX_CHAT_WIDTH, content)),
    );
    unmount();
    // hidden, the content is the window again — the chosen width comes back
    useSidebarStore.setState({ hidden: true });
    const again = render(<ChatPanel />);
    expect((again.container.querySelector("aside") as HTMLElement).style.width).toBe(
      `${clampChatWidth(720, window.innerWidth)}px`,
    );
  });

  it("clamps a dragged width to the content width too", () => {
    useSidebarStore.setState({ hidden: false, width: 248 });
    useChatStore.getState().setWidth(9999);
    expect(useChatStore.getState().width).toBe(
      clampChatWidth(MAX_CHAT_WIDTH, window.innerWidth - 248),
    );
  });
});

describe("ChatPanel selection chip", () => {
  beforeEach(() => {
    useChatStore.setState({ open: true, busy: false, messages: [], cliSessionId: null });
    useDiagramStore.setState({ nodes: [], edges: [] });
  });

  it("shows no chip when nothing is selected", () => {
    render(<ChatPanel />);
    expect(screen.queryByText(/Selection ·/)).toBeNull();
  });

  it("shows the number of selected nodes and edges", () => {
    select({ node: true, edge: true });
    render(<ChatPanel />);
    expect(screen.getByText(/Selection · 1 node, 1 edge/)).toBeTruthy();
  });

  it("omits the node count when only edges are selected", () => {
    select({ edge: true });
    render(<ChatPanel />);
    // scoped to the chip: a broad /node/ would break on unrelated UI copy
    expect(screen.getByText(/Selection · 1 edge/).textContent).not.toContain("node");
  });

  it("clears the canvas selection and removes the chip on ✕", async () => {
    select({ node: true, edge: true });
    render(<ChatPanel />);

    await userEvent.click(screen.getByTitle("Clear selection"));

    const state = useDiagramStore.getState();
    expect(state.nodes.every((n) => !n.selected)).toBe(true);
    expect(state.edges.every((e) => !e.selected)).toBe(true);
    expect(screen.queryByText(/Selection ·/)).toBeNull();
  });
});

describe("docked side panel — one panel, two views (#194, #219 D12·D13, T22·T27)", () => {
  beforeEach(() => {
    localStorage.clear();
    useChatStore.setState({
      open: false,
      busy: false,
      messages: [],
      cliSessionId: null,
      width: 320,
    });
    useDiagramStore.setState({ nodes: [makeNode({ id: "a", label: "Start" })], edges: [] });
  });

  /** the toolbar's toggles open and switch the panel now — as in the editor */
  const renderWithToolbar = () =>
    render(
      <>
        <Toolbar />
        <ChatPanel />
      </>,
    );

  it("renders nothing when closed — not even a floating button", () => {
    const { container } = render(<ChatPanel />);
    expect(container.querySelector("aside")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders aside#side-panel when open — named by the visible title, sized to the visible width, no radius or shadow", () => {
    useChatStore.setState({ open: true });
    render(<ChatPanel />);
    const panel = screen.getByRole("complementary", { name: "Assistant" });
    expect(panel).toHaveAttribute("id", SIDE_PANEL_ID);
    expect(screen.getByRole("heading", { level: 2, name: "Assistant" })).toBeInTheDocument();
    expect(panel.style.width).toBe("320px");
    expect(panel.className).not.toMatch(/(^|\s)(rounded|shadow)[\w-]*/);
    expect(panel).toHaveClass("nodelete", "flex-none", "bg-surface");
  });

  it("chat header: New chat · AI assistant settings · Close panel — 28 buttons, 15 icons", () => {
    useChatStore.setState({ open: true });
    render(<ChatPanel />);
    for (const name of ["New chat", "AI assistant settings", "Close panel"]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toMatch(/(^|\s)h-7(\s|$)/);
      expect(button.querySelector("svg")).toHaveAttribute("width", "15");
    }
    expect(screen.queryByRole("group", { name: "Panel view" })).toBeNull();
  });

  it("Mermaid view: title 'Mermaid preview', only Close panel in the header (T27)", () => {
    useChatStore.setState({ open: true, view: "mermaid" });
    render(<ChatPanel />);
    expect(screen.getByRole("complementary", { name: "Mermaid preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close panel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
    expect(screen.getByLabelText("Mermaid code")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Ask the AI to draw or edit…")).toBeNull();
  });

  it("opens, switches and closes from the toolbar toggles", async () => {
    const user = userEvent.setup();
    renderWithToolbar();
    await user.click(screen.getByRole("button", { name: "Mermaid preview" }));
    expect(screen.getByRole("img", { name: /^Mermaid diagram/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ask AI" }));
    expect(screen.getByPlaceholderText("Ask the AI to draw or edit…")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ask AI" }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("closes on Close panel and returns focus to the toolbar toggle for that view", async () => {
    const user = userEvent.setup();
    useChatStore.setState({ open: true, view: "mermaid" });
    renderWithToolbar();
    await user.click(screen.getByRole("button", { name: "Close panel" }));
    expect(useChatStore.getState().open).toBe(false);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Mermaid preview" }));

    await user.click(screen.getByRole("button", { name: "Ask AI" }));
    await user.click(screen.getByRole("button", { name: "Close panel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ask AI" }));
  });

  it("keeps the draft and conversation across view switches and close/reopen", async () => {
    const user = userEvent.setup();
    useChatStore.getState().addMessage("user", "draw a login flow");
    renderWithToolbar();
    await user.click(screen.getByRole("button", { name: "Ask AI" }));
    await user.type(screen.getByPlaceholderText("Ask the AI to draw or edit…"), "half typed");
    await user.click(screen.getByRole("button", { name: "Mermaid preview" }));
    await user.click(screen.getByRole("button", { name: "Ask AI" }));
    expect(screen.getByPlaceholderText("Ask the AI to draw or edit…")).toHaveValue("half typed");
    await user.click(screen.getByRole("button", { name: "Ask AI" }));
    await user.click(screen.getByRole("button", { name: "Ask AI" }));
    expect(screen.getByPlaceholderText("Ask the AI to draw or edit…")).toHaveValue("half typed");
    expect(screen.getByText("draw a login flow")).toBeInTheDocument();
  });
});

describe("toast position — moves aside by the panel width (#219 D16, T24)", () => {
  const right = () => document.documentElement.style.getPropertyValue("--dsk-toast-right");

  beforeEach(() => {
    useChatStore.setState({ open: false, width: 320, busy: false, messages: [] });
  });

  it("sets --dsk-toast-right to the visible panel width while open, and clears it on close or unmount", () => {
    const view = render(<ChatPanel />);
    expect(right()).toBe("");
    act(() => useChatStore.setState({ open: true }));
    expect(right()).toBe("320px");
    act(() => useChatStore.setState({ width: 400 }));
    expect(right()).toBe("400px");
    act(() => useChatStore.setState({ open: false }));
    expect(right()).toBe("");
    act(() => useChatStore.setState({ open: true }));
    expect(right()).toBe("400px");
    view.unmount();
    expect(right()).toBe("");
  });
});

describe("messages and composer (#219 D15, T26)", () => {
  beforeEach(() => {
    useChatStore.setState({ open: true, view: "chat", busy: false, messages: [], width: 320 });
    useDiagramStore.setState({ nodes: [], edges: [] });
  });

  it("puts user bubbles on the right with a hover background, answers as plain text, errors in a danger box, activity muted on the left", () => {
    const store = useChatStore.getState();
    store.addMessage("user", "make it amber");
    store.addMessage("assistant", "Done — Payments is amber.");
    store.addMessage("error", "Something broke");
    store.addMessage("activity", "Applied 4 changes");
    render(<ChatPanel />);
    expect(screen.getByText("make it amber")).toHaveClass("ml-auto", "bg-hover");
    const answer = screen.getByText("Done — Payments is amber.");
    expect(answer.className).not.toMatch(/(^|\s)bg-/);
    expect(screen.getByText("Something broke")).toHaveClass("text-danger");
    const activity = screen.getByText("Applied 4 changes");
    expect(activity).toHaveClass("text-muted", "text-[11px]");
    expect(activity).not.toHaveClass("justify-center");
  });

  it("puts the selection chip inside the composer box", () => {
    select({ node: true });
    render(<ChatPanel />);
    const chip = screen.getByText(/Selection · 1 node/);
    const box = screen.getByPlaceholderText("Ask the AI to draw or edit…").parentElement;
    expect(box).toContainElement(chip);
    expect(box).toHaveClass("bg-frame");
  });

  it("marks the focused composer with a 1px focus ring, not a 2px one", () => {
    render(<ChatPanel />);
    const box = screen.getByPlaceholderText("Ask the AI to draw or edit…").parentElement;
    expect(box).toHaveClass("has-[textarea:focus]:ring-1", "has-[textarea:focus]:ring-focus");
    expect(box?.className).not.toMatch(/ring-2(\s|$)/);
    // the ring is the message field's: focus on a button inside leaves the composer plain
    expect(box?.className).not.toMatch(/focus-within:/);
    // forced-colors mode drops the ring (a box-shadow); the field then shows the system's outline
    expect(screen.getByPlaceholderText("Ask the AI to draw or edit…")).toHaveClass(
      "focus:outline-hidden",
    );
  });

  it("gives the buttons inside the composer the design system's keyboard ring, not the webview's", () => {
    select({ node: true });
    render(<ChatPanel />);
    for (const button of [
      screen.getByRole("button", { name: "Clear selection" }),
      screen.getByRole("button", { name: /Claude|GPT/ }),
      screen.getByRole("button", { name: "Send" }),
    ]) {
      expect(button).toHaveClass(...FOCUS_RING.split(" "));
    }
  });

  it("sends on Enter and breaks the line on Shift+Enter — Send is off when empty or busy", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);
    const box = screen.getByPlaceholderText("Ask the AI to draw or edit…");
    expect(screen.getByLabelText("Send")).toBeDisabled();
    await user.type(box, "one{Shift>}{Enter}{/Shift}two");
    expect(box).toHaveValue("one\ntwo");
    expect(screen.getByLabelText("Send")).toBeEnabled();
    act(() => useChatStore.setState({ busy: true }));
    expect(screen.getByLabelText("Send")).toBeDisabled();
  });

  it("shows the model picker below the composer — the chosen model (#252)", () => {
    useChatStore.setState((st) => ({
      settings: {
        ...st.settings,
        vendor: "claude",
        auths: { ...st.settings.auths, claude: "subscription" },
      },
    }));
    render(<ChatPanel />);
    expect(screen.getByRole("button", { name: /Claude Opus 5/ })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );
  });
});

describe("selecting and copying message text", () => {
  beforeEach(() => {
    useChatStore.setState({ open: true, view: "chat", busy: false, messages: [], width: 320 });
    useDiagramStore.setState({ nodes: [], edges: [], clipboard: null, editRequestId: null });
    window.addEventListener("keydown", handleCanvasKeyDown);
  });
  afterEach(() => {
    window.removeEventListener("keydown", handleCanvasKeyDown);
    document.getSelection()?.removeAllRanges();
  });

  const press = (key: string) => {
    const event = new KeyboardEvent("keydown", {
      key,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    (document.activeElement ?? document.body).dispatchEvent(event);
    return event;
  };
  /** a press on the words, then a drag over them — as the user selects */
  const selectWords = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    const words = screen.getByText(text);
    await user.click(words);
    const range = document.createRange();
    range.selectNodeContents(words);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
  };

  it("lets the words of every message be selected, and nothing else in the panel", () => {
    const store = useChatStore.getState();
    store.addMessage("user", "make it amber");
    store.addMessage("assistant", "Done — Payments is amber.");
    store.addMessage("error", "Something broke");
    store.addMessage("activity", "Applied 4 changes");
    render(<ChatPanel />);
    for (const text of [
      "make it amber",
      "Done — Payments is amber.",
      "Something broke",
      "Applied 4 changes",
    ]) {
      expect(screen.getByText(text).closest(".select-text")).not.toBeNull();
    }
    expect(screen.getByRole("heading", { name: "Assistant" }).closest(".select-text")).toBeNull();
    expect(screen.getByLabelText("Send").closest(".select-text")).toBeNull();
    act(() => useChatStore.setState({ busy: true }));
    expect(screen.getByText("Assistant is thinking…").closest(".select-none")).not.toBeNull();
  });

  it("keeps the empty-chat hint out of a selection", () => {
    render(<ChatPanel />);
    expect(screen.getByText(/Draw a login flow/).closest(".select-none")).not.toBeNull();
  });

  it("copies selected message text on Cmd+C even while shapes are selected on the canvas", async () => {
    const user = userEvent.setup();
    select({ node: true });
    useChatStore.getState().addMessage("assistant", "Done — Payments is amber.");
    render(<ChatPanel />);
    await selectWords(user, "Done — Payments is amber.");
    const copy = press("c");
    // the canvas did not take it: the webview's own copy goes ahead
    expect(copy.defaultPrevented).toBe(false);
    expect(useDiagramStore.getState().clipboard).toBeNull();
  });

  it("leaves the other modifier shortcuts to the canvas — Cmd+Z after a press on a message still undoes", async () => {
    const user = userEvent.setup();
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "n1" })], []), null);
    useDiagramStore.getState().addNode("rect", { x: 200, y: 0 });
    expect(useDiagramStore.getState().nodes).toHaveLength(2);
    useChatStore.getState().addMessage("assistant", "Added a shape.");
    render(<ChatPanel />);
    await selectWords(user, "Added a shape.");
    press("z");
    expect(useDiagramStore.getState().nodes.map((n) => n.id)).toEqual(["n1"]);
  });

  it("Backspace after a press on a message still deletes the shapes selected on the canvas", async () => {
    const user = userEvent.setup();
    select({ node: true });
    useChatStore.getState().addMessage("assistant", "Done.");
    render(<ChatPanel />);
    await user.click(screen.getByText("Done."));
    const backspace = new KeyboardEvent("keydown", {
      key: "Backspace",
      bubbles: true,
      cancelable: true,
    });
    (document.activeElement ?? document.body).dispatchEvent(backspace);
    expect(useDiagramStore.getState().nodes.map((n) => n.id)).toEqual(["n2"]);
  });

  it("Enter after a press on a message still starts editing the selected shape's label", async () => {
    const user = userEvent.setup();
    select({ node: true });
    useChatStore.getState().addMessage("assistant", "Done.");
    render(<ChatPanel />);
    await user.click(screen.getByText("Done."));
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(enter);
    expect(useDiagramStore.getState().editRequestId).toBe("n1");
  });

  it("a selection of the words made from elsewhere (the Edit menu's Select All) does not stay", async () => {
    useChatStore.getState().addMessage("assistant", "Done — Payments is amber.");
    render(<ChatPanel />);
    act(() => screen.getByRole("button", { name: "New chat" }).focus());
    const range = document.createRange();
    range.selectNodeContents(screen.getByText("Done — Payments is amber."));
    act(() => {
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(document.getSelection()?.toString()).toBe("");
  });

  it("Cmd+C with no words selected copies the canvas selection as before", async () => {
    const user = userEvent.setup();
    select({ node: true });
    useChatStore.getState().addMessage("assistant", "Done.");
    render(<ChatPanel />);
    await user.click(screen.getByText("Done."));
    document.getSelection()?.removeAllRanges();
    expect(press("c").defaultPrevented).toBe(true);
    expect(useDiagramStore.getState().clipboard).not.toBeNull();
  });

  it("Cmd+A selects the conversation only from inside it — the canvas has no select-all to give the words", async () => {
    const user = userEvent.setup();
    useChatStore.getState().addMessage("assistant", "Done.");
    render(<ChatPanel />);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(press("a").defaultPrevented).toBe(true);
    await user.click(screen.getByText("Done."));
    expect(press("a").defaultPrevented).toBe(false);
  });

  it("copies the words as plain text — no colours of the theme go with them", async () => {
    const user = userEvent.setup();
    useChatStore.getState().addMessage("assistant", "Done — Payments is amber.");
    render(<ChatPanel />);
    await selectWords(user, "Done — Payments is amber.");
    const data = new Map<string, string>();
    const copy = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(copy, "clipboardData", {
      value: { setData: (type: string, value: string) => data.set(type, value) },
    });
    screen.getByText("Done — Payments is amber.").dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
    expect([...data]).toEqual([["text/plain", "Done — Payments is amber."]]);
  });

  it("drops the selection once the focus moves elsewhere in the window", async () => {
    const user = userEvent.setup();
    useChatStore.getState().addMessage("assistant", "Done — Payments is amber.");
    render(<ChatPanel />);
    await selectWords(user, "Done — Payments is amber.");
    expect(document.getSelection()?.toString()).toBe("Done — Payments is amber.");
    // focus moving, not a click that would itself reset the selection
    act(() => screen.getByRole("button", { name: "New chat" }).focus());
    expect(document.getSelection()?.toString()).toBe("");
  });
});

/**
 * Save no longer blurs whatever has the focus (#219): it asks the
 * document's editors to write, and the chat is not one of them.
 */
describe("⌘S leaves the chat input alone (#219)", () => {
  const appKeys = (e: KeyboardEvent) => handleAppKeyDown(e, true);
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(likeRust());
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    useChatStore.setState({ open: true, busy: false, messages: [] });
    act(() => {
      openDocument(makeDoc([], [], "Doc"), { projectId: "p1" });
    });
    window.addEventListener("keydown", appKeys, true);
  });
  afterEach(() => window.removeEventListener("keydown", appKeys, true));

  it("⌘S in the chat input — saves the document and keeps focus and draft", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);
    const box = screen.getByRole("textbox", { name: "Message" });
    await user.type(box, "half a question");
    expect(box).toHaveFocus();
    fireEvent.keyDown(box, { key: "s", code: "KeyS", metaKey: true });
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(["Saved"]),
    );
    expect(box).toHaveFocus();
    expect(box).toHaveValue("half a question");
  });
});

/**
 * The settings view replaces the composer, and the control that had the
 * keyboard can go with it — the model picker's button, the message box, Done.
 * The focus fell to <body>, outside `.nodelete`, where the next Backspace
 * deleted the canvas selection (#219). The switch hands the focus
 * on itself: into the settings view, and back to the composer.
 */
describe("the panel's way to Settings (#252)", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      open: false,
      section: "General",
      lastSection: "General",
      focus: null,
    });
    useChatStore.setState({
      open: true,
      view: "chat",
      busy: false,
      messages: [],
      cliSessionId: null,
      settings: {
        vendor: "claude",
        auths: { claude: "subscription", openai: "subscription" },
        keys: { claude: "", openai: "" },
        models: { claude: "claude-opus-5", openai: "gpt-5.6-sol" },
      },
    });
    select({ node: true });
  });

  it("the header's AI assistant settings opens Settings on AI assistant — the panel keeps no settings of its own", async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);
    const toggle = screen.getByRole("button", { name: "AI assistant settings" });
    expect(toggle).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(toggle);
    expect(useSettingsStore.getState()).toMatchObject({ open: true, section: "AI assistant" });
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("sending without an API key opens Settings on the key field — the draft stays, and focus comes back to the message", async () => {
    useChatStore.setState((s) => ({
      settings: { ...s.settings, auths: { ...s.settings.auths, claude: "api-key" } },
    }));
    const user = userEvent.setup();
    render(<ChatPanel />);
    const box = screen.getByRole("textbox", { name: "Message" });
    await user.type(box, "draw a box{Enter}");
    await waitFor(() =>
      expect(useSettingsStore.getState()).toMatchObject({
        open: true,
        section: "AI assistant",
        focus: "key-claude",
      }),
    );
    expect(useSettingsStore.getState().returnTo).toBe(box);
    expect(box).toHaveValue("draw a box");
    expect(useDiagramStore.getState().nodes.find((n) => n.id === "n1")?.selected).toBe(true);
  });
});
