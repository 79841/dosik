import type Anthropic from "@anthropic-ai/sdk";

import type { ChatAttachment } from "./attachments";

/**
 * What one turn's files become on each route (#275):
 * - the API paths send pictures and PDFs as content the model reads, a text
 *   file's words inside the message, and of any other file its name only
 * - the subscription CLIs get every file as a path to read
 */

/** files the API paths cannot send the contents of: kinds they do not read */
export const nameOnly = (attachments: ChatAttachment[]): ChatAttachment[] =>
  attachments.filter((a) => a.kind === "file");

/** text files too long to put inside the message (`TEXT_INLINE_MAX`) */
export const tooLongToInline = (attachments: ChatAttachment[]): ChatAttachment[] =>
  attachments.filter((a) => a.kind === "text" && a.text === undefined);

/** a name inside an attribute, and words that cannot close their own block */
const attr = (name: string): string => name.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const inBlock = (text: string): string => text.replace(/<\/file>/g, "<\\/file>");

const describe = (a: ChatAttachment): string => `${a.name} (${a.mime}, ${a.size} bytes)`;

/**
 * The words the API paths add after the user's text: each text file in a
 * `<file>` block, a line naming each file that went by name only, and one per
 * picture of the diagram that rides along.
 */
export const attachmentText = (attachments: ChatAttachment[]): string => {
  const parts: string[] = [];
  for (const a of attachments) {
    if (a.kind === "text" && a.text !== undefined) {
      parts.push(`<file name="${attr(a.name)}">\n${inBlock(a.text)}\n</file>`);
    } else if (a.kind === "text") {
      parts.push(
        `[Attached text file ${describe(a)} — too long to put in the message; only its name was sent.]`,
      );
    } else if (a.kind === "file") {
      parts.push(
        `[Attached file ${describe(a)} — its contents could not be sent over this connection.]`,
      );
    } else if (a.fromNode) {
      parts.push(`[The picture of image node ${a.fromNode} is attached.]`);
    } else {
      parts.push(`[Attached ${a.kind === "pdf" ? "PDF" : "picture"}: ${a.name}]`);
    }
  }
  return parts.join("\n\n");
};

/** the user's message (with its selection block) and what went with it, as one text */
export const withAttachmentText = (payload: string, attachments: ChatAttachment[]): string => {
  const extra = attachmentText(attachments);
  return extra ? `${payload}\n\n${extra}` : payload;
};

type AnthropicBlock = Anthropic.Beta.BetaContentBlockParam;

/**
 * The turn's user content with a cache mark on its last block: the tool loop
 * sends the whole conversation again each round, and files make it heavy.
 */
export const cachedContent = (content: string | AnthropicBlock[]): AnthropicBlock[] => {
  const blocks: AnthropicBlock[] =
    typeof content === "string" ? [{ type: "text", text: content }] : [...content];
  const last = blocks.at(-1);
  if (last && last.type !== "thinking" && last.type !== "redacted_thinking") {
    blocks[blocks.length - 1] = { ...last, cache_control: { type: "ephemeral" } } as AnthropicBlock;
  }
  return blocks;
};

/**
 * What each earlier message replays of its files: none from a turn the
 * provider refused, and a picture of an image node only from the latest
 * message that carried it — the same node selected for fifteen turns is one
 * picture, not fifteen.
 */
export const replayedFiles = (
  history: { id: string; role: string; attachments?: ChatAttachment[]; filesFailed?: true }[],
): Map<string, ChatAttachment[]> => {
  const seen = new Set<string>();
  const out = new Map<string, ChatAttachment[]>();
  for (const m of [...history].reverse()) {
    if (m.role !== "user" || !m.attachments) continue;
    // a refused turn's files: never again
    if (m.filesFailed) {
      out.set(m.id, []);
      continue;
    }
    out.set(
      m.id,
      m.attachments.filter((a) => {
        if (!a.fromNode) return true;
        if (seen.has(a.fromNode)) return false;
        seen.add(a.fromNode);
        return true;
      }),
    );
  }
  return out;
};

/** a user turn for the Anthropic API: pictures and PDFs first, then the words */
export const anthropicContent = (
  text: string,
  attachments: ChatAttachment[] = [],
): string | AnthropicBlock[] => {
  const blocks: AnthropicBlock[] = [];
  for (const a of attachments) {
    if (a.kind === "image") {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: a.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
          data: a.base64,
        },
      });
    } else if (a.kind === "pdf") {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: a.base64 },
        title: a.name,
      });
    }
  }
  if (blocks.length === 0) return text;
  return [...blocks, { type: "text", text }];
};

export type OpenAiContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; filename: string; file_data: string };

/** a user turn for the OpenAI Responses API: the words, then pictures and PDFs */
export const openAiContent = (
  text: string,
  attachments: ChatAttachment[] = [],
): string | OpenAiContentPart[] => {
  const parts: OpenAiContentPart[] = [];
  for (const a of attachments) {
    if (a.kind === "image") {
      parts.push({ type: "input_image", image_url: `data:${a.mime};base64,${a.base64}` });
    } else if (a.kind === "pdf") {
      parts.push({
        type: "input_file",
        filename: a.name,
        file_data: `data:application/pdf;base64,${a.base64}`,
      });
    }
  }
  if (parts.length === 0) return text;
  return [{ type: "input_text", text }, ...parts];
};

/** the note a CLI turn carries: where this message's files and the diagram's pictures are */
export const cliFilesNote = (
  files: { name: string; path: string }[],
  pictures: { node: string; path: string }[],
): string => {
  const lines: string[] = [];
  if (files.length > 0) {
    lines.push("Files the user attached to this message — read each before you answer:");
    for (const f of files) lines.push(`- ${f.name}: ${f.path}`);
  }
  if (pictures.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      "Pictures of the diagram's image nodes, by node id — read one to see what it shows:",
    );
    for (const p of pictures) lines.push(`- ${p.node}: ${p.path}`);
  }
  return lines.join("\n");
};
