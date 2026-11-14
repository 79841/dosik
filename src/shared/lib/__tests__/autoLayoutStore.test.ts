import { beforeEach, describe, expect, it } from "vitest";

import { useDiagramStore } from "../store";
import { arrangeableSelection } from "../store/layout";
import { nodeBounds } from "../edgeUtils";
import { makeDoc, makeEdge, makeNode } from "./testFixtures";

const load = () =>
  useDiagramStore.getState().loadDoc(
    makeDoc(
      [
        makeNode({ id: "a", x: 500, y: 400 }),
        makeNode({ id: "b", x: 0, y: 0 }),
        makeNode({ id: "c", x: 300, y: 50 }),
        makeNode({ id: "ll", shape: "lifeline", x: 900, y: 900, width: 120, height: 300 }),
      ],
      [
        {
          ...makeEdge({ id: "ab", source: "a", target: "b" }),
          sourceHandle: "left",
          targetHandle: "right",
        },
        {
          ...makeEdge({ id: "bc", source: "b", target: "c" }),
          data: { arrow: true, variant: "solid", waypoints: [{ x: 1, y: 2 }] },
        },
      ],
    ),
    null,
  );

const node = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id)!;
const edge = (id: string) => useDiagramStore.getState().edges.find((e) => e.id === id)!;

describe("autoLayout — store (#3)", () => {
  beforeEach(load);

  it("moves shapes and comes back with a single undo", () => {
    const before = useDiagramStore.getState().nodes.map((n) => n.position);
    const result = useDiagramStore.getState().autoLayout("TB");
    expect(result).toEqual({ moved: 3, framesAdjusted: 0 });
    expect(node("a").position.y).toBeLessThan(node("b").position.y);
    useDiagramStore.getState().undo();
    expect(useDiagramStore.getState().nodes.map((n) => n.position)).toEqual(before);
  });

  it("edges between moved shapes re-pick handles and clear bends — the old shape does not fit the new spots", () => {
    useDiagramStore.getState().autoLayout("TB");
    expect(edge("ab").sourceHandle).toBe("bottom");
    expect(edge("ab").targetHandle).toBe("top");
    expect(edge("bc").data?.waypoints).toBeUndefined();
  });

  it("lifelines stay put", () => {
    useDiagramStore.getState().autoLayout("LR");
    expect(node("ll").position).toEqual({ x: 900, y: 900 });
  });

  it("does nothing with fewer than two items to arrange — leaves no empty undo step", () => {
    const past = useDiagramStore.getState().past.length;
    expect(useDiagramStore.getState().autoLayout("TB", ["a"])).toEqual({
      moved: 0,
      reason: "too-few",
    });
    expect(useDiagramStore.getState().past.length).toBe(past);
  });

  it("when already arranged, leaves no undo step and says so (#154)", () => {
    useDiagramStore.getState().autoLayout("TB");
    const past = useDiagramStore.getState().past.length;
    expect(useDiagramStore.getState().autoLayout("TB")).toEqual({
      moved: 0,
      reason: "unchanged",
    });
    expect(useDiagramStore.getState().past.length).toBe(past);
  });
});

describe("layout op — bridge (#3)", () => {
  beforeEach(load);

  it("takes a direction and targets and arranges them", () => {
    const result = useDiagramStore.getState().applyOps([{ op: "layout", direction: "LR" }], true);
    expect(result.errors).toEqual([]);
    expect(result.applied).toBe(1);
    expect(node("a").position.x).toBeLessThan(node("b").position.x);
    // shapes moved by the agent flash
    expect(useDiagramStore.getState().touched.a).toBeDefined();
  });

  it("accepts bottom→top and right→left too (#206)", () => {
    useDiagramStore.getState().applyOps([{ op: "layout", direction: "BT" }]);
    expect(node("a").position.y).toBeGreaterThan(node("b").position.y);
    useDiagramStore.getState().applyOps([{ op: "layout", direction: "RL" }]);
    expect(node("a").position.x).toBeGreaterThan(node("b").position.x);
  });

  it("defaults to top→bottom without a direction", () => {
    useDiagramStore.getState().applyOps([{ op: "layout" }]);
    expect(node("a").position.y).toBeLessThan(node("b").position.y);
  });

  it("rejects invalid arguments", () => {
    const store = useDiagramStore.getState();
    expect(store.applyOps([{ op: "layout", direction: "diagonal" } as never]).errors[0]).toMatch(
      /direction must be TB, BT, LR or RL/,
    );
    expect(store.applyOps([{ op: "layout", ids: "a" } as never]).errors[0]).toMatch(
      /ids must be an array of node ids/,
    );
    expect(store.applyOps([{ op: "layout", ids: ["a", "zzz"] }]).errors[0]).toMatch(
      /unknown node 'zzz'/,
    );
    expect(store.applyOps([{ op: "layout", ids: ["a", "ll"] }]).errors[0]).toMatch(
      /'ll' is a lifeline/,
    );
    expect(store.applyOps([{ op: "layout", ids: ["a"] }]).errors[0]).toMatch(
      /needs two or more shapes/,
    );
  });
});

