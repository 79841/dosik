import { describe, expect, it } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import type { DiagramEdge, DiagramNode } from "../../../shared/lib/types";
import { toMermaid } from "../markdown";
import { renderVectorSvg } from "../vectorSvg";

const entity = (id: string, label: string, columns: string[], x = 0): DiagramNode => {
  const n = makeNode({
    id,
    label,
    shape: "entity",
    x,
    width: 200,
    height: 32 + 12 + columns.length * 20,
  });
  return { ...n, data: { ...n.data, columns } };
};
const rel = (
  id: string,
  source: string,
  target: string,
  start: string,
  end: string,
  label?: string,
): DiagramEdge => {
  const e = makeEdge({ id, source, target, label });
  return { ...e, data: { ...e.data!, markerStart: start as never, markerEnd: end as never } };
};

const shop = () =>
  makeDoc(
    [
      entity("customer", "Customer", ["id uuid PK", "email text UK"]),
      entity("order", "Order", ["id uuid PK", "customer_id uuid FK", "total numeric"], 320),
    ],
    [rel("r", "customer", "order", "one", "zero-many", "places")],
    "Shop",
  );

describe("ERD export (#5)", () => {
  it("Uses Mermaid erDiagram when every shape is an entity", () => {
    const out = toMermaid(shop());
    expect(out.split("\n")[0]).toBe("erDiagram");
    expect(out).toContain('customer ||--o{ order : "places"');
    expect(out).toMatch(/customer\["Customer"\] \{\n\s+uuid id PK\n\s+text email UK\n\s+\}/);
    expect(out).toContain("uuid customer_id FK");
    expect(out).toContain("numeric total");
  });

  it("Writes an empty label for unlabeled relationships, as erDiagram requires", () => {
    const doc = shop();
    doc.edges[0]!.data!.label = undefined;
    expect(toMermaid(doc)).toContain('customer ||--o{ order : ""');
  });

  it("Falls back to flowchart when entities mix with other shapes — entities become name boxes", () => {
    const doc = shop();
    doc.nodes.push(makeNode({ id: "note", label: "Note" }));
    const out = toMermaid(doc);
    expect(out.startsWith("flowchart")).toBe(true);
    expect(out).toContain('customer["Customer"]');
  });

  it("Vector SVG uses the same EntitySvg as the canvas — column names are visible", () => {
    const svg = renderVectorSvg(shop());
    expect(svg).toContain(">customer_id<");
    expect(svg).toContain(">Customer<");
    // Includes the crow's-foot end marker definitions (the zero-or-more circle)
    expect(svg).toMatch(/<marker[^>]*viewBox="0 0 20 10"/);
  });
});
