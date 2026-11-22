import { posix } from "node:path";

import { describe, expect, it } from "vitest";

import rules from "../../src-tauri/src/library/rules.json";
import { isBroad } from "../mcp/library.mjs";
import {
  classify,
  clean,
  cleanFolder,
  diagramStem,
  fold,
  MAX_DEPTH,
  MAX_NAME_BYTES,
  MAX_NAME_CHARS,
  naturalCmp,
  same,
  uniqueName,
} from "../mcp/names.mjs";

/**
 * The MCP server names and skips things the way the app does: both read the
 * cases in `src-tauri/src/library/rules.json` (the app in `names.rs` and
 * `walk.rs`), so a rule changed on one side alone fails a test.
 */
describe("library names — the rules the app keeps too", () => {
  const chars = (text: string) => [...text].length;
  const bytes = (text: string) => Buffer.byteLength(text, "utf8");

  it("keeps the same limits", () => {
    expect(rules.limits).toEqual({ chars: MAX_NAME_CHARS, bytes: MAX_NAME_BYTES });
    expect(rules.maxDepth).toBe(MAX_DEPTH);
  });

  it("cleans names by the shared cases", () => {
    for (const c of rules.clean) {
      const out = clean(c.in, c.default);
      expect(out, JSON.stringify(c)).toBe(c.out);
      expect(chars(out)).toBeLessThanOrEqual(MAX_NAME_CHARS);
      expect(bytes(out)).toBeLessThanOrEqual(MAX_NAME_BYTES);
      // and a clean name stays as it is
      expect(clean(out, "x")).toBe(out);
    }
  });

  it("cleans folder names by the shared cases", () => {
    for (const c of rules.cleanFolder) {
      const out = cleanFolder(c.in, c.default);
      expect(out, JSON.stringify(c)).toBe(c.out);
      expect(chars(out)).toBeLessThanOrEqual(MAX_NAME_CHARS);
      expect(bytes(out)).toBeLessThanOrEqual(MAX_NAME_BYTES);
      expect(cleanFolder(out, "x")).toBe(out);
      expect(classify(out, true)).toBe("folder");
    }
  });

  it("tells clashing names by the shared cases", () => {
    for (const c of rules.same) expect(same(c.a, c.b), JSON.stringify(c)).toBe(c.same);
  });

  it("makes names unique by the shared cases", () => {
    for (const c of rules.unique) {
      const except = "except" in c ? fold(c.except as string) : undefined;
      const taken = c.taken.map(fold).filter((t) => t !== except);
      const out = uniqueName(c.wanted, (candidate: string) => taken.includes(fold(candidate)));
      expect(out, JSON.stringify(c)).toBe(c.out);
      expect(chars(out)).toBeLessThanOrEqual(MAX_NAME_CHARS);
      expect(bytes(out)).toBeLessThanOrEqual(MAX_NAME_BYTES);
    }
  });

  it("sorts names by the shared cases", () => {
    for (const want of rules.natural) {
      expect([...want].reverse().sort(naturalCmp)).toEqual(want);
    }
    expect(naturalCmp("a", "a")).toBe(0);
    expect(naturalCmp("a01", "a1")).toBe(-1);
    expect(naturalCmp("99999999999999999999999", "100000000000000000000000")).toBe(-1);
  });

  it("tells entries apart by the shared cases", () => {
    for (const c of rules.entries) {
      expect(classify(c.name, c.dir), JSON.stringify(c)).toBe(c.kind);
      if (c.kind === "diagram") expect(diagramStem(c.name)).toBe(c.stem);
    }
  });

  it("tells broad paths by the shared cases", () => {
    for (const c of rules.broad.cases) {
      expect(isBroad(c.path, rules.broad.home, posix), JSON.stringify(c)).toBe(c.broad);
    }
  });
});
