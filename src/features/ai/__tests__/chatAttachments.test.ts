import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetPlatform, pretendMac } from "../../../test/platform";
import type { ChatAttachment } from "../attachments";

const { cliMock, apiMock, codexMock, openaiMock, stageMock, invokeMock } = vi.hoisted(() => ({
  cliMock: vi.fn(),
  apiMock: vi.fn(),
  codexMock: vi.fn(),
  openaiMock: vi.fn(),
  stageMock: vi.fn(),
  invokeMock: vi.fn(async () => undefined),
}));

vi.mock("../cliProvider", () => ({ sendWithClaudeCli: cliMock }));
vi.mock("../apiProvider", () => ({ sendWithApi: apiMock }));
vi.mock("../codexProvider", () => ({ sendWithCodexCli: codexMock }));
vi.mock("../openaiProvider", () => ({ sendWithOpenAi: openaiMock }));
vi.mock("../cliFiles", () => ({ stageForCli: stageMock }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const { sendChatTurn } = await import("../chatActions");
const { useChatStore } = await import("../chatStore");
const { useDiagramStore } = await import("../../../shared/lib/store");
const { makeNode } = await import("../../../shared/lib/__tests__/testFixtures");

const file = (over: Partial<ChatAttachment>): ChatAttachment => ({
  id: over.name ?? "f",
  name: "f",
  mime: "application/octet-stream",
  size: 3,
  kind: "file",
  base64: "AAAA",
  ...over,
});
const SHOT = file({ name: "shot.png", mime: "image/png", kind: "image" });
const NOTES = file({ name: "notes.md", mime: "text/plain", kind: "text", text: "# todo" });
const SKETCH = file({ name: "flows.sketch" });
const PNG = "data:image/png;base64,iVBORw0KGgo=";

const settings = (vendor: "claude" | "openai", auth: "subscription" | "api-key") => ({
  vendor,
  auths: { claude: auth, openai: auth },
  keys: { claude: "sk-a", openai: "sk-o" },
  models: { claude: "claude-opus-5", openai: "gpt-5.6-sol" },
});

beforeEach(() => {
  pretendMac();
  for (const m of [cliMock, apiMock, codexMock, openaiMock, stageMock]) m.mockReset();
  cliMock.mockResolvedValue({ text: "ok", sessionId: "s1" });
  codexMock.mockResolvedValue({ text: "ok", sessionId: "t1" });
  stageMock.mockResolvedValue({ note: "", images: [], any: false });
  useChatStore.setState({
    busy: false,
    messages: [],
    cliSessionId: null,
    attachments: [],
    conversationId: "conv1",
    settings: settings("claude", "api-key"),
  });
  useDiagramStore.setState({ nodes: [], edges: [] });
});
afterEach(forgetPlatform);

describe("a message with files", () => {
  it("files alone are a message — they go with it and leave the composer", async () => {
    useChatStore.getState().addAttachments([SHOT]);
    expect(await sendChatTurn("  ")).toBe("sent");
    const [message] = useChatStore.getState().messages;
    expect(message).toMatchObject({ role: "user", text: "", attachments: [SHOT] });
    expect(useChatStore.getState().attachments).toEqual([]);
    expect(apiMock.mock.calls[0]?.[6]).toEqual([SHOT]);
  });

  it("keeps the files in the composer when the key is missing", async () => {
    useChatStore.setState({
      settings: { ...settings("claude", "api-key"), keys: { claude: "", openai: "" } },
    });
    useChatStore.getState().addAttachments([SHOT]);
    expect(await sendChatTurn("look")).toBe("needs-api-key");
    expect(useChatStore.getState().attachments).toEqual([SHOT]);
  });

  it("API key: a text file's words ride in the message; a file it cannot read goes by name and the chat says so", async () => {
    useChatStore.getState().addAttachments([NOTES, SKETCH]);
    await sendChatTurn("use these");
    const payload = apiMock.mock.calls[0]?.[3] as string;
    expect(payload).toContain('<file name="notes.md">\n# todo\n</file>');
    expect(payload).toContain("[Attached file flows.sketch (application/octet-stream, 3 bytes)");
    expect(useChatStore.getState().messages.map((m) => [m.role, m.text])).toContainEqual([
      "notice",
      "flows.sketch went by name only: Claude API can't read this kind of file.",
    ]);
  });

  it("GPT by API key names its own API in that line", async () => {
    useChatStore.setState({ settings: settings("openai", "api-key") });
    useChatStore.getState().addAttachments([SKETCH]);
    await sendChatTurn("x");
    expect(useChatStore.getState().messages.at(-1)?.text).toBe(
      "flows.sketch went by name only: OpenAI API can't read this kind of file.",
    );
    expect(openaiMock.mock.calls[0]?.[7]).toEqual([SKETCH]);
  });

  it("the selected image nodes' pictures go along — all four ways", async () => {
    useDiagramStore.setState({
      nodes: [
        {
          ...makeNode({ id: "img1", shape: "image" }),
          data: { ...makeNode({ id: "img1" }).data, shape: "image", src: PNG },
          selected: true,
        },
        {
          ...makeNode({ id: "img2" }),
          data: { ...makeNode({ id: "img2" }).data, shape: "image", src: PNG },
        },
      ],
    });
    await sendChatTurn("what is in it");
    const sent = apiMock.mock.calls[0]?.[6] as ChatAttachment[];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "image",
      mime: "image/png",
      base64: "iVBORw0KGgo=",
      fromNode: "img1",
    });
    expect(apiMock.mock.calls[0]?.[3]).toContain("[The picture of image node img1 is attached.]");
  });

  it("subscription: stages the files and every picture, and the prompt says where they are", async () => {
    useChatStore.setState({ settings: settings("claude", "subscription") });
    useDiagramStore.setState({
      nodes: [
        {
          ...makeNode({ id: "img2" }),
          data: { ...makeNode({ id: "img2" }).data, shape: "image", src: PNG },
        },
      ],
    });
    stageMock.mockResolvedValue({
      note: "Files the user attached…",
      images: ["/c/shot.png"],
      any: true,
    });
    useChatStore.getState().addAttachments([SHOT]);
    await sendChatTurn("look");
    const [conversation, , files, pictures] = stageMock.mock.calls[0] ?? [];
    expect(conversation).toBe("conv1");
    expect(files).toEqual([SHOT]);
    expect(pictures).toEqual([{ node: "img2", mime: "image/png", base64: "iVBORw0KGgo=" }]);
    expect(cliMock.mock.calls[0]?.[0]).toMatch(/look\n\nFiles the user attached…$/);
    expect(cliMock.mock.calls[0]?.[4]).toBe("conv1");
    // no "went by name only" line: the CLI gets the file itself
    expect(useChatStore.getState().messages.some((m) => m.role === "notice")).toBe(false);
  });

  it("Codex gets the staged pictures to hand over", async () => {
    useChatStore.setState({ settings: settings("openai", "subscription") });
    stageMock.mockResolvedValue({ note: "n", images: ["/c/shot.png"], any: true });
    useChatStore.getState().addAttachments([SHOT]);
    await sendChatTurn("look");
    expect(codexMock.mock.calls[0]?.[4]).toEqual({
      conversation: "conv1",
      images: ["/c/shot.png"],
    });
  });

  it("every CLI turn names the conversation — a later turn can read an earlier turn's files", async () => {
    useChatStore.setState({ settings: settings("claude", "subscription") });
    // nothing staged this turn: whether the folder exists (and opens) is Rust's call
    await sendChatTurn("copy the table on page 3 again");
    expect(cliMock.mock.calls[0]?.[4]).toBe("conv1");
    useChatStore.setState({ settings: settings("openai", "subscription"), busy: false });
    await sendChatTurn("again");
    expect(codexMock.mock.calls[0]?.[4]).toEqual({ conversation: "conv1", images: [] });
  });
});

