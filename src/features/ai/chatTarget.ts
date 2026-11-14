import { nanoid } from "nanoid";

import { elideImages } from "../../shared/lib/imageData";
import { useDiagramStore } from "../../shared/lib/store";
import { tallyErrors } from "../../shared/lib/store/agentOps";
import type { AgentOp } from "../../shared/lib/types";

/**
 * Where one chat turn draws (#167, #229 D16): the diagram open when the user
 * sent the message — not whatever is on screen when an edit arrives. A
 * diagram is one canvas, so that is all there is to it. Leaving the diagram
 * (Home, another diagram) stops the turn — nothing is drawn anywhere else,
 * and no new diagram is made for it. External agents (MCP, `POST /api/ops`)
 * never come through here; their rules are the bridge's.
 */
export interface ChatTarget {
  /** `docSession` when the turn started — the diagram it belongs to */
  readonly session: number;
  /** why the turn stopped — shown in the chat once the turn ends */
  stopped: string | null;
}

export const captureChatTarget = (): ChatTarget => ({
  session: useDiagramStore.getState().docSession,
  stopped: null,
});

/**
 * What the model is told when it may not go on. Only a CLI acts on it (it
 * reads the 409 body and replies); the API paths end their loop right after
 * the tool call, so there the chat's own stop line is what the user reads.
 */
export const STOPPED_FOR_MODEL =
  "The user left the diagram this conversation was editing, so nothing was applied. Stop editing and tell the user in one short sentence that you stopped.";

/** `null` while the turn may still draw; otherwise why it may not (and the turn is marked stopped) */
const blocked = (target: ChatTarget): string | null => {
  if (target.stopped) return target.stopped;
  if (useDiagramStore.getState().docSession !== target.session) {
    target.stopped = "Stopped drawing — you left the diagram this chat was working on.";
  }
  return target.stopped;
};

export type ChatRead = { ok: true; doc: string } | { ok: false; error: string };

/**
 * The diagram as the model reads it: the whole document. Pictures stand in
 * as placeholders, since a few screenshots are megabytes of base64 (#155).
 */
export const readForChat = (target: ChatTarget): ChatRead => {
  if (blocked(target)) return { ok: false, error: STOPPED_FOR_MODEL };
  const doc = useDiagramStore.getState().toDoc();
  return { ok: true, doc: JSON.stringify(elideImages(doc)) };
};

export type ChatApply =
  | { ok: true; applied: number; errors: string[] }
  | { ok: false; applied: 0; errors: [string] };

/**
 * Applies `ops` to the turn's diagram — the live one: while the session is
 * the same, that diagram is the one on screen.
 */
export const applyForChat = (target: ChatTarget, ops: AgentOp[]): ChatApply => {
  if (blocked(target)) return { ok: false, applied: 0, errors: [STOPPED_FOR_MODEL] };
  const result = useDiagramStore.getState().applyOps(ops, true);
  return { ok: true, applied: result.applied, errors: result.errors };
};

/** the chat's activity line for one apply_ops call */
export const describeApply = (result: ChatApply): string => {
  if (!result.ok) return "Not applied — the diagram is no longer open";
  // a stop's "the N ops after it were not applied" line is no failure of its own
  const { failed, skipped } = tallyErrors(result.errors);
  return (
    `Edited diagram — ${result.applied} operation${result.applied === 1 ? "" : "s"} applied` +
    (failed > 0 ? `, ${failed} failed` : "") +
    (skipped > 0 ? `, ${skipped} not applied after it` : "")
  );
};

// ------------------------------------------------------------ CLI turns

/**
 * A subscription CLI edits over HTTP, so its turn is reached by a token in
 * the URL it is given (`/api/chat/<token>/…`). The token lives as long as the
 * turn: a request after it — a resumed CLI session replaying an old URL —
 * finds nothing.
 */
const turns = new Map<string, ChatTarget>();

export const openChatTurn = (target: ChatTarget): string => {
  // letters, digits, - and _ — the bridge accepts [A-Za-z0-9-] only, so no _
  const token = nanoid(24).replace(/_/g, "-");
  turns.set(token, target);
  return token;
};

export const closeChatTurn = (token: string): void => {
  turns.delete(token);
};

export const chatTurn = (token: string): ChatTarget | undefined => turns.get(token);
