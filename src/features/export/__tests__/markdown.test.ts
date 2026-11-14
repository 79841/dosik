import { describe, expect, it } from "vitest";

import type { DiagramEdge } from "../../../shared/lib/types";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { toMarkdown, toMermaid } from "../markdown";

describe("toMermaid", () => {
  it("Maps each shape to its Mermaid syntax", () => {
    const doc = makeDoc(
      [
        makeNode({ id: "a", label: "Box", shape: "rect" }),
        makeNode({ id: "b", label: "Decide", shape: "diamond", y: 200 }),
        makeNode({ id: "c", label: "DB", shape: "cylinder", y: 400 }),
        makeNode({ id: "d", label: "Input", shape: "parallelogram", y: 600 }),
        makeNode({ id: "e", label: "Hexagon", shape: "hexagon", y: 800 }),
        makeNode({ id: "f", label: "Ellipse", shape: "ellipse", y: 1000 }),
      ],
      [],
    );
    const mermaid = toMermaid(doc);
    expect(mermaid).toContain('a["Box"]');
    expect(mermaid).toContain('b{"Decide"}');
    expect(mermaid).toContain('c[("DB")]');
    expect(mermaid).toContain('d[/"Input"/]');
    expect(mermaid).toContain('e{{"Hexagon"}}');
    expect(mermaid).toContain('f(["Ellipse"])');
  });

  it("Expresses edge style (dashed/arrow/label) in the connector", () => {
    const doc = makeDoc(
      [makeNode({ id: "a" }), makeNode({ id: "b", y: 200 })],
      [makeEdge({ id: "e1", source: "a", target: "b", label: "Yes", variant: "dashed" })],
    );
    expect(toMermaid(doc)).toContain("-.->|Yes|");

    const noArrow = makeDoc(
      [makeNode({ id: "a" }), makeNode({ id: "b", y: 200 })],
      [makeEdge({ id: "e1", source: "a", target: "b", arrow: false })],
    );
    expect(toMermaid(noArrow)).toContain("---");
  });

  it("Writes a line whose head is only at the start in the direction it points — the same reading as alignment (#182)", () => {
    const e = makeEdge({ id: "e1", source: "v", target: "s" });
    const backwards: DiagramEdge = {
      ...e,
      data: { ...e.data!, markerStart: "arrow", markerEnd: "none" },
    };
    const doc = makeDoc(
      [makeNode({ id: "s", label: "Start" }), makeNode({ id: "v", label: "Validate", y: 200 })],
      [backwards],
    );
    const line = toMermaid(doc)
      .split("\n")
      .find((l) => l.includes("-->"))!;
    expect(line.indexOf("Start")).toBeLessThan(line.indexOf("-->"));
    expect(line.indexOf("Validate")).toBeGreaterThan(line.indexOf("-->"));
  });

  it("Uses LR when the layout is wide and TD when it is tall", () => {
    const wide = makeDoc([makeNode({ id: "a", x: 0 }), makeNode({ id: "b", x: 900 })], []);
    expect(toMermaid(wide)).toMatch(/^flowchart LR/);

    const tall = makeDoc([makeNode({ id: "a", y: 0 }), makeNode({ id: "b", y: 900 })], []);
    expect(toMermaid(tall)).toMatch(/^flowchart TD/);
  });

  it("Safely escapes ids with special characters and labels with quotes", () => {
    const doc = makeDoc(
      [
        makeNode({ id: "no-de 1!", label: 'Speech "quote"' }),
        makeNode({ id: "2nd", label: "Starts with a digit", y: 200 }),
      ],
      [makeEdge({ id: "e1", source: "no-de 1!", target: "2nd" })],
    );
    const mermaid = toMermaid(doc);
    expect(mermaid).toContain("#quot;quote#quot;");
    expect(mermaid).not.toContain("no-de 1!");
    // An id that starts with a digit gets a prefix
    expect(mermaid).toMatch(/n1(_\d+)?2nd/);
  });

  it("Declares unconnected nodes too", () => {
    const doc = makeDoc(
      [
        makeNode({ id: "a" }),
        makeNode({ id: "b", y: 200 }),
        makeNode({ id: "lonely", label: "Loner", y: 400 }),
      ],
      [makeEdge({ id: "e1", source: "a", target: "b" })],
    );
    expect(toMermaid(doc)).toContain('lonely("Loner")');
  });

  it("Leaves anchor nodes and free arrows out of Mermaid", () => {
    const doc = makeDoc(
      [
        makeNode({ id: "a", label: "Real node" }),
        makeNode({ id: "p1", shape: "anchor", y: 300 }),
        makeNode({ id: "p2", shape: "anchor", y: 400 }),
      ],
      [makeEdge({ id: "free", source: "p1", target: "p2" })],
    );
    const mermaid = toMermaid(doc);
    expect(mermaid).toContain("Real node");
    expect(mermaid).not.toContain("p1");
    expect(mermaid).not.toContain("p2");
  });

  it("toMarkdown includes the title and a mermaid code block", () => {
    const doc = makeDoc([makeNode({ id: "a" })], [], "My diagram");
    const markdown = toMarkdown(doc);
    expect(markdown).toContain("# My diagram");
    expect(markdown).toContain("```mermaid");
    expect(markdown.trim().endsWith("```")).toBe(true);
  });
});

