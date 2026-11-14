import { describe, expect, it } from "vitest";

import { effectiveMarkerEnd, effectiveMarkerStart } from "../../../../shared/lib/edgeUtils";
import { scratchDiagramStore } from "../../../../shared/lib/store";
import { frameContents } from "../../../../shared/lib/store/frames";
import type { AgentOp, DiagramEdge, DiagramNode } from "../../../../shared/lib/types";
import { toMermaid } from "../../../export/markdown";
import { buildFragment } from "../buildFragment";
import { parseMermaid } from "../parseMermaid";

/** a document as an agent would draw it */
const docOf = (ops: AgentOp[]) => {
  const store = scratchDiagramStore();
  const { errors } = store.getState().applyOps(ops);
  expect(errors).toEqual([]);
  const { nodes, edges } = store.getState();
  return { version: 1 as const, title: "t", nodes, edges };
};

/** what must survive the trip: shapes by label, edges by their ends' labels */
const signature = (nodes: DiagramNode[], edges: DiagramEdge[]) => {
  const label = (id: string) => nodes.find((n) => n.id === id)?.data.label;
  return {
    nodes: nodes
      .map((n) => ({
        shape: n.data.shape,
        label: n.data.label,
        color: n.data.color,
        icon: n.data.icon,
        stereotype: n.data.stereotype,
        isAbstract: n.data.isAbstract,
        attributes: n.data.attributes,
        methods: n.data.methods,
        columns: n.data.columns,
        frames: n.data.shape === "frame" ? frameContents(nodes, n).map(label).sort() : undefined,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    edges: edges
      .map((e) => ({
        ends: [label(e.source), label(e.target)],
        label: e.data?.label || undefined,
        labelStart: e.data?.labelStart || undefined,
        labelEnd: e.data?.labelEnd || undefined,
        variant: e.data?.variant,
        markerStart: effectiveMarkerStart(e.data),
        markerEnd: effectiveMarkerEnd(e.data),
      }))
      .sort((a, b) => a.ends.join().localeCompare(b.ends.join())),
  };
};

const roundTrip = async (ops: AgentOp[]) => {
  const doc = docOf(ops);
  const back = buildFragment(await parseMermaid(toMermaid(doc)));
  return { before: signature(doc.nodes, doc.edges), after: signature(back.nodes, back.edges) };
};

describe("Pasting exported Mermaid back gives the same diagram (#200)", () => {
  it("flowchart — shapes, labels, colors, icons, lines, frames", async () => {
    const { before, after } = await roundTrip([
      { op: "add_node", node: { id: "s", label: "Start", shape: "ellipse", x: 0, y: 0 } },
      {
        op: "add_node",
        node: { id: "q", label: 'Is "it" <ok>?', shape: "diamond", color: "amber", x: 0, y: 150 },
      },
      { op: "add_node", node: { id: "d", label: "Orders DB", shape: "cylinder", x: 300, y: 150 } },
      {
        op: "add_node",
        node: { id: "w", label: "Web", shape: "icon", icon: "server", x: 300, y: 0 },
      },
      {
        op: "add_node",
        node: { id: "p", label: "Two\nlines", shape: "parallelogram", color: "blue", x: 0, y: 300 },
      },
      { op: "add_node", node: { id: "h", label: "Hex", shape: "hexagon", x: 300, y: 300 } },
      { op: "add_node", node: { id: "r", label: "Round", shape: "rounded", x: 600, y: 300 } },
      { op: "add_edge", edge: { source: "s", target: "q", markerEnd: "arrow" } },
      {
        op: "add_edge",
        edge: { source: "q", target: "d", label: "yes", variant: "dashed", markerEnd: "arrow" },
      },
      {
        op: "add_edge",
        edge: { source: "q", target: "p", label: "no", markerStart: "arrow", markerEnd: "arrow" },
      },
      { op: "add_edge", edge: { source: "w", target: "d", markerEnd: "none" } },
      { op: "add_edge", edge: { source: "h", target: "r", markerEnd: "arrow" } },
      {
        op: "add_node",
        node: {
          id: "f",
          label: "Backend",
          shape: "frame",
          x: 260,
          y: 260,
          width: 560,
          height: 160,
        },
      },
    ]);
    expect(after).toEqual(before);
  });

  it("classDiagram — members, stereotypes, abstract, relationships, multiplicity", async () => {
    const { before, after } = await roundTrip([
      { op: "add_node", node: { id: "a", label: "Animal", shape: "class", x: 0, y: 0 } },
      {
        op: "update_node",
        id: "a",
        set: { isAbstract: true, attributes: ["# name: string"], methods: ["+ speak(): void"] },
      },
      {
        op: "add_node",
        node: { id: "d", label: "Dog", shape: "class", color: "green", x: 0, y: 200 },
      },
      { op: "update_node", id: "d", set: { methods: ["+ fetch(ball: Ball<T>): bool"] } },
      { op: "add_node", node: { id: "i", label: "Pet", shape: "class", x: 300, y: 0 } },
      { op: "update_node", id: "i", set: { stereotype: "interface" } },
      { op: "add_node", node: { id: "t", label: "Tail", shape: "class", x: 0, y: 400 } },
      { op: "add_node", node: { id: "o", label: "Owner", shape: "class", x: 300, y: 200 } },
      {
        op: "add_edge",
        edge: { source: "a", target: "d", markerStart: "triangle", markerEnd: "none" },
      },
      {
        op: "add_edge",
        edge: {
          source: "i",
          target: "d",
          variant: "dashed",
          markerStart: "triangle",
          markerEnd: "none",
        },
      },
      {
        op: "add_edge",
        edge: {
          source: "d",
          target: "t",
          markerStart: "diamond",
          markerEnd: "none",
          labelStart: "1",
          labelEnd: "1",
          label: "has",
        },
      },
      {
        op: "add_edge",
        edge: {
          source: "o",
          target: "d",
          markerStart: "diamond-open",
          markerEnd: "open",
          labelEnd: "0..*",
        },
      },
    ]);
    expect(after).toEqual(before);
  });

  it("erDiagram — columns, keys, crow's feet, identifying/non-identifying", async () => {
    const { before, after } = await roundTrip([
      {
        op: "add_node",
        node: {
          id: "c",
          label: "Customer",
          shape: "entity",
          columns: ["id uuid PK", "email text UK"],
          x: 0,
          y: 0,
        },
      },
      {
        op: "add_node",
        node: {
          id: "o",
          label: "Order",
          shape: "entity",
          columns: ["id uuid PK", "customer_id uuid FK", "total numeric"],
          x: 300,
          y: 0,
        },
      },
      {
        op: "add_node",
        node: {
          id: "l",
          label: "Line",
          shape: "entity",
          columns: ["order_id uuid PK,FK"],
          x: 600,
          y: 0,
        },
      },
      {
        op: "add_edge",
        edge: {
          source: "c",
          target: "o",
          markerStart: "one",
          markerEnd: "zero-many",
          label: "places",
        },
      },
      {
        op: "add_edge",
        edge: {
          source: "o",
          target: "l",
          markerStart: "zero-one",
          markerEnd: "one-many",
          variant: "dashed",
        },
      },
    ]);
    expect(after).toEqual(before);
  });

  it("sequenceDiagram — participant order, messages, replies, self messages, activation bars, destruction", async () => {
    const doc = docOf([
      {
        op: "add_node",
        node: { id: "u", label: "User", shape: "lifeline", x: 0, y: 0, height: 500 },
      },
      {
        op: "add_node",
        node: { id: "s", label: "Server", shape: "lifeline", x: 220, y: 0, height: 500 },
      },
      {
        op: "add_node",
        node: { id: "d", label: "DB", shape: "lifeline", x: 440, y: 0, height: 500 },
      },
      { op: "add_message", message: { from: "u", to: "s", y: 100, label: "login" } },
      { op: "add_message", message: { from: "s", to: "d", y: 150, label: "query" } },
      {
        op: "add_message",
        message: {
          from: "d",
          to: "s",
          y: 200,
          label: "rows",
          variant: "dashed",
          markerEnd: "open",
        },
      },
      { op: "add_message", message: { from: "s", to: "s", y: 250, label: "check" } },
      {
        op: "add_message",
        message: { from: "s", to: "u", y: 320, label: "ok", variant: "dashed", markerEnd: "open" },
      },
      { op: "add_activation", lifeline: "s", y0: 95, y1: 330 },
      { op: "update_node", id: "d", set: { destroyY: 220 } },
    ]);
    const back = buildFragment(await parseMermaid(toMermaid(doc)));
    const lifelines = (nodes: DiagramNode[]) =>
      nodes
        .filter((n) => n.data.shape === "lifeline")
        .sort((a, b) => a.position.x - b.position.x)
        .map((n) => ({
          label: n.data.label,
          bars: n.data.activations?.length ?? 0,
          destroyed: n.data.destroyY !== undefined,
        }));
    expect(lifelines(back.nodes)).toEqual(lifelines(doc.nodes));
    const messages = (nodes: DiagramNode[], edges: DiagramEdge[]) =>
      signature(nodes, edges).edges.sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
    expect(messages(back.nodes, back.edges)).toEqual(messages(doc.nodes, doc.edges));
  });
});
