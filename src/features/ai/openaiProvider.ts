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
import { type OpenAiContentPart, openAiContent, replayedFiles } from "./turnContent";

interface TurnCallbacks {
  onText: (text: string) => void;
  onActivity: (text: string) => void;
}

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
/** tool-call rounds per turn; the Anthropic path uses the same bound */
export const MAX_TOOL_ROUNDS = 20;

/** Responses API input items — only the shapes this loop produces */
export type ResponsesInputItem =
  | { role: "user" | "assistant"; content: string | OpenAiContentPart[] }
  | { type: "function_call_output"; call_id: string; output: string };

interface FunctionCallItem {
  type: "function_call";
  name: string;
  arguments: string;
  call_id: string;
}
interface MessageItem {
  type: "message";
  content: { type: string; text?: string }[];
}
type OutputItem = FunctionCallItem | MessageItem | { type: string };

/**
 * Rebuilds the conversation from stored chat messages — the same rule as the
 * Anthropic path (`historyToParams`): user turns replay their `payload` (the
 * selection block, #55) and their files (#275), assistant turns their text,
 * nothing else.
 */
export const historyToInput = (history: ChatMessage[]): ResponsesInputItem[] => {
  const files = replayedFiles(history);
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) =>
      m.role === "user"
        ? { role: "user" as const, content: openAiContent(m.payload ?? m.text, files.get(m.id)) }
        : { role: "assistant" as const, content: m.text },
    );
};

