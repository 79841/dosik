import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";

import type { AgentOp } from "../../shared/lib/types";
import type { ChatAttachment } from "./attachments";
import type { ChatMessage } from "./chatStore";
import {
  applyForChat,
  type ChatTarget,
  captureChatTarget,
  describeApply,
  pictureForChat,
  readForChat,
} from "./chatTarget";
import { apiSystemPrompt } from "./systemPrompt";
import { anthropicContent, cachedContent, replayedFiles } from "./turnContent";

interface TurnCallbacks {
  onText: (text: string) => void;
  onActivity: (text: string) => void;
}

/**
 * Rebuilds the API conversation from stored chat messages. Exported for tests:
 * this is where a turn's selection context survives into later turns (#55),
 * and its files (#275).
 */
export const historyToParams = (history: ChatMessage[]): Anthropic.Beta.BetaMessageParam[] => {
  const files = replayedFiles(history);
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      // only user turns carry a payload (the selection block) and files.
      // Narrowing by role rather than relying on "assistants never set it"
      // keeps a later writer from silently changing what the model reads.
      content: m.role === "user" ? anthropicContent(m.payload ?? m.text, files.get(m.id)) : m.text,
    }));
};

/** `view_image`'s answer: the picture itself, or why there is none */
export const viewImageResult = (
  target: ChatTarget,
  id: string,
): string | Anthropic.Beta.Messages.BetaToolResultContentBlockParam[] => {
  const found = pictureForChat(target, id);
  if (!found.ok) return JSON.stringify({ ok: false, error: found.error });
  return [
    { type: "text", text: `The picture of image node ${id}:` },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: found.picture.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
        data: found.picture.base64,
      },
    },
  ];
};

/**
 * Anthropic API provider: runs a tool-use loop where Claude reads and edits
 * the diagram store directly. Edits are marked as agent edits so the canvas
 * shows the realtime highlight. They land on `target` — the diagram the
 * message was sent from (#167); once the user leaves it the loop stops.
 */
export const sendWithApi = async (
  apiKey: string,
  model: string,
  history: ChatMessage[],
  userMessage: string,
  callbacks: TurnCallbacks,
  target: ChatTarget = captureChatTarget(),
  /** this turn's files — pictures and PDFs go as content blocks */
  attachments: ChatAttachment[] = [],
): Promise<void> => {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const readDiagram = betaTool({
    name: "read_diagram",
    description:
      "Read the current diagram document (title, nodes, edges) as JSON. Call this before editing an existing diagram.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => {
      const read = readForChat(target);
      return read.ok ? read.doc : JSON.stringify({ ok: false, error: read.error });
    },
  });

  const applyOps = betaTool({
    name: "apply_ops",
    description:
      "Apply a batch of edit operations to the diagram. Each op is one of: " +
      "add_node {node:{id?,label,shape?,color?,x,y,width?,height?}}, " +
      "update_node {id,set:{...}}, delete_node {id}, " +
      "add_edge {edge:{id?,source,target,label?,variant?,arrow?}}, " +
      "update_edge {id,set:{...}}, delete_edge {id}, " +
      "add_message {message:{id?,from,to,y,label?,variant?,markerEnd?}} (horizontal sequence " +
      "message between lifeline nodes; self-message when from==to; from/to may be a point " +
      "{x} instead of an id for a found/lost message), " +
      "add_activation {lifeline,y0,y1} (activation bar, y relative to the lifeline top), " +
      "set_title {title}, group {ids,id?} (bind shapes so the user selects and moves them together in the app; moving one over the API moves only that shape), ungroup {id}, clear {}. " +
      "Returns the number of applied ops and any errors.",
    inputSchema: {
      type: "object",
      properties: {
        ops: {
          type: "array",
          description: "Edit operations, each with an 'op' discriminator field",
          items: { type: "object" },
        },
      },
      required: ["ops"],
    },
    run: (input) => {
      const ops = (input as { ops: AgentOp[] }).ops ?? [];
      const result = applyForChat(target, ops);
      callbacks.onActivity(describeApply(result));
      return JSON.stringify({ applied: result.applied, errors: result.errors });
    },
  });

  const viewImage = betaTool({
    name: "view_image",
    description:
      "Look at the picture an image node holds. Reading the diagram, an image node's src is a placeholder; call this with the node's id to see the picture itself.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The image node's id" } },
      required: ["id"],
      additionalProperties: false,
    },
    run: (input) => viewImageResult(target, (input as { id: string }).id),
  });

  const runner = client.beta.messages.toolRunner({
    model,
    max_tokens: 16000,
    system: apiSystemPrompt(),
    tools: [readDiagram, applyOps, viewImage],
    messages: [
      ...historyToParams(history),
      { role: "user", content: cachedContent(anthropicContent(userMessage, attachments)) },
    ],
    max_iterations: 20,
  });

  let sawText = false;
  for await (const message of runner) {
    // the user left the diagram: say nothing more, the chat reports the stop
    if (target.stopped) return;
    for (const block of message.content) {
      if (block.type === "text" && block.text.trim()) {
        sawText = true;
        callbacks.onText(block.text);
      }
    }
    if (message.stop_reason === "refusal") {
      callbacks.onText("The request was declined by the model's safety system.");
      return;
    }
  }
  if (!sawText) {
    callbacks.onText("Done.");
  }
};
