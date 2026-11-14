import { describe, expect, it } from "vitest";

import type { AgentOp } from "../../../shared/lib/types";
import { cutAtRemovedOp, splitAtNewDiagram } from "../bridgeBatch";

const add = (id: string): AgentOp => ({ op: "add_node", node: { id, label: id, x: 0, y: 0 } });
const made = (title?: string): AgentOp => ({ op: "new_diagram", title });

/** the bridge's batch, cut where it starts another diagram (#229 D15, T25) */
describe("batch splitting (#229 D15, T25)", () => {
  it("[a, new, b, new, c] → lead [a], parts [{new, [b]}, {new, [c]}]", () => {
    const [a, b, c] = [add("a"), add("b"), add("c")];
    const first = made("One");
    const second = made("Two");
    expect(splitAtNewDiagram([a!, first, b!, second, c!])).toEqual({
      lead: [a],
      parts: [
        { create: first, ops: [b] },
        { create: second, ops: [c] },
      ],
    });
  });

  it("returns only lead without new_diagram", () => {
    const ops = [add("a"), add("b")];
    expect(splitAtNewDiagram(ops)).toEqual({ lead: ops, parts: [] });
    expect(splitAtNewDiagram([])).toEqual({ lead: [], parts: [] });
  });

  it("leading new_diagram — lead is empty, and of two in a row the first gets no ops", () => {
    const first = made();
    const second = made();
    expect(splitAtNewDiagram([first, second, add("x")])).toEqual({
      lead: [],
      parts: [
        { create: first, ops: [] },
        { create: second, ops: [add("x")] },
      ],
    });
  });
});

/** a removed page op stops the batch — counted over the whole batch, new_diagram parts too */
describe("cutting at a removed page op (#229 D15)", () => {
  it("keeps ops up to the page op and counts the ones after it", () => {
    const page = { op: "add_page" } as unknown as AgentOp;
    expect(cutAtRemovedOp([add("a"), page, made(), add("b")])).toEqual({
      ops: [add("a"), page],
      cut: { op: "add_page", dropped: 2 },
    });
  });

  it("returns the ops unchanged without a page op", () => {
    const ops = [add("a"), made(), add("b")];
    expect(cutAtRemovedOp(ops)).toEqual({ ops, cut: null });
  });

  it("drops nothing for a trailing page op", () => {
    const page = { op: "delete_page", id: "p" } as unknown as AgentOp;
    expect(cutAtRemovedOp([add("a"), page])).toEqual({
      ops: [add("a"), page],
      cut: { op: "delete_page", dropped: 0 },
    });
  });
});
