import { describe, expect, it } from "vitest";

import { allShapesDoc } from "./fixtures/allShapes";

describe("allShapes fixture", () => {
  it("Every bridge op applies — the fixture does not silently drop shapes", () => {
    const doc = allShapesDoc();
    const shapes = new Set(doc.nodes.map((n) => n.data.shape));
    expect(doc.edges.map((e) => e.id)).toContain("free");
    for (const kind of [
      "rect",
      "rounded",
      "ellipse",
      "diamond",
      "parallelogram",
      "cylinder",
      "hexagon",
      "sticky",
      "text",
      "icon",
      "class",
      "lifeline",
      "fragment",
      "anchor",
    ]) {
      expect(shapes).toContain(kind);
    }
  });
});