/** the two tools, same names/descriptions as the Anthropic path so the system prompt fits both */
export const OPENAI_TOOLS = [
  {
    type: "function",
    name: "read_diagram",
    description:
      "Read the current diagram document (title, nodes, edges) as JSON. Call this before editing an existing diagram.",
    // no strict mode on either tool: it buys nothing for a no-argument call, and
    // apply_ops' free-form `items` is not strict-compatible anyway
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
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
    parameters: {
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
  },
  {
    type: "function",
    name: "view_image",
    description:
      "Look at the picture an image node holds. Reading the diagram, an image node's src is a placeholder; call this with the node's id and the picture follows in the next message.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "The image node's id" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

/**
 * `view_image`: a function's output is text only, so the picture follows the
 * outputs as a user item — `null` when there is none to show (the output says why).
 */
export const viewImage = (
  rawArgs: string,
  target: ChatTarget,
): { output: string; picture: ResponsesInputItem | null } => {
  let id = "";
  try {
    id = String((JSON.parse(rawArgs || "{}") as { id?: unknown }).id ?? "");
  } catch {
    return {
      output: JSON.stringify({ ok: false, error: "view_image: arguments were not valid JSON" }),
      picture: null,
    };
  }
  const found = pictureForChat(target, id);
  if (!found.ok)
    return { output: JSON.stringify({ ok: false, error: found.error }), picture: null };
  return {
    output: JSON.stringify({ ok: true, note: `the picture of image node ${id} follows` }),
    picture: {
      role: "user",
      content: [
        { type: "input_text", text: `The picture of image node ${id} (from view_image):` },
        {
          type: "input_image",
          image_url: `data:${found.picture.mime};base64,${found.picture.base64}`,
        },
      ],
    },
  };
};

const runTool = (
  name: string,
  rawArgs: string,
  callbacks: TurnCallbacks,
  target: ChatTarget,
): string => {
  if (name === "read_diagram") {
    const read = readForChat(target);
    return read.ok ? read.doc : JSON.stringify({ ok: false, error: read.error });
  }
  if (name === "apply_ops") {
    let ops: AgentOp[] = [];
    try {
      ops = (JSON.parse(rawArgs || "{}") as { ops?: AgentOp[] }).ops ?? [];
    } catch {
      return JSON.stringify({ applied: 0, errors: ["apply_ops: arguments were not valid JSON"] });
    }
    const result = applyForChat(target, ops);
    callbacks.onActivity(describeApply(result));
    return JSON.stringify({ applied: result.applied, errors: result.errors });
  }
  return JSON.stringify({ error: `unknown tool: ${name}` });
};

const describeNetworkFailure = (error: unknown): string =>
  `Could not reach the OpenAI API (${error instanceof Error ? error.message : String(error)}) — check your connection.`;

const describeFailure = async (response: Response): Promise<string> => {
  let detail = "";
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? "";
  } catch {
    // no JSON body — the status line is all there is
  }
  if (response.status === 401) return "Invalid OpenAI API key — check it in settings.";
  if (response.status === 429)
    return `OpenAI rate limit or quota reached${detail ? `: ${detail}` : "."}`;
  return `OpenAI API error ${response.status}${detail ? `: ${detail}` : ""}`;
};

/**
 * OpenAI API provider (#119): a tool-use loop over the Responses API where
 * GPT reads and edits the diagram store directly, marked as agent edits so
 * the canvas highlights them. Same tools and same bounds as the Anthropic path,
 * and the same target: the diagram the message was sent from (#167).
 */
export const sendWithOpenAi = async (
  apiKey: string,
  model: string,
  history: ChatMessage[],
  userMessage: string,
  callbacks: TurnCallbacks,
  fetchImpl: typeof fetch = fetch,
  target: ChatTarget = captureChatTarget(),
  /** this turn's files — pictures and PDFs go as input parts */
  attachments: ChatAttachment[] = [],
): Promise<void> => {
  // the first request carries the conversation; after that the server holds
  // the transcript (`previous_response_id`) and each request sends only the
  // tool outputs produced in the round before — never an output twice
  let input: ResponsesInputItem[] = [
    ...historyToInput(history),
    { role: "user", content: openAiContent(userMessage, attachments) },
  ];
  let previousResponseId: string | null = null;
  let sawText = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response: Response;
    try {
      response = await fetchImpl(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          instructions: apiSystemPrompt(),
          tools: OPENAI_TOOLS,
          tool_choice: "auto",
          input,
          ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        }),
      });
    } catch (error) {
      throw new Error(describeNetworkFailure(error));
    }
    if (!response.ok) {
      const message = await describeFailure(response);
      // the status rides along on the first request only: that one carries
      // the turn's files, so its 400 or 413 may be them (`chatActions`); a
      // later round sends tool outputs alone
      throw previousResponseId === null
        ? Object.assign(new Error(message), { status: response.status })
        : new Error(message);
    }
    let body: { id: string; status?: string; output?: OutputItem[] };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // a 200 that is not JSON (a proxy's HTML page, say) must read as one line, not a SyntaxError
      throw new Error("OpenAI returned an unreadable response — check your network or proxy.");
    }
    previousResponseId = body.id;

    const calls: FunctionCallItem[] = [];
    for (const item of body.output ?? []) {
      if (item.type === "message") {
        const parts = (item as MessageItem).content;
        const text = parts
          .filter((c) => c.type === "output_text" && c.text)
          .map((c) => c.text)
          .join("");
        // a refusal is an answer too — the user must not read "Done."
        const refusal = parts
          .filter((c) => c.type === "refusal")
          .map(
            (c) => (c as { refusal?: string }).refusal ?? "The request was declined by the model.",
          )
          .join("");
        const shown = [text.trim(), refusal.trim()].filter(Boolean).join("\n");
        if (shown) {
          sawText = true;
          callbacks.onText(shown);
        }
      } else if (item.type === "function_call") {
        calls.push(item as FunctionCallItem);
      }
    }
    if (body.status === "incomplete") {
      sawText = true;
      callbacks.onText("(The response was cut off — the model ran out of room.)");
      break;
    }
    if (calls.length === 0) break;
    const pictures: ResponsesInputItem[] = [];
    input = calls.map((call) => {
      if (call.name === "view_image") {
        const seen = viewImage(call.arguments, target);
        if (seen.picture) pictures.push(seen.picture);
        return { type: "function_call_output", call_id: call.call_id, output: seen.output };
      }
      return {
        type: "function_call_output",
        call_id: call.call_id,
        output: runTool(call.name, call.arguments, callbacks, target),
      };
    });
    input.push(...pictures);
    // the user left the diagram: no further round, the chat reports the stop
    if (target.stopped) return;
  }
  if (!sawText) callbacks.onText("Done.");
};
