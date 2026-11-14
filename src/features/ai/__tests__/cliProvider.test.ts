import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureChatTarget, chatTurn } from "../chatTarget";
import {
  BRIDGE_DOWN,
  checkClaudeCli,
  formatCliError,
  isCliError,
  sendWithClaudeCli,
} from "../cliProvider";

const mockedInvoke = vi.mocked(invoke);

/** the bridge listens on `port`; the CLI command answers with `chat` */
const bridgeAnd = (chat: () => unknown, port: number | null = 4517) =>
  mockedInvoke.mockImplementation(async (cmd: string) => (cmd === "bridge_port" ? port : chat()));

describe("cliProvider", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("sendWithClaudeCli: passes the prompt, system prompt and session to the command and maps the result", async () => {
    bridgeAnd(() => ({ text: "reply", session_id: "s-9" }));
    const result = await sendWithClaudeCli("draw a login flow", "s-8");
    expect(mockedInvoke).toHaveBeenCalledWith("claude_cli_chat", {
      prompt: expect.stringMatching(/\/api\/chat\/[^/]+\/ops[\s\S]*draw a login flow$/),
      systemPrompt: expect.any(String),
      sessionId: "s-8",
    });
    expect(result).toEqual({ text: "reply", sessionId: "s-9" });
  });

  describe("address for this turn (#167)", () => {
    it("gets a URL built from the port the app really listens on and this turn's token, and the token ends with the turn", async () => {
      let prompt = "";
      let tokenDuringTurn: string | undefined;
      mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === "bridge_port") return 4600;
        prompt = (args as { systemPrompt: string }).systemPrompt;
        tokenDuringTurn = /\/api\/chat\/([^/]+)\/ops/.exec(prompt)?.[1];
        expect(chatTurn(tokenDuringTurn ?? "")).toBeDefined();
        return { text: "ok", session_id: null };
      });
      const target = captureChatTarget();
      await sendWithClaudeCli("hi", null, target);
      expect(prompt).toContain("http://127.0.0.1:4600/api/chat/");
      expect(prompt).not.toContain("/api/ops");
      expect(prompt).not.toContain("/api/diagram");
      expect(chatTurn(tokenDuringTurn ?? "")).toBeUndefined();
    });

    it("does not start the CLI when the bridge is down — so nothing leaks to another app's port", async () => {
      bridgeAnd(() => ({ text: "drew", session_id: null }), null);
      await expect(sendWithClaudeCli("hi", null)).rejects.toThrow(BRIDGE_DOWN);
      expect(mockedInvoke).not.toHaveBeenCalledWith("claude_cli_chat", expect.anything());
    });

    it("revokes the token even when the CLI fails", async () => {
      let token: string | undefined;
      mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === "bridge_port") return 4517;
        token = /\/api\/chat\/([^/]+)\//.exec((args as { systemPrompt: string }).systemPrompt)?.[1];
        throw "boom";
      });
      await expect(sendWithClaudeCli("hi", null)).rejects.toThrow("boom");
      expect(token).toBeDefined();
      expect(chatTurn(token ?? "")).toBeUndefined();
    });
  });

  it("checkClaudeCli: a version string on success", async () => {
    mockedInvoke.mockResolvedValue("1.2.3 (Claude Code)");
    expect(await checkClaudeCli()).toBe("1.2.3 (Claude Code)");
  });

  it("checkClaudeCli: null on failure (CLI shown as not installed)", async () => {
    mockedInvoke.mockRejectedValue(new Error("not found"));
    expect(await checkClaudeCli()).toBeNull();
  });

  // #68 — structured errors are thrown as one human-readable line
  describe("CLI error wording (#68)", () => {
    it("session_limit: reset time + a hint to switch providers", () => {
      const line = formatCliError({
        kind: "session_limit",
        message: "You've hit your session limit · resets 5:10am (Asia/Seoul)",
      });
      expect(line).toContain("resets 5:10am");
      expect(line).toContain("API key connection");
      expect(line).not.toContain("{");
    });

    it("api_error / unknown: prefix + message, not_installed keeps its guidance as is", () => {
      expect(formatCliError({ kind: "api_error", message: "Internal server error" })).toBe(
        "Claude API error: Internal server error",
      );
      expect(formatCliError({ kind: "unknown", message: "boom" })).toBe("Claude CLI failed: boom");
      const guide = "Claude Code CLI not found. Install it …";
      expect(formatCliError({ kind: "not_installed", message: guide })).toBe(guide);
    });

    it("sendWithClaudeCli: throws structured errors as an Error with the formatCliError wording", async () => {
      bridgeAnd(() => {
        throw {
          kind: "session_limit",
          message: "You've hit your session limit · resets 5:10am (Asia/Seoul)",
        };
      });
      await expect(sendWithClaudeCli("hi", null)).rejects.toThrow(
        /resets 5:10am.*API key connection/,
      );
    });

    it("stringifies and throws an unstructured rejection", async () => {
      bridgeAnd(() => {
        throw "plain failure";
      });
      await expect(sendWithClaudeCli("hi", null)).rejects.toThrow("plain failure");
    });

    it("isCliError: true only with string kind and message fields", () => {
      expect(isCliError({ kind: "unknown", message: "m" })).toBe(true);
      expect(isCliError({ kind: 1, message: "m" })).toBe(false);
      expect(isCliError("string")).toBe(false);
      expect(isCliError(null)).toBe(false);
    });
  });
});
