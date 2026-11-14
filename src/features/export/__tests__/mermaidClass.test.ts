import mermaid from "mermaid";
import { beforeAll, describe, expect, it } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { DEFAULT_EDGE_WIDTH } from "../../../shared/lib/edgeUtils";
import type { DiagramEdge, DiagramNode, MarkerShape } from "../../../shared/lib/types";
import { toMermaid } from "../markdown";

/**
 * A class diagram exports as Mermaid's classDiagram (#194 feedback) — before,
 * it fell back to flowchart boxes carrying only the class names. Checked
 * against the real parser and its class database, not substrings alone.
 */
const cls = (id: string, data: Partial<DiagramNode["data"]> = {}, x = 0): DiagramNode => {
  const n = makeNode({ id, label: id, shape: "class", x, width: 200, height: 120 });
  return { ...n, data: { ...n.data, color: "mono", ...data } };
};
const rel = (
  id: string,
  source: string,
  target: string,
  data: Partial<NonNullable<DiagramEdge["data"]>> = {},
): DiagramEdge => ({
  ...makeEdge({ id, source, target }),
  data: { variant: "solid", arrow: false, ...data },
});

const classesOf = async (text: string) => {
  // biome-ignore lint/suspicious/noExplicitAny: mermaid's diagram database has no public type
  const diagram: any = await mermaid.mermaidAPI.getDiagramFromText(text);
  return diagram.db.getClasses() as Map<
    string,
    {
      label: string;
      annotations: string[];
      members: { getDisplayDetails: () => { displayText: string } }[];
      methods: { getDisplayDetails: () => { displayText: string } }[];
    }
  >;
};

beforeAll(() => mermaid.initialize({ startOnLoad: false }));

describe("Class diagram → Mermaid classDiagram (#194)", () => {
  const order = () =>
    cls("Order", {
      label: "Order",
      stereotype: "entity",
      attributes: ["- id: UUID", "+ items: List<Item>"],
      methods: ["+ submit(): void", "# total(tax: number): Money"],
    });

  it("Only classes gives classDiagram — with name, stereotype, attributes and methods", async () => {
    const out = toMermaid(makeDoc([order()], []));
    expect(out.split("\n")[0]).toBe("classDiagram");
    await expect(mermaid.parse(out)).resolves.toBeTruthy();
    const order_ = (await classesOf(out)).get("Order")!;
    expect(order_.annotations).toEqual(["entity"]);
    expect(order_.members.map((m) => m.getDisplayDetails().displayText)).toEqual([
      "-id: UUID",
      "+items: List<Item>",
    ]);
    expect(order_.methods.map((m) => m.getDisplayDetails().displayText)).toEqual([
      "+submit() : void",
      "#total(tax: number) : Money",
    ]);
  });

  it("An abstract class gets <<abstract>>, and a name with spaces becomes a label", async () => {
    const out = toMermaid(makeDoc([cls("s", { label: "Shape Base", isAbstract: true })], []));
    await expect(mermaid.parse(out)).resolves.toBeTruthy();
    const shape = (await classesOf(out)).get("s")!;
    expect(shape.label).toBe("Shape Base");
    expect(shape.annotations).toContain("abstract");
  });

  it.each<[string, MarkerShape, MarkerShape, "solid" | "dashed", RegExp]>([
    ["Inheritance", "none", "triangle", "solid", /a --\|> b/],
    ["Realization", "none", "triangle", "dashed", /a \.\.\|> b/],
    ["Composition", "diamond", "none", "solid", /a \*-- b/],
    ["Aggregation", "diamond-open", "none", "solid", /a o-- b/],
    ["Dependency", "none", "open", "dashed", /a \.\.> b/],
    ["Association", "none", "none", "solid", /a -- b/],
  ])("%s relationship uses the UML notation", async (_name, start, end, variant, expected) => {
    const out = toMermaid(
      makeDoc(
        [cls("a"), cls("b", {}, 300)],
        [rel("r", "a", "b", { markerStart: start, markerEnd: end, variant })],
      ),
    );
    expect(out).toMatch(expected);
    await expect(mermaid.parse(out)).resolves.toBeTruthy();
  });

  it("Stereotype and abstract together are both written, with a note that the drawing shows only one", async () => {
    const out = toMermaid(
      makeDoc(
        [cls("s", { stereotype: "interface", isAbstract: true, methods: ["+ go(): void"] })],
        [],
      ),
    );
    expect(out).toContain("<<interface>>");
    expect(out).toContain("<<abstract>>");
    expect(out).toMatch(
      /%% omitted \(no classDiagram equivalent\): abstract shown with a stereotype/,
    );
    await expect(mermaid.parse(out)).resolves.toBeTruthy();
  });

  it("Includes multiplicity and the relationship name", async () => {
    const out = toMermaid(
      makeDoc(
        [cls("a"), cls("b", {}, 300)],
        [
          rel("r", "a", "b", {
            markerEnd: "arrow",
            label: "places",
            labelStart: "1",
            labelEnd: "0..*",
          }),
        ],
      ),
    );
    expect(out).toContain('a "1" --> "0..*" b : places');
    await expect(mermaid.parse(out)).resolves.toBeTruthy();
  });

  it("Dangerous characters in members don't break parsing", async () => {
    const out = toMermaid(
      makeDoc(
        [
          cls("a", {
            attributes: ["+ x: a;b {c}", "+ y: C# rocks"],
            methods: ["+ go(): Map<K, V>"],
          }),
        ],
        [],
      ),
    );
    await expect(mermaid.parse(out)).resolves.toBeTruthy();
  });

  it("Mixed with other shapes it stays flowchart as before — classes become name boxes", () => {
    const out = toMermaid(makeDoc([cls("a"), makeNode({ id: "box", shape: "rect" })], []));
    expect(out.split("\n")[0]).toMatch(/^flowchart/);
  });
});

