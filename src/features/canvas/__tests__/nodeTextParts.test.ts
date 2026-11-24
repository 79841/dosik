import { describe, expect, it } from "vitest";

import {
  CLASS_NAME_H,
  CLASS_ROW_H,
  CLASS_SECTION_PAD,
  CLASS_STEREOTYPE_H,
} from "../../../shared/lib/classShape";
import { ENTITY_HEADER_H, ENTITY_ROW_H, ENTITY_ROWS_PAD } from "../../../shared/lib/entityShape";
import type { ShapeNodeData } from "../../../shared/lib/types";
import {
  addableTextParts,
  cardRowBands,
  editorStartText,
  lineRange,
  nextTextPart,
  nodeTextParts,
  pickTextPart,
  textPartChanged,
  textPartPatch,
  textPartValue,
} from "../nodeTextParts";

const data = (extra: Partial<ShapeNodeData> = {}): ShapeNodeData => ({
  label: "Payments",
  shape: "rect",
  color: "amber",
  ...extra,
});

describe("nodeTextParts — the texts a shape shows, in Tab order", () => {
  it("a plain box shows its name only", () => {
    expect(nodeTextParts(data())).toEqual(["label"]);
  });

  it("a box with a description and a badge: name, description, badge", () => {
    expect(nodeTextParts(data({ description: "Charges cards", badge: "v2" }))).toEqual([
      "label",
      "description",
      "badge",
    ]);
  });

  it("a frame: title, then its badge", () => {
    expect(nodeTextParts(data({ shape: "frame", badge: "1" }))).toEqual(["label", "badge"]);
  });

  it("a class: stereotype, name, attributes, methods — only those it shows", () => {
    expect(
      nodeTextParts(
        data({
          shape: "class",
          stereotype: "entity",
          attributes: ["+ id: UUID"],
          methods: ["+ pay()"],
        }),
      ),
    ).toEqual(["stereotype", "label", "attributes", "methods"]);
    expect(nodeTextParts(data({ shape: "class", methods: ["+ pay()"] }))).toEqual([
      "label",
      "methods",
    ]);
  });

  it("an entity: name, then its columns", () => {
    expect(nodeTextParts(data({ shape: "entity", columns: ["id uuid PK"] }))).toEqual([
      "label",
      "columns",
    ]);
    expect(nodeTextParts(data({ shape: "entity" }))).toEqual(["label"]);
  });

  it("an image and an anchor draw no text to edit", () => {
    expect(nodeTextParts(data({ shape: "image" }))).toEqual([]);
    expect(nodeTextParts(data({ shape: "anchor" }))).toEqual([]);
  });

  it("text a shape cannot carry is not a part even if the data has it", () => {
    // a lifeline never draws a description or a badge
    expect(nodeTextParts(data({ shape: "lifeline", description: "x", badge: "y" }))).toEqual([
      "label",
    ]);
  });

  it("a part being added is shown while it is typed", () => {
    expect(nodeTextParts(data(), "description")).toEqual(["label", "description"]);
    expect(nodeTextParts(data({ shape: "class" }), "attributes")).toEqual(["label", "attributes"]);
  });
});

describe("nextTextPart — Tab goes round the texts the shape shows", () => {
  const box = data({ description: "Charges cards", badge: "v2" });

  it("forward and round", () => {
    expect(nextTextPart(box, "label", 1)).toBe("description");
    expect(nextTextPart(box, "description", 1)).toBe("badge");
    expect(nextTextPart(box, "badge", 1)).toBe("label");
  });

  it("backward and round", () => {
    expect(nextTextPart(box, "label", -1)).toBe("badge");
    expect(nextTextPart(box, "badge", -1)).toBe("description");
  });

  it("skips a text the shape does not show", () => {
    const noDescription = data({ badge: "v2" });
    expect(nextTextPart(noDescription, "label", 1)).toBe("badge");
    expect(nextTextPart(noDescription, "badge", -1)).toBe("label");
  });

  it("goes on from a text that just disappeared (a description emptied on Tab)", () => {
    expect(nextTextPart(data({ badge: "v2" }), "description", 1)).toBe("badge");
    expect(nextTextPart(data(), "description", 1)).toBe("label");
    expect(nextTextPart(data({ badge: "v2" }), "description", -1)).toBe("label");
  });

  it("a shape with one text stays on it", () => {
    expect(nextTextPart(data({ shape: "lifeline" }), "label", 1)).toBe("label");
  });

  it("a class goes stereotype, name, attributes, methods and round", () => {
    const cls = data({ shape: "class", stereotype: "s", attributes: ["a"], methods: ["m"] });
    expect(nextTextPart(cls, "methods", 1)).toBe("stereotype");
    expect(nextTextPart(cls, "stereotype", 1)).toBe("label");
    expect(nextTextPart(cls, "label", 1)).toBe("attributes");
  });

  it("nothing to go to on a shape without text", () => {
    expect(nextTextPart(data({ shape: "image" }), "label", 1)).toBeNull();
  });
});

