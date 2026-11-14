import { describe, expect, it } from "vitest";

import { useDiagramStore } from "../store";
import {
  docErrors,
  documentFile,
  documentMayHaveChanged,
  isDiagramDocShape,
  isMultiPage,
  MULTI_PAGE_ERROR,
  normalizeDoc,
} from "../store/document";
import type { DiagramState } from "../store/state";
import { makeDoc, makeEdge, makeNode } from "./testFixtures";

/**
 * A document is one canvas (#229 D1): what is left of the page module — the
 * shape test, the multi-page refusal, the load clean-up and the file form.
 */
describe("Document module (#229 D1·D2, T16)", () => {
  it("isDiagramDocShape — an object with nodes·edges arrays and no pages", () => {
    expect(isDiagramDocShape({ nodes: [], edges: [] })).toBe(true);
    expect(isDiagramDocShape(makeDoc([], []))).toBe(true);
    expect(isDiagramDocShape({ nodes: [] })).toBe(false);
    expect(isDiagramDocShape({ nodes: {}, edges: [] })).toBe(false);
    expect(isDiagramDocShape({ nodes: [], edges: [], pages: [] })).toBe(false);
    expect(isDiagramDocShape({ pages: [{ nodes: [], edges: [] }] })).toBe(false);
    expect(isDiagramDocShape(null)).toBe(false);
    expect(isDiagramDocShape([1])).toBe(false);
    expect(isDiagramDocShape("x")).toBe(false);
  });

  it("isMultiPage — a top-level pages key, whatever its value", () => {
    for (const pages of [[], [{}], null, 0, "x", {}]) {
      expect(isMultiPage({ version: 2, pages })).toBe(true);
    }
    expect(isMultiPage({ nodes: [], edges: [], pages: undefined })).toBe(true);
    expect(isMultiPage(makeDoc([], []))).toBe(false);
    expect(isMultiPage({ nodes: [{ pages: [] }], edges: [] })).toBe(false);
    expect(isMultiPage(null)).toBe(false);
    expect(isMultiPage([])).toBe(false);
  });

  it("MULTI_PAGE_ERROR — the sentence the user reads", () => {
    expect(MULTI_PAGE_ERROR).toBe(
      "This diagram has pages — Dosik now opens one-canvas diagrams only",
    );
  });

  it("docErrors — errors in the document structure", () => {
    expect(docErrors(makeDoc([makeNode({ id: "a" })], []))).toEqual([]);
    const bad = makeDoc([{ ...makeNode({ id: "a" }), position: { x: Number.NaN, y: 0 } }], []);
    expect(docErrors(bad)).toEqual(["nodes[0] must have finite position {x,y}"]);
    // a v1 file that left out its arrays is read as empty ones
    expect(docErrors({ version: 1, title: "T" } as never)).toEqual([]);
  });

  it("normalizeDoc — drops edges touching background shapes, and the orphan anchors that held their ends", () => {
    const { nodes, edges } = normalizeDoc(
      [
        makeNode({ id: "f", shape: "fragment" }),
        makeNode({ id: "y" }),
        makeNode({ id: "pin", shape: "anchor" }),
      ],
      [
        makeEdge({ id: "e", source: "f", target: "y" }),
        makeEdge({ id: "e2", source: "pin", target: "f" }),
      ],
    );
    expect(edges).toEqual([]);
    expect(nodes.map((n) => n.id)).toEqual(["f", "y"]);
  });

  it("documentFile — always v1, without selection or runtime fields", () => {
    const store = useDiagramStore.getState();
    store.loadDoc(makeDoc([makeNode({ id: "a" })], [], "T"), null);
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: true, measured: { width: 1, height: 1 } })),
    }));
    const file = documentFile(useDiagramStore.getState());
    expect(file.version).toBe(1);
    expect(file.title).toBe("T");
    expect(file).not.toHaveProperty("pages");
    expect(file.nodes[0]).not.toHaveProperty("selected");
    expect(file.nodes[0]).not.toHaveProperty("measured");
  });

  it("documentMayHaveChanged — looks only at the title, nodes, and edges", () => {
    const a = useDiagramStore.getState();
    const same = { ...a, touched: { x: 1 }, docVersion: a.docVersion + 1 } as DiagramState;
    expect(documentMayHaveChanged(a, same)).toBe(false);
    expect(documentMayHaveChanged(a, { ...a, title: "Other" } as DiagramState)).toBe(true);
    expect(documentMayHaveChanged(a, { ...a, nodes: [...a.nodes] } as DiagramState)).toBe(true);
    expect(documentMayHaveChanged(a, { ...a, edges: [...a.edges] } as DiagramState)).toBe(true);
  });
});
