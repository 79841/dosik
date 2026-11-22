import type { DiagramState } from "../../shared/lib/store/state";
import { tallyErrors } from "../../shared/lib/store/agentOps";
import { isDiagramDocShape, isMultiPage } from "../../shared/lib/store/document";
import type { DiagramDoc } from "../../shared/lib/types";

/**
 * The headless CLI's decisions, without touching the filesystem (#64).
 *
 * Scope, settled from the issue's open questions:
 * 1. **Data layer only.** PNG is rendered from a live `.react-flow__viewport`
 *    by `html-to-image`; there is no headless path that does not keep a hidden
 *    window (not headless, and dead on a display-less CI). Markdown, Mermaid
 *    and the document itself (`.dosik`) are pure data and come along. (PPTX did too until the
 *    export was removed, #192.)
 *    SVG joined them in #148: it is drawn from the document with the canvas's
 *    own shape components and edge layout (`vectorSvg`), so it is not the
 *    second renderer this decision ruled out — there is no second copy of the
 *    geometry to drift.
 * 2. **Batch, not a server.** Read → apply → write → exit. Holding the bridge
 *    open without a window is a different product (#63 covers the live case).
 * 3. **Node, not a Tauri subcommand.** The data layer is TypeScript; a Node
 *    entry point reuses `applyOps` and the exporters as they are.
 */
/**
 * `dosik` is the document as the app saves it; `dosik.json` is what it was
 * saved as before — still written where a caller asks for it, so a script
 * that edits an older file in place keeps working.
 */
export const HEADLESS_FORMATS = ["md", "mmd", "dosik", "dosik.json", "svg"] as const;
export type HeadlessFormat = (typeof HEADLESS_FORMATS)[number];

/** formats that exist in the app but cannot leave a window */
export const WINDOWED_FORMATS = ["png"] as const;

export interface HeadlessArgs {
  /** the `.dosik` (or older `.dosik.json`) to start from; without it the document starts empty */
  in?: string;
  /** JSON file of bridge ops to apply, `{"ops":[…]}` or `[…]` */
  ops?: string;
  /** where to write the resulting document */
  out?: string;
  /** where to write an export; the format comes from the extension */
  export?: string;
  /**
   * where to write a JSON summary of the run (#149). The stderr lines are for
   * people; a program driving this CLI — the MCP server's file mode — reads
   * this instead of scraping them.
   */
  report?: string;
  /** colours for an SVG export — `light` (default), `dark`, or `auto`: following the page it is shown on (#202) */
  theme?: "light" | "dark" | "auto";
  /** an SVG's size: `fixed` pixels (default, for files) or `fit` — 100% of its container, for a chat */
  size?: "fixed" | "fit";
  /** an SVG's backdrop: the `canvas` colour (default) or `none` — transparent, on a chat's own background (#202) */
  background?: "canvas" | "none";
}

/** the summary `--report` writes: the bridge's response shape, plus whether anything was written */
export interface RunReport {
  ok: boolean;
  applied: number;
  errors: string[];
  written: boolean;
  /** what an SVG export drew — present only for one (#202) */
  view?: ViewSummary;
}

/**
 * What an SVG export drew, said by the run that drew it (#202). The MCP
 * server's chat view reports it to the model. A diagram is one canvas, so
 * there is no page to name (#229 D17).
 */
export interface ViewSummary {
  title: string;
  shapes: number;
  connectors: number;
}

/**
 * The report a run writes: `runReport`, plus what an SVG export drew. Only an
 * SVG export — the other formats draw no picture to speak of.
 */
export const finalReport = (
  result: { applied: number; errors: string[] } | null,
  written: boolean,
  args: Pick<HeadlessArgs, "export">,
  state: Parameters<typeof viewSummary>[0],
): RunReport => {
  const report = runReport(result, written);
  if (args.export && formatFor(args.export) === "svg") report.view = viewSummary(state);
  return report;
};

export const viewSummary = (
  state: Pick<DiagramState, "title" | "nodes" | "edges">,
): ViewSummary => ({
  title: state.title,
  shapes: state.nodes.length,
  connectors: state.edges.length,
});

export const runReport = (
  result: { applied: number; errors: string[] } | null,
  written: boolean,
  /** the ops applied but the file could not be written — that is a failure too (#151) */
  writeError?: string,
): RunReport => {
  const errors = [
    ...(result?.errors ?? []),
    ...(writeError ? [`write failed: ${writeError}`] : []),
  ];
  return { ok: errors.length === 0, applied: result?.applied ?? 0, errors, written };
};

