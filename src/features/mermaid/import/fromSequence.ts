import { SELF_MESSAGE_GAP } from "../../../shared/lib/edgeUtils";
import { DEFAULT_NODE_SIZE, LIFELINE_HEADER_H } from "../../../shared/lib/palette";
import {
  type AgentOp,
  type EdgeVariant,
  type FragmentKind,
  MAX_FRAGMENT_BRANCHES,
  MIN_FRAGMENT_BRANCHES,
  type MarkerShape,
} from "../../../shared/lib/types";
import { decodeLabel } from "./mermaidText";
import type { ImportPlan } from "./plan";

/** the parts of Mermaid's sequence db this reads (mermaid 11) */
interface SeqActor {
  name: string;
  description?: string;
}
interface SeqMessage {
  from?: string;
  to?: string;
  type?: number;
  message?: unknown;
}
export interface SeqDb {
  getActors(): Map<string, SeqActor>;
  getActorKeys?(): string[];
  getMessages(): SeqMessage[];
  getDestroyedActors?(): Map<string, number>;
  getBoxes?(): unknown[];
}

/** Mermaid's `LINETYPE` — the numbers its sequence db tags each entry with */
const T = {
  SOLID: 0,
  DOTTED: 1,
  NOTE: 2,
  SOLID_CROSS: 3,
  DOTTED_CROSS: 4,
  SOLID_OPEN: 5,
  DOTTED_OPEN: 6,
  LOOP_START: 10,
  LOOP_END: 11,
  ALT_START: 12,
  ALT_ELSE: 13,
  ALT_END: 14,
  OPT_START: 15,
  OPT_END: 16,
  ACTIVE_START: 17,
  ACTIVE_END: 18,
  PAR_START: 19,
  PAR_AND: 20,
  PAR_END: 21,
  RECT_START: 22,
  RECT_END: 23,
  SOLID_POINT: 24,
  DOTTED_POINT: 25,
  AUTONUMBER: 26,
  CRITICAL_START: 27,
  CRITICAL_OPTION: 28,
  CRITICAL_END: 29,
  BREAK_START: 30,
  BREAK_END: 31,
  PAR_OVER_START: 32,
  BIDIRECTIONAL_SOLID: 33,
  BIDIRECTIONAL_DOTTED: 34,
} as const;

/** blocks the canvas draws as a fragment, by the entry that opens them */
const FRAGMENT_START: Record<number, FragmentKind> = {
  [T.LOOP_START]: "loop",
  [T.ALT_START]: "alt",
  [T.OPT_START]: "opt",
  [T.PAR_START]: "par",
  [T.PAR_OVER_START]: "par",
  [T.CRITICAL_START]: "critical",
};
/** blocks with no canvas form: their messages are kept, the block is not */
const PLAIN_START: Record<number, string> = {
  [T.BREAK_START]: "break blocks",
  [T.RECT_START]: "background highlights",
};
const BLOCK_END = new Set<number>([
  T.LOOP_END,
  T.ALT_END,
  T.OPT_END,
  T.PAR_END,
  T.CRITICAL_END,
  T.BREAK_END,
  T.RECT_END,
]);
const SECTION = new Set<number>([T.ALT_ELSE, T.PAR_AND, T.CRITICAL_OPTION]);

/** line and ends of each message arrow — the reply convention is dashed + open (#25) */
const ARROWS: Record<number, { variant: EdgeVariant; end: MarkerShape; both?: true }> = {
  [T.SOLID]: { variant: "solid", end: "arrow" },
  [T.DOTTED]: { variant: "dashed", end: "open" },
  [T.SOLID_CROSS]: { variant: "solid", end: "arrow" },
  [T.DOTTED_CROSS]: { variant: "dashed", end: "open" },
  [T.SOLID_OPEN]: { variant: "solid", end: "none" },
  [T.DOTTED_OPEN]: { variant: "dashed", end: "none" },
  [T.SOLID_POINT]: { variant: "solid", end: "open" },
  [T.DOTTED_POINT]: { variant: "dashed", end: "open" },
  [T.BIDIRECTIONAL_SOLID]: { variant: "solid", end: "arrow", both: true },
  [T.BIDIRECTIONAL_DOTTED]: { variant: "dashed", end: "arrow", both: true },
};

/** spacing — the same the agent guide asks for (~220 between lifelines, ~50 between messages) */
export const COLUMN = 220;
export const ROW = 50;
/** a self-message loops below its y; the next message starts past the loop */
const SELF_EXTRA = SELF_MESSAGE_GAP;
/** room a fragment takes above its first message (its tab) and below its last */
const FRAG_HEAD = 40;
const FRAG_FOOT = 16;
/** a fragment reaches this far past the outermost lifeline it covers, less for each level inside */
const FRAG_REACH = 90;
const FRAG_INSET = 12;
/** the first message sits this far under the lifeline's header */
export const FIRST_GAP = 40;
/** an activation bar starts this far above the message that opens it and ends this far below its last */
export const ACTIVATION_LEAD = 6;
export const ACTIVATION_TAIL = 14;
/** lifelines are added at the default size — their centres follow it */
const LIFELINE_W = DEFAULT_NODE_SIZE.lifeline.width;

