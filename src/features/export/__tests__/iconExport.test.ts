import { describe, expect, it } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { toMermaid } from "../markdown";

const iconNode = (id: string, icon: string, label = id) => ({
  ...makeNode({ id, shape: "icon", label }),
  data: { ...makeNode({ id, shape: "icon", label }).data, icon },
});

describe("icon export (#9)", () => {
  it("Mermaid: an unknown id (or one containing a newline) becomes 'unknown' — the comment does not leak into syntax", () => {
    const md = toMermaid(makeDoc([iconNode("db", "x\nA --> B", "DB")], []));
    expect(md).toContain("%% icon: unknown");
    expect(md).not.toContain("A --> B");
    expect(md.split("\n").every((line) => !line.startsWith("A "))).toBe(true);
  });

  it("Mermaid: the comment goes right above the node declaration, at the same indentation", () => {
    const md = toMermaid(makeDoc([iconNode("db", "database", "Orders DB")], []));
    const lines = md.split("\n");
    const note = lines.findIndex((l) => l.includes("%% icon: database"));
    expect(lines[note]!.startsWith("    %%")).toBe(true);
    expect(lines[note + 1]).toContain('["Orders DB"]');
  });

  it("Mermaid: a self-loop writes the comment once; two icons on one edge line are told apart by id", () => {
    const md = toMermaid(
      makeDoc(
        [
          iconNode("a", "browser", "Web"),
          { ...iconNode("b", "api", "API"), position: { x: 300, y: 0 } },
        ],
        [
          makeEdge({ id: "loop", source: "a", target: "a" }),
          makeEdge({ id: "e", source: "a", target: "b" }),
        ],
      ),
    );
    expect(md.match(/%% icon: browser/g)).toHaveLength(1);
    expect(md).toMatch(/%% icon: browser \(\w+\)/);
    expect(md).toMatch(/%% icon: api \(\w+\)/);
  });

  it("Mermaid: exports as a box and leaves the icon id as a comment", () => {
    const md = toMermaid(
      makeDoc(
        [
          iconNode("db", "database", "Orders DB"),
          { ...makeNode({ id: "svc", label: "Service" }), position: { x: 300, y: 0 } },
        ],
        [makeEdge({ id: "e", source: "svc", target: "db" })],
      ),
    );
    expect(md).toContain("%% icon: database");
    expect(md).toContain('["Orders DB"]');
  });
});
