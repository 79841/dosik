import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { forgetPlatform, pretendMac } from "../../../test/platform";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const { useAiStatusStore, checkCli, checkKey, forgetKeyCheck, isConnected } = await import(
  "../aiStatusStore"
);
const { DEFAULT_AI_SETTINGS } = await import("../settings");

// GPT's subscription is macOS's: these suites run as on a Mac (jsdom names no platform)
beforeEach(pretendMac);
afterEach(forgetPlatform);

describe("AI status (#252)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAiStatusStore.setState({
      cli: { claude: { state: "unknown" }, openai: { state: "unknown" } },
      cliChecking: { claude: false, openai: false },
      key: { claude: { state: "unknown" }, openai: { state: "unknown" } },
      keyChecking: { claude: false, openai: false },
    });
  });

  it("a found, signed-in CLI is ok with its version", async () => {
    invokeMock.mockResolvedValue({ version: "2.1.4 (Claude Code)", signed_in: true });
    await checkCli("claude");
    expect(invokeMock).toHaveBeenCalledWith("claude_cli_status");
    expect(useAiStatusStore.getState().cli.claude).toEqual({ state: "ok", version: "2.1.4" });
  });

  it("no version is missing; signed in false is signed-out; unknown sign-in counts as ok", async () => {
    invokeMock.mockResolvedValueOnce({ version: null, signed_in: null });
    await checkCli("openai");
    expect(invokeMock).toHaveBeenCalledWith("codex_cli_status");
    expect(useAiStatusStore.getState().cli.openai).toEqual({ state: "missing" });
    invokeMock.mockResolvedValueOnce({ version: "codex-cli 0.9.0", signed_in: false });
    await checkCli("openai");
    expect(useAiStatusStore.getState().cli.openai).toEqual({
      state: "signed-out",
      version: "0.9.0",
    });
    invokeMock.mockResolvedValueOnce({ version: "0.9.0", signed_in: null });
    await checkCli("openai");
    expect(useAiStatusStore.getState().cli.openai.state).toBe("ok");
  });

  it("two checks at once share one call", async () => {
    let finish: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(new Promise((r) => (finish = r)));
    useAiStatusStore.setState({
      cli: { claude: { state: "missing" }, openai: { state: "unknown" } },
    });
    const a = checkCli("claude");
    const b = checkCli("claude");
    // the last result stays while the check is out
    expect(useAiStatusStore.getState().cli.claude.state).toBe("missing");
    expect(useAiStatusStore.getState().cliChecking.claude).toBe(true);
    finish({ version: "1.0.0", signed_in: true });
    await Promise.all([a, b]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(useAiStatusStore.getState().cliChecking.claude).toBe(false);
  });

  it("a failed call is missing, not a crash", async () => {
    invokeMock.mockRejectedValue(new Error("no tauri"));
    await checkCli("claude");
    expect(useAiStatusStore.getState().cli.claude).toEqual({ state: "missing" });
  });

  it("a key check that ends after a newer one, or after the key went, changes nothing", async () => {
    const answers: ((r: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => answers.push(resolve))),
    );
    const first = checkKey("openai", "sk-old");
    const second = checkKey("openai", "sk-new");
    answers[1]!(new Response("{}", { status: 401 }));
    await second;
    answers[0]!(new Response("{}", { status: 200 }));
    await first;
    expect(useAiStatusStore.getState().key.openai).toEqual({ state: "rejected" });
    const third = checkKey("openai", "sk-new");
    forgetKeyCheck("openai");
    answers[2]!(new Response("{}", { status: 200 }));
    await third;
    expect(useAiStatusStore.getState().key.openai).toEqual({ state: "unknown" });
    vi.unstubAllGlobals();
  });

  it("a key check again keeps the last result on screen; only the checking flag turns on", async () => {
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    useAiStatusStore.setState({ key: { claude: { state: "unknown" }, openai: { state: "ok" } } });
    const check = checkKey("openai", "sk-o");
    expect(useAiStatusStore.getState().key.openai).toEqual({ state: "ok" });
    expect(useAiStatusStore.getState().keyChecking.openai).toBe(true);
    answer(new Response("{}", { status: 401 }));
    await check;
    expect(useAiStatusStore.getState().key.openai).toEqual({ state: "rejected" });
    expect(useAiStatusStore.getState().keyChecking.openai).toBe(false);
    vi.unstubAllGlobals();
  });

  it("connected: an API key needs a key; a subscription needs a CLI not known to be missing or signed out", () => {
    const s = {
      ...DEFAULT_AI_SETTINGS,
      auths: { claude: "api-key" as const, openai: "subscription" as const },
      keys: { claude: "", openai: "" },
    };
    const cli = (state: "unknown" | "missing" | "signed-out" | "ok") =>
      ({ claude: { state: "unknown" }, openai: { state, version: "1" } }) as never;
    expect(isConnected(s, cli("unknown"), "claude")).toBe(false);
    expect(
      isConnected({ ...s, keys: { claude: "sk", openai: "" } }, cli("unknown"), "claude"),
    ).toBe(true);
    expect(isConnected(s, cli("unknown"), "openai")).toBe(true);
    expect(isConnected(s, cli("ok"), "openai")).toBe(true);
    expect(isConnected(s, cli("missing"), "openai")).toBe(false);
    expect(isConnected(s, cli("signed-out"), "openai")).toBe(false);
  });

  it("off macOS a stored GPT subscription is connected only by its API key", () => {
    forgetPlatform();
    const s = {
      ...DEFAULT_AI_SETTINGS,
      auths: { claude: "subscription" as const, openai: "subscription" as const },
      keys: { claude: "", openai: "" },
    };
    const cli = { claude: { state: "ok" }, openai: { state: "ok", version: "1" } } as never;
    expect(isConnected(s, cli, "openai")).toBe(false);
    expect(isConnected({ ...s, keys: { claude: "", openai: "sk" } }, cli, "openai")).toBe(true);
    expect(isConnected(s, cli, "claude")).toBe(true);
  });
});