describe("a turn the provider refused", () => {
  it("its files leave the replay — later turns do not send them again and fail the same way", async () => {
    apiMock.mockRejectedValueOnce(
      Object.assign(new Error("400 prompt is too long"), { status: 400 }),
    );
    useChatStore.getState().addAttachments([NOTES, SHOT]);
    await sendChatTurn("use these");
    const [first] = useChatStore.getState().messages;
    // kept on the message, to show what was sent — but replayed no more
    expect(first?.attachments).toEqual([NOTES, SHOT]);
    expect(first?.filesFailed).toBe(true);
    expect(first?.payload).not.toContain("<file");
    expect(first?.payload).toMatch(/use these$/);
    expect(useChatStore.getState().messages.at(-1)).toMatchObject({ role: "error" });
  });

  it("a passing failure (network, rate limit, overload) keeps the files for the next turn", async () => {
    for (const error of [
      new Error("network down"),
      Object.assign(new Error("rate limited"), { status: 429 }),
      Object.assign(new Error("overloaded"), { status: 529 }),
    ]) {
      useChatStore.setState({ messages: [], busy: false });
      apiMock.mockRejectedValueOnce(error);
      useChatStore.getState().addAttachments([NOTES]);
      await sendChatTurn("use this");
      expect(useChatStore.getState().messages[0]).not.toHaveProperty("filesFailed");
    }
  });

  it("a request too large (413) is a refusal too", async () => {
    apiMock.mockRejectedValueOnce(Object.assign(new Error("too large"), { status: 413 }));
    useChatStore.getState().addAttachments([NOTES]);
    await sendChatTurn("x");
    expect(useChatStore.getState().messages[0]?.filesFailed).toBe(true);
  });

  it("a subscription turn keeps its files — the CLI read them from disk", async () => {
    useChatStore.setState({ settings: settings("claude", "subscription") });
    cliMock.mockRejectedValueOnce(new Error("CLI failed"));
    useChatStore.getState().addAttachments([NOTES]);
    await sendChatTurn("x");
    expect(useChatStore.getState().messages[0]?.attachments).toEqual([NOTES]);
  });
});

