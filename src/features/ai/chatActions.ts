import { nanoid } from "nanoid";

import { useDiagramStore } from "../../shared/lib/store";
import { sendWithApi } from "./apiProvider";
import type { ChatAttachment } from "./attachments";
import { captureChatTarget, diagramPictures, type NodePicture } from "./chatTarget";
import { type ChatRole, useChatStore } from "./chatStore";
import { stageForCli } from "./cliFiles";
import { sendWithClaudeCli } from "./cliProvider";
import { sendWithCodexCli } from "./codexProvider";
import { sendWithOpenAi } from "./openaiProvider";
import { selectionChipLabel, summarizeSelection, withSelectionContext } from "./selectionContext";
import { type AiVendor, activeAuth, activeKey, activeModel } from "./settings";
import { nameOnly, tooLongToInline, withAttachmentText } from "./turnContent";

/** a selected image node's picture, riding along like an attached one (#275) */
const pictureAttachment = (picture: NodePicture): ChatAttachment => ({
  id: nanoid(8),
  name: `${picture.node}.${picture.mime.split("/")[1] ?? "png"}`,
  mime: picture.mime,
  size: Math.floor((picture.base64.length * 3) / 4),
  kind: "image",
  base64: picture.base64,
  fromNode: picture.node,
});

const apiName = (vendor: AiVendor): string => (vendor === "claude" ? "Claude API" : "OpenAI API");
const names = (files: ChatAttachment[]): string => files.map((f) => f.name).join(", ");

/** the line under a message whose files an API connection could send by name only */
export const nameOnlyNotice = (files: ChatAttachment[], vendor: AiVendor): string =>
  `${names(files)} went by name only: ${apiName(vendor)} can't read this kind of file.`;

/** the line under a message whose text files were too long to put inside it */
export const tooLongNotice = (files: ChatAttachment[]): string =>
  `${names(files)} went by name only: too long to put in the message.`;

export type SendResult = "sent" | "needs-api-key" | "ignored";

/**
 * A refusal that may be the turn's files — a malformed or too large request
 * (400, 413), not a passing failure (network, rate limit, overload).
 */
const refusedTheFiles = (error: unknown): boolean => {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 400 || status === 413;
};

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
  const files = store.attachments;
  // files alone are a message too (#275)
  if ((!text && files.length === 0) || store.busy) return "ignored";
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
  const conversationId = store.conversationId;
  const say = (role: ChatRole, line: string) => {
    if (useChatStore.getState().conversation === conversation) store.addMessage(role, line);
  };
  // the turn draws on the diagram open right now, wherever the user goes
  // while it answers (#167)
  const target = captureChatTarget();
  // the chat shows what the user typed; the provider also gets the canvas selection
  const diagram = useDiagramStore.getState();
  const selection = withSelectionContext(text, diagram.nodes, diagram.edges);
  // the pictures of the selected image nodes go along, as attached ones do (#275)
  const attachments = [...files, ...diagramPictures("selected").map(pictureAttachment)];
  // the chat keeps the raw text; the API paths replay `payload` (and the
  // files) so a later turn still sees which shapes an earlier "this" pointed
  // at (#55) and what was attached
  const payload = withAttachmentText(selection, attachments);
  // what went with it stays on the message, for its chips (#277)
  const summary = summarizeSelection(diagram.nodes, diagram.edges);
  const sent = store.addMessage("user", text, {
    payload,
    attachments,
    ...(summary ? { selection: selectionChipLabel(summary) } : {}),
  });
  store.clearAttachments();
  if (auth === "api-key") {
    const unread = nameOnly(attachments);
    if (unread.length > 0) say("notice", nameOnlyNotice(unread, settings.vendor));
    const long = tooLongToInline(attachments);
    if (long.length > 0) say("notice", tooLongNotice(long));
  }
  store.setBusy(true);
  try {
    if (auth === "subscription") {
      // a CLI reads files: this message's, and every picture in the diagram
      // (`view_image`'s counterpart), from the conversation's folder
      const staged = await stageForCli(
        conversationId,
        nanoid(8),
        attachments,
        diagramPictures("all"),
      );
      const prompt = staged.note ? `${selection}\n\n${staged.note}` : selection;
      // the composer's model goes to the CLI too (#252) — without it the menu's choice would do nothing
      const model = activeModel(settings);
      // always the conversation: a later turn may read an earlier turn's
      // files, and Rust opens the folder only when it exists
      const result =
        settings.vendor === "claude"
          ? await sendWithClaudeCli(prompt, store.cliSessionId, target, model, conversationId)
          : await sendWithCodexCli(prompt, store.cliSessionId, target, model, {
              conversation: conversationId,
              images: staged.images,
            });
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
        await sendWithApi(key, model, history, payload, callbacks, target, attachments);
      } else {
        await sendWithOpenAi(key, model, history, payload, callbacks, fetch, target, attachments);
      }
    }
    if (target.stopped) say("error", target.stopped);
  } catch (error) {
    // a refused turn's files would go again with every later one, and fail
    // it the same way: they leave the replay
    if (auth === "api-key" && attachments.length > 0 && refusedTheFiles(error)) {
      store.forgetTurnFiles(sent, selection);
    }
    say("error", error instanceof Error ? error.message : String(error));
    // a CLI that failed after the user left: why nothing was drawn matters more
    if (target.stopped) say("error", target.stopped);
  } finally {
    useChatStore.getState().setBusy(false);
  }
  return "sent";
};