const overlaps = () => {
  const boxes = useDiagramStore
    .getState()
    .nodes.filter((n) => n.data.shape !== "anchor")
    .map((n) => ({ id: n.id, ...nodeBounds(n) }));
  const hits: string[] = [];
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1))
      if (
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height
      )
        hits.push(`${a.id}×${b.id}`);
  return hits;
};

describe("Arranging does not land on shapes outside the targets (#154)", () => {
  it("selection arrange: a vertically stretched block avoids shapes outside the selection", () => {
    const chain = ["a", "b", "c", "d"];
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [
          ...chain.map((id, i) => makeNode({ id, x: i * 200, y: 0 })),
          makeNode({ id: "out", x: 0, y: 300 }),
        ],
        chain.slice(1).map((id, i) => makeEdge({ id: `e${i}`, source: chain[i]!, target: id })),
      ),
      null,
    );
    expect(overlaps()).toEqual([]);
    useDiagramStore.getState().autoLayout("TB", chain);
    expect(overlaps()).toEqual([]);
    expect(node("out").position).toEqual({ x: 0, y: 300 });
  });

  it("mixed box and sequence document: boxes do not sit on lifelines", () => {
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [
            makeNode({ id: "a", x: 0, y: 0 }),
            makeNode({ id: "b", x: 200, y: 0 }),
            makeNode({ id: "c", x: 400, y: 0 }),
            makeNode({ id: "ll1", shape: "lifeline", x: 0, y: 200, width: 120, height: 300 }),
            makeNode({ id: "ll2", shape: "lifeline", x: 250, y: 200, width: 120, height: 300 }),
          ],
          [
            makeEdge({ id: "ab", source: "a", target: "b" }),
            makeEdge({ id: "bc", source: "b", target: "c" }),
          ],
        ),
        null,
      );
    expect(overlaps()).toEqual([]);
    useDiagramStore.getState().autoLayout("TB");
    expect(overlaps()).toEqual([]);
    useDiagramStore.getState().autoLayout("LR");
    expect(overlaps()).toEqual([]);
  });
});

describe("Keeps heights attached to lifelines (#154)", () => {
  it("box → lifeline edges keep their pct handles", () => {
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [
          makeNode({ id: "a", x: 0, y: 0 }),
          makeNode({ id: "b", x: 0, y: 300 }),
          makeNode({ id: "ll", shape: "lifeline", x: 600, y: 0, width: 120, height: 360 }),
        ],
        [
          makeEdge({ id: "ab", source: "a", target: "b" }),
          {
            ...makeEdge({ id: "al", source: "a", target: "ll" }),
            sourceHandle: "right",
            targetHandle: "left-70",
          },
        ],
      ),
      null,
    );
    useDiagramStore.getState().autoLayout("LR", ["a", "b"]);
    expect(edge("al").targetHandle).toBe("left-70");
  });
});

describe("AI chat knows the layout op (#3)", () => {
  it("the system prompt mentions the layout op — so the agent does not move shapes one by one", async () => {
    const { apiSystemPrompt, cliSystemPrompt } = await import("../../../features/ai/systemPrompt");
    expect(apiSystemPrompt()).toContain('"op":"layout"');
    expect(cliSystemPrompt({ port: 4517, token: "t" })).toContain(
      '{"op":"layout","direction"?,"ids"?}',
    );
  });
});

describe("arrangeableSelection — the toolbar arranges only what is selected (#182)", () => {
  const pick = (nodes: ReturnType<typeof makeNode>[], ids: string[]) =>
    nodes.map((n) => ({ ...n, selected: ids.includes(n.id) }));
  const shapes = [
    makeNode({ id: "a", x: 0, y: 0 }),
    makeNode({ id: "b", x: 300, y: 0 }),
    makeNode({ id: "out", x: 2000, y: 2000 }),
    makeNode({ id: "f", shape: "frame", x: -50, y: -50, width: 600, height: 300 }),
    makeNode({ id: "ll", shape: "lifeline", x: 900, y: 0, width: 120, height: 300 }),
  ];

  it("nothing selected means nothing to arrange — not the whole diagram", () => {
    expect(arrangeableSelection(pick(shapes, []))).toEqual([]);
  });

  it("only arrangeable shapes in the selection — sequence elements and the frame itself are left out", () => {
    expect(arrangeableSelection(pick(shapes, ["a", "out", "ll"]))).toEqual(["a", "out"]);
  });

  it("selecting a frame arranges the shapes inside it", () => {
    expect(arrangeableSelection(pick(shapes, ["f"])).sort()).toEqual(["a", "b"]);
  });
});
