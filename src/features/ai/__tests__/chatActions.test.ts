import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { forgetPlatform, pretendMac } from "../../../test/platform";

const { cliMock, apiMock, codexMock, openaiMock } = vi.hoisted(() => ({
  cliMock: vi.fn(),
  apiMock: vi.fn(),
  codexMock: vi.fn(),
  openaiMock: vi.fn(),
}));

vi.mock("../cliProvider", () => ({
  sendWithClaudeCli: cliMock,
}));
vi.mock("../apiProvider", () => ({ sendWithApi: apiMock }));
vi.mock("../codexProvider", () => ({ sendWithCodexCli: codexMock }));
vi.mock("../openaiProvider", () => ({ sendWithOpenAi: openaiMock }));

const subscription = (vendor: "claude" | "openai" = "claude") => ({
  vendor,
  auths: { claude: "subscription" as const, openai: "subscription" as const },
  keys: { claude: "", openai: "" },
  models: { claude: "claude-opus-5", openai: "gpt-5.6-sol" },
});
const apiKey = (vendor: "claude" | "openai" = "claude", key = "sk-test") => ({
  vendor,
  auths: { claude: "api-key" as const, openai: "api-key" as const },
  keys: { claude: vendor === "claude" ? key : "", openai: vendor === "openai" ? key : "" },
  models: { claude: "claude-opus-5", openai: "gpt-5.6-sol" },
});

const { sendChatTurn } = await import("../chatActions");
const { useChatStore } = await import("../chatStore");
const { useDiagramStore } = await import("../../../shared/lib/store");
const { makeNode } = await import("../../../shared/lib/__tests__/testFixtures");

const resetChat = () => {
  useChatStore.setState({
    open: false,
    busy: false,
    messages: [],
    cliSessionId: null,
    settings: subscription(),
  });
  useDiagramStore.setState({ nodes: [], edges: [] });
};

// GPT's subscription is macOS's: these suites run as on a Mac (jsdom names no platform)
beforeEach(pretendMac);
afterEach(forgetPlatform);

