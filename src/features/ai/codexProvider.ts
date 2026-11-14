import { invoke } from "@tauri-apps/api/core";

import { type ChatTarget, captureChatTarget } from "./chatTarget";
import { formatCliError, isCliError, withChatRoute } from "./cliProvider";

interface CliChatResult {
  text: string;
  sessionId: string | null;
}

/**
 * GPT subscription provider: routes the chat turn through the locally
 * installed OpenAI Codex CLI (`codex exec`), signed in with the user's
 * ChatGPT subscription — no API key required. Like the Claude CLI path, the
 * CLI edits the diagram via the local HTTP bridge with curl. The session id
 * is Codex's thread id.
 */
export const sendWithCodexCli = (
  userMessage: string,
  sessionId: string | null,
  target: ChatTarget = captureChatTarget(),
): Promise<CliChatResult> =>
  withChatRoute(target, userMessage, async ({ systemPrompt, prompt }) => {
    try {
      const result = await invoke<{ text: string; session_id: string | null }>("codex_cli_chat", {
        prompt,
        systemPrompt,
        sessionId,
      });
      return { text: result.text, sessionId: result.session_id };
    } catch (error) {
      if (isCliError(error)) throw new Error(formatCliError(error, "Codex"));
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  });

/** Checks whether the Codex CLI is installed and can start; the message on failure is actionable. */
export const checkCodexCli = async (): Promise<{ version: string } | { error: string }> => {
  try {
    return { version: await invoke<string>("codex_cli_version") };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};
