import { beforeEach, describe, expect, it } from "vitest";

import { entityNodeHeight } from "../entityShape";
import { useDiagramStore } from "../store";
import { makeDoc, makeNode } from "./testFixtures";

const node = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id)!;
const ops = (list: unknown[]) => useDiagramStore.getState().applyOps(list as never);

describe("Entity — store and bridge (#5)", () => {
  beforeEach(() => useDiagramStore.getState().loadDoc(makeDoc([], []), null));

  it("add_node creates an entity with columns, and the box fits the columns", () => {
    const result = ops([
      {
        op: "add_node",
        node: {
          id: "o",
          label: "Order",
          shape: "entity",
          x: 0,
          y: 0,
          columns: ["id uuid PK", "customer_id uuid FK", "  total   numeric  "],
        },
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(node("o").data.columns).toEqual(["id uuid PK", "customer_id uuid FK", "total numeric"]);
    expect(node("o").height).toBe(entityNodeHeight(node("o").data.columns));
  });

  it("changing columns with update_node grows the box to match", () => {
    ops([{ op: "add_node", node: { id: "o", label: "Order", shape: "entity", x: 0, y: 0 } }]);
    ops([{ op: "update_node", id: "o", set: { columns: ["a int", "b int", "c int", "d int"] } }]);
    expect(node("o").height).toBe(entityNodeHeight(["a", "b", "c", "d"]));
  });

  it("rejects columns on non-entity shapes", () => {
    expect(
      ops([{ op: "add_node", node: { label: "x", x: 0, y: 0, columns: ["a int"] } }]).errors[0],
    ).toMatch(/columns is only valid with shape "entity"/);
    ops([{ op: "add_node", node: { id: "r", label: "r", x: 0, y: 0 } }]);
    expect(ops([{ op: "update_node", id: "r", set: { columns: ["a int"] } }]).errors[0]).toMatch(
      /columns is only valid on shape "entity"/,
    );
    expect(ops([{ op: "update_node", id: "r", set: { columns: "a int" } }]).errors[0]).toMatch(
      /columns must be an array of strings/,
    );
  });

  it("drops columns when switching to another shape", () => {
    ops([
      {
        op: "add_node",
        node: { id: "o", label: "Order", shape: "entity", x: 0, y: 0, columns: ["id int"] },
      },
    ]);
    ops([{ op: "update_node", id: "o", set: { shape: "rounded" } }]);
    expect(node("o").data.columns).toBeUndefined();
  });

  it("the inspector path (updateNodeData) also sanitizes and grows", () => {
    ops([{ op: "add_node", node: { id: "o", label: "Order", shape: "entity", x: 0, y: 0 } }]);
    useDiagramStore.getState().updateNodeData("o", { columns: ["id uuid PK", "", "  name text "] });
    expect(node("o").data.columns).toEqual(["id uuid PK", "name text"]);
    expect(node("o").height).toBe(entityNodeHeight(["x", "y"]));
  });

  it("reading from a file sanitizes columns and keeps the minimum size", () => {
    const raw = makeNode({ id: "o", shape: "entity", height: 10 });
    const stray = makeNode({ id: "r" });
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [
          { ...raw, data: { ...raw.data, columns: ["id int", 5 as never, "x y"] } },
          { ...stray, data: { ...stray.data, columns: ["a int"] } },
        ],
        [],
      ),
      null,
    );
    expect(node("o").data.columns).toEqual(["id int", "x y"]);
    expect(node("o").height).toBe(entityNodeHeight(["a", "b"]));
    expect(node("r").data.columns).toBeUndefined();
  });

  it("ERD end shapes are accepted", () => {
    ops([
      { op: "add_node", node: { id: "a", label: "A", shape: "entity", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", shape: "entity", x: 300, y: 0 } },
    ]);
    const result = ops([
      {
        op: "add_edge",
        edge: { id: "ab", source: "a", target: "b", markerStart: "one", markerEnd: "zero-many" },
      },
    ]);
    expect(result.errors).toEqual([]);
  });
});
