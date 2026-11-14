// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { toMarkdown, toMermaid } from "../../export/markdown";
import { renderVectorSvg } from "../../export/vectorSvg";
import { useDiagramStore } from "../../../shared/lib/store";
import { parseOps } from "../cli";

/**
 * The headless CLI boots the app's own store outside a browser. Everything else
 * in this suite runs under jsdom, which would hide a module reaching for
 * `window` or `localStorage` at import time — the failure this whole path is
 * exposed to. Hence the environment comment on line 1: without it the test
 * proves nothing.
 */
describe("headless runs without a DOM (#64)", () => {
  const fixture = join(__dirname, "fixtures", "ops.json");

  it("There is no global DOM — the premise of this test", () => {
    expect(typeof globalThis.window).toBe("undefined");
    expect(typeof globalThis.document).toBe("undefined");
  });

  it("Starts the store, applies ops and outputs a document", () => {
    const ops = parseOps(readFileSync(fixture, "utf8"));
    useDiagramStore.getState().loadDoc({ version: 1, title: "x", nodes: [], edges: [] }, null);
    const result = useDiagramStore.getState().applyOps(ops as never, true);
    expect(result.errors).toEqual([]);
    const doc = useDiagramStore.getState().toDoc();
    expect(doc.title).toBe("Headless smoke");
    expect(doc.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(doc.edges).toHaveLength(1);
  });

  it("Markdown, Mermaid and SVG come out of the same document", () => {
    const ops = parseOps(readFileSync(fixture, "utf8"));
    useDiagramStore.getState().loadDoc({ version: 1, title: "x", nodes: [], edges: [] }, null);
    useDiagramStore.getState().applyOps(ops as never, true);
    const doc = useDiagramStore.getState().toDoc();
    expect(toMarkdown(doc)).toContain("Headless smoke");
    expect(toMermaid(doc)).toContain("flowchart");
    // the vector renderer is the heaviest module the CLI loads — drawn here, in Node
    expect(renderVectorSvg(doc)).toMatch(/^<svg[\s\S]*Headless smoke[\s\S]*<\/svg>$/);
  });

  it("Rejects new_diagram — headless and the MCP file mode edit a single file (#229 D15, T31)", () => {
    useDiagramStore.getState().loadDoc({ version: 1, title: "x", nodes: [], edges: [] }, null);
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "new_diagram" }, { op: "set_title", title: "y" }], true);
    expect(result.applied).toBe(0);
    expect(result.errors[0]).toBe(
      "new_diagram: only POST /api/ops can start a new diagram — this edits one diagram",
    );
    expect(useDiagramStore.getState().title).toBe("x");
  });
});