describe("textPartValue / textPartPatch — what the editor shows and writes", () => {
  it("single texts read and write as they are", () => {
    const d = data({ description: "Charges", badge: "v2", stereotype: "entity" });
    expect(textPartValue(d, "label")).toBe("Payments");
    expect(textPartValue(d, "description")).toBe("Charges");
    expect(textPartValue(d, "badge")).toBe("v2");
    expect(textPartValue(d, "stereotype")).toBe("entity");
    expect(textPartPatch("description", "New")).toEqual({ description: "New" });
  });

  it("missing texts read as empty", () => {
    expect(textPartValue(data(), "description")).toBe("");
    expect(textPartValue(data({ shape: "class" }), "attributes")).toBe("");
  });

  it("a compartment is its rows, one per line", () => {
    const d = data({ shape: "class", attributes: ["+ id: UUID", "- total: Money"] });
    expect(textPartValue(d, "attributes")).toBe("+ id: UUID\n- total: Money");
    expect(textPartPatch("attributes", "a\nb")).toEqual({ attributes: ["a", "b"] });
    expect(textPartPatch("columns", "id uuid PK")).toEqual({ columns: ["id uuid PK"] });
  });
});

describe("textPartChanged — no write (and no undo step) for what cleans up to the same", () => {
  it("a label compares as typed", () => {
    expect(textPartChanged(data(), "label", "Payments")).toBe(false);
    expect(textPartChanged(data(), "label", "Payments ")).toBe(true);
  });

  it("a description or badge compares after the store's clean-up", () => {
    const d = data({ description: "Charges", badge: "v2" });
    expect(textPartChanged(d, "description", "  Charges ")).toBe(false);
    expect(textPartChanged(d, "description", "Charges more")).toBe(true);
    expect(textPartChanged(d, "badge", "v2 ")).toBe(false);
    expect(textPartChanged(d, "description", "")).toBe(true);
    // nothing typed into a text being added writes nothing
    expect(textPartChanged(data(), "description", "  ")).toBe(false);
  });

  it("a stereotype compares without its guillemets and spaces", () => {
    expect(
      textPartChanged(data({ shape: "class", stereotype: "entity" }), "stereotype", "«entity»"),
    ).toBe(false);
  });

  it("a compartment compares its cleaned rows — a blank line added changes nothing", () => {
    const d = data({ shape: "class", attributes: ["+ id: UUID"] });
    expect(textPartChanged(d, "attributes", "+ id: UUID\n")).toBe(false);
    expect(textPartChanged(d, "attributes", "+ id: UUID\n+ name: string")).toBe(true);
    expect(textPartChanged(data({ shape: "class" }), "attributes", "")).toBe(false);
  });
});

describe("pickTextPart — the text a double-click landed on", () => {
  const box = data({ description: "Charges", badge: "v2" });

  it("a marked text the shape shows", () => {
    expect(pickTextPart(box, "description", undefined)).toEqual({ part: "description" });
    expect(pickTextPart(box, "badge", undefined)).toEqual({ part: "badge" });
  });

  it("a compartment row carries its line", () => {
    const cls = data({ shape: "class", attributes: ["a", "b"] });
    expect(pickTextPart(cls, "attributes", "1")).toEqual({ part: "attributes", line: 1 });
  });

  it("anywhere else — or a mark the shape does not show — is the name", () => {
    expect(pickTextPart(box, undefined, undefined)).toEqual({ part: "label" });
    expect(pickTextPart(data(), "badge", undefined)).toEqual({ part: "label" });
    expect(pickTextPart(box, "nonsense", undefined)).toEqual({ part: "label" });
  });

  it("an image has nothing to open", () => {
    expect(pickTextPart(data({ shape: "image" }), undefined, undefined)).toBeNull();
  });
});