describe("sendChatTurn", () => {
  beforeEach(resetChat);

  it("ignores empty input and the busy state", async () => {
    expect(await sendChatTurn("   ")).toBe("ignored");
    useChatStore.setState({ busy: true });
    expect(await sendChatTurn("hello")).toBe("ignored");
    expect(cliMock).not.toHaveBeenCalled();
  });

  it("off macOS a stored GPT subscription asks for the API key — the Codex CLI never runs", async () => {
    forgetPlatform();
    useChatStore.setState({
      settings: {
        vendor: "openai",
        auths: { claude: "subscription", openai: "subscription" },
        keys: { claude: "", openai: "" },
        models: { claude: "claude-opus-5", openai: "gpt-5.6-sol" },
      },
    });
    expect(await sendChatTurn("hello")).toBe("needs-api-key");
    expect(cliMock).not.toHaveBeenCalled();
  });

  it("returns needs-api-key in API key mode without a key", async () => {
    useChatStore.setState({
      settings: apiKey("claude", ""),
    });
    expect(await sendChatTurn("hello")).toBe("needs-api-key");
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it("CLI provider: records the reply and session id", async () => {
    cliMock.mockResolvedValue({ text: "Hello", sessionId: "sess-1" });
    expect(await sendChatTurn("hi")).toBe("sent");

    const state = useChatStore.getState();
    expect(state.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(state.messages[1]?.text).toBe("Hello");
    expect(state.cliSessionId).toBe("sess-1");
    expect(state.busy).toBe(false);
  });

  it("replaces an empty CLI reply with 'Done.'", async () => {
    cliMock.mockResolvedValue({ text: "", sessionId: null });
    await sendChatTurn("hi");
    expect(useChatStore.getState().messages[1]?.text).toBe("Done.");
  });

  it("leaves a provider exception as an error message and clears busy", async () => {
    cliMock.mockRejectedValue(new Error("CLI crashed"));
    await sendChatTurn("hi");
    const state = useChatStore.getState();
    expect(state.messages[1]?.role).toBe("error");
    expect(state.messages[1]?.text).toBe("CLI crashed");
    expect(state.busy).toBe(false);
  });

  it("sends the selection block only to the provider and shows only the raw text on screen", async () => {
    useDiagramStore.setState({
      nodes: [{ ...makeNode({ id: "n1", label: "Start" }), selected: true }],
      edges: [],
    });
    cliMock.mockResolvedValue({ text: "ok", sessionId: null });

    await sendChatTurn("make this blue");

    const sent = cliMock.mock.calls[0]?.[0] as string;
    expect(sent).toContain("[Selection]");
    expect(sent).toContain('n1 "Start"');
    expect(sent).toContain("make this blue");
    expect(useChatStore.getState().messages[0]?.text).toBe("make this blue");
  });

  it("says so when nothing is selected", async () => {
    cliMock.mockResolvedValue({ text: "ok", sessionId: null });
    await sendChatTurn("draw a login flow");

    const sent = cliMock.mock.calls[0]?.[0] as string;
    expect(sent).toContain("nothing selected");
    expect(sent.endsWith("draw a login flow")).toBe(true);
  });

  it("API provider: passes the history (earlier messages, excluding the user message) and callbacks", async () => {
    useChatStore.setState({
      settings: apiKey(),
    });
    useChatStore.getState().addMessage("user", "earlier");
    apiMock.mockImplementation(
      async (
        _key: string,
        _model: string,
        _history: unknown[],
        _msg: string,
        callbacks: { onText: (t: string) => void; onActivity: (t: string) => void },
      ) => {
        callbacks.onActivity("Edited diagram — 2 operations applied");
        callbacks.onText("done!");
      },
    );

    await sendChatTurn("draw something");

    expect(apiMock).toHaveBeenCalledWith(
      "sk-test",
      "claude-opus-5",
      expect.arrayContaining([expect.objectContaining({ text: "earlier" })]),
      expect.stringContaining("draw something"),
      expect.anything(),
      { session: expect.any(Number), stopped: null },
    );
    const roles = useChatStore.getState().messages.map((m) => m.role);
    expect(roles).toEqual(["user", "user", "activity", "assistant"]);
  });
});

describe("turn that left the diagram (#167)", () => {
  beforeEach(resetChat);

  it("notes a stopped turn in the chat", async () => {
    useChatStore.setState({ settings: apiKey("claude", "sk-a") });
    apiMock.mockImplementationOnce(async (...args: unknown[]) => {
      const target = args[5] as { stopped: string | null };
      target.stopped = "Stopped drawing — you left the diagram this chat was working on.";
    });
    await sendChatTurn("draw");
    expect(useChatStore.getState().messages.at(-1)).toMatchObject({
      role: "error",
      text: expect.stringContaining("you left the diagram"),
    });
  });

  it("keeps the stop reason even when the provider fails afterwards", async () => {
    useChatStore.setState({ settings: apiKey("claude", "sk-a") });
    apiMock.mockImplementationOnce(async (...args: unknown[]) => {
      (args[5] as { stopped: string | null }).stopped = "Stopped drawing — you left the diagram.";
      throw new Error("network down");
    });
    await sendChatTurn("draw");
    const texts = useChatStore.getState().messages.map((m) => m.text);
    expect(texts.slice(-2)).toEqual(["network down", "Stopped drawing — you left the diagram."]);
  });

  it("targets the diagram at send time — there are no pages (#229 D16)", async () => {
    useChatStore.setState({ settings: apiKey("claude", "sk-a") });
    const session = useDiagramStore.getState().docSession;
    await sendChatTurn("draw");
    const target = apiMock.mock.calls.at(-1)![5] as { session: number; stopped: string | null };
    expect(target).toEqual({ session, stopped: null });
  });
});

describe("routing for the four combinations (#119)", () => {
  beforeEach(() => {
    resetChat();
    for (const m of [cliMock, apiMock, codexMock, openaiMock]) m.mockReset();
    cliMock.mockResolvedValue({ text: "claude", sessionId: "s1" });
    codexMock.mockResolvedValue({ text: "codex", sessionId: "th1" });
    apiMock.mockResolvedValue(undefined);
    openaiMock.mockResolvedValue(undefined);
  });

  it("GPT · Subscription → Codex CLI, records the thread id", async () => {
    useChatStore.setState({ settings: subscription("openai") });
    await sendChatTurn("hi");
    expect(codexMock).toHaveBeenCalledWith(
      expect.stringContaining("hi"),
      null,
      { session: expect.any(Number), stopped: null },
      "gpt-5.6-sol",
    );
    expect(cliMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().cliSessionId).toBe("th1");
    expect(useChatStore.getState().messages.at(-1)).toMatchObject({
      role: "assistant",
      text: "codex",
    });
  });

  it("Claude · Subscription → Claude Code CLI with the chosen model (#252)", async () => {
    useChatStore.setState({
      settings: {
        ...subscription("claude"),
        models: { claude: "claude-haiku-4-5", openai: "gpt-5.6-sol" },
      },
    });
    await sendChatTurn("hi");
    expect(cliMock).toHaveBeenCalledWith(
      expect.stringContaining("hi"),
      null,
      expect.anything(),
      "claude-haiku-4-5",
    );
  });

  it("each vendor goes its own way: Claude by API key while GPT stays on its subscription (#252)", async () => {
    useChatStore.setState({
      settings: {
        vendor: "openai",
        auths: { claude: "api-key", openai: "subscription" },
        keys: { claude: "sk-a", openai: "" },
        models: { claude: "claude-opus-5", openai: "gpt-6-astra" },
      },
    });
    await sendChatTurn("hi");
    expect(codexMock).toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("GPT · API key → OpenAI, with the vendor's key and model", async () => {
    useChatStore.setState({ settings: apiKey("openai", "sk-o") });
    await sendChatTurn("hi");
    expect(openaiMock).toHaveBeenCalledWith(
      "sk-o",
      "gpt-5.6-sol",
      [],
      expect.stringContaining("hi"),
      expect.anything(),
      expect.any(Function),
      { session: expect.any(Number), stopped: null },
    );
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("Claude · API key → Anthropic, with the Claude key and model", async () => {
    useChatStore.setState({ settings: apiKey("claude", "sk-a") });
    await sendChatTurn("hi");
    expect(apiMock).toHaveBeenCalledWith(
      "sk-a",
      "claude-opus-5",
      [],
      expect.stringContaining("hi"),
      expect.anything(),
      { session: expect.any(Number), stopped: null },
    );
    expect(openaiMock).not.toHaveBeenCalled();
  });

  it("GPT · API key with an empty OpenAI key → needs-api-key (even with a Claude key)", async () => {
    useChatStore.setState({
      settings: { ...apiKey("openai", ""), keys: { claude: "sk-a", openai: "" } },
    });
    expect(await sendChatTurn("hi")).toBe("needs-api-key");
    expect(openaiMock).not.toHaveBeenCalled();
  });

  it("resets the CLI session id when the vendor or connection changes", () => {
    useChatStore.setState({ settings: subscription("claude"), cliSessionId: "s-claude" });
    useChatStore.getState().setSettings({
      ...subscription("claude"),
      models: { claude: "claude-sonnet-5", openai: "gpt-5.6-sol" },
    });
    expect(useChatStore.getState().cliSessionId).toBe("s-claude");
    useChatStore.getState().setSettings(subscription("openai"));
    expect(useChatStore.getState().cliSessionId).toBeNull();
    useChatStore.setState({ cliSessionId: "th-codex" });
    useChatStore.getState().setSettings(apiKey("openai"));
    expect(useChatStore.getState().cliSessionId).toBeNull();
  });
});

/**
 * The model picker is reachable while a turn is out (#219 D15), so the
 * connection can change under it. A CLI session id belongs to the CLI that
 * made it: written onto another connection, the next turn would ask that CLI
 * to resume a conversation it never had (#219).
 */
describe("switching connection mid-turn drops that turn's session id (#219)", () => {
  type Reply = { text: string; sessionId: string | null };
  const pending = () => {
    let finish: (r: Reply) => void = () => {};
    const promise = new Promise<Reply>((r) => {
      finish = r;
    });
    return { promise, finish };
  };

  beforeEach(() => {
    resetChat();
    for (const m of [cliMock, codexMock]) m.mockReset();
  });

  it("to GPT · Subscription during a Claude turn — the Claude session id does not stick to the GPT connection", async () => {
    const turn = pending();
    cliMock.mockReturnValue(turn.promise);
    const sent = sendChatTurn("hello");
    useChatStore.getState().setSettings(subscription("openai"));
    turn.finish({ text: "ok", sessionId: "claude-session" });
    await sent;
    const state = useChatStore.getState();
    expect(state.settings.vendor).toBe("openai");
    expect(state.cliSessionId).toBeNull();
    // the reply itself still lands — it is what the user asked
    expect(state.messages.at(-1)).toMatchObject({ role: "assistant", text: "ok" });
    expect(state.busy).toBe(false);
  });

  it("to Claude during a GPT turn — the same for the Codex thread id", async () => {
    useChatStore.setState({ settings: subscription("openai") });
    const turn = pending();
    codexMock.mockReturnValue(turn.promise);
    const sent = sendChatTurn("hello");
    useChatStore.getState().setSettings(subscription("claude"));
    turn.finish({ text: "ok", sessionId: "codex-thread" });
    await sent;
    expect(useChatStore.getState().cliSessionId).toBeNull();
  });

  it("keeps the session after going to API key and back to the same connection — it belongs to that CLI", async () => {
    const turn = pending();
    cliMock.mockReturnValue(turn.promise);
    const sent = sendChatTurn("hello");
    useChatStore.getState().setSettings(apiKey("claude"));
    useChatStore.getState().setSettings(subscription("claude"));
    turn.finish({ text: "ok", sessionId: "claude-session" });
    await sent;
    expect(useChatStore.getState().cliSessionId).toBe("claude-session");
  });
});

/**
 * New chat while a turn is out starts a conversation the turn never belonged
 * to: what it answers — text, activity, errors, its CLI session — stays with
 * the abandoned one, not the fresh chat (#219).
 */
describe("New chat mid-turn — that turn's reply and session do not attach to the new chat (#219)", () => {
  beforeEach(() => {
    resetChat();
    for (const m of [cliMock, apiMock]) m.mockReset();
  });

  it("CLI — drops both the reply and the session id", async () => {
    let finish: (r: { text: string; sessionId: string | null }) => void = () => {};
    cliMock.mockReturnValue(new Promise((r) => (finish = r)));
    const sent = sendChatTurn("hello");
    useChatStore.getState().clearMessages();
    finish({ text: "old answer", sessionId: "old-session" });
    await sent;
    const state = useChatStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.cliSessionId).toBeNull();
    expect(state.busy).toBe(false);
  });

  it("API — text, activity and errors arriving afterwards stay out of the new chat", async () => {
    useChatStore.setState({ settings: apiKey() });
    let fail: (e: Error) => void = () => {};
    apiMock.mockImplementation(
      (
        _k,
        _m,
        _h,
        _p,
        callbacks: { onText: (t: string) => void; onActivity: (t: string) => void },
      ) =>
        new Promise((_resolve, reject) => {
          fail = (e) => {
            callbacks.onText("late text");
            callbacks.onActivity("late activity");
            reject(e);
          };
        }),
    );
    const sent = sendChatTurn("hello");
    useChatStore.getState().clearMessages();
    fail(new Error("late failure"));
    await sent;
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().busy).toBe(false);
  });

  it("without New chat nothing changes — the reply and session stay in the same chat", async () => {
    cliMock.mockResolvedValue({ text: "answer", sessionId: "s1" });
    await sendChatTurn("hello");
    const state = useChatStore.getState();
    expect(state.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(state.cliSessionId).toBe("s1");
  });
});

describe("past-turn selection context on the API path (#55)", () => {
  beforeEach(() => {
    useChatStore.setState({
      open: false,
      busy: false,
      messages: [],
      cliSessionId: null,
      settings: apiKey(),
    });
    useDiagramStore.setState({ nodes: [], edges: [] });
    apiMock.mockReset();
    apiMock.mockResolvedValue(undefined);
  });

  it("keeps the sent payload on the message — so the next turn can read it", async () => {
    useDiagramStore.setState({
      nodes: [{ ...makeNode({ id: "n1" }), selected: true }],
      edges: [],
    });

    await sendChatTurn("make this blue");

    const sent = useChatStore.getState().messages.find((m) => m.role === "user")!;
    expect(sent.payload).toContain("[Selection]");
    expect(sent.payload).toContain("n1");
    expect(sent.payload).toContain("make this blue");
  });

  it("shows the raw text in the visible message", async () => {
    useDiagramStore.setState({
      nodes: [{ ...makeNode({ id: "n1" }), selected: true }],
      edges: [],
    });

    await sendChatTurn("make this blue");

    const shown = useChatStore.getState().messages.find((m) => m.role === "user")!;
    expect(shown.text).toBe("make this blue");
    expect(shown.text).not.toContain("[Selection]");
  });

  it("keeps 'ignore the previous selection' for a turn without a selection", async () => {
    await sendChatTurn("first");

    const sent = useChatStore.getState().messages.find((m) => m.role === "user")!;
    expect(sent.payload).toContain("nothing selected");
  });

  it("leaves the current turn out of the history — mixing it in would send the selection block twice", async () => {
    useChatStore.getState().addMessage("user", "earlier");
    useChatStore.getState().addMessage("assistant", "ok");

    await sendChatTurn("current");

    const history = apiMock.mock.calls[0]![2] as { text: string }[];
    expect(history.map((m) => m.text)).toEqual(["earlier", "ok"]);
  });

  it("attaches no payload to assistant messages", async () => {
    await sendChatTurn("first");
    useChatStore.getState().addMessage("assistant", "Done.");

    const assistant = useChatStore.getState().messages.find((m) => m.role === "assistant")!;
    expect(assistant.payload).toBeUndefined();
  });

  it("carries the previous turn's payload in the next turn's history", async () => {
    useDiagramStore.setState({
      nodes: [{ ...makeNode({ id: "n1" }), selected: true }],
      edges: [],
    });
    await sendChatTurn("make this blue");
    useChatStore.getState().addMessage("assistant", "Done.");
    useDiagramStore.setState({ nodes: [makeNode({ id: "n1" })], edges: [] });

    await sendChatTurn("actually make it green");

    const history = apiMock.mock.calls[1]![2] as { role: string; payload?: string }[];
    expect(history.find((m) => m.role === "user")?.payload).toContain("n1");
  });
});
