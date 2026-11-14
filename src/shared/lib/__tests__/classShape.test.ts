import { describe, expect, it } from "vitest";

import { normalizeNode } from "../store/nodeFactory";
import { makeNode } from "./testFixtures";
import {
  CLASS_NAME_H,
  CLASS_ROW_H,
  CLASS_SECTION_PAD,
  CLASS_STEREOTYPE_H,
  classDividerYs,
  classNodeHeight,
  classNodeWidth,
  CLASS_CHAR_W,
  CLASS_MEMBER_FONT,
  CLASS_TEXT_PAD,
  MAX_CLASS_MEMBERS,
  sanitizeClassMembers,
  sanitizeStereotype,
  matchUmlRelation,
  splitVisibility,
  textWidth,
  UML_RELATION_STYLE,
  UML_RELATIONS,
} from "../classShape";

describe("sanitizeClassMembers", () => {
  it("drops non-arrays", () => {
    expect(sanitizeClassMembers("+ name: string")).toBeUndefined();
    expect(sanitizeClassMembers(42)).toBeUndefined();
    expect(sanitizeClassMembers(null)).toBeUndefined();
  });

  it("filters out non-string elements", () => {
    expect(sanitizeClassMembers(["+ a: int", 7, null, "- b: str"])).toEqual([
      "+ a: int",
      "- b: str",
    ]);
  });

  it("drops empty and whitespace-only lines", () => {
    expect(sanitizeClassMembers(["+ a", "", "   ", "- b"])).toEqual(["+ a", "- b"]);
  });

  it("removes the field when nothing is left", () => {
    expect(sanitizeClassMembers([])).toBeUndefined();
    expect(sanitizeClassMembers(["", "  "])).toBeUndefined();
  });

  it("folds line breaks inside one member (so unknown rows do not render)", () => {
    expect(sanitizeClassMembers(["+ run(\n  x: int\n): void"])).toEqual(["+ run( x: int ): void"]);
  });

  it("truncates at the maximum count", () => {
    const many = Array.from({ length: MAX_CLASS_MEMBERS + 10 }, (_, i) => `+ m${i}`);
    expect(sanitizeClassMembers(many)).toHaveLength(MAX_CLASS_MEMBERS);
  });
});

describe("sanitizeStereotype", () => {
  it("drops non-strings and empty strings", () => {
    expect(sanitizeStereotype(1)).toBeUndefined();
    expect(sanitizeStereotype("   ")).toBeUndefined();
  });

  it("strips user-typed «» so they are not drawn twice", () => {
    expect(sanitizeStereotype("«interface»")).toBe("interface");
    expect(sanitizeStereotype("interface")).toBe("interface");
  });
});

describe("splitVisibility", () => {
  it.each([
    ["+ name: string", "+", "name: string"],
    ["- id: int", "-", "id: int"],
    ["# kind: K", "#", "kind: K"],
    ["~ pkg: P", "~", "pkg: P"],
  ])("strips the leading mark from %s", (line, mark, rest) => {
    expect(splitVisibility(line)).toEqual({ mark, rest });
  });

  it("leaves the text as is when no mark leads the line", () => {
    expect(splitVisibility("a+b: int")).toEqual({ mark: null, rest: "a+b: int" });
  });

  it("recognizes a mark with no following space", () => {
    expect(splitVisibility("+name")).toEqual({ mark: "+", rest: "name" });
  });
});

describe("classNodeHeight", () => {
  it("with no members, takes only the name compartment", () => {
    expect(classNodeHeight({})).toBe(CLASS_NAME_H);
  });

  it("grows by the stereotype", () => {
    expect(classNodeHeight({ stereotype: "interface" })).toBe(CLASS_NAME_H + CLASS_STEREOTYPE_H);
  });

  it("grows in proportion to the member count", () => {
    const one = classNodeHeight({ attributes: ["a"] });
    const three = classNodeHeight({ attributes: ["a", "b", "c"] });
    expect(three - one).toBe(2 * CLASS_ROW_H);
  });

  it("empty compartments take no height", () => {
    expect(classNodeHeight({ attributes: ["a"], methods: [] })).toBe(
      classNodeHeight({ attributes: ["a"] }),
    );
  });

  it("adds the attribute and method compartments separately", () => {
    expect(classNodeHeight({ attributes: ["a"], methods: ["m()"] })).toBe(
      CLASS_NAME_H + 2 * (CLASS_SECTION_PAD * 2 + CLASS_ROW_H),
    );
  });
});