describe("lineRange — where a row sits in the compartment's text", () => {
  it("selects the n-th line", () => {
    expect(lineRange("ab\ncde\nf", 0)).toEqual([0, 2]);
    expect(lineRange("ab\ncde\nf", 1)).toEqual([3, 6]);
    expect(lineRange("ab\ncde\nf", 2)).toEqual([7, 8]);
  });

  it("past the last line: the last line", () => {
    expect(lineRange("ab\ncd", 9)).toEqual([3, 5]);
  });
});

describe("addableTextParts — what right-click › Add … offers", () => {
  it("a box: description and badge, the ones it shows greyed", () => {
    expect(addableTextParts(data({ badge: "v2" }))).toEqual([
      { part: "description", enabled: true },
      { part: "badge", enabled: false },
    ]);
  });

  it("a frame: its badge", () => {
    expect(addableTextParts(data({ shape: "frame" }))).toEqual([{ part: "badge", enabled: true }]);
  });

  it("a class or entity can always add a row", () => {
    expect(addableTextParts(data({ shape: "class", attributes: ["a"] }))).toEqual([
      { part: "attributes", enabled: true },
      { part: "methods", enabled: true },
    ]);
    expect(addableTextParts(data({ shape: "entity" }))).toEqual([
      { part: "columns", enabled: true },
    ]);
  });

  it("other shapes add nothing", () => {
    expect(addableTextParts(data({ shape: "lifeline" }))).toEqual([]);
    expect(addableTextParts(data({ shape: "image" }))).toEqual([]);
  });
});

describe("editorStartText — what an editor opens with", () => {
  it("the stored text", () => {
    expect(editorStartText(data({ description: "Charges" }), "description", false)).toBe("Charges");
  });

  it("adding a row to a compartment opens it with an empty last line", () => {
    const cls = data({ shape: "class", attributes: ["a"] });
    expect(editorStartText(cls, "attributes", true)).toBe("a\n");
    expect(editorStartText(data({ shape: "class" }), "attributes", true)).toBe("");
  });
});

describe("cardRowBands — where a double-click on a class or entity row lands", () => {
  it("a class: the stereotype line and each member row, the compartments' padding included", () => {
    const bands = cardRowBands(
      data({ shape: "class", stereotype: "s", attributes: ["a", "b"], methods: ["m"] }),
    );
    const top = CLASS_NAME_H + CLASS_STEREOTYPE_H;
    expect(bands[0]).toMatchObject({
      part: "stereotype",
      line: 0,
      top: 0,
      height: CLASS_STEREOTYPE_H,
    });
    // first attribute row reaches up to the rule, the last down past the padding
    expect(bands[1]).toMatchObject({
      part: "attributes",
      line: 0,
      top,
      height: CLASS_SECTION_PAD + CLASS_ROW_H,
    });
    expect(bands[2]).toMatchObject({
      part: "attributes",
      line: 1,
      top: top + CLASS_SECTION_PAD + CLASS_ROW_H,
      height: CLASS_ROW_H + CLASS_SECTION_PAD,
    });
    const methodsTop = top + CLASS_SECTION_PAD * 2 + 2 * CLASS_ROW_H;
    expect(bands[3]).toMatchObject({
      part: "methods",
      line: 0,
      top: methodsTop,
      height: CLASS_SECTION_PAD * 2 + CLASS_ROW_H,
    });
  });

  it("an entity: each column row", () => {
    const bands = cardRowBands(data({ shape: "entity", columns: ["id uuid PK", "name text"] }));
    expect(bands).toMatchObject([
      {
        part: "columns",
        line: 0,
        top: ENTITY_HEADER_H,
        height: ENTITY_ROWS_PAD + ENTITY_ROW_H,
        row: { top: ENTITY_HEADER_H + ENTITY_ROWS_PAD, height: ENTITY_ROW_H },
      },
      {
        part: "columns",
        line: 1,
        top: ENTITY_HEADER_H + ENTITY_ROWS_PAD + ENTITY_ROW_H,
        height: ENTITY_ROW_H + ENTITY_ROWS_PAD,
        row: { top: ENTITY_HEADER_H + ENTITY_ROWS_PAD + ENTITY_ROW_H, height: ENTITY_ROW_H },
      },
    ]);
  });

  it("other shapes have no rows", () => {
    expect(cardRowBands(data())).toEqual([]);
  });
});
