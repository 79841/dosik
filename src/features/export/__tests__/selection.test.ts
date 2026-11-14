import { describe, expect, it } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { collectFragment } from "../../../shared/lib/store/clipboard";
import { hasExportableSelection, selectionDoc } from "../selection";

const pick = <T extends { id: string }>(items: T[], ids: string[]): T[] =>
  items.map((i) => (ids.includes(i.id) ? { ...i, selected: true } : i));

const scene = () => {
  const nodes = [
    makeNode({ id: "a" }),
    { ...makeNode({ id: "b" }), position: { x: 300, y: 0 } },
    { ...makeNode({ id: "c" }), position: { x: 600, y: 0 } },
  ];
  const edges = [
    makeEdge({ id: "ab", source: "a", target: "b" }),
    makeEdge({ id: "bc", source: "b", target: "c" }),
  ];
  return { nodes, edges, doc: makeDoc(nodes, edges) };
};

describe("Selection export (#48)", () => {
  it("Nothing selected gives nothing — no empty file is written", () => {
    const { doc, nodes, edges } = scene();
    expect(selectionDoc(doc, nodes, edges)).toBeNull();
    expect(hasExportableSelection(nodes, edges)).toBe(false);
  });

  it("Selecting two nodes brings the edge between them along — selection expansion", () => {
    const { doc, nodes, edges } = scene();
    const sub = selectionDoc(doc, pick(nodes, ["a", "b"]), edges);
    expect(sub?.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(sub?.edges.map((e) => e.id)).toEqual(["ab"]);
  });

  it("An edge with only one end selected is cut — no dangling lines are exported", () => {
    const { doc, nodes, edges } = scene();
    const sub = selectionDoc(doc, pick(nodes, ["b"]), edges);
    expect(sub?.nodes.map((n) => n.id)).toEqual(["b"]);
    expect(sub?.edges).toEqual([]);
  });

  it("A free arrow comes along when only the line is selected — its endpoints are invisible points", () => {
    const nodes = [
      { ...makeNode({ id: "p", shape: "anchor" }) },
      { ...makeNode({ id: "q", shape: "anchor" }), position: { x: 200, y: 0 } },
      { ...makeNode({ id: "box" }), position: { x: 400, y: 0 } },
    ];
    const edges = [makeEdge({ id: "arrow", source: "p", target: "q" })];
    const doc = makeDoc(nodes, edges);
    const sub = selectionDoc(
      doc,
      nodes,
      edges.map((e) => ({ ...e, selected: true })),
    );
    expect(sub?.nodes.map((n) => n.id).sort()).toEqual(["p", "q"]);
    expect(sub?.edges.map((e) => e.id)).toEqual(["arrow"]);
  });

  it("The rest of the document stays — the title is used for the file name and the export", () => {
    const { nodes, edges } = scene();
    const doc = { ...makeDoc(nodes, edges), title: "Orders flow" };
    expect(selectionDoc(doc, pick(nodes, ["a"]), edges)?.title).toBe("Orders flow");
  });

  it("It is the same slice as copying the selection — the rule does not split in two", () => {
    const { doc, nodes, edges } = scene();
    const selectedNodes = pick(nodes, ["a", "b"]);
    const sub = selectionDoc(doc, selectedNodes, edges);
    // the one assertion that actually pins this PR's central claim
    expect(sub?.nodes).toEqual(collectFragment(selectedNodes, edges)?.nodes);
    expect(sub?.edges).toEqual(collectFragment(selectedNodes, edges)?.edges);
    // selection state itself is not part of the exported piece
    expect(sub?.nodes.every((n) => !n.selected)).toBe(true);
    expect(hasExportableSelection(selectedNodes, edges)).toBe(true);
  });

  it("Selecting two lifelines brings the messages between them along and leaves found/lost behind", () => {
    const nodes = [
      makeNode({ id: "A", shape: "lifeline" }),
      { ...makeNode({ id: "B", shape: "lifeline" }), position: { x: 300, y: 0 } },
      { ...makeNode({ id: "src", shape: "anchor" }), position: { x: -120, y: 120 } },
    ];
    const edges = [
      makeEdge({ id: "msg", source: "A", target: "B" }),
      // found message: an anchor out in space into a lifeline
      makeEdge({ id: "found", source: "src", target: "A" }),
    ];
    const sub = selectionDoc(makeDoc(nodes, edges), pick(nodes, ["A", "B"]), edges);
    expect(sub?.nodes.map((n) => n.id)).toEqual(["A", "B"]);
    // the anchor was never picked, so dragging it in would export a shape the
    // user did not point at — the both-endpoints rule holding, not a gap
    expect(sub?.edges.map((e) => e.id)).toEqual(["msg"]);
  });

  it("Selecting only a fragment does not bring along what overlaps it — overlap is not containment", () => {
    const nodes = [
      makeNode({ id: "frame", shape: "fragment" }),
      { ...makeNode({ id: "inside" }), position: { x: 40, y: 60 } },
    ];
    const sub = selectionDoc(makeDoc(nodes, []), pick(nodes, ["frame"]), []);
    expect(sub?.nodes.map((n) => n.id)).toEqual(["frame"]);
  });
});
