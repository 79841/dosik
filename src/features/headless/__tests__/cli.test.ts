import { describe, expect, it } from "vitest";

import {
  formatFor,
  HEADLESS_FORMATS,
  HeadlessError,
  parseArgs,
  parseDoc,
  parseOps,
  finalReport,
  runReport,
  applySummary,
  viewSummary,
} from "../cli";

describe("headless CLI (#64)", () => {
  it("Does not start when there is nowhere to put the result", () => {
    expect(() => parseArgs(["--in", "a.dosik.json"])).toThrow(/--out or --export/);
    expect(parseArgs(["--in", "a.dosik.json", "--out", "b.dosik.json"])).toEqual({
      in: "a.dosik.json",
      out: "b.dosik.json",
    });
  });

  it("Tells a missing value apart from an unknown option", () => {
    expect(() => parseArgs(["--out"])).toThrow(/--out needs a value/);
    expect(() => parseArgs(["--out", "--export", "x.md"])).toThrow(/--out needs a value/);
    expect(() => parseArgs(["--nope", "x"])).toThrow(/unknown option/);
    expect(() => parseArgs(["x.json"])).toThrow(/unknown argument/);
  });

  it("The extension decides the format, and .dosik.json is a double extension", () => {
    expect(formatFor("out.md")).toBe("md");
    expect(formatFor("out.mmd")).toBe("mmd");
    expect(formatFor("/tmp/a/b.dosik.json")).toBe("dosik.json");
    expect(formatFor("OUT.MD")).toBe("md");
  });

  it("PNG answers 'needs a window', not 'unknown format'", () => {
    // the app exports PNG every day; "unknown format" would be a worse answer
    expect(() => formatFor("a.png")).toThrow(/needs a window/);
    // SVG is drawn without a window (#148)
    expect(formatFor("a.svg")).toBe("svg");
    expect(() => formatFor("a.pdf")).toThrow(/unknown format/);
    // PowerPoint export is gone (#192): an old caller hears what it can write instead
    expect(() => formatFor("a.pptx")).toThrow(/unknown format: \.pptx \(available: md, mmd/);
    for (const f of HEADLESS_FORMATS) expect(() => formatFor(`a.${f}`)).not.toThrow();
  });

  it("ops accepts the same two shapes as the bridge", () => {
    expect(parseOps('{"ops":[{"op":"clear"}]}')).toEqual([{ op: "clear" }]);
    expect(parseOps('[{"op":"clear"}]')).toEqual([{ op: "clear" }]);
    expect(() => parseOps("{")).toThrow(HeadlessError);
    expect(() => parseOps('{"nope":1}')).toThrow(/{"ops":\[…\]} or/);
  });

  it("Checks that the input document is a diagram, and names the path when it is not", () => {
    const doc = parseDoc('{"version":1,"title":"T","nodes":[],"edges":[]}', "a.json");
    expect(doc.title).toBe("T");
    expect(() => parseDoc("{}", "a.json")).toThrow(/a\.json: not a \.dosik\.json/);
    // a document with pages: refused, in the CLI's own words (#229 D2, T20)
    expect(() =>
      parseDoc(
        '{"version":2,"title":"Book","pages":[{"id":"p","name":"P","nodes":[],"edges":[]}]}',
        "b.json",
      ),
    ).toThrow(
      "b.json: multi-page documents (pages) are not supported — only single-canvas documents (nodes·edges) open",
    );
    expect(() =>
      parseDoc('{"version":1,"title":"T","nodes":[],"edges":[],"pages":[]}', "c.json"),
    ).toThrow(/c\.json: multi-page documents \(pages\)/);
    expect(() => parseDoc("nope", "a.json")).toThrow(/a\.json: can't read JSON/);
  });

  it("--report leaves the result as machine-readable JSON — so nobody scrapes the human-facing stderr (#149)", () => {
    expect(
      parseArgs(["--in", "a.dosik.json", "--out", "a.dosik.json", "--report", "r.json"]),
    ).toEqual({
      in: "a.dosik.json",
      out: "a.dosik.json",
      report: "r.json",
    });
    // A report alone is not a place to put the result
    expect(() => parseArgs(["--report", "r.json"])).toThrow(/--out or --export/);
  });

  it("Apply summary — the notice line after an op that stopped the batch does not count as a failure (#229 D15)", () => {
    expect(applySummary({ applied: 2, errors: [] })).toBe("· 2 applied");
    expect(applySummary({ applied: 1, errors: ["add_node: bad color"] })).toBe(
      "· 1 applied, 1 failed",
    );
    expect(
      applySummary({
        applied: 0,
        errors: [
          "new_diagram: only POST /api/ops can start a new diagram — this edits one diagram",
          "new_diagram: the 1 op after it was not applied",
        ],
      }),
    ).toBe("· 0 applied, 1 failed, 1 skipped after it");
    expect(
      applySummary({
        applied: 1,
        errors: [
          "add_page: pages were removed — a diagram is one canvas. Use new_diagram to start another diagram.",
          "add_page: the 3 ops after it were not applied",
        ],
      }),
    ).toBe("· 1 applied, 1 failed, 3 skipped after it");
  });

  it("The report has the same shape as the bridge response, and says nothing was written on failure", () => {
    expect(runReport({ applied: 2, errors: [] }, true)).toEqual({
      ok: true,
      applied: 2,
      errors: [],
      written: true,
    });
    expect(runReport({ applied: 1, errors: ["add_node: bad color"] }, false)).toEqual({
      ok: false,
      applied: 1,
      errors: ["add_node: bad color"],
      written: false,
    });
    // A run that only reads and exports, without ops
    expect(runReport(null, true)).toEqual({ ok: true, applied: 0, errors: [], written: true });
    // All ops applied but the write failed — that is a failure, not "applied" (#151)
    expect(runReport({ applied: 1, errors: [] }, false, "ENOENT: no such directory")).toEqual({
      ok: false,
      applied: 1,
      errors: ["write failed: ENOENT: no such directory"],
      written: false,
    });
  });

  it("--theme picks the SVG colors — accepts only auto·light·dark (#148, #202)", () => {
    expect(parseArgs(["--export", "a.svg", "--theme", "dark"])).toEqual({
      export: "a.svg",
      theme: "dark",
    });
    expect(parseArgs(["--export", "a.svg", "--theme", "auto"])).toMatchObject({ theme: "auto" });
    expect(() => parseArgs(["--export", "a.svg", "--theme", "sepia"])).toThrow(
      /--theme must be auto, light or dark/,
    );
  });

  it("--size fit means 100% width — fits a place with a set width, like a chat view (#148)", () => {
    expect(parseArgs(["--export", "a.svg", "--size", "fit"])).toEqual({
      export: "a.svg",
      size: "fit",
    });
    expect(() => parseArgs(["--export", "a.svg", "--size", "huge"])).toThrow(
      /--size must be fixed or fit/,
    );
  });

  it("--theme·--size are rejected without an SVG — not silently ignored (#152)", () => {
    expect(() => parseArgs(["--export", "a.md", "--theme", "dark"])).toThrow(/only to SVG/);
    expect(() => parseArgs(["--out", "a.dosik.json", "--size", "fit"])).toThrow(/only to SVG/);
    expect(
      parseArgs(["--out", "a.dosik.json", "--export", "a.svg", "--theme", "dark"]),
    ).toMatchObject({ theme: "dark" });
  });

  it("Reports the drawn diagram — used by the in-chat app's summary; there are no pages (#202, #229 D17)", () => {
    const node = { id: "a" } as never;
    const edge = { id: "e" } as never;
    expect(viewSummary({ title: "Flow", nodes: [node, node, node], edges: [edge] })).toEqual({
      title: "Flow",
      shapes: 3,
      connectors: 1,
    });
  });

  it("Only a run that exported SVG puts the drawn diagram in the report", () => {
    const state = { title: "Flow", nodes: [], edges: [] };
    expect(finalReport(null, false, { export: "/tmp/a.svg" }, state).view).toEqual(
      viewSummary(state),
    );
    expect(finalReport(null, false, { export: "/tmp/a.md" }, state)).not.toHaveProperty("view");
    expect(finalReport(null, true, {}, state)).toEqual(runReport(null, true));
  });

  it("--background none means no canvas background — for drawing in a chat (#202)", () => {
    expect(parseArgs(["--export", "a.svg", "--background", "none"])).toMatchObject({
      background: "none",
    });
    expect(parseArgs(["--export", "a.svg", "--background", "canvas"])).toMatchObject({
      background: "canvas",
    });
    expect(() => parseArgs(["--export", "a.svg", "--background", "white"])).toThrow(
      /--background must be canvas or none/,
    );
    expect(() => parseArgs(["--export", "a.md", "--background", "none"])).toThrow(/only to SVG/);
  });
});
