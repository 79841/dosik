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
  /** the composer's model (#252); null leaves the CLI on its own default */
  model: string | null = null,
  /** the conversation's staged files: its id, and the pictures to hand over (`cliFiles.ts`) */
  files: { conversation: string; images: string[] } | null = null,
): Promise<CliChatResult> =>
  withChatRoute(target, userMessage, async ({ systemPrompt, prompt }) => {
    try {
      const result = await invoke<{ text: string; session_id: string | null }>("codex_cli_chat", {
        prompt,
        systemPrompt,
        sessionId,
        model,
        conversation: files?.conversation ?? null,
        images: files?.images ?? null,
      });
      return { text: result.text, sessionId: result.session_id };
    } catch (error) {
      if (isCliError(error)) throw new Error(formatCliError(error, "Codex"));
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  });
