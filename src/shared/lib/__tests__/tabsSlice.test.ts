import { beforeEach, describe, expect, it, vi } from "vitest";

import { serializeProject } from "../../../features/library/libraryApi";
import { useDiagramStore } from "../store";
import { documentFile } from "../store/document";
import { revealRequestFor } from "../store/reveal";
import {
  DOC_KEYS,
  type DocSnapshot,
  documentPatch,
  GLOBAL_KEYS,
  RESET_KEYS,
  takeDocument,
} from "../store/tabs";
import { makeDoc, makeNode } from "./testFixtures";

const store = () => useDiagramStore.getState();
const ids = () => store().nodes.map((n) => n.id);
const add = (id: string) =>
  store().applyOps([{ op: "add_node", node: { id, label: id, x: 0, y: 0 } }]);

/** the swap tabActions makes: the snapshot in, one set */
const swapIn = (snapshot: DocSnapshot) =>
  useDiagramStore.setState(documentPatch(snapshot, store(), revealRequestFor(snapshot.nodes)));

describe("document slice (#218 D2)", () => {
  beforeEach(() => store().loadDoc(makeDoc([makeNode({ id: "a" })], [], "A"), null));

  it("takeDocument takes only DOC_KEYS, by reference — selection marks stay too (T1)", () => {
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
    const live = store();
    const snap = takeDocument(live);
    expect(Object.keys(snap).sort()).toEqual([...DOC_KEYS].sort());
    for (const key of DOC_KEYS) expect(snap[key]).toBe(live[key]);
    expect(snap.nodes[0]?.selected).toBe(true);
  });

  it("documentPatch restores the slice, clears transient state, and sets both counters to live + 1 (T2)", () => {
    const snap = takeDocument(store());
    useDiagramStore.setState({
      touched: { a: 1 },
      editRequestId: "a",
      pasteCount: 3,
      dragRiders: { a: [] },
      groupResizing: { ids: [], nodes: [], edges: [], committed: false },
      docVersion: 40,
      docSession: 7,
    });
    const reveal = { key: 99, mode: "fit" as const };
    const patch = documentPatch(snap, store(), reveal);
    for (const key of DOC_KEYS) expect(patch[key]).toBe(snap[key]);
    expect(patch).toMatchObject({
      touched: {},
      editRequestId: null,
      pasteCount: 0,
      dragRiders: null,
      groupResizing: null,
      revealRequest: reveal,
      docVersion: 41,
      docSession: 8,
    });
  });

  it("every non-function store field is in exactly one of the three — new fields must be classified (T3)", () => {
    const fields = Object.entries(store())
      .filter(([, value]) => typeof value !== "function")
      .map(([key]) => key)
      .sort();
    const listed = [...DOC_KEYS, ...RESET_KEYS, ...GLOBAL_KEYS];
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(fields);
  });

  it("the fields a tab carries have no pages (#229 D1, T18)", () => {
    expect([...DOC_KEYS]).toEqual([
      "title",
      "nodes",
      "edges",
      "past",
      "future",
      "filePath",
      "projectId",
      "enteredGroup",
    ]);
  });

  it("swap round trip — undo in A undoes only A's edits, B stays as it was (T4)", () => {
    store().loadDoc(makeDoc([makeNode({ id: "A-1" })], [], "A"), null);
    add("x");
    add("y");
    const a = takeDocument(store());

    store().loadDoc(makeDoc([makeNode({ id: "b" })], [], "B"), null);
    add("b2");
    const b = takeDocument(store());

    swapIn(a);
    expect(ids()).toEqual(["A-1", "x", "y"]);
    store().undo();
    store().undo();
    expect(ids()).toEqual(["A-1"]);

    swapIn(b);
    expect(store().title).toBe("B");
    expect(ids()).toEqual(["b", "b2"]);
    store().undo();
    expect(ids()).toEqual(["b"]);
  });

  it("a swap is a single set — subscribers are called once (T5)", () => {
    const snap = takeDocument(store());
    store().loadDoc(makeDoc([], [], "Other"), null);
    const listener = vi.fn();
    const off = useDiagramStore.subscribe(listener);
    swapIn(snap);
    off();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("bytes serialized from the slice match the live store (T6)", () => {
    add("x");
    expect(serializeProject(documentFile(takeDocument(store())))).toBe(
      serializeProject(store().toDoc()),
    );
  });
});
