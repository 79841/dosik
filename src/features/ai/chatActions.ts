import { useDiagramStore } from "../../shared/lib/store";
import { sendWithApi } from "./apiProvider";
import { captureChatTarget } from "./chatTarget";
import { type ChatRole, useChatStore } from "./chatStore";
import { sendWithClaudeCli } from "./cliProvider";
import { sendWithCodexCli } from "./codexProvider";
import { sendWithOpenAi } from "./openaiProvider";
import { withSelectionContext } from "./selectionContext";
import { activeAuth, activeKey, activeModel } from "./settings";

export type SendResult = "sent" | "needs-api-key" | "ignored";

/**
 * Runs one chat turn against the configured provider, appending user,
 * assistant, activity, and error messages to the chat store. View-independent
 * so the panel stays presentational.
 *
 * Four routes (#119): vendor × connection. The two CLI routes carry a session
 * id across turns; the two API routes replay the stored history instead.
 */
export const sendChatTurn = async (rawText: string): Promise<SendResult> => {
  const store = useChatStore.getState();
  const text = rawText.trim();
  if (!text || store.busy) return "ignored";
  const { settings } = store;
  const auth = activeAuth(settings);
  if (auth === "api-key" && !activeKey(settings)) {
    return "needs-api-key";
  }

  const history = store.messages;
  // New chat while this turn is out starts a conversation it never belonged
  // to: what it answers, and its CLI session, stay with the abandoned one
  // (#219)
  const conversation = store.conversation;
  const say = (role: ChatRole, line: string) => {
    if (useChatStore.getState().conversation === conversation) store.addMessage(role, line);
  };
  // the turn draws on the diagram open right now, wherever the user goes
  // while it answers (#167)
  const target = captureChatTarget();
  // the chat shows what the user typed; the provider also gets the canvas selection
  const diagram = useDiagramStore.getState();
  const payload = withSelectionContext(text, diagram.nodes, diagram.edges);
  // the chat keeps the raw text; the API paths replay `payload` so a later turn
  // still sees which shapes an earlier "this" pointed at (#55)
  store.addMessage("user", text, payload);
  store.setBusy(true);
  try {
    if (auth === "subscription") {
      const send = settings.vendor === "claude" ? sendWithClaudeCli : sendWithCodexCli;
      // the composer's model goes to the CLI too (#252) — without it the menu's choice would do nothing
      const result = await send(payload, store.cliSessionId, target, activeModel(settings));
      // The session id belongs to the CLI that answered. The model picker
      // works while a turn is out: if the connection changed meanwhile, the
      // id would ask the other CLI to resume a conversation it never had —
      // and every later turn would fail the same way (#219).
      const now = useChatStore.getState();
      if (
        now.conversation === conversation &&
        now.settings.vendor === settings.vendor &&
        activeAuth(now.settings) === auth
      ) {
        now.setCliSessionId(result.sessionId);
      }
      say("assistant", result.text || "Done.");
    } else {
      const callbacks = {
        onText: (t: string) => say("assistant", t),
        onActivity: (t: string) => say("activity", t),
      };
      const [key, model] = [activeKey(settings), activeModel(settings)];
      if (settings.vendor === "claude") {
        await sendWithApi(key, model, history, payload, callbacks, target);
      } else {
        await sendWithOpenAi(key, model, history, payload, callbacks, fetch, target);
      }
    }
    if (target.stopped) say("error", target.stopped);
  } catch (error) {
    say("error", error instanceof Error ? error.message : String(error));
    // a CLI that failed after the user left: why nothing was drawn matters more
    if (target.stopped) say("error", target.stopped);
  } finally {
    useChatStore.getState().setBusy(false);
  }
  return "sent";
};