type Item =
  | { t: "msg"; index: number; from: string; to: string; type: number; text: string }
  | { t: "act"; actor: string; on: boolean }
  | { t: "frag"; kind: FragmentKind; guards: string[]; sections: Item[][] }
  | { t: "plain"; items: Item[] };

const text = (message: unknown): string =>
  typeof message === "string" ? decodeLabel(message) : "";

/** the db's flat entry list as nested blocks */
const toTree = (messages: SeqMessage[], omitted: string[]): Item[] => {
  const root: Item[] = [];
  const stack: { items: Item[]; frag?: Extract<Item, { t: "frag" }> }[] = [{ items: root }];
  const top = () => stack[stack.length - 1]!;
  messages.forEach((m, index) => {
    const type = m.type ?? T.SOLID;
    const kind = FRAGMENT_START[type];
    if (kind) {
      const section: Item[] = [];
      const frag: Item = { t: "frag", kind, guards: [text(m.message)], sections: [section] };
      top().items.push(frag);
      stack.push({ items: section, frag });
      return;
    }
    if (PLAIN_START[type]) {
      omitted.push(PLAIN_START[type]!);
      const plain: Item = { t: "plain", items: [] };
      top().items.push(plain);
      stack.push({ items: plain.items });
      return;
    }
    if (SECTION.has(type)) {
      const frag = top().frag;
      if (!frag) return;
      const section: Item[] = [];
      frag.sections.push(section);
      frag.guards.push(text(m.message));
      stack[stack.length - 1] = { items: section, frag };
      return;
    }
    if (BLOCK_END.has(type)) {
      if (stack.length > 1) {
        const frag = stack.pop()!.frag;
        if (frag) settleSections(frag, omitted);
      }
      return;
    }
    if (type === T.ACTIVE_START || type === T.ACTIVE_END) {
      if (m.from) top().items.push({ t: "act", actor: m.from, on: type === T.ACTIVE_START });
      return;
    }
    if (type === T.NOTE) {
      omitted.push("notes");
      return;
    }
    if (type === T.AUTONUMBER) {
      omitted.push("autonumber");
      return;
    }
    if (!m.from || !m.to) return;
    if (!(type in ARROWS)) omitted.push("half arrows");
    if (type === T.SOLID_CROSS || type === T.DOTTED_CROSS) omitted.push("x message ends");
    top().items.push({ t: "msg", index, from: m.from, to: m.to, type, text: text(m.message) });
  });
  return root;
};

/**
 * The canvas splits only an alt, into at most five equal branches: the
 * sections past the fifth join the fifth, so the dividers fall where the
 * messages change branch. A par or critical has no dividers at all — its
 * sections stack in one frame, which is said in the toast.
 */
const settleSections = (frag: Extract<Item, { t: "frag" }>, omitted: string[]): void => {
  if (frag.kind === "alt" && frag.sections.length > MAX_FRAGMENT_BRANCHES) {
    const kept = frag.sections.slice(0, MAX_FRAGMENT_BRANCHES - 1);
    frag.sections = [...kept, frag.sections.slice(MAX_FRAGMENT_BRANCHES - 1).flat()];
  } else if (frag.kind !== "alt" && frag.sections.length > 1) {
    omitted.push("dividers in par and critical blocks");
  }
};

const rowHeight = (item: Extract<Item, { t: "msg" }>): number =>
  item.from === item.to ? ROW + SELF_EXTRA : ROW;

/** how tall a run of items is laid out */
const heightOf = (items: Item[]): number =>
  items.reduce((sum, item) => {
    if (item.t === "msg") return sum + rowHeight(item);
    if (item.t === "plain") return sum + heightOf(item.items);
    if (item.t === "frag") return sum + fragHeight(item);
    return sum;
  }, 0);

/** a fragment's branches are equal (the canvas splits it evenly), so each is as tall as the tallest */
const sectionHeight = (frag: Extract<Item, { t: "frag" }>): number =>
  Math.max(ROW, ...frag.sections.map(heightOf));
const branchCount = (frag: Extract<Item, { t: "frag" }>): number =>
  frag.kind === "alt"
    ? Math.min(MAX_FRAGMENT_BRANCHES, Math.max(MIN_FRAGMENT_BRANCHES, frag.sections.length))
    : 1;
/** an alt has at least two branches even when Mermaid gave it one; others stack their sections */
const slots = (frag: Extract<Item, { t: "frag" }>): number =>
  Math.max(frag.sections.length, branchCount(frag));

/**
 * How far one section is from the next. The canvas divides an alt's *whole*
 * height evenly (`FragmentSvg`), so each branch carries its own head room —
 * then divider k sits exactly a head above branch k's first message (#200). Other blocks have one head for the frame and their sections stack.
 */
const sectionStep = (frag: Extract<Item, { t: "frag" }>): number =>
  frag.kind === "alt" ? FRAG_HEAD + sectionHeight(frag) : sectionHeight(frag);
const fragHeight = (frag: Extract<Item, { t: "frag" }>): number =>
  frag.kind === "alt"
    ? sectionStep(frag) * slots(frag)
    : FRAG_HEAD + sectionStep(frag) * slots(frag) + FRAG_FOOT;