/**
 * The line a run prints after applying its ops: applied, failed, and — when
 * an op stopped the batch (a removed page op, `new_diagram`) — how many after
 * it were left. That note is no failure of its own (#229 D15).
 */
export const applySummary = (result: { applied: number; errors: string[] }): string => {
  const { failed, skipped } = tallyErrors(result.errors);
  return (
    `· ${result.applied} applied` +
    (failed ? `, ${failed} failed` : "") +
    (skipped ? `, ${skipped} skipped after it` : "")
  );
};

export class HeadlessError extends Error {}

const FLAGS = ["in", "ops", "out", "export", "report", "theme", "size", "background"] as const;

/**
 * The format a path asks for. The windowed ones get their own message: telling
 * someone "unknown format: png" when the app exports PNG every day is a worse
 * answer than saying why it cannot happen here.
 */
export const formatFor = (path: string): HeadlessFormat => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".dosik.json")) return "dosik.json";
  const ext = lower.slice(lower.lastIndexOf(".") + 1);
  if ((WINDOWED_FORMATS as readonly string[]).includes(ext)) {
    throw new HeadlessError(
      `${ext.toUpperCase()} can't be exported headless — it captures the rendered canvas, so it needs a window. Available: ${HEADLESS_FORMATS.join(", ")}`,
    );
  }
  if ((HEADLESS_FORMATS as readonly string[]).includes(ext)) return ext as HeadlessFormat;
  throw new HeadlessError(`unknown format: .${ext} (available: ${HEADLESS_FORMATS.join(", ")})`);
};

export const parseArgs = (argv: string[]): HeadlessArgs => {
  const args: HeadlessArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith("--")) {
      throw new HeadlessError(`unknown argument: ${token}`);
    }
    const name = token.slice(2) as (typeof FLAGS)[number];
    if (!FLAGS.includes(name)) {
      throw new HeadlessError(
        `unknown option: ${token} (available: ${FLAGS.map((f) => `--${f}`).join(" ")})`,
      );
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new HeadlessError(`--${name} needs a value`);
    }
    if (name === "theme" && value !== "light" && value !== "dark" && value !== "auto") {
      throw new HeadlessError(`--theme must be auto, light or dark (got: ${value})`);
    }
    if (name === "size" && value !== "fixed" && value !== "fit") {
      throw new HeadlessError(`--size must be fixed or fit (got: ${value})`);
    }
    if (name === "background" && value !== "canvas" && value !== "none") {
      throw new HeadlessError(`--background must be canvas or none (got: ${value})`);
    }
    (args as Record<string, string>)[name] = value;
    i += 1;
  }
  if (!args.out && !args.export) {
    throw new HeadlessError("--out or --export is required — there is nowhere to put the result");
  }
  // colour and size only mean something to an SVG; accepting them silently on
  // a Markdown export would let a caller believe they did something (#152)
  const svgTarget = [args.out, args.export].some((p) => p?.toLowerCase().endsWith(".svg"));
  if ((args.theme || args.size || args.background) && !svgTarget) {
    throw new HeadlessError(
      "--theme·--size·--background apply only to SVG — --out or --export must be an .svg",
    );
  }
  // formats are checked before anything is written: `--out` succeeding and then
  // `--export` refusing would leave half a run on disk
  if (args.out) formatFor(args.out);
  if (args.export) formatFor(args.export);
  return args;
};

/** Reads an ops payload in either of the two shapes the bridge accepts. */
export const parseOps = (raw: string): unknown[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new HeadlessError(
      `can't read the ops JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
  const ops = Array.isArray(parsed) ? parsed : (parsed as { ops?: unknown })?.ops;
  if (!Array.isArray(ops)) {
    throw new HeadlessError('ops must be {"ops":[…]} or […]');
  }
  return ops;
};

export const parseDoc = (raw: string, path: string): DiagramDoc => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new HeadlessError(
      `${path}: can't read JSON — ${error instanceof Error ? error.message : error}`,
    );
  }
  // a document with pages was never shipped: refused, not migrated (#229 D2)
  if (isMultiPage(parsed)) {
    throw new HeadlessError(
      `${path}: multi-page documents (pages) are not supported — only single-canvas documents (nodes·edges) open`,
    );
  }
  if (!isDiagramDocShape(parsed)) {
    throw new HeadlessError(`${path}: not a Dosik diagram — nodes and edges arrays are required`);
  }
  return parsed;
};