describe("classDividerYs", () => {
  it("no dividers without members", () => {
    expect(classDividerYs({})).toEqual([]);
  });

  it("one divider with only attributes", () => {
    expect(classDividerYs({ attributes: ["a"] })).toEqual([CLASS_NAME_H]);
  });

  it("one divider with only methods too — right below the name compartment", () => {
    expect(classDividerYs({ methods: ["m()"] })).toEqual([CLASS_NAME_H]);
  });

  it("two dividers with both, the second below the attribute compartment", () => {
    expect(classDividerYs({ attributes: ["a", "b"], methods: ["m()"] })).toEqual([
      CLASS_NAME_H,
      CLASS_NAME_H + CLASS_SECTION_PAD * 2 + 2 * CLASS_ROW_H,
    ]);
  });

  it("dividers always stay within the box height", () => {
    const data = { stereotype: "interface", attributes: ["a"], methods: ["m()"] };
    for (const y of classDividerYs(data)) {
      expect(y).toBeLessThan(classNodeHeight(data));
    }
  });
});

describe("normalizeNode — class node", () => {
  it("does not attach class fields to non-class nodes", () => {
    const n = normalizeNode({
      ...makeNode({ id: "a" }),
      data: { ...makeNode({ id: "a" }).data, attributes: ["+ x"], stereotype: "iface" },
    });
    expect(n.data.attributes).toBeUndefined();
    expect(n.data.stereotype).toBeUndefined();
  });

  it("stores sanitized members", () => {
    const n = normalizeNode({
      ...makeNode({ id: "a", shape: "class" }),
      data: {
        ...makeNode({ id: "a", shape: "class" }).data,
        shape: "class" as const,
        attributes: ["+ x: int", "", 7 as unknown as string],
        methods: [],
      },
    });
    expect(n.data.attributes).toEqual(["+ x: int"]);
    expect(n.data.methods).toBeUndefined();
  });

  it("height grows to fit the content", () => {
    const base = normalizeNode(makeNode({ id: "a", shape: "class" }));
    const withMembers = normalizeNode({
      ...makeNode({ id: "b", shape: "class" }),
      data: {
        ...makeNode({ id: "b", shape: "class" }).data,
        shape: "class" as const,
        attributes: ["+ a", "+ b", "+ c"],
      },
    });
    expect(withMembers.height!).toBeGreaterThan(base.height!);
  });

  it("a stored height smaller than the content grows to fit", () => {
    const n = normalizeNode({
      ...makeNode({ id: "a", shape: "class", height: 40 }),
      data: {
        ...makeNode({ id: "a", shape: "class" }).data,
        shape: "class" as const,
        methods: ["+ m1()", "+ m2()", "+ m3()", "+ m4()"],
      },
    });
    expect(n.height!).toBeGreaterThanOrEqual(
      classNodeHeight({ methods: ["+ m1()", "+ m2()", "+ m3()", "+ m4()"] }),
    );
  });

  it("does not shrink a height the user enlarged", () => {
    const n = normalizeNode({ ...makeNode({ id: "a", shape: "class", height: 400 }) });
    expect(n.height).toBe(400);
  });
});

