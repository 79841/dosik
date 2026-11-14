import { describe, expect, it } from "vitest";

import { highlightMermaid, type Token } from "../highlightMermaid";

/** the tokens of one line, as [kind, text] pairs — plain text trimmed, blank runs dropped */
const kinds = (line: string) =>
  highlightMermaid(line)[0]!
    .filter((t: Token) => t.kind !== "plain" || t.text.trim() !== "")
    .map((t: Token) => [t.kind, t.kind === "plain" ? t.text.trim() : t.text]);

describe("Mermaid code highlighting (#198)", () => {
  it("Returns the line unchanged — joining the tokens gives the original", () => {
    const code =
      'flowchart LR\n    a["Start"] -->|yes| b{"Valid?"}\n    %% omitted (no flowchart equivalent): pictures';
    expect(
      highlightMermaid(code)
        .map((line) => line.map((t) => t.text).join(""))
        .join("\n"),
    ).toBe(code);
  });

  it("Diagram keywords and direction", () => {
    expect(kinds("flowchart LR")).toEqual([
      ["keyword", "flowchart"],
      ["keyword", "LR"],
    ]);
    expect(kinds("classDiagram")).toEqual([["keyword", "classDiagram"]]);
  });

  it("Arrows, strings and line labels", () => {
    expect(kinds('    a["Start"] -->|yes| b')).toEqual([
      ["plain", "a"],
      ["punct", "["],
      ["string", '"Start"'],
      ["punct", "]"],
      ["arrow", "-->"],
      ["label", "|yes|"],
      ["plain", "b"],
    ]);
  });

  it("classDiagram relationship symbols, annotations and relationship names", () => {
    expect(kinds('    Order "1" *-- "1..*" Item : contains')).toEqual([
      ["plain", "Order"],
      ["string", '"1"'],
      ["arrow", "*--"],
      ["string", '"1..*"'],
      ["plain", "Item"],
      ["label", ": contains"],
    ]);
    expect(kinds("        <<interface>>")).toEqual([["annotation", "<<interface>>"]]);
    expect(kinds("    a ..|> b")).toEqual([
      ["plain", "a"],
      ["arrow", "..|>"],
      ["plain", "b"],
    ]);
  });

  it("A comment line is a comment as a whole", () => {
    expect(kinds("    %% omitted (no flowchart equivalent): pictures")).toEqual([
      ["comment", "%% omitted (no flowchart equivalent): pictures"],
    ]);
  });

  it("A member's visibility symbol is not an arrow", () => {
    expect(kinds("        -id: UUID").some(([kind]) => kind === "arrow")).toBe(false);
  });

  it("Sequence messages", () => {
    expect(kinds("    a->>b: hello")).toEqual([
      ["plain", "a"],
      ["arrow", "->>"],
      ["plain", "b"],
      ["label", ": hello"],
    ]);
    expect(kinds("    participant a as Client")[0]).toEqual(["keyword", "participant"]);
  });

  it("Words not at the start of a line are not colored as keywords — even when a user's name contains note or and", () => {
    expect(kinds("        int note").some(([kind]) => kind === "keyword")).toBe(false);
    expect(
      kinds("    participant b as Server and Cache").filter(([kind]) => kind === "keyword"),
    ).toEqual([["keyword", "participant"]]);
    // a direction is a keyword only after a diagram or direction keyword
    expect(kinds("    direction LR")).toEqual([
      ["keyword", "direction"],
      ["keyword", "LR"],
    ]);
    expect(kinds('    a["LR"] --> TD').some(([kind]) => kind === "keyword")).toBe(false);
  });
});
