import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import type { ChatAttachment } from "../attachments";

vi.mock("../cliProvider", () => ({ sendWithClaudeCli: vi.fn() }));
vi.mock("../apiProvider", () => ({ sendWithApi: vi.fn(async () => undefined) }));
vi.mock("../codexProvider", () => ({ sendWithCodexCli: vi.fn() }));
vi.mock("../openaiProvider", () => ({ sendWithOpenAi: vi.fn() }));
vi.mock("../../mermaid/renderMermaid", () => ({ renderMermaid: vi.fn(async () => "<svg></svg>") }));
Element.prototype.scrollTo = vi.fn();

const { ChatPanel } = await import("../ChatPanel");
const { useChatStore } = await import("../chatStore");

const NOTES: ChatAttachment = {
  id: "n1",
  name: "notes.md",
  mime: "text/plain",
  size: 4096,
  kind: "text",
  base64: "",
  text: "# todo",
};
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);
const message = () => screen.getByRole("textbox", { name: "Message" });

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
  useToastStore.getState().dismissAll();
  useDiagramStore.setState({ nodes: [], edges: [] });
  useChatStore.setState({
    open: true,
    view: "chat",
    busy: false,
    messages: [],
    attachments: [],
    width: 320,
    settings: {
      vendor: "claude",
      auths: { claude: "api-key", openai: "api-key" },
      keys: { claude: "sk-a", openai: "" },
      models: { claude: "claude-opus-5", openai: "gpt-5.6-sol" },
    },
  });
});

describe("attaching files in the composer", () => {
  it("Attach files opens the file dialog and the picks become chips", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { name: "notes.md", size: 6, mime: "text/plain", base64: btoa("# todo") },
      { name: "flows.sketch", size: 3, base64: btoa("\u0000\u0001\u0002") },
    ]);
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Attach files" }));
    await screen.findByText("notes.md");
    expect(invoke).toHaveBeenCalledWith("pick_chat_files", { room: 10 });
    expect(screen.getByText("notes.md").closest("[title]")).toHaveAttribute(
      "title",
      "notes.md — 6 B",
    );
    expect(useChatStore.getState().attachments.map((a) => a.kind)).toEqual(["text", "file"]);
  });

  it("says in a toast what the dialog could not read", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { name: "big.zip", size: 0, error: "big.zip is too large (21 MB; the limit is 20 MB)" },
    ]);
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Attach files" }));
    await waitFor(() =>
      expect(toasts()).toEqual(["Error: big.zip is too large (21 MB; the limit is 20 MB)"]),
    );
  });

  it("refuses an eleventh file with a toast", async () => {
    useChatStore.setState({
      attachments: Array.from({ length: 10 }, (_, i) => ({ ...NOTES, id: `${i}` })),
    });
    vi.mocked(invoke).mockResolvedValueOnce([{ name: "one.txt", size: 1, base64: btoa("x") }]);
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Attach files" }));
    await waitFor(() =>
      expect(toasts()).toEqual(["Error: Up to 10 files per message: one.txt not attached"]),
    );
    expect(useChatStore.getState().attachments).toHaveLength(10);
  });

  it("pasting a file attaches it; pasting words leaves them to the field", async () => {
    render(<ChatPanel />);
    const shot = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "", {
      type: "image/png",
    });
    const withFile = fireEvent.paste(message(), {
      clipboardData: { files: [shot], types: ["Files"] },
    });
    expect(withFile).toBe(false); // the paste was taken
    await screen.findByText("pasted.png");
    const words = fireEvent.paste(message(), {
      clipboardData: { files: [], types: ["text/plain"] },
    });
    expect(words).toBe(true);
  });

  it("a paste that carries nothing takes the picture on the clipboard, read as its own bytes", async () => {
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "read_clipboard_picture"
        ? { kind: "data", mime: "image/png", base64: png }
        : undefined,
    );
    render(<ChatPanel />);
    fireEvent.paste(message(), { clipboardData: { files: [], types: [] } });
    await screen.findByText("pasted.png");
    expect(useChatStore.getState().attachments).toMatchObject([
      { kind: "image", mime: "image/png" },
    ]);
  });

  it("copied files on the clipboard are not read behind a paste that carries nothing", async () => {
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "read_clipboard_picture" ? { kind: "files", paths: ["/x/a.png"] } : undefined,
    );
    render(<ChatPanel />);
    fireEvent.paste(message(), { clipboardData: { files: [], types: [] } });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("read_clipboard_picture"));
    await act(async () => undefined);
    expect(useChatStore.getState().attachments).toEqual([]);
  });

  it("a chip's x takes that file off", async () => {
    useChatStore.setState({ attachments: [NOTES] });
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Remove notes.md" }));
    expect(useChatStore.getState().attachments).toEqual([]);
    expect(screen.queryByText("notes.md")).toBeNull();
  });

  it("a chip removed from the keyboard hands the focus on — never to the page, where Backspace deletes shapes", async () => {
    const user = userEvent.setup();
    const B = { ...NOTES, id: "b", name: "b.md" };
    useChatStore.setState({ attachments: [NOTES, B] });
    render(<ChatPanel />);
    screen.getByRole("button", { name: "Remove notes.md" }).focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove b.md" }));
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(message());
  });

  it("refuses the files past ten by name", async () => {
    useChatStore.setState({
      attachments: Array.from({ length: 9 }, (_, i) => ({ ...NOTES, id: `${i}` })),
    });
    vi.mocked(invoke).mockResolvedValueOnce([
      { name: "a.txt", size: 1, base64: btoa("x") },
      { name: "b.txt", size: 1, base64: btoa("x") },
      { name: "c.txt", size: 1, base64: btoa("x") },
    ]);
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Attach files" }));
    await waitFor(() =>
      expect(toasts()).toEqual(["Error: Up to 10 files per message: b.txt, c.txt not attached"]),
    );
  });

  it("Enter while an answer is on its way keeps what was typed", async () => {
    const user = userEvent.setup();
    useChatStore.setState({ busy: true });
    render(<ChatPanel />);
    await user.type(message(), "next{Enter}");
    expect(message()).toHaveValue("next");
  });

  it("files sit in the composer's chip row, after the selection chip", () => {
    useChatStore.setState({ attachments: [NOTES] });
    render(<ChatPanel />);
    const box = message().parentElement!;
    expect(box).toContainElement(screen.getByText("notes.md"));
  });

  it("Send works with files and no words, and the chips leave the composer", async () => {
    const user = userEvent.setup();
    useChatStore.setState({ attachments: [NOTES] });
    render(<ChatPanel />);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeEnabled();
    await user.click(send);
    await waitFor(() => expect(useChatStore.getState().attachments).toEqual([]));
    expect(useChatStore.getState().messages[0]).toMatchObject({
      role: "user",
      text: "",
      attachments: [NOTES],
    });
    // no empty bubble for a message of files alone
    expect(document.querySelector(".bg-hover.ml-auto")).toBeNull();
  });
});

