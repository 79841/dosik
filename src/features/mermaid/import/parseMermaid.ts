import { firstMeaningfulLine } from "../mermaidSource";
import { loadMermaid } from "../renderMermaid";
import { type ClassDb, fromClass } from "./fromClass";
import { type ErDb, fromEr } from "./fromEr";
import { type FlowDb, fromFlowchart } from "./fromFlowchart";
import { fromSequence, type SeqDb } from "./fromSequence";
import { type ImportKind, type ImportPlan, MermaidImportError } from "./plan";

/** the diagram keywords the canvas draws (#200 spec) */
const SUPPORTED = /^(flowchart|graph|sequenceDiagram|classDiagram(-v2)?|erDiagram)(\s|;|$)/;

/** Mermaid's own name for each diagram it parsed, as ours */
const KINDS: Record<string, ImportKind> = {
  "flowchart-v2": "flowchart",
  flowchart: "flowchart",
  "flowchart-elk": "flowchart",
  sequence: "sequence",
  classDiagram: "class",
  class: "class",
  er: "er",
};

const UNSUPPORTED_HINT = "only flowchart, sequence, class and ER diagrams";

const unsupported = (name: string) =>
  new MermaidImportError(`Can't draw ${name} from Mermaid — ${UNSUPPORTED_HINT}`);

/** Mermaid's parse errors run to several lines (the source with a caret); the first one says it */
const firstLine = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .split("\n")[0]!
    .replace(/:\s*$/, "")
    .trim();

/**
 * Mermaid source as an import plan (#200 D1): mermaid.js parses it — the
 * engine that draws it, so whatever it draws, this reads — and each kind's
 * db becomes ops. A kind the canvas has no shapes for is refused by name
 * before parsing, so `pie` with a typo still says "can't draw pie".
 *
 * The db methods are mermaid 11's; the tests parse with the real library so
 * an upgrade that moves them fails there, not on a user's paste.
 */
export const parseMermaid = async (code: string): Promise<ImportPlan> => {
  const head = firstMeaningfulLine(code) ?? "";
  if (!SUPPORTED.test(head)) throw unsupported(head.split(/[\s;]/)[0] || "this");
  const mermaid = await loadMermaid();
  // parsing needs only these; the preview sets its theme and font again on
  // every render (`renderMermaid`), so dropping them from the shared config here is harmless
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  let diagram: { type: string; db: unknown };
  try {
    diagram = await mermaid.mermaidAPI.getDiagramFromText(code);
  } catch (error) {
    throw new MermaidImportError(`Mermaid code has an error: ${firstLine(error)}`);
  }
  const kind = KINDS[diagram.type];
  if (!kind) throw unsupported(diagram.type);
  const plan =
    kind === "flowchart"
      ? fromFlowchart(diagram.db as FlowDb, code)
      : kind === "sequence"
        ? fromSequence(diagram.db as SeqDb)
        : kind === "class"
          ? fromClass(diagram.db as ClassDb)
          : fromEr(diagram.db as ErDb);
  return { kind, ...plan, omitted: [...new Set(plan.omitted)] };
};