describe("toMermaid — sequenceDiagram", () => {
  const lifeline = (id: string, x: number, extra: Record<string, unknown> = {}) => {
    const n = makeNode({
      id,
      label: id.toUpperCase(),
      shape: "lifeline",
      x,
      y: 0,
      width: 120,
      height: 360,
    });
    n.data = { ...n.data, ...extra };
    return n;
  };
  /** A message = a lifeline↔lifeline edge with pct handles */
  const msg = (
    id: string,
    source: string,
    target: string,
    pct: number,
    data: Record<string, unknown> = {},
    targetPct = pct,
  ): DiagramEdge => {
    const e = makeEdge({ id, source, target, label: id });
    return {
      ...e,
      sourceHandle: `right-${pct}`,
      targetHandle: `left-${targetPct}`,
      data: { ...e.data, ...data },
    } as DiagramEdge;
  };

  it("Emits a sequenceDiagram when there are lifelines", () => {
    const out = toMermaid(
      makeDoc([lifeline("a", 0), lifeline("b", 300)], [msg("m", "a", "b", 30)]),
    );
    expect(out.split("\n")[0]).toBe("sequenceDiagram");
    expect(out).toContain("participant a as A");
    expect(out).toContain("participant b as B");
    expect(out).toContain("a->>b: m");
  });

  it("Orders participants by ascending x and messages by ascending y", () => {
    const out = toMermaid(
      makeDoc(
        [lifeline("b", 300), lifeline("a", 0)],
        [msg("late", "a", "b", 60), msg("early", "a", "b", 20)],
      ),
    );
    const lines = out.split("\n").map((l) => l.trim());
    expect(lines.indexOf("participant a as A")).toBeLessThan(lines.indexOf("participant b as B"));
    expect(lines.indexOf("a->>b: early")).toBeLessThan(lines.indexOf("a->>b: late"));
  });

  it("dashed becomes -->>, no arrowhead becomes ->", () => {
    const out = toMermaid(
      makeDoc(
        [lifeline("a", 0), lifeline("b", 300)],
        [
          msg("res", "b", "a", 40, { variant: "dashed" }),
          msg("plain", "a", "b", 20, { markerEnd: "none", arrow: false }),
        ],
      ),
    );
    expect(out).toContain("b-->>a: res");
    expect(out).toContain("a->b: plain");
  });

  it("A self message is A->>A", () => {
    const a = lifeline("a", 0);
    const e = {
      ...makeEdge({ id: "self", source: "a", target: "a", label: "retry" }),
      sourceHandle: "right-30",
      targetHandle: "right-40",
    };
    expect(toMermaid(makeDoc([a], [e]))).toContain("a->>a: retry");
  });

  it("An activation bar puts activate/deactivate on the first and last messages it spans", () => {
    // height 360, bar 100~200 → pct 27.8~55.6
    const b = lifeline("b", 300, { activations: [{ y0: 100, y1: 200 }] });
    const out = toMermaid(
      makeDoc(
        [lifeline("a", 0), b],
        [msg("in", "a", "b", 30), msg("work", "a", "b", 45), msg("out", "b", "a", 50)],
      ),
    );
    const lines = out.split("\n").map((l) => l.trim());
    expect(lines.indexOf("activate b")).toBe(lines.indexOf("a->>b: in") + 1);
    expect(lines.indexOf("deactivate b")).toBe(lines.indexOf("b->>a: out") + 1);
  });

  it("Omits an activation bar that spans no message", () => {
    const b = lifeline("b", 300, { activations: [{ y0: 300, y1: 340 }] });
    const out = toMermaid(makeDoc([lifeline("a", 0), b], [msg("m", "a", "b", 20)]));
    expect(out).not.toContain("activate");
  });

  it("destroy comes **before** the destroying message (Mermaid syntax)", () => {
    const b = lifeline("b", 300, { destroyY: 250 });
    const out = toMermaid(
      makeDoc([lifeline("a", 0), b], [msg("first", "a", "b", 20), msg("last", "a", "b", 40)]),
    );
    const lines = out.split("\n").map((l) => l.trim());
    // Mermaid: "destroyed participant does not have an associated destroying
    // message after its declaration" — if destroy comes after, parsing fails outright
    expect(lines.indexOf("destroy b")).toBe(lines.indexOf("a->>b: last") - 1);
  });

  it("Omits found/lost messages and notes it in a comment", () => {
    const anchor = makeNode({ id: "an", shape: "anchor", x: -100, y: 100, width: 12, height: 12 });
    const fl = {
      ...makeEdge({ id: "fl", source: "an", target: "a", label: "webhook" }),
      sourceHandle: "center",
      targetHandle: "left-30",
    };
    const out = toMermaid(makeDoc([lifeline("a", 0), anchor], [fl]));
    expect(out).not.toContain("webhook");
    expect(out).toMatch(/%%.*found\/lost/i);
  });

  it("Omits mixed-in non-sequence nodes and notes it in a comment", () => {
    const box = makeNode({ id: "box", label: "Box", x: 600, y: 0 });
    const out = toMermaid(makeDoc([lifeline("a", 0), box], [msg("m", "a", "a", 30)]));
    expect(out).not.toContain("Box");
    expect(out).toMatch(/%%/);
  });

  it("Escapes semicolons in labels (the Mermaid statement separator)", () => {
    const out = toMermaid(
      makeDoc(
        [lifeline("a", 0), lifeline("b", 300)],
        [msg("m", "a", "b", 30, { label: "Save; validate" })],
      ),
    );
    expect(out).toContain("Save#59; validate");
    // No unescaped raw semicolon may remain (#59; is allowed)
    expect(out.replace(/#59;/g, "")).not.toContain(";");
  });

  it("Escapes semicolons in participant labels too", () => {
    const a = lifeline("a", 0);
    a.data = { ...a.data, label: "Server; main" };
    expect(toMermaid(makeDoc([a, lifeline("b", 300)], [msg("m", "a", "b", 30)]))).toContain(
      "participant a as Server#59; main",
    );
  });

  it("Flips the operands when only markerStart is set, to keep the arrowhead direction", () => {
    const out = toMermaid(
      makeDoc(
        [lifeline("a", 0), lifeline("b", 300)],
        [msg("m", "a", "b", 30, { markerStart: "arrow", markerEnd: "none", arrow: false })],
      ),
    );
    // The canvas draws the arrowhead at the source (a) — Mermaid draws it at the right operand, so flip
    expect(out).toContain("b->>a: m");
    expect(out).not.toContain("a->>b: m");
  });

  it("Uses the bidirectional syntax for arrowheads at both ends", () => {
    const out = toMermaid(
      makeDoc(
        [lifeline("a", 0), lifeline("b", 300)],
        [msg("m", "a", "b", 30, { markerStart: "arrow", markerEnd: "arrow" })],
      ),
    );
    expect(out).toContain("a<<->>b: m");
  });

  it("Avoids Mermaid reserved-word ids with a prefix", () => {
    const out = toMermaid(
      makeDoc([lifeline("loop", 0), lifeline("end", 300)], [msg("m", "loop", "end", 30)]),
    );
    expect(out).toContain("participant n_loop as");
    expect(out).toContain("participant n_end as");
    expect(out).toContain("n_loop->>n_end: m");
  });

  it("The flowchart path avoids reserved-word ids too (old debt)", () => {
    const out = toMermaid(makeDoc([makeNode({ id: "end", label: "End", x: 0, y: 0 })], []));
    expect(out).toContain("n_end");
  });

  it("Keeps the existing flowchart when there are no lifelines", () => {
    const out = toMermaid(makeDoc([makeNode({ id: "a", label: "A", x: 0, y: 0 })], []));
    expect(out.split("\n")[0]).toMatch(/^flowchart /);
  });

  it("Orders messages by the source handle's y (not the target y)", () => {
    // a→b has source y=216 (60%) · target y=72 (20%); b→a has source y=144 (40%).
    // Sorting by target y would reverse the order, so the two implementations differ
    const out = toMermaid(
      makeDoc(
        [lifeline("a", 0), lifeline("b", 200)],
        [msg("late", "a", "b", 60, {}, 20), msg("early", "b", "a", 40)],
      ),
    );

    expect(out.indexOf("early")).toBeLessThan(out.indexOf("late"));
  });

  it("An activation bar wraps only messages that touch its lifeline", () => {
    // activate goes *after* the message that triggered the activation. Inside b's active span (100~300)
    // c→d (y≈119) comes before b's message (y≈202), so without the filter
    // activate b is pulled after c→d and wraps an unrelated message
    const out = toMermaid(
      makeDoc(
        [
          lifeline("a", 0),
          lifeline("b", 200, { activations: [{ y0: 100, y1: 300 }] }),
          lifeline("c", 400),
          lifeline("d", 600),
        ],
        [msg("cd", "c", "d", 33), msg("inb", "a", "b", 56)],
      ),
    );

    expect(out.indexOf("cd")).toBeLessThan(out.indexOf("inb"));
    expect(out.indexOf("inb")).toBeLessThan(out.indexOf("activate b"));
  });

  it("Escapes # in labels (otherwise the rest is silently cut off)", () => {
    const out = toMermaid(
      makeDoc(
        [lifeline("a", 0, { label: "C# Server" }), lifeline("b", 200)],
        [msg("m", "a", "b", 50, { label: "step #1; done" })],
      ),
    );

    expect(out).toContain("C#35; Server");
    expect(out).toContain("step #35;1#59; done");
    expect(out).not.toMatch(/#35#59;/);
  });

  it("Escapes %%{...}%% directives in labels", () => {
    const out = toMermaid(
      makeDoc(
        [lifeline("a", 0), lifeline("b", 200)],
        [msg("m", "a", "b", 50, { label: 'x %%{init: {"theme":"dark"}}%% y' })],
      ),
    );

    expect(out).not.toContain("%%{init");
    expect(out).toContain("#37;#37;{init");
  });

  it("Reports dropped free arrows too", () => {
    const doc = makeDoc(
      [
        lifeline("a", 0),
        makeNode({ id: "p1", shape: "anchor" }),
        makeNode({ id: "p2", shape: "anchor" }),
      ],
      [makeEdge({ id: "free", source: "p1", target: "p2", label: "IMPORTANT" })],
    );

    expect(toMermaid(doc)).toContain("free arrows");
  });

  it("Replaces a whitespace-only label with the id", () => {
    const out = toMermaid(makeDoc([lifeline("a", 0, { label: "   " }), lifeline("b", 200)], []));

    expect(out).not.toMatch(/participant a as\s*$/m);
  });
});

/**
 * A diagram is one canvas (#229 D17): its Markdown is the title and one
 * mermaid block — byte for byte what a one-page document gave before pages
 * were removed. The expected text was taken from the build before #229.
 */
describe("Single-canvas Markdown is byte-for-byte the same as before #229 (#229 D17, T21)", () => {
  it("Title + one mermaid block", () => {
    const doc = makeDoc(
      [
        makeNode({ id: "web", label: "Web app", shape: "rounded", color: "blue" }),
        makeNode({ id: "api", label: "API", x: 260 }),
        makeNode({ id: "db", label: "Orders DB", shape: "cylinder", x: 520 }),
        makeNode({ id: "q", label: "Valid?", shape: "diamond", x: 260, y: 200 }),
      ],
      [
        makeEdge({ id: "e1", source: "web", target: "api", label: "HTTPS" }),
        makeEdge({ id: "e2", source: "api", target: "db", variant: "dashed" }),
        makeEdge({ id: "e3", source: "api", target: "q" }),
      ],
      "Checkout — Payment",
    );
    expect(toMarkdown(doc)).toBe(
      [
        "# Checkout — Payment",
        "",
        "```mermaid",
        "flowchart LR",
        '    web("Web app") -->|HTTPS| api("API")',
        '    api -.-> db[("Orders DB")]',
        '    api --> q{"Valid?"}',
        "    style web fill:#E6EEF9,stroke:#2B66B8,color:#1A1A1A",
        "    style api fill:#EEE9F8,stroke:#5B3DB5,color:#1A1A1A",
        "    style db fill:#EEE9F8,stroke:#5B3DB5,color:#1A1A1A",
        "    style q fill:#EEE9F8,stroke:#5B3DB5,color:#1A1A1A",
        "```",
        "",
      ].join("\n"),
    );
  });
});
