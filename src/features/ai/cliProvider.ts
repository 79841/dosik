import { invoke } from "@tauri-apps/api/core";

import { type ChatTarget, captureChatTarget, closeChatTurn, openChatTurn } from "./chatTarget";
import { cliSystemPrompt, cliTurnNote } from "./systemPrompt";

interface CliChatResult {
  text: string;
  sessionId: string | null;
}

/** Structured failure from the Rust side (#68) — kind picks the wording. */
export interface CliError {
  kind: "session_limit" | "api_error" | "not_installed" | "spawn_failed" | "unknown";
  message: string;
}

export const isCliError = (e: unknown): e is CliError =>
  typeof e === "object" &&
  e !== null &&
  typeof (e as CliError).kind === "string" &&
  typeof (e as CliError).message === "string";

/** One readable line per failure kind — never a raw result JSON (#68). Shared by both CLIs (#119). */
export const formatCliError = (e: CliError, cli: "Claude" | "Codex" = "Claude"): string => {
  switch (e.kind) {
    case "session_limit":
      // the message already carries the reset time (e.g. "resets 5:10am")
      return `${e.message} — switch to the API key connection in settings to keep going.`;
    case "api_error":
      return `${cli === "Claude" ? "Claude API" : "Codex"} error: ${e.message}`;
    // these arrive with actionable install/run guidance already written
    case "not_installed":
    case "spawn_failed":
      return e.message;
    default:
      return `${cli} CLI failed: ${e.message}`;
  }
};

export const BRIDGE_DOWN =
  "Dosik's local bridge is not running, so the CLI cannot draw — another app may be using its port. Restart Dosik and try again.";

/**
 * Runs one CLI turn against `target` (#167): the CLI is given this turn's own
 * URLs — the port the bridge really listens on and a token that reaches the
 * diagram the message was sent from — and the token dies with the turn. Shared
 * by both CLIs (#119).
 */
export const withChatRoute = async <T>(
  target: ChatTarget,
  userMessage: string,
  run: (turn: { systemPrompt: string; prompt: string }) => Promise<T>,
): Promise<T> => {
  // not the default port: when this instance could not bind it, another app
  // (an installed Dosik, say) holds it, and the CLI would draw there
  const port = await invoke<number | null>("bridge_port").catch(() => null);
  if (port === null || port === undefined) throw new Error(BRIDGE_DOWN);
  const token = openChatTurn(target);
  try {
    const route = { port, token };
    return await run({
      systemPrompt: cliSystemPrompt(route),
      prompt: `${cliTurnNote(route)}\n\n${userMessage}`,
    });
  } finally {
    closeChatTurn(token);
  }
};

/**
 * Claude subscription provider: routes the chat turn through the locally
 * installed Claude Code CLI (`claude -p`), which is authenticated with the
 * user's Claude subscription — no API key required. The CLI edits the diagram
 * via the local HTTP bridge, so edits appear on the canvas in real time.
 */
export const sendWithClaudeCli = (
  userMessage: string,
  sessionId: string | null,
  target: ChatTarget = captureChatTarget(),
): Promise<CliChatResult> =>
  withChatRoute(target, userMessage, async ({ systemPrompt, prompt }) => {
    try {
      const result = await invoke<{ text: string; session_id: string | null }>("claude_cli_chat", {
        prompt,
        systemPrompt,
        sessionId,
      });
      return { text: result.text, sessionId: result.session_id };
    } catch (error) {
      if (isCliError(error)) throw new Error(formatCliError(error));
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  });

/** Checks whether the Claude Code CLI is installed and reachable. */
export const checkClaudeCli = async (): Promise<string | null> => {
  try {
    return await invoke<string>("claude_cli_version");
  } catch {
    return null;
  }
};
