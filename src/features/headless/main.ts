import { readFileSync, writeFileSync } from "node:fs";

import { toMarkdown, toMermaid } from "../export/markdown";
import { renderVectorSvg } from "../export/vectorSvg";
import { useDiagramStore } from "../../shared/lib/store";
import type { DiagramDoc } from "../../shared/lib/types";
import {
  applySummary,
  finalReport,
  formatFor,
  type HeadlessArgs,
  parseArgs,
  parseDoc,
  parseOps,
  runReport,
} from "./cli";
import { writeAtomic } from "./writeAtomic";

const EMPTY: DiagramDoc = { version: 1, title: "Untitled Diagram", nodes: [], edges: [] };

/** Writes the store's diagram — one canvas (#229 D17) — as `path`'s format. */
const exportTo = async (path: string, args: HeadlessArgs): Promise<void> => {
  const store = useDiagramStore.getState();
  const doc = store.toDoc();
  switch (formatFor(path)) {
    case "svg":
      writeAtomic(
        path,
        renderVectorSvg(doc, {
          theme: args.theme,
          responsive: args.size === "fit",
          background: args.background !== "none",
        }),
      );
      return;
    case "md":
      // no "nothing to draw" refusal here, unlike the app's menus
      // (`exportActions.markdownOf`): for a script an empty diagram's Markdown
      // is a valid result, and failing would break an otherwise sound pipeline
      writeAtomic(path, toMarkdown(doc));
      return;
    case "mmd":
      writeAtomic(path, toMermaid(doc));
      return;
    case "dosik.json":
      writeAtomic(path, `${JSON.stringify(doc, null, 2)}\n`);
      return;
  }
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const store = useDiagramStore.getState();

  store.loadDoc(args.in ? parseDoc(readFileSync(args.in, "utf8"), args.in) : EMPTY, null);

  let result: { applied: number; errors: string[] } | null = null;
  if (args.ops) {
    result = useDiagramStore
      .getState()
      .applyOps(parseOps(readFileSync(args.ops, "utf8")) as never, true);
    for (const error of result.errors) console.error(`! ${error}`);
    console.error(applySummary(result));
    if (result.errors.length > 0) process.exitCode = 1;
  }

  // a batch that did not fully apply must not overwrite the target: the file
  // would look like a successful run to whatever picks it up next
  if (process.exitCode === 1) {
    console.error("· nothing was written because the ops failed to apply");
    if (args.report) writeReport(args.report, runReport(result, false));
    return;
  }

  // `written` is about the document (`--out`, the edit's destination) — an
  // export that fails after it still reports the document as written
  let wroteOut = false;
  try {
    if (args.out) {
      await exportTo(args.out, args);
      wroteOut = true;
    }
    if (args.export) await exportTo(args.export, args);
  } catch (error) {
    // the ops applied, the write did not: say so, or the caller reads "applied"
    if (args.report) {
      writeReport(
        args.report,
        runReport(result, wroteOut, error instanceof Error ? error.message : String(error)),
      );
    }
    throw error;
  }
  // an SVG export says what it drew — the chat view reports it (#202)
  if (args.report) {
    writeReport(
      args.report,
      finalReport(result, Boolean(args.out), args, useDiagramStore.getState()),
    );
  }
};

const writeReport = (path: string, report: unknown): void => {
  writeFileSync(path, `${JSON.stringify(report)}\n`, "utf8");
};

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
