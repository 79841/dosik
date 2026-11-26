import { invoke } from "@tauri-apps/api/core";

import type { ChatAttachment } from "./attachments";
import type { NodePicture } from "./chatTarget";
import { cliFilesNote } from "./turnContent";

/** what a CLI turn gets: the note for its prompt, and Codex's pictures */
export interface StagedTurn {
  /** where the files are, for the prompt — empty when there are none */
  note: string;
  /** the pictures among the message's files, for Codex's `--image` */
  images: string[];
  /** whether the conversation's folder now holds anything to read */
  any: boolean;
}

const EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * Writes a message's files, and the pictures of the diagram's image nodes,
 * into the conversation's folder (`chat_files.rs`) — a subscription CLI reads
 * files, not bytes. `message` names the message's own folder.
 */
export const stageForCli = async (
  conversation: string,
  message: string,
  attachments: ChatAttachment[],
  pictures: NodePicture[],
): Promise<StagedTurn> => {
  const stage = async (
    folder: string,
    files: { name: string; base64: string }[],
    replace = false,
  ) =>
    (await invoke<string[] | null>("stage_chat_files", { conversation, folder, files, replace })) ??
    [];
  const filePaths =
    attachments.length > 0
      ? await stage(
          message,
          attachments.map((a) => ({ name: a.name, base64: a.base64 })),
        )
      : [];
  // the diagram's pictures are context, not the message: if they cannot be
  // written (a full disk), the turn goes on without their list
  // every turn, even with no pictures left: the folder then holds the
  // diagram as it is now, never a deleted node's picture
  const picturePaths = await stage(
    "diagram-images",
    pictures.map((p) => ({
      name: `${p.node}.${EXTENSION[p.mime] ?? "png"}`,
      base64: p.base64,
    })),
    true,
  ).catch(() => [] as string[]);
  const listed = picturePaths.length > 0 ? pictures : [];
  return {
    note: cliFilesNote(
      attachments.map((a, i) => ({ name: a.name, path: filePaths[i] ?? "" })),
      listed.map((p, i) => ({ node: p.node, path: picturePaths[i] ?? "" })),
    ),
    images: attachments.flatMap((a, i) =>
      a.kind === "image" && filePaths[i] ? [filePaths[i]] : [],
    ),
    any: filePaths.length + picturePaths.length > 0,
  };
};
