import { beforeEach, describe, expect, it } from "vitest";

import { HISTORY_LIMIT } from "../store/history";
import { useDiagramStore } from "../store";
import { MULTI_PAGE_ERROR } from "../store/document";
import type { AgentOp } from "../types";
import { makeDoc, makeNode } from "./testFixtures";

const store = () => useDiagramStore.getState();
const ids = () => store().nodes.map((n) => n.id);
const add = (id: string): AgentOp => ({ op: "add_node", node: { id, label: id, x: 0, y: 0 } });
const v2 = {
  version: 2,
  title: "Book",
  pages: [{ id: "p1", name: "One", nodes: [], edges: [] }],
};

/** the store holds one canvas (#229 D1, D2, D15) */
describe("Store — one canvas (#229 D1·D2, T17)", () => {
  beforeEach(() => store().loadDoc(makeDoc([makeNode({ id: "a" })], [], "Start"), null));

  it("has no page state or actions", () => {
    const state = store() as unknown as Record<string, unknown>;
    for (const key of [
      "pages",
      "activePageId",
      "pageStash",
      "addPage",
      "switchPage",
      "renamePage",
      "deletePage",
      "duplicatePage",
      "movePage",
      "replacePages",
      "stepPageFrame",
      "applyOpsToPage",
      "toPageDoc",
    ]) {
      expect(state).not.toHaveProperty(key);
    }
  });

  it("loadDoc v2 → MULTI_PAGE_ERROR throws, leaving state unchanged", () => {
    store().commit();
    const before = { ...store() };
    expect(() => store().loadDoc(v2 as never, "/tmp/b.dosik.json")).toThrow(MULTI_PAGE_ERROR);
    // `pages` beside nodes and edges is a multi-page document too
    expect(() => store().loadDoc({ ...makeDoc([], []), pages: [] } as never, null)).toThrow(
      MULTI_PAGE_ERROR,
    );
    expect(store().nodes).toBe(before.nodes);
    expect(store().title).toBe("Start");
    expect(store().past).toBe(before.past);
    expect(store().docSession).toBe(before.docSession);
    expect(store().filePath).toBeNull();
  });

  it("loadDoc v1 → clears history and bumps docSession", () => {
    store().commit();
    const session = store().docSession;
    store().loadDoc(makeDoc([makeNode({ id: "b" })], [], "Next"), "/tmp/n.dosik.json");
    expect(ids()).toEqual(["b"]);
    expect(store().title).toBe("Next");
    expect(store().past).toEqual([]);
    expect(store().future).toEqual([]);
    expect(store().docSession).toBe(session + 1);
    expect(store().filePath).toBe("/tmp/n.dosik.json");
    expect(store().projectId).toBeNull();
  });

  it("undo/redo snapshot the title, nodes, and edges", () => {
    store().applyOps([add("b"), { op: "set_title", title: "Two" }]);
    expect(store().past).toHaveLength(1);
    expect(Object.keys(store().past[0]!).sort()).toEqual(["edges", "nodes", "title"]);
    store().undo();
    expect(ids()).toEqual(["a"]);
    expect(store().title).toBe("Start");
    store().redo();
    expect(ids()).toEqual(["a", "b"]);
    expect(store().title).toBe("Two");
  });

  it("toDoc is always v1", () => {
    const doc = store().toDoc();
    expect(doc).toEqual({ version: 1, title: "Start", nodes: expect.any(Array), edges: [] });
  });
});

/** a batch on the one canvas (#229 D15, T19) */
describe("applyOps — one canvas (#229 D15, T19)", () => {
  beforeEach(() => store().loadDoc(makeDoc([makeNode({ id: "a" })], [], "Start"), null));

  it("one batch = one undo", () => {
    store().applyOps([add("b"), add("c"), add("d")]);
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(ids()).toEqual(["a"]);
  });

  it("a batch with no effect leaves no history — and keeps the redo history", () => {
    store().applyOps([add("b")]);
    store().undo();
    const { past, future } = store();
    const result = store().applyOps([{ op: "delete_node", id: "nope" }]);
    expect(result.applied).toBe(0);
    expect(store().past).toBe(past);
    expect(store().future).toBe(future);
  });

  it("at the history cap, a no-op batch does not drop the oldest step", () => {
    for (let i = 0; i < HISTORY_LIMIT; i++) store().applyOps([add(`n${i}`)]);
    const past = store().past;
    expect(past).toHaveLength(HISTORY_LIMIT);
    store().applyOps([{ op: "delete_node", id: "nope" }]);
    expect(store().past).toBe(past);
  });

  it.each(["add_page", "switch_page", "rename_page", "delete_page"])(
    "%s → an error that says why; ops after it are not applied, ops before it are",
    (name) => {
      const result = store().applyOps([
        add("before"),
        { op: name, id: "p", name: "P" } as unknown as AgentOp,
        add("after1"),
        add("after2"),
      ]);
      expect(result.applied).toBe(1);
      expect(result.errors).toEqual([
        `${name}: pages were removed — a diagram is one canvas. Use new_diagram to start another diagram.`,
        `${name}: the 2 ops after it were not applied`,
      ]);
      expect(ids()).toEqual(["a", "before"]);
      expect(store().past).toHaveLength(1);
    },
  );

  it("when the page op is last there is no trailing-op sentence; with one after it, singular", () => {
    expect(store().applyOps([{ op: "add_page" } as unknown as AgentOp]).errors).toHaveLength(1);
    expect(store().applyOps([{ op: "add_page" } as unknown as AgentOp, add("x")]).errors[1]).toBe(
      "add_page: the 1 op after it was not applied",
    );
    expect(ids()).toEqual(["a"]);
  });

  it("set_diagram v1 → replaces the whole diagram and comes back with one undo", () => {
    const result = store().applyOps([
      {
        op: "set_diagram",
        doc: makeDoc([makeNode({ id: "x" }), makeNode({ id: "y" })], [], "New"),
      },
    ]);
    expect(result).toEqual({ applied: 1, errors: [] });
    expect(ids()).toEqual(["x", "y"]);
    expect(store().title).toBe("New");
    store().undo();
    expect(ids()).toEqual(["a"]);
    expect(store().title).toBe("Start");
  });

  it("set_diagram with pages → error, unchanged", () => {
    const result = store().applyOps([{ op: "set_diagram", doc: v2 } as unknown as AgentOp]);
    expect(result.applied).toBe(0);
    expect(result.errors[0]).toBe(
      "set_diagram: a document with pages is not supported — a diagram is one canvas (send nodes and edges)",
    );
    expect(ids()).toEqual(["a"]);
    expect(store().past).toEqual([]);
  });

  it("new_diagram → rejection message, later ops not applied — chat and headless edit a single diagram", () => {
    const result = store().applyOps([{ op: "new_diagram", title: "Other" } as AgentOp, add("x")]);
    expect(result.applied).toBe(0);
    expect(result.errors).toEqual([
      "new_diagram: only POST /api/ops can start a new diagram — this edits one diagram",
      "new_diagram: the 1 op after it was not applied",
    ]);
    expect(ids()).toEqual(["a"]);
  });
});
