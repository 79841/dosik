import { describe, expect, it } from "vitest";

import { textWidth } from "../classShape";
import {
  ENTITY_HEADER_H,
  ENTITY_KEY_FONT,
  ENTITY_TEXT_PAD,
  entityKeyGutter,
  ENTITY_ROW_H,
  ENTITY_ROWS_PAD,
  ERD_RELATION_STYLE,
  entityNodeHeight,
  entityNodeWidth,
  matchErdRelation,
  mermaidCardinality,
  parseColumn,
} from "../entityShape";

describe("Entity (#5)", () => {
  it("splits a column line into name, type, and key — the key is the trailing PK/FK/UK", () => {
    expect(parseColumn("id uuid PK")).toEqual({ name: "id", type: "uuid", keys: ["PK"] });
    expect(parseColumn("customer_id uuid FK")).toEqual({
      name: "customer_id",
      type: "uuid",
      keys: ["FK"],
    });
    expect(parseColumn("order_id int pk,fk")).toEqual({
      name: "order_id",
      type: "int",
      keys: ["PK", "FK"],
    });
    expect(parseColumn("email varchar(255) UK")).toEqual({
      name: "email",
      type: "varchar(255)",
      keys: ["UK"],
    });
    expect(parseColumn("created_at timestamp with time zone")).toEqual({
      name: "created_at",
      type: "timestamp with time zone",
      keys: [],
    });
    expect(parseColumn("note")).toEqual({ name: "note", type: "", keys: [] });
  });

  it("pk inside a type name is not a key — only at the end of the line", () => {
    expect(parseColumn("pk_seq bigint").keys).toEqual([]);
  });

  it("the key column fits the longest key — so PK,FK does not cover the name", () => {
    const one = entityKeyGutter(["id uuid PK"]);
    const two = entityKeyGutter(["order_id uuid PK,FK"]);
    expect(two).toBeGreaterThan(one);
    expect(two).toBeGreaterThanOrEqual(ENTITY_TEXT_PAD + textWidth("PK,FK", ENTITY_KEY_FONT) + 6);
    // the key column stays even without keys — names stay aligned
    expect(entityKeyGutter(["note text"])).toBe(one);
  });

  it("height is the header band + column rows", () => {
    expect(entityNodeHeight([])).toBe(ENTITY_HEADER_H);
    expect(entityNodeHeight(["a int", "b int"])).toBe(
      ENTITY_HEADER_H + ENTITY_ROWS_PAD * 2 + 2 * ENTITY_ROW_H,
    );
  });

  it("width fits the longest line — keeps a width the user widened", () => {
    const narrow = entityNodeWidth({ label: "Order", columns: ["id uuid PK"] }, 0);
    const wide = entityNodeWidth(
      { label: "Order", columns: ["a_very_long_column_name varchar(255) FK"] },
      0,
    );
    expect(wide).toBeGreaterThan(narrow);
    expect(entityNodeWidth({ label: "Order", columns: ["id uuid PK"] }, 400)).toBe(400);
  });

  it("relationship presets are two crow's foot end shapes", () => {
    expect(ERD_RELATION_STYLE["one-to-many"]).toEqual({
      markerStart: "one",
      markerEnd: "one-many",
    });
    expect(matchErdRelation({ markerStart: "zero-many", markerEnd: "zero-many" })).toBe(
      "many-to-many",
    );
    expect(matchErdRelation({ markerStart: "none", markerEnd: "arrow" })).toBeNull();
  });

  it("Mermaid cardinality — left and right symbols are mirrored", () => {
    expect(mermaidCardinality("one", "left")).toBe("||");
    expect(mermaidCardinality("zero-many", "left")).toBe("}o");
    expect(mermaidCardinality("zero-many", "right")).toBe("o{");
    expect(mermaidCardinality("one-many", "right")).toBe("|{");
    expect(mermaidCardinality("zero-one", "left")).toBe("|o");
    // a non-crow's-foot end reads as 'exactly one'
    expect(mermaidCardinality("arrow", "right")).toBe("||");
  });
});
