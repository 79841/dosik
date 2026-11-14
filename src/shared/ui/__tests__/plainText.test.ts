import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../../..");
/** fields that take no typed text */
const NOT_TEXT = /type="(number|checkbox|range|color|radio|file)"/;

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return path.endsWith(".tsx") ? [path] : [];
  });

/**
 * The opening tag starting at `from` (`<input …` / `<textarea …`), up to the
 * `>` that ends it — the first one outside `{…}` and quotes, so an arrow or a
 * comparison inside a prop does not end it, and a tag with children
 * (`<textarea …></textarea>`) ends where its own attributes do (#175).
 */
const openingTag = (source: string, from: number): string => {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from + 1; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (depth === 0 && (ch === '"' || ch === "'")) {
      quote = ch;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
    } else if (ch === ">" && depth === 0) {
      return source.slice(from, i + 1);
    }
  }
  throw new Error(`no end to the tag at offset ${from}`);
};

/** each `<input`/`<textarea` opening tag with its line */
const fields = (source: string): { tag: string; line: number }[] => {
  const out: { tag: string; line: number }[] = [];
  const re = /<(input|textarea)\b/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    out.push({
      tag: openingTag(source, m.index),
      line: source.slice(0, m.index).split("\n").length,
    });
  }
  return out;
};

describe("Text input fields turn off autocapitalize, autocorrect and spellcheck (#174)", () => {
  it("Every text input and textarea spreads PLAIN_TEXT", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of sources(SRC)) {
      for (const { tag, line } of fields(readFileSync(file, "utf8"))) {
        if (NOT_TEXT.test(tag)) continue;
        checked += 1;
        const at = tag.indexOf("{...PLAIN_TEXT}");
        // last spread, so nothing spread after it can turn the three back on
        if (at === -1 || tag.slice(at + 1).includes("{...")) {
          missing.push(`${relative(SRC, file)}:${line}`);
        }
      }
    }
    expect(missing).toEqual([]);
    // every text field in the app — raise this when one is added; a scanner
    // that starts missing fields fails here instead of passing quietly
    // (#219 moved the title field from the toolbar into the document tab.
    // #220 adds From Mermaid…'s textarea. #229 takes the page tabs' rename
    // field away with the pages)
    expect(checked).toBe(15);
  });

  it("Finds the end of the tag correctly — a textarea with children, a following number field", () => {
    const source = [
      "<textarea className={FIELD} onChange={(e) => f(e)}></textarea>",
      '<input\n  type="number"\n/>',
    ].join("\n");
    const [area, num] = fields(source);
    expect(area!.tag).toBe("<textarea className={FIELD} onChange={(e) => f(e)}>");
    expect(NOT_TEXT.test(area!.tag)).toBe(false);
    expect(NOT_TEXT.test(num!.tag)).toBe(true);
  });
});