/** the lifelines a run of items touches */
const actorsIn = (items: Item[], into = new Set<string>()): Set<string> => {
  for (const item of items) {
    if (item.t === "msg") into.add(item.from).add(item.to);
    else if (item.t === "act") into.add(item.actor);
    else if (item.t === "plain") actorsIn(item.items, into);
    else for (const s of item.sections) actorsIn(s, into);
  }
  return into;
};

export const fromSequence = (db: SeqDb): Omit<ImportPlan, "kind"> => {
  const omitted: string[] = [];
  const ops: AgentOp[] = [];
  if ((db.getBoxes?.() ?? []).length > 0) omitted.push("participant boxes");
  const actors = db.getActors();
  const keys = db.getActorKeys?.() ?? [...actors.keys()];
  const tree = toTree(db.getMessages(), omitted);

  const ids = new Map(keys.map((k, i) => [k, `n${i}`]));
  const centre = new Map(keys.map((k, i) => [k, i * COLUMN + LIFELINE_W / 2]));
  const height = LIFELINE_HEADER_H + FIRST_GAP + heightOf(tree) + ROW;

  keys.forEach((k, i) => {
    const actor = actors.get(k);
    ops.push({
      op: "add_node",
      node: {
        id: ids.get(k)!,
        label: decodeLabel(actor?.description) || k,
        shape: "lifeline",
        x: i * COLUMN,
        y: 0,
        height,
      },
    });
  });

  const messageY = new Map<number, number>();
  const later: AgentOp[] = [];
  const open = new Map<string, number[]>();
  const spans: { actor: string; y0: number; y1: number }[] = [];
  let lastY = LIFELINE_HEADER_H + FIRST_GAP;
  let fragments = 0;

  const place = (items: Item[], y: number, depth: number): number => {
    for (const item of items) {
      if (item.t === "msg") {
        messageY.set(item.index, y);
        lastY = y;
        const arrow = ARROWS[item.type] ?? ARROWS[T.SOLID]!;
        const id = `e${item.index}`;
        ops.push({
          op: "add_message",
          message: {
            id,
            from: ids.get(item.from)!,
            to: ids.get(item.to)!,
            y,
            ...(item.text ? { label: item.text } : {}),
            variant: arrow.variant,
            markerEnd: arrow.end,
          },
        });
        if (arrow.both) later.push({ op: "update_edge", id, set: { markerStart: arrow.end } });
        y += rowHeight(item);
      } else if (item.t === "act") {
        // a bar starts at the message that activated it and ends at the last one before deactivate
        if (item.on) open.set(item.actor, [...(open.get(item.actor) ?? []), lastY]);
        else {
          const y0 = open.get(item.actor)?.pop();
          if (y0 !== undefined) spans.push({ actor: item.actor, y0, y1: lastY });
        }
      } else if (item.t === "plain") {
        y = place(item.items, y, depth);
      } else {
        const top = y;
        const step = sectionStep(item);
        let cursor = top + FRAG_HEAD;
        item.sections.forEach((section) => {
          place(section, cursor, depth + 1);
          cursor += step;
        });
        // a block with no messages (only notes, or empty) spans every lifeline
        const covered = [...actorsIn(item.sections.flat())].map((a) => centre.get(a) ?? 0);
        const xs = covered.length > 0 ? covered : [...centre.values()];
        if (xs.length === 0) {
          y = top + fragHeight(item);
          continue;
        }
        const reach = Math.max(FRAG_INSET, FRAG_REACH - depth * FRAG_INSET);
        const left = Math.min(...xs) - reach;
        const right = Math.max(...xs) + reach;
        const id = `g${fragments++}`;
        const guards = item.guards.filter(Boolean);
        ops.push({
          op: "add_node",
          node: {
            id,
            label: guards.join(" / "),
            shape: "fragment",
            x: left,
            y: top,
            width: right - left,
            height: fragHeight(item),
          },
        });
        later.push({
          op: "update_node",
          id,
          set: {
            fragmentKind: item.kind,
            ...(item.kind === "alt" ? { branches: branchCount(item) } : {}),
          },
        });
        y = top + fragHeight(item);
      }
    }
    return y;
  };
  place(tree, LIFELINE_HEADER_H + FIRST_GAP, 0);
  // an activation never deactivated runs to the last message
  for (const [actor, starts] of open) for (const y0 of starts) spans.push({ actor, y0, y1: lastY });

  for (const { actor, y0, y1 } of spans) {
    const id = ids.get(actor);
    if (!id) continue;
    ops.push({
      op: "add_activation",
      lifeline: id,
      y0: y0 - ACTIVATION_LEAD,
      y1: Math.max(y1, y0) + ACTIVATION_TAIL,
    });
  }
  for (const [actor, index] of db.getDestroyedActors?.() ?? []) {
    const y = messageY.get(index);
    const id = ids.get(actor);
    if (y !== undefined && id) later.push({ op: "update_node", id, set: { destroyY: y } });
  }

  return { ops: [...ops, ...later], omitted, layout: null };
};
