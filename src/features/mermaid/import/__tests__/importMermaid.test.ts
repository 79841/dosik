import { beforeAll, describe, expect, it } from "vitest";

import { nodeBounds } from "../../../../shared/lib/edgeUtils";
import { frameContents } from "../../../../shared/lib/store/frames";
import type { DiagramEdge, DiagramNode } from "../../../../shared/lib/types";
import { buildFragment } from "../buildFragment";
import { parseMermaid } from "../parseMermaid";
import { MermaidImportError } from "../plan";

/** real mermaid, parsed in jsdom — the db shapes are pinned by these tests (D1) */
const draw = async (code: string) => {
  const plan = await parseMermaid(code);
  return { plan, ...buildFragment(plan) };
};

const byLabel = (nodes: DiagramNode[], label: string): DiagramNode => {
  const node = nodes.find((n) => n.data.label === label);
  if (!node) throw new Error(`no node "${label}" in ${nodes.map((n) => n.data.label).join(", ")}`);
  return node;
};

/** an edge as [source label, target label] */
const ends = (nodes: DiagramNode[], edge: DiagramEdge) => [
  nodes.find((n) => n.id === edge.source)?.data.label,
  nodes.find((n) => n.id === edge.target)?.data.label,
];

/** a message's absolute y, read from its `-<pct>` handle on the source lifeline */
const messageY = (nodes: DiagramNode[], edges: DiagramEdge[], label: string): number => {
  const e = edges.find((x) => x.data?.label === label)!;
  const lifeline = nodes.find((n) => n.id === e.source)!;
  const pct = Number(/-(\d+(?:\.\d+)?)$/.exec(e.sourceHandle ?? "")![1]);
  return lifeline.position.y + (pct / 100) * nodeBounds(lifeline).height;
};

/** the alt branch a y falls in — the canvas splits the whole frame evenly (FragmentSvg) */
const branchOf = (alt: DiagramNode, y: number): number => {
  const box = nodeBounds(alt);
  return Math.floor((y - box.y) / (box.height / alt.data.branches!));
};

const overlaps = (a: ReturnType<typeof nodeBounds>, b: ReturnType<typeof nodeBounds>) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

beforeAll(() => {
  // jsdom has no CSS.supports; mermaid asks it about colours (sequence `box`)
  if (!window.CSS) Object.defineProperty(window, "CSS", { value: {}, configurable: true });
  Object.assign(window.CSS, { supports: () => true });
});

