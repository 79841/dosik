import { describe, expect, it } from "vitest";

import { mermaidSource } from "../mermaidSource";

describe("Extracting Mermaid code from clipboard text (#200)", () => {
  it("Bare code stays as is", () => {
    const code = "flowchart LR\n    a --> b";
    expect(mermaidSource(code)).toEqual({ code, blocks: 1 });
  });

  it("A single line chained with semicolons is also Mermaid — ; is Mermaid's statement separator", () => {
    for (const code of [
      "graph TD;A-->B;B-->C;",
      "flowchart LR; A-->B",
      "sequenceDiagram; A->>B: hi",
    ]) {
      expect(mermaidSource(code)?.code).toBe(code);
    }
  });

  it("A single line inside a fence is also Mermaid — the fence already says so", () => {
    expect(mermaidSource("```mermaid\nflowchart LR\n```")?.code).toBe("flowchart LR");
  });

  it("Code inside a ```mermaid fence", () => {
    expect(mermaidSource("```mermaid\nsequenceDiagram\n    a->>b: hi\n```")).toEqual({
      code: "sequenceDiagram\n    a->>b: hi",
      blocks: 1,
    });
  });

  it("A fence inside Markdown — the text before and after is dropped (Copy as Markdown output)", () => {
    const md = "# Title\n\n```mermaid\nerDiagram\n    A ||--o{ B : has\n```\n\nmore text";
    expect(mermaidSource(md)).toEqual({ code: "erDiagram\n    A ||--o{ B : has", blocks: 1 });
  });

  it("With several blocks, the first block and the block count", () => {
    const md =
      "## One\n\n```mermaid\ngraph TD\n  a\n```\n\n## Two\n\n```mermaid\nclassDiagram\n  class A\n```\n";
    expect(mermaidSource(md)).toEqual({ code: "graph TD\n  a", blocks: 2 });
  });

  it("Skips the front matter, comments and init directives to look at the keyword", () => {
    const code =
      "---\ntitle: Hi\n---\n%%{init: {'theme':'dark'}}%%\n%% a comment\n\nclassDiagram\n  class A";
    expect(mermaidSource(code)?.code).toBe(code);
  });

  it("Accepts CRLF line breaks too", () => {
    expect(mermaidSource("```mermaid\r\nflowchart TD\r\n  a-->b\r\n```")?.code).toBe(
      "flowchart TD\n  a-->b",
    );
  });

  it("Unsupported kinds are still seen as Mermaid — then 'can't draw' is reported", () => {
    expect(mermaidSource('pie\n  "a": 1')?.code).toBe('pie\n  "a": 1');
    expect(mermaidSource("stateDiagram-v2\n  [*] --> S")).not.toBeNull();
  });

  it("Plain text and empty text are not Mermaid", () => {
    expect(mermaidSource("hello world")).toBeNull();
    expect(mermaidSource("Order\nCustomer")).toBeNull();
    expect(mermaidSource("")).toBeNull();
    expect(mermaidSource("   \n  ")).toBeNull();
    // one line opening with a keyword-like word is a sentence, not a diagram
    expect(mermaidSource("pie chart of revenue")).toBeNull();
    expect(mermaidSource("timeline for the launch")).toBeNull();
    expect(mermaidSource("graph TD")).toBeNull();
    // a keyword inside a word is not the keyword
    expect(mermaidSource("graphql schema")).toBeNull();
    expect(mermaidSource("piechart")).toBeNull();
  });

  it("A fence in another language is not Mermaid", () => {
    expect(mermaidSource("```js\nconst a = 1\n```")).toBeNull();
  });

  it("Trims leading and trailing whitespace", () => {
    expect(mermaidSource("\n\n  flowchart LR\n  a\n\n")?.code).toBe("flowchart LR\n  a");
  });
});