describe("States what Mermaid lacks (#194)", () => {
  const image = (): DiagramNode => {
    const n = makeNode({ id: "pic", label: "Logo", shape: "image" });
    return { ...n, data: { ...n.data, src: "data:image/png;base64,iVBORw0KGgo=" } };
  };

  it("flowchart: reports pictures, free arrows, line end shapes, end labels and line colors as %% omitted", async () => {
    const anchors = [
      makeNode({ id: "p", shape: "anchor", x: 0, y: 300, width: 12, height: 12 }),
      makeNode({ id: "q", shape: "anchor", x: 200, y: 300, width: 12, height: 12 }),
    ];
    const out = toMermaid(
      makeDoc(
        [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 }), image(), ...anchors],
        [
          rel("e", "a", "b", { markerEnd: "many", labelStart: "1", color: "rose" }),
          rel("free", "p", "q", { markerEnd: "arrow" }),
        ],
      ),
    );
    const note = out.split("\n").find((l) => l.includes("%% omitted"));
    expect(note).toBeDefined();
    for (const what of [
      "pictures",
      "free arrows",
      "line end shapes",
      "line end labels",
      "line colors",
    ]) {
      expect(note).toContain(what);
    }
    await expect(mermaid.parse(out)).resolves.toBeTruthy();
  });

  it("No omissions means no note — even for a line that spells out the default width", () => {
    const out = toMermaid(
      makeDoc(
        [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
        [rel("e", "a", "b", { markerEnd: "arrow", width: DEFAULT_EDGE_WIDTH })],
      ),
    );
    expect(out).not.toContain("%% omitted");
  });

  it("Shape colors move to style — black and white (mono) stays at the Mermaid default", async () => {
    const amber = {
      ...makeNode({ id: "a" }),
      data: { ...makeNode({ id: "a" }).data, color: "amber" as const },
    };
    const mono = {
      ...makeNode({ id: "m", x: 300 }),
      data: { ...makeNode({ id: "m" }).data, color: "mono" as const },
    };
    const out = toMermaid(makeDoc([amber, mono], []));
    expect(out).toMatch(/style a fill:#[0-9A-F]{6},stroke:#[0-9A-F]{6},color:#[0-9A-F]{6}/i);
    expect(out).not.toMatch(/style m /);
    await expect(mermaid.parse(out)).resolves.toBeTruthy();
  });

  it("erDiagram: reports colors and free arrows — the comment does not break parsing", async () => {
    const entity = (id: string, x: number, color: DiagramNode["data"]["color"]) => {
      const n = makeNode({ id, label: id, shape: "entity", x, width: 200, height: 120 });
      return { ...n, data: { ...n.data, color, columns: ["id uuid PK"] } };
    };
    const out = toMermaid(
      makeDoc(
        [
          entity("users", 0, "teal"),
          entity("orders", 300, "mono"),
          makeNode({ id: "p", shape: "anchor", x: 0, y: 300, width: 12, height: 12 }),
          makeNode({ id: "q", shape: "anchor", x: 200, y: 300, width: 12, height: 12 }),
        ],
        [rel("free", "p", "q", { markerEnd: "arrow" })],
      ),
    );
    expect(out.split("\n")[0]).toBe("erDiagram");
    expect(out).toContain("%% omitted (no erDiagram equivalent): free arrows, colors");
    await expect(mermaid.parse(out)).resolves.toBeTruthy();
  });

  it("sequenceDiagram: a colored lifeline reports its color", () => {
    const life = (id: string, x: number, color: DiagramNode["data"]["color"]) => {
      const n = makeNode({ id, label: id, shape: "lifeline", x, width: 120, height: 360 });
      return { ...n, data: { ...n.data, color } };
    };
    const out = toMermaid(makeDoc([life("a", 0, "rose"), life("b", 300, "mono")], []));
    expect(out).toMatch(/%% omitted \(no sequenceDiagram equivalent\):.*colors/);
  });

  it("flowchart: frame colors also move to subgraph style", async () => {
    const frame = {
      ...makeNode({
        id: "f",
        label: "Group",
        shape: "frame",
        x: -50,
        y: -50,
        width: 400,
        height: 300,
      }),
      zIndex: -2,
    };
    frame.data = { ...frame.data, color: "blue" };
    const out = toMermaid(makeDoc([frame, makeNode({ id: "a", x: 0, y: 0 })], []));
    expect(out).toMatch(/style f fill:/);
    await expect(mermaid.parse(out)).resolves.toBeTruthy();
  });
});