describe("UML relationship presets", () => {
  it("all six kinds have a style defined", () => {
    for (const { id } of UML_RELATIONS) {
      expect(UML_RELATION_STYLE[id]).toBeDefined();
    }
  });

  it("generalization and realization differ only in line type", () => {
    const g = UML_RELATION_STYLE.generalization;
    const r = UML_RELATION_STYLE.realization;
    expect(g.markerEnd).toBe("triangle");
    expect(r.markerEnd).toBe("triangle");
    expect(g.variant).toBe("solid");
    expect(r.variant).toBe("dashed");
  });

  it("the aggregation/composition diamond sits on the whole side (markerStart)", () => {
    expect(UML_RELATION_STYLE.aggregation.markerStart).toBe("diamond-open");
    expect(UML_RELATION_STYLE.composition.markerStart).toBe("diamond");
    expect(UML_RELATION_STYLE.aggregation.markerEnd).toBe("none");
    expect(UML_RELATION_STYLE.composition.markerEnd).toBe("none");
  });

  it("a style with a preset applied maps back to that preset", () => {
    for (const { id } of UML_RELATIONS) {
      expect(matchUmlRelation(UML_RELATION_STYLE[id])).toBe(id);
    }
  });

  it("a default edge (only the arrow boolean) is no preset", () => {
    expect(matchUmlRelation({ variant: "solid" })).toBeNull();
  });

  it("legacy arrow:false is not mistaken for aggregation/composition", () => {
    expect(matchUmlRelation({ variant: "solid", markerEnd: "none" })).toBeNull();
  });
});

describe("classNodeWidth", () => {
  it("keeps the given minimum for short content", () => {
    expect(classNodeWidth({ label: "A" }, 200)).toBe(200);
  });

  it("widens for long members", () => {
    const long = "+ applyDiscountPolicy(policy: DiscountPolicy, ctx: Ctx): Money";
    expect(classNodeWidth({ label: "A", methods: [long] }, 200)).toBeGreaterThan(200);
  });

  it("the longest line sets the width", () => {
    const one = classNodeWidth({ label: "A", attributes: ["+ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }, 0);
    const two = classNodeWidth(
      { label: "A", attributes: ["+ short", "+ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] },
      0,
    );
    expect(two).toBe(one);
  });

  it("accounts for long class names", () => {
    expect(classNodeWidth({ label: "AVeryLongClassNameIndeed" }, 0)).toBeGreaterThan(
      classNodeWidth({ label: "A" }, 0),
    );
  });

  it("accounts for the stereotype too («» included)", () => {
    expect(classNodeWidth({ label: "A", stereotype: "a".repeat(40) }, 0)).toBeGreaterThan(
      classNodeWidth({ label: "A" }, 0),
    );
  });

  it("the actual text fits in the computed width", () => {
    // monospace makes this exact — longest line + horizontal padding
    const line = "+ applyDiscountPolicy(policy: DiscountPolicy, ctx: Ctx): Money";
    const w = classNodeWidth({ label: "A", methods: [line] }, 0);
    expect(w).toBeGreaterThanOrEqual(
      line.length * CLASS_MEMBER_FONT * CLASS_CHAR_W + CLASS_TEXT_PAD * 2,
    );
  });
});

describe("textWidth — font fallback width", () => {
  it("counts Latin characters at the monospace advance", () => {
    expect(textWidth("abc", 10)).toBeCloseTo(3 * 10 * CLASS_CHAR_W, 5);
  });

  it("counts Hangul wider than Latin — IBM Plex Mono has no Hangul glyphs, so it falls back", () => {
    expect(textWidth("가나다", 10)).toBeGreaterThan(textWidth("abc", 10));
  });

  it("counts Han, kana, and full-width characters wide too", () => {
    for (const wide of ["漢字", "かな", "ＡＢ"]) {
      expect(textWidth(wide, 10)).toBeGreaterThan(textWidth("ab", 10));
    }
  });

  it("counts an emoji as one character even as a surrogate pair", () => {
    expect(textWidth("😀", 10)).toBe(10);
  });

  it("a Hangul member is wider than a Latin one with the same character count", () => {
    const ko = classNodeWidth({ label: "A", attributes: ["+ 주문번호수량"] }, 0);
    const en = classNodeWidth({ label: "A", attributes: ["+ abcdef"] }, 0);

    expect("+ 주문번호수량".length).toBe("+ abcdef".length);
    expect(ko).toBeGreaterThan(en);
  });
});
