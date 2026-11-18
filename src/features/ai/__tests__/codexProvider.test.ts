import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendWithCodexCli } from "../codexProvider";

const mockedInvoke = vi.mocked(invoke);

/** the bridge is up; the CLI command answers with `chat` */
const bridgeAnd = (chat: () => unknown) =>
  mockedInvoke.mockImplementation(async (cmd: string) => (cmd === "bridge_port" ? 4517 : chat()));

// Tauri rejects with a plain object; an Error carrying the same fields keeps
// the mock's own promise bookkeeping from surfacing as an unhandled rejection
const cliError = (kind: string, message: string) => Object.assign(new Error(message), { kind });

describe("codexProvider (#119)", () => {
  beforeEach(() => mockedInvoke.mockReset());

  it("sendWithCodexCli: passes the prompt, system prompt and thread id to codex_cli_chat", async () => {
    bridgeAnd(() => ({ text: "drew it", session_id: "th_2" }));
    const result = await sendWithCodexCli("draw a flow", "th_1");
    expect(mockedInvoke).toHaveBeenCalledWith("codex_cli_chat", {
      prompt: expect.stringMatching(/\/api\/chat\/[^/]+\/ops[\s\S]*draw a flow$/),
      systemPrompt: expect.stringContaining("curl"),
      sessionId: "th_1",
      model: null,
    });
    expect(result).toEqual({ text: "drew it", sessionId: "th_2" });
  });

  it("sendWithCodexCli: passes the chosen model to codex_cli_chat (#252)", async () => {
    bridgeAnd(() => ({ text: "drew it", session_id: "th_2" }));
    await sendWithCodexCli("draw a flow", null, undefined, "gpt-6-astra");
    expect(mockedInvoke).toHaveBeenCalledWith(
      "codex_cli_chat",
      expect.objectContaining({ model: "gpt-6-astra" }),
    );
  });

  it("turns structured errors into Codex wording", async () => {
    mockedInvoke
      .mockResolvedValueOnce(4517)
      .mockRejectedValueOnce(cliError("api_error", "not logged in"));
    await expect(sendWithCodexCli("x", null)).rejects.toThrow("Codex error: not logged in");
    mockedInvoke
      .mockResolvedValueOnce(4517)
      .mockRejectedValueOnce(cliError("session_limit", "usage limit hit"));
    await expect(sendWithCodexCli("x", null)).rejects.toThrow("switch to the API key connection");
    mockedInvoke.mockResolvedValueOnce(4517).mockRejectedValueOnce(cliError("unknown", "boom"));
    await expect(sendWithCodexCli("x", null)).rejects.toThrow("Codex CLI failed: boom");
  });
});