describe("a text file too long to go inside the message", () => {
  it("goes by name, and the chat says why", async () => {
    const LOG = file({ name: "server.log", mime: "text/plain", kind: "text" });
    useChatStore.getState().addAttachments([LOG]);
    await sendChatTurn("look");
    expect(apiMock.mock.calls[0]?.[3]).toContain(
      "[Attached text file server.log (text/plain, 3 bytes) — too long to put in the message; only its name was sent.]",
    );
    expect(useChatStore.getState().messages.map((m) => m.text)).toContain(
      "server.log went by name only: too long to put in the message.",
    );
  });
});

describe("what a sent message keeps for its chips", () => {
  it("the selection it carried, as the composer's chip read it", async () => {
    useDiagramStore.setState({ nodes: [{ ...makeNode({ id: "a" }), selected: true }] });
    await sendChatTurn("this one");
    expect(useChatStore.getState().messages[0]?.selection).toBe("1 node");
  });

  it("no selection, nothing kept", async () => {
    await sendChatTurn("hi");
    expect(useChatStore.getState().messages[0]).not.toHaveProperty("selection");
  });
});

describe("the composer's files in the store", () => {
  it("adds, removes and clears", () => {
    const store = useChatStore.getState();
    store.addAttachments([SHOT, NOTES]);
    store.removeAttachment(SHOT.id);
    expect(useChatStore.getState().attachments).toEqual([NOTES]);
    useChatStore.getState().clearAttachments();
    expect(useChatStore.getState().attachments).toEqual([]);
  });

  it("New chat starts a conversation of its own and lets the old one's files go", () => {
    useChatStore.getState().clearMessages();
    expect(useChatStore.getState().conversationId).not.toBe("conv1");
    expect(invokeMock).toHaveBeenCalledWith("discard_chat_files", { conversation: "conv1" });
  });
});
