import { describe, expect, it } from "vitest";

import { scratchDiagramStore } from "../../../shared/lib/store";
import type { DiagramDoc } from "../../../shared/lib/types";
import { toMermaid } from "../../export/markdown";
import { STARTER_KINDS, STARTER_TITLE, starterDoc, starterPlan } from "../starters";

const shapes = (doc: DiagramDoc) => doc.nodes.map((n) => n.data.shape);
const labels = (doc: DiagramDoc) => doc.nodes.map((n) => n.data.label);

describe("starter templates (#220 D7, T19)", () => {
  it("four kinds — order and titles", () => {
    expect(STARTER_KINDS).toEqual(["flowchart", "sequence", "class", "er"]);
    expect(STARTER_KINDS.map((k) => STARTER_TITLE[k])).toEqual([
      "Flowchart",
      "Sequence diagram",
      "Class diagram",
      "ER diagram",
    ]);
  });

  it.each(STARTER_KINDS)("%s — the op plan builds into an empty store without errors", (kind) => {
    const plan = starterPlan(kind);
    expect(plan.kind).toBe(kind);
    expect(plan.omitted).toEqual([]);
    const store = scratchDiagramStore();
    expect(store.getState().applyOps(plan.ops).errors).toEqual([]);
  });

  it.each([
    ["flowchart", "flowchart LR"],
    ["sequence", "sequenceDiagram"],
    ["class", "classDiagram"],
    ["er", "erDiagram"],
  ] as const)("%s — first line of the Markdown export is %s", (kind, head) => {
    expect(toMermaid(starterDoc(kind)).split("\n")[0]).toBe(head);
  });

  it("Flowchart — Start(rounded, ink) → Valid input?(diamond, violet) → Yes Save / No Show error", () => {
    const doc = starterDoc("flowchart");
    expect(doc.title).toBe("Flowchart");
    expect(labels(doc)).toEqual(["Start", "Valid input?", "Save", "Show error"]);
    expect(shapes(doc)).toEqual(["rounded", "diamond", "rect", "rect"]);
    expect(doc.nodes.map((n) => n.data.color)).toEqual(["ink", "violet", "green", "rose"]);
    expect(doc.edges.map((e) => e.data?.label ?? "")).toEqual(["", "Yes", "No"]);
    // laid out left to right: each rank further right
    const x = (label: string) => doc.nodes.find((n) => n.data.label === label)!.position.x;
    expect(x("Start")).toBeLessThan(x("Valid input?"));
    expect(x("Valid input?")).toBeLessThan(x("Save"));
  });

  it("Sequence — three lifelines, four messages (the two returns dashed), one activation bar on Server", () => {
    const doc = starterDoc("sequence");
    expect(doc.title).toBe("Sequence diagram");
    const lifelines = doc.nodes.filter((n) => n.data.shape === "lifeline");
    expect(lifelines.map((n) => [n.data.label, n.data.color])).toEqual([
      ["Client", "blue"],
      ["Server", "mono"],
      ["Database", "teal"],
    ]);
    expect(doc.edges.map((e) => [e.data?.label, e.data?.variant ?? "solid"])).toEqual([
      ["GET /items", "solid"],
      ["SELECT items", "solid"],
      ["rows", "dashed"],
      ["200 OK", "dashed"],
    ]);
    const server = lifelines.find((n) => n.data.label === "Server")!;
    expect(server.data.activations).toHaveLength(1);
    expect(lifelines.filter((n) => n.data.activations?.length)).toHaveLength(1);
  });

  it("Class — Animal(violet) and Dog(blue), generalization (hollow triangle), parent on the left", () => {
    const doc = starterDoc("class");
    expect(doc.title).toBe("Class diagram");
    const [animal, dog] = doc.nodes;
    expect([animal?.data.label, animal?.data.color, dog?.data.label, dog?.data.color]).toEqual([
      "Animal",
      "violet",
      "Dog",
      "blue",
    ]);
    expect(shapes(doc)).toEqual(["class", "class"]);
    expect(animal?.data.attributes).toEqual(["+ name: string"]);
    expect(animal?.data.methods).toEqual(["+ speak(): void"]);
    expect(dog?.data.methods).toEqual(["+ fetch(): void"]);
    expect(doc.edges).toHaveLength(1);
    const edge = doc.edges[0]!;
    const parentEnd = edge.source === animal?.id ? edge.data?.markerStart : edge.data?.markerEnd;
    expect(parentEnd).toBe("triangle");
    expect(animal!.position.x).toBeLessThan(dog!.position.x);
  });

  it("ERD — CUSTOMER(teal) and ORDER(amber), one — zero-many, 'places'", () => {
    const doc = starterDoc("er");
    expect(doc.title).toBe("ER diagram");
    expect(shapes(doc)).toEqual(["entity", "entity"]);
    const [customer, order] = doc.nodes;
    expect(customer?.data).toMatchObject({
      label: "CUSTOMER",
      color: "teal",
      columns: ["id uuid PK", "name text", "email text"],
    });
    expect(order?.data).toMatchObject({
      label: "ORDER",
      color: "amber",
      columns: ["id uuid PK", "customer_id uuid FK", "total numeric", "created_at timestamp"],
    });
    expect(doc.edges.map((e) => [e.data?.markerStart, e.data?.markerEnd, e.data?.label])).toEqual([
      ["one", "zero-many", "places"],
    ]);
  });

  it("the document is a single page (v1) with no runtime-only fields — saves unchanged when opened", () => {
    for (const kind of STARTER_KINDS) {
      const doc = starterDoc(kind);
      expect(doc.version).toBe(1);
      for (const node of doc.nodes) expect(node).not.toHaveProperty("selected");
    }
  });
});