describe("flowchart → shapes (#200)", () => {
  it("Shape mapping — shapes with no match become boxes", async () => {
    const { nodes } = await draw(`flowchart LR
  a[sq] --- b(round) --- c([stad]) --- d((circ)) --- e{dia}
  f{{hex}} --- g[(db)] --- h[/lean/] --- i[\\back\\] --- j[/trap\\]
  k>flag] --- l[[sub]] --- m@{ shape: cyl, label: "new" } --- n`);
    const shape = (label: string) => byLabel(nodes, label).data.shape;
    expect(shape("sq")).toBe("rect");
    expect(shape("round")).toBe("rounded");
    expect(shape("stad")).toBe("ellipse");
    expect(shape("circ")).toBe("ellipse");
    expect(shape("dia")).toBe("diamond");
    expect(shape("hex")).toBe("hexagon");
    expect(shape("db")).toBe("cylinder");
    expect(shape("lean")).toBe("parallelogram");
    expect(shape("back")).toBe("parallelogram");
    expect(shape("trap")).toBe("parallelogram");
    expect(shape("flag")).toBe("rect");
    expect(shape("sub")).toBe("rect");
    expect(shape("new")).toBe("cylinder");
    // a bare id is its own label
    expect(shape("n")).toBe("rect");
  });

  it("Lines — arrow, none, both ends, circle, dotted, thick, label", async () => {
    const { nodes, edges, plan } = await draw(`flowchart TD
  a --> b
  b --- c
  c <--> d
  d --o e
  e -.-> f
  f ==> g
  g -->|go on| h
  h -- also --> i
  i --x j`);
    const edge = (from: string) => {
      const e = edges.find((x) => ends(nodes, x)[0] === from);
      if (!e) throw new Error(from);
      return e.data!;
    };
    expect(edge("a")).toMatchObject({ markerStart: "none", markerEnd: "arrow", variant: "solid" });
    expect(edge("b")).toMatchObject({ markerStart: "none", markerEnd: "none" });
    expect(edge("c")).toMatchObject({ markerStart: "arrow", markerEnd: "arrow" });
    expect(edge("d")).toMatchObject({ markerEnd: "circle" });
    expect(edge("e")).toMatchObject({ variant: "dashed", markerEnd: "arrow" });
    expect(edge("f")).toMatchObject({ width: 2.8, markerEnd: "arrow" });
    expect(edge("g").label).toBe("go on");
    expect(edge("h").label).toBe("also");
    expect(edge("i")).toMatchObject({ markerEnd: "none" });
    expect(plan.omitted).toContain("x line ends");
  });

  it("Expands & and chains", async () => {
    const { nodes, edges } = await draw("flowchart LR\n  a & b --> c --> d");
    expect(edges.map((e) => ends(nodes, e))).toEqual([
      ["a", "c"],
      ["b", "c"],
      ["c", "d"],
    ]);
  });

  it("Draws a single line chained with semicolons too", async () => {
    const { nodes, edges } = await draw("graph TD;A-->B;B-->C;");
    expect(nodes.map((n) => n.data.label)).toEqual(["A", "B", "C"]);
    expect(edges).toHaveLength(2);
  });

  it("~~~ draws no line", async () => {
    const { edges } = await draw("flowchart LR\n  a ~~~ b\n  a --> c");
    expect(edges).toHaveLength(1);
  });

  it("Turns entity codes and <br/> in labels back into characters", async () => {
    const { nodes } = await draw(
      'flowchart TD\n  a["say #quot;hi#quot; #60;T#62; C#35; 50#37;<br/>next line"]',
    );
    expect(nodes[0]!.data.label).toBe('say "hi" <T> C# 50%\nnext line');
  });

  it("fill from style and classDef becomes the nearest palette color", async () => {
    const { nodes } = await draw(`flowchart LR
  a --> b --> c --> d
  style a fill:#DBEAFE,stroke:#3B82F6,color:#1E40AF
  classDef warn fill:#fde68a
  class b warn
  style c stroke:#f00`);
    expect(byLabel(nodes, "a").data.color).toBe("blue");
    expect(byLabel(nodes, "b").data.color).toBe("amber");
    // no fill: the default look
    expect(byLabel(nodes, "c").data.color).toBe("mono");
  });

  it("classDef default's color applies to every shape", async () => {
    const { nodes } = await draw("flowchart LR\n  a --> b\n  classDef default fill:#dcfce7");
    expect(nodes.map((n) => n.data.color)).toEqual(["green", "green"]);
  });

  it("An icon comment the app exported comes back as an icon shape", async () => {
    const { nodes } = await draw('flowchart TD\n    %% icon: database (db1)\n    db1["Orders"]');
    expect(nodes[0]!.data).toMatchObject({ shape: "icon", icon: "database", label: "Orders" });
  });

  it("Leaves out click and linkStyle and reports them", async () => {
    const { plan } = await draw(
      'flowchart LR\n  a --> b\n  click a "https://example.com"\n  linkStyle 0 stroke:#f00',
    );
    expect(plan.omitted).toEqual(expect.arrayContaining(["click links", "link styles"]));
  });

  it("Direction — LR is left to right, TD is top to bottom", async () => {
    const lr = await draw("flowchart LR\n  a --> b");
    expect(byLabel(lr.nodes, "b").position.x).toBeGreaterThan(byLabel(lr.nodes, "a").position.x);
    const td = await draw("graph TD\n  a --> b");
    expect(byLabel(td.nodes, "b").position.y).toBeGreaterThan(byLabel(td.nodes, "a").position.y);
  });

  it("Direction — BT and RL stay as written, not folded (#206)", async () => {
    const bt = await draw("flowchart BT\n  a --> b");
    expect(bt.plan.layout?.direction).toBe("BT");
    expect(byLabel(bt.nodes, "b").position.y).toBeLessThan(byLabel(bt.nodes, "a").position.y);
    const rl = await draw("flowchart RL\n  a --> b");
    expect(rl.plan.layout?.direction).toBe("RL");
    expect(byLabel(rl.nodes, "b").position.x).toBeLessThan(byLabel(rl.nodes, "a").position.x);
  });

  it("A subgraph is a frame around its members — an inner subgraph is an inner frame, and outside shapes are not taken in", async () => {
    const { nodes } = await draw(`flowchart LR
  x --> a
  subgraph outer [Outer]
    subgraph inner
      a --> b
    end
    c
  end
  b --> c --> y`);
    const outer = byLabel(nodes, "Outer");
    const inner = byLabel(nodes, "inner");
    expect(outer.data.shape).toBe("frame");
    const label = (ids: string[]) =>
      ids.map((id) => nodes.find((n) => n.id === id)!.data.label).sort();
    expect(label(frameContents(nodes, inner))).toEqual(["a", "b"]);
    expect(label(frameContents(nodes, outer))).toEqual(["a", "b", "c", "inner"]);
    // shapes outside are not under either frame
    for (const name of ["x", "y"]) {
      expect(overlaps(nodeBounds(byLabel(nodes, name)), nodeBounds(outer))).toBe(false);
    }
  });

  it("Leaves out lines attached to a subgraph and reports them — a frame can't be a line end", async () => {
    const { nodes, edges, plan } = await draw(`flowchart LR
  subgraph one
    a --> b
  end
  subgraph two
    c
  end
  one --> two
  b --> c`);
    expect(nodes.filter((n) => n.data.shape === "frame")).toHaveLength(2);
    expect(edges.map((e) => ends(nodes, e).join())).toEqual(["a,b", "b,c"]);
    expect(plan.omitted).toContain("links to subgraphs");
  });

  it("Hand-written angle brackets and ampersands stay as characters, HTML formatting tags are stripped", async () => {
    const { nodes } = await draw(
      'flowchart TD\n  a["x < y & z > w"]\n  b["<b>bold</b> and <i>it</i>"]',
    );
    expect(nodes.map((n) => n.data.label)).toEqual(["x < y & z > w", "bold and it"]);
  });

  it("Shapes don't overlap each other", async () => {
    const { nodes } = await draw("flowchart TD\n  a --> b & c & d\n  b & c & d --> e\n  f\n  g");
    const boxes = nodes.map(nodeBounds);
    boxes.forEach((a, i) => {
      for (const b of boxes.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    });
  });
});

describe("sequenceDiagram → lifelines and messages (#200)", () => {
  it("Participants go left → right in declaration order, and the alias is the label", async () => {
    const { nodes } = await draw(
      "sequenceDiagram\n  participant A as Alice\n  actor B\n  A->>B: hi",
    );
    const lifelines = nodes.filter((n) => n.data.shape === "lifeline");
    expect(lifelines.map((n) => n.data.label)).toEqual(["Alice", "B"]);
    expect(lifelines[1]!.position.x).toBeGreaterThan(lifelines[0]!.position.x);
    expect(lifelines[0]!.position.y).toBe(lifelines[1]!.position.y);
  });

  it("Line and ends per message kind, y in time order", async () => {
    const { nodes, edges } = await draw(`sequenceDiagram
  A->>B: solid
  B-->>A: reply
  A->B: plain
  A-)B: async
  A<<->>B: both
  A->>A: self`);
    const data = (label: string) => edges.find((e) => e.data?.label === label)!.data!;
    expect(data("solid")).toMatchObject({ variant: "solid", markerEnd: "arrow" });
    expect(data("reply")).toMatchObject({ variant: "dashed", markerEnd: "open" });
    expect(data("plain")).toMatchObject({ markerEnd: "none" });
    expect(data("async")).toMatchObject({ markerEnd: "open" });
    expect(data("both")).toMatchObject({ markerStart: "arrow", markerEnd: "arrow" });
    const self = edges.find((e) => e.data?.label === "self")!;
    expect(self.source).toBe(self.target);
    // every edge is a message between lifelines, in order down the page
    const a = byLabel(nodes, "A");
    const ys = edges.map((e) => Number(/-(\d+(?:\.\d+)?)$/.exec(e.sourceHandle ?? "")?.[1]));
    expect(ys.every((y) => Number.isFinite(y))).toBe(true);
    expect([...ys].sort((p, q) => p - q)).toEqual(ys);
    expect(a.data.shape).toBe("lifeline");
  });

  it("activate/deactivate and the +/- shorthand become activation bars", async () => {
    const { nodes } = await draw(`sequenceDiagram
  A->>+B: call
  B-->>-A: back
  A->>C: go
  activate C
  C->>A: x
  deactivate C`);
    expect(byLabel(nodes, "B").data.activations).toHaveLength(1);
    expect(byLabel(nodes, "C").data.activations).toHaveLength(1);
    expect(byLabel(nodes, "A").data.activations ?? []).toHaveLength(0);
  });

  it("loop, alt (else), opt, par and critical are fragments around messages — alt's branch count is the section count", async () => {
    const { nodes, edges } = await draw(`sequenceDiagram
  A->>B: before
  loop every minute
    A->>B: ping
  end
  alt ok
    B->>A: yes
  else bad
    B->>A: no
  else worse
    B->>A: never
  end
  opt maybe
    A->>C: extra
  end
  par one
    A->>B: p
  and two
    A->>C: q
  end
  critical lock
    A->>B: c
  end`);
    const frags = nodes.filter((n) => n.data.shape === "fragment");
    expect(frags.map((f) => f.data.fragmentKind)).toEqual([
      "loop",
      "alt",
      "opt",
      "par",
      "critical",
    ]);
    const alt = frags[1]!;
    expect(alt.data.branches).toBe(3);
    expect(alt.data.label).toBe("ok / bad / worse");
    expect(frags[0]!.data.label).toBe("every minute");
    // a fragment covers its messages and not the one before it
    const yOf = (label: string) => {
      const e = edges.find((x) => x.data?.label === label)!;
      const lifeline = nodes.find((n) => n.id === e.source)!;
      return (
        lifeline.position.y +
        (Number(/-(\d+(?:\.\d+)?)$/.exec(e.sourceHandle!)![1]) / 100) * nodeBounds(lifeline).height
      );
    };
    const loop = nodeBounds(frags[0]!);
    expect(yOf("ping")).toBeGreaterThan(loop.y);
    expect(yOf("ping")).toBeLessThan(loop.y + loop.height);
    expect(yOf("before")).toBeLessThan(loop.y);
    // each message in its own branch, as the canvas draws the dividers
    const branch = (label: string) => branchOf(alt, yOf(label));
    expect(["yes", "no", "never"].map(branch)).toEqual([0, 1, 2]);
  });

  it.each([2, 3, 4, 5])(
    "alt with %i branches — each message stays in its own branch, clear of the dividers (the canvas splits the full height evenly)",
    async (n) => {
      const code = [
        "sequenceDiagram",
        ...Array.from({ length: n }, (_, i) => [
          i === 0 ? "alt g0" : `else g${i}`,
          `  A->>B: m${i}`,
        ]).flat(),
        "end",
      ].join("\n");
      const { nodes, edges } = await draw(code);
      const alt = nodes.find((x) => x.data.shape === "fragment")!;
      const box = nodeBounds(alt);
      const slot = box.height / alt.data.branches!;
      for (let i = 0; i < n; i += 1) {
        const y = messageY(nodes, edges, `m${i}`);
        expect(branchOf(alt, y)).toBe(i);
        // clear of the divider above it, so the line does not cross the label
        expect(y - (box.y + slot * i)).toBeGreaterThanOrEqual(30);
      }
    },
  );

  it("Draws a block with no messages too — the full width of the lifelines", async () => {
    const { nodes } = await draw(
      "sequenceDiagram\n  A->>B: hi\n  opt maybe\n    Note over A: x\n  end\n  loop\n  end",
    );
    const frags = nodes.filter((n) => n.data.shape === "fragment");
    expect(frags).toHaveLength(2);
    for (const f of frags) {
      expect(Number.isFinite(f.position.x)).toBe(true);
      expect(nodeBounds(f).width).toBeGreaterThan(0);
    }
  });

  it("When alt has more than five sections, the overflow is gathered into the last branch — so dividers and messages stay aligned", async () => {
    const branches = ["one", "two", "three", "four", "five", "six"];
    const code = [
      "sequenceDiagram",
      ...branches.flatMap((b, i) => [i === 0 ? `alt ${b}` : `else ${b}`, `  A->>B: m${i}`]),
      "end",
    ].join("\n");
    const { nodes, edges } = await draw(code);
    const alt = nodes.find((n) => n.data.shape === "fragment")!;
    expect(alt.data.branches).toBe(5);
    const box = nodeBounds(alt);
    const yOf = (label: string) => {
      const e = edges.find((x) => x.data?.label === label)!;
      const lifeline = nodes.find((n) => n.id === e.source)!;
      return (
        lifeline.position.y +
        (Number(/-(\d+(?:\.\d+)?)$/.exec(e.sourceHandle!)![1]) / 100) * nodeBounds(lifeline).height
      );
    };
    // the fifth branch holds m4 and m5
    expect(branches.map((_, i) => branchOf(alt, yOf(`m${i}`)))).toEqual([0, 1, 2, 3, 4, 4]);
    expect(box.height).toBeGreaterThan(0);
  });

  it("Reports par and critical, whose sections stack without dividers", async () => {
    const { plan } = await draw(
      "sequenceDiagram\n  par a\n    A->>B: x\n  and b\n    A->>B: y\n  end",
    );
    expect(plan.omitted).toContain("dividers in par and critical blocks");
  });

  it("destroy becomes a destruction mark at that message's height", async () => {
    const { nodes } = await draw("sequenceDiagram\n  A->>B: make\n  destroy B\n  A->>B: kill");
    expect(byLabel(nodes, "B").data.destroyY).toBeGreaterThan(0);
  });

  it("Leaves out Note, break, rect, autonumber and box and reports them — messages inside break are drawn", async () => {
    const { plan, edges } = await draw(`sequenceDiagram
  box Aqua Team
  participant A
  end
  autonumber
  Note over A: hi
  break stop
    A->>B: inside
  end
  rect rgb(1,2,3)
    A->>B: lit
  end`);
    expect(plan.omitted).toEqual(
      expect.arrayContaining([
        "participant boxes",
        "autonumber",
        "notes",
        "break blocks",
        "background highlights",
      ]),
    );
    expect(edges.map((e) => e.data?.label)).toEqual(["inside", "lit"]);
  });
});

describe("classDiagram → classes (#200)", () => {
  it("Members, stereotypes, abstract and generics", async () => {
    const { nodes } = await draw(`classDiagram
  class Shape["Shape thing"] {
    <<interface>>
    -int id
    +List~Item~ items
    +area() double
    +draw(Map~K,V~ m) void
  }
  class Base
  <<abstract>> Base`);
    expect(byLabel(nodes, "Shape thing").data).toMatchObject({
      shape: "class",
      stereotype: "interface",
      attributes: ["- int id", "+ List<Item> items"],
      methods: ["+ area(): double", "+ draw(Map<K,V> m): void"],
    });
    expect(byLabel(nodes, "Base").data.isAbstract).toBe(true);
  });

  it("A generic class name uses angle brackets", async () => {
    const { nodes } = await draw("classDiagram\n  class Square~Shape~\n  Square --> Other");
    expect(nodes.map((n) => n.data.label)).toEqual(["Square<Shape>", "Other"]);
  });

  it("Relationship ends, lines, multiplicity and names", async () => {
    const { nodes, edges } = await draw(`classDiagram
  Animal <|-- Dog
  Shape <|.. Box : impl
  Car "1" *-- "4" Wheel : has
  Team o-- Player
  A --> B
  C ..> D
  E -- F`);
    const between = (s: string, t: string) =>
      edges.find((e) => ends(nodes, e).join() === [s, t].join())!.data!;
    expect(between("Animal", "Dog")).toMatchObject({ markerStart: "triangle", variant: "solid" });
    expect(between("Shape", "Box")).toMatchObject({
      markerStart: "triangle",
      variant: "dashed",
      label: "impl",
    });
    expect(between("Car", "Wheel")).toMatchObject({
      markerStart: "diamond",
      labelStart: "1",
      labelEnd: "4",
      label: "has",
    });
    expect(between("Team", "Player")).toMatchObject({ markerStart: "diamond-open" });
    expect(between("A", "B")).toMatchObject({ markerStart: "none", markerEnd: "open" });
    expect(between("C", "D")).toMatchObject({ markerEnd: "open", variant: "dashed" });
    expect(between("E", "F")).toMatchObject({ markerStart: "none", markerEnd: "none" });
  });

  it("Parent and whole go on top — the triangle side of inheritance and realization, the diamond side of composition and aggregation comes first (UML convention)", async () => {
    const { nodes } = await draw(`classDiagram
  Animal <|-- Dog
  Cat --|> Animal
  Pet <|.. Dog
  Leg --* Dog
  Owner o-- Dog`);
    const y = (label: string) => byLabel(nodes, label).position.y;
    expect(y("Animal")).toBeLessThan(y("Dog"));
    expect(y("Animal")).toBeLessThan(y("Cat"));
    expect(y("Pet")).toBeLessThan(y("Dog"));
    expect(y("Dog")).toBeLessThan(y("Leg"));
    expect(y("Owner")).toBeLessThan(y("Dog"));
  });

  it("The parent is on top or left in reversed directions too — BT puts it in the last layer (top), RL in the last layer (left) (#206)", async () => {
    const bt = await draw("classDiagram\n  direction BT\n  Dog --|> Animal\n  Cat --|> Animal");
    expect(byLabel(bt.nodes, "Animal").position.y).toBeLessThan(
      byLabel(bt.nodes, "Dog").position.y,
    );
    expect(byLabel(bt.nodes, "Animal").position.y).toBeLessThan(
      byLabel(bt.nodes, "Cat").position.y,
    );
    const rl = await draw("classDiagram\n  direction RL\n  Animal <|-- Dog");
    expect(byLabel(rl.nodes, "Animal").position.x).toBeLessThan(
      byLabel(rl.nodes, "Dog").position.x,
    );
  });

  it("A labeled line is lengthened so its labels don't overlap — two multiplicities and one name", async () => {
    const { nodes } = await draw('classDiagram\n  Car "1" *-- "4" Wheel : has');
    const car = nodeBounds(byLabel(nodes, "Car"));
    // three label pills stacked (~22 each) need more than the bare 80 rank gap
    expect(nodeBounds(byLabel(nodes, "Wheel")).y - (car.y + car.height)).toBeGreaterThanOrEqual(
      110,
    );
  });

  it("Follows direction LR, and reports note, namespace and lollipop", async () => {
    const { nodes, plan } = await draw(`classDiagram
  direction LR
  A --> B
  C ()-- D
  namespace NS {
    class K
  }
  note for A "hi"`);
    expect(byLabel(nodes, "B").position.x).toBeGreaterThan(byLabel(nodes, "A").position.x);
    expect(plan.omitted).toEqual(
      expect.arrayContaining(["notes", "namespaces", "lollipop interfaces"]),
    );
  });
});

describe("erDiagram → entities (#200)", () => {
  it("Columns, keys and the alias label", async () => {
    const { nodes } = await draw(`erDiagram
  CUSTOMER["Customer"] {
    string id PK
    string org_id FK "owner"
    int age
  }`);
    expect(nodes[0]!.data).toMatchObject({
      shape: "entity",
      label: "Customer",
      columns: ["id string PK", "org_id string FK", "age int"],
    });
  });

  it("Follows direction LR", async () => {
    const { nodes } = await draw("erDiagram\n  direction LR\n  A ||--o{ B : has");
    expect(byLabel(nodes, "B").position.x).toBeGreaterThan(byLabel(nodes, "A").position.x);
  });

  it("Cardinality at both ends, identifying/non-identifying, role label", async () => {
    const { nodes, edges, plan } = await draw(`erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER |o..|{ LINE : ""`);
    const places = edges.find((e) => ends(nodes, e).join() === "CUSTOMER,ORDER")!.data!;
    expect(places).toMatchObject({
      markerStart: "one",
      markerEnd: "zero-many",
      variant: "solid",
      label: "places",
    });
    const line = edges.find((e) => ends(nodes, e).join() === "ORDER,LINE")!.data!;
    expect(line).toMatchObject({
      markerStart: "zero-one",
      markerEnd: "one-many",
      variant: "dashed",
    });
    expect(line.label ?? "").toBe("");
    expect(plan.omitted).toEqual([]);
  });

  it("Reports attribute comments", async () => {
    const { plan } = await draw('erDiagram\n  A {\n    int id PK "the id"\n  }');
    expect(plan.omitted).toContain("attribute comments");
  });
});

describe("What can't be drawn (#200 D6)", () => {
  it("An unsupported kind is reported by its name", async () => {
    await expect(parseMermaid('pie\n  "a": 1')).rejects.toThrow(/Can't draw pie from Mermaid/);
    await expect(parseMermaid("stateDiagram-v2\n  [*] --> S")).rejects.toThrow(
      /Can't draw stateDiagram-v2/,
    );
  });

  it("A syntax error reports Mermaid's first line", async () => {
    const error = await parseMermaid("flowchart LR\n  A -->").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MermaidImportError);
    expect((error as Error).message).toMatch(
      /^Mermaid code has an error: Parse error on line \d+$/,
    );
  });
});