describe("dropping files on the panel", () => {
  const files = (list: File[]) => ({
    dataTransfer: { types: ["Files"], files: list, dropEffect: "none" },
  });

  it("shows what a drop does while files are over the panel, and takes them on drop", async () => {
    render(<ChatPanel />);
    const panel = document.getElementById("side-panel")!;
    fireEvent.dragEnter(panel, files([]));
    expect(screen.getByText("Drop files to attach")).toBeInTheDocument();
    expect(screen.getByText("Up to 10 files, 20 MB each")).toBeInTheDocument();
    const dropped = new File(["hello"], "hello.txt", { type: "text/plain" });
    fireEvent.drop(panel, files([dropped]));
    expect(screen.queryByText("Drop files to attach")).toBeNull();
    await screen.findByText("hello.txt");
  });

  it("drags that carry no files show nothing", () => {
    render(<ChatPanel />);
    fireEvent.dragEnter(document.getElementById("side-panel")!, {
      dataTransfer: { types: ["text/plain"], files: [] },
    });
    expect(screen.queryByText("Drop files to attach")).toBeNull();
  });

  it("the guide goes when the files leave the panel", () => {
    render(<ChatPanel />);
    const panel = document.getElementById("side-panel")!;
    fireEvent.dragEnter(panel, files([]));
    fireEvent.dragLeave(panel, { relatedTarget: document.body });
    expect(screen.queryByText("Drop files to attach")).toBeNull();
  });

  it("marks the panel as taking its own drops, so the canvas leaves them alone", () => {
    render(<ChatPanel />);
    expect(document.getElementById("side-panel")).toHaveAttribute("data-takes-file-drops");
  });
});

describe("the line about a file that went by name only", () => {
  it("is muted, with an info glyph, under the message", () => {
    act(() =>
      useChatStore
        .getState()
        .addMessage(
          "notice",
          "flows.sketch went by name only: Claude API can't read this kind of file.",
        ),
    );
    render(<ChatPanel />);
    const line = screen.getByText(/went by name only/);
    expect(line).toHaveClass("text-muted", "text-[11px]");
    expect(line.querySelector("svg")).not.toBeNull();
  });
});

describe("what went with a sent message", () => {
  const PICTURE: ChatAttachment = {
    ...NOTES,
    id: "p1",
    name: "img1.png",
    kind: "image",
    mime: "image/png",
    fromNode: "img1",
  };

  it("shows the selection it carried and its files as chips above the bubble, without an x", () => {
    act(() =>
      useChatStore.getState().addMessage("user", "use these", {
        attachments: [NOTES, PICTURE],
        selection: "1 node",
      }),
    );
    render(<ChatPanel />);
    const bubble = screen.getByText("use these");
    const message = bubble.parentElement!;
    expect(message).toHaveClass("ml-auto", "flex-col", "items-end");
    const chips = message.firstElementChild!;
    expect(chips).toHaveTextContent("Selection · 1 node");
    expect(chips).toHaveTextContent("notes.md");
    // the selected image node's picture: the selection chip stands for it
    expect(chips).not.toHaveTextContent("img1.png");
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear selection" })).toBeNull();
  });

  it("a message of files alone is its chips — no empty bubble", () => {
    act(() => useChatStore.getState().addMessage("user", "", { attachments: [NOTES] }));
    render(<ChatPanel />);
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(document.querySelector(".bg-hover.rounded-\\[10px_10px_3px_10px\\]")).toBeNull();
  });

  it("a plain message stays a plain bubble", () => {
    act(() => useChatStore.getState().addMessage("user", "hello"));
    render(<ChatPanel />);
    expect(screen.getByText("hello")).toHaveClass("bg-hover");
    expect(screen.getByText("hello").previousElementSibling).toBeNull();
  });
});
