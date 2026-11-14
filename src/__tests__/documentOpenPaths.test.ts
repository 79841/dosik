import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const FEATURES = join(__dirname, "../features");

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });

/**
 * Who may swap a whole document into the store (#218 D9, T43): the tab
 * module, which keeps the document on screen in its tab first, and the
 * headless CLI, which has no tabs. Any other `loadDoc`/`openProject` call
 * would replace the active tab's document without keeping it — lost, with
 * its undo history and, for an external file, its unsaved edits.
 */
const ALLOWED = new Set(["library/tabActions.ts", "headless/main.ts"]);

describe("Only the tab module replaces the whole document (#218 T43)", () => {
  it("files in src/features that call .loadDoc( / .openProject(", () => {
    const callers = sources(FEATURES)
      .filter((path) => /\.(loadDoc|openProject)\(/.test(readFileSync(path, "utf8")))
      .map((path) => relative(FEATURES, path).split("\\").join("/"));
    expect(callers.filter((path) => !ALLOWED.has(path))).toEqual([]);
    // the allow-list itself stays true: each entry still exists and still calls
    for (const path of ALLOWED) expect(callers).toContain(path);
  });
});
