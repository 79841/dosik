import { beforeEach, describe, expect, it } from "vitest";

import { handleCanvasKeyDown } from "../../../features/canvas/canvasKeymap";
import { useDiagramStore } from "../store";
import {
  canGroup,
  canUngroup,
  groupOutlineBoxes,
  liveGroups,
  withBoxGroupSelection,
} from "../store/groups";
import type { DiagramDoc } from "../types";
import { makeDoc } from "./testFixtures";

const store = () => useDiagramStore.getState();
const node = (id: string) => store().nodes.find((n) => n.id === id)!;
const selected = () =>
  store()
    .nodes.filter((n) => n.selected)
    .map((n) => n.id)
    .sort();
const pick = (...ids: string[]) =>
  useDiagramStore.setState((s) => ({
    nodes: s.nodes.map((n) => ({ ...n, selected: ids.includes(n.id) })),
  }));
/** what React Flow sends for a plain click on `id`: it, and nothing else */
const click = (id: string) =>
  store().onNodesChange([
    ...store()
      .nodes.filter((n) => n.selected && n.id !== id)
      .map((n) => ({ type: "select" as const, id: n.id, selected: false })),
    { type: "select", id, selected: true },
  ]);

/** a, b, c in a row; d far away */
const setup = () => {
  store().loadDoc(makeDoc([], []), null);
  store().enterGroup(null);
  store().applyOps([
    { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
    { op: "add_node", node: { id: "b", label: "B", x: 200, y: 0 } },
    { op: "add_node", node: { id: "c", label: "C", x: 400, y: 0 } },
    { op: "add_node", node: { id: "d", label: "D", x: 0, y: 400 } },
  ]);
};

describe("Grouping and ungrouping (#171)", () => {
  beforeEach(setup);

  it("groups the selected shapes into one, undone with a single undo", () => {
    pick("a", "b");
    expect(store().groupSelection()).toBe(true);
    const g = node("a").data.groupId;
    expect(g).toBeTruthy();
    expect(node("b").data.groupId).toBe(g);
    expect(node("c").data.groupId).toBeUndefined();
    store().undo();
    expect(node("a").data.groupId).toBeUndefined();
  });

  it("does not group a single selection", () => {
    pick("a");
    expect(store().groupSelection()).toBe(false);
  });

  it("no nesting — regrouping with a group included merges into one", () => {
    pick("a", "b");
    store().groupSelection();
    pick("b", "c");
    store().groupSelection();
    expect(liveGroups(store().nodes).size).toBe(1);
    const [members] = [...liveGroups(store().nodes).values()];
    expect(members!.sort()).toEqual(["a", "b", "c"]);
  });

  it("ungrouping releases the whole group", () => {
    pick("a", "b", "c");
    store().groupSelection();
    pick("b");
    expect(store().ungroupSelection()).toBe(true);
    expect(store().nodes.some((n) => n.data.groupId)).toBe(false);
  });

  it("Group/Ungroup are enabled only when there is something to do", () => {
    pick("a", "b");
    expect(canGroup(store().nodes)).toBe(true);
    expect(canUngroup(store().nodes)).toBe(false);
    store().groupSelection();
    pick("a", "b");
    expect(canGroup(store().nodes)).toBe(false); // already exactly that group
    expect(canUngroup(store().nodes)).toBe(true);
    pick("a", "b", "c");
    expect(canGroup(store().nodes)).toBe(true); // folds c in
  });

  it("⌘G groups and ⌘⇧G ungroups", () => {
    pick("a", "b");
    handleCanvasKeyDown(new KeyboardEvent("keydown", { key: "g", metaKey: true }));
    expect(node("a").data.groupId).toBeTruthy();
    handleCanvasKeyDown(new KeyboardEvent("keydown", { key: "g", metaKey: true, shiftKey: true }));
    expect(node("a").data.groupId).toBeUndefined();
  });
});

describe("Group selection (#171 — a click selects all; a double-click or second click selects one)", () => {
  beforeEach(() => {
    setup();
    pick("a", "b");
    store().groupSelection();
    pick();
  });

  it("clicking a shape in a group selects the whole group", () => {
    click("a");
    expect(selected()).toEqual(["a", "b"]);
  });

  it("clicking a shape outside the group selects only it", () => {
    click("a");
    click("d");
    expect(selected()).toEqual(["d"]);
  });

  it("entering a group (double-click or second click) selects one, then one at a time inside it", () => {
    click("a");
    store().pickInGroup("b");
    expect(selected()).toEqual(["b"]);
    expect(store().enteredGroup).toBe(node("a").data.groupId);
    click("a");
    expect(selected()).toEqual(["a"]);
  });

  it("leaving the group selects the whole group again", () => {
    store().pickInGroup("b");
    store().enterGroup(null);
    click("b");
    expect(selected()).toEqual(["a", "b"]);
  });

  it("pickInGroup does nothing on a shape outside any group", () => {
    store().pickInGroup("d");
    expect(store().enteredGroup).toBeNull();
  });

  it("a group caught in a range selection is taken whole", () => {
    store().onNodesChange([{ type: "select", id: "a", selected: true }]);
    expect(selected()).toEqual(["a", "b"]);
  });

  it("right-click also selects the whole group", () => {
    store().selectForContextMenu("b");
    expect(selected()).toEqual(["a", "b"]);
  });
});

describe("Groups move together (#171)", () => {
  beforeEach(() => {
    setup();
    pick("a", "b");
    store().groupSelection();
    pick();
  });

  it("dragging just one grabbed shape brings the rest along — when React Flow got the selection late", () => {
    store().beginNodeDrag(["a"]);
    store().onNodesChange([
      { type: "position", id: "a", position: { x: 10, y: 20 }, dragging: true },
    ]);
    store().endNodeDrag();
    expect(node("b").position).toEqual({ x: 210, y: 20 });
    expect(node("c").position).toEqual({ x: 400, y: 0 });
  });

  it("members dragged together move only once", () => {
    store().beginNodeDrag(["a", "b"]);
    store().onNodesChange([
      { type: "position", id: "a", position: { x: 10, y: 0 }, dragging: true },
      { type: "position", id: "b", position: { x: 210, y: 0 }, dragging: true },
    ]);
    expect(node("b").position).toEqual({ x: 210, y: 0 });
  });

  it("inside an entered group, only one moves", () => {
    store().pickInGroup("a");
    store().beginNodeDrag(["a"]);
    store().onNodesChange([
      { type: "position", id: "a", position: { x: 10, y: 0 }, dragging: true },
    ]);
    store().endNodeDrag();
    expect(node("b").position).toEqual({ x: 200, y: 0 });
  });
});

describe("Group copy, files, and bridge (#171)", () => {
  beforeEach(setup);

  it("a copied and pasted group is a new group — it does not join the original", () => {
    pick("a", "b");
    store().groupSelection();
    const original = node("a").data.groupId;
    pick("a", "b");
    store().duplicateSelection();
    const copies = store().nodes.filter((n) => !["a", "b", "c", "d"].includes(n.id));
    expect(copies).toHaveLength(2);
    expect(copies[0]!.data.groupId).toBeTruthy();
    expect(copies[0]!.data.groupId).not.toBe(original);
    expect(copies[1]!.data.groupId).toBe(copies[0]!.data.groupId);
  });

  it("copying part of a group gives a copy that is not a group", () => {
    pick("a", "b");
    store().groupSelection();
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: n.id === "a" })),
    }));
    store().duplicateSelection();
    const copy = store().nodes.find((n) => !["a", "b", "c", "d"].includes(n.id))!;
    expect(copy.data.groupId).toBeUndefined();
  });

  it("drops group ids with only one member when reading from a file", () => {
    const doc = makeDoc([], []) as DiagramDoc & { nodes: unknown[] };
    doc.nodes = [
      {
        id: "x",
        type: "shape",
        position: { x: 0, y: 0 },
        data: { label: "X", shape: "rect", color: "mono", groupId: "g1" },
      },
      {
        id: "y",
        type: "shape",
        position: { x: 0, y: 0 },
        data: { label: "Y", shape: "rect", color: "mono", groupId: "g2" },
      },
      {
        id: "z",
        type: "shape",
        position: { x: 0, y: 0 },
        data: { label: "Z", shape: "rect", color: "mono", groupId: "g2" },
      },
    ];
    store().loadDoc(doc as DiagramDoc, null);
    expect(node("x").data.groupId).toBeUndefined();
    expect(node("y").data.groupId).toBe("g2");
  });

  it("bridge: group groups and ungroup ungroups", () => {
    const r = store().applyOps([{ op: "group", ids: ["a", "b"], id: "pair" }]);
    expect(r.errors).toEqual([]);
    expect(node("a").data.groupId).toBe("pair");
    expect(store().applyOps([{ op: "ungroup", id: "pair" }]).errors).toEqual([]);
    expect(node("a").data.groupId).toBeUndefined();
  });

  it("bridge: rejects invalid requests", () => {
    const r = store().applyOps([
      { op: "group", ids: ["a"] },
      { op: "group", ids: ["a", "nope"] },
      { op: "ungroup", id: "nope" },
    ]);
    expect(r.errors).toHaveLength(3);
    store().applyOps([{ op: "group", ids: ["a", "b"], id: "pair" }]);
    expect(store().applyOps([{ op: "group", ids: ["c", "d"], id: "pair" }]).errors[0]).toContain(
      "already exists",
    );
  });
});

describe("Easily missed paths (#171)", () => {
  beforeEach(() => {
    setup();
    pick("a", "b");
    store().groupSelection();
    pick();
  });

  it("⌘ click removing one member removes the whole group — no half-selected groups", () => {
    pick("a", "b", "d");
    store().onNodesChange([{ type: "select", id: "a", selected: false }]);
    expect(selected()).toEqual(["d"]);
  });

  it("the group stays whole even when the selection box grows past it to other shapes", () => {
    // React Flow's steps: touches a → touches a and d (b let go: it never saw b)
    const box1 = { x: -10, y: -10, width: 60, height: 60 };
    store().onNodesChange(
      withBoxGroupSelection(
        [{ type: "select", id: "a", selected: true }],
        store().nodes,
        null,
        box1,
      ),
    );
    expect(selected()).toEqual(["a", "b"]);
    const box2 = { x: -10, y: -10, width: 60, height: 500 };
    store().onNodesChange(
      withBoxGroupSelection(
        [
          { type: "select", id: "b", selected: false },
          { type: "select", id: "d", selected: true },
        ],
        store().nodes,
        null,
        box2,
      ),
    );
    expect(selected()).toEqual(["a", "b", "d"]);
    // the box pulled back off the group: it goes, whole
    const box3 = { x: -10, y: 380, width: 60, height: 60 };
    store().onNodesChange(
      withBoxGroupSelection(
        [{ type: "select", id: "a", selected: false }],
        store().nodes,
        null,
        box3,
      ),
    );
    expect(selected()).toEqual(["d"]);
  });

  it("dragging a grouped frame brings its contents and the rest of the group along", () => {
    store().applyOps([
      {
        op: "add_node",
        node: { id: "f", label: "F", shape: "frame", x: 600, y: 0, width: 300, height: 200 },
      },
      { op: "add_node", node: { id: "x", label: "X", x: 640, y: 60 } },
      { op: "group", ids: ["f", "c"], id: "fc" },
    ]);
    store().beginNodeDrag(["f"]);
    store().onNodesChange([
      { type: "position", id: "f", position: { x: 610, y: 0 }, dragging: true },
    ]);
    store().endNodeDrag();
    expect(node("x").position).toEqual({ x: 650, y: 60 });
    expect(node("c").position).toEqual({ x: 410, y: 0 });
  });

  it("dragging a group member brings the contents of frames in the group along too", () => {
    store().applyOps([
      {
        op: "add_node",
        node: { id: "f", label: "F", shape: "frame", x: 600, y: 0, width: 300, height: 200 },
      },
      { op: "add_node", node: { id: "x", label: "X", x: 640, y: 60 } },
      { op: "group", ids: ["f", "c"], id: "fc" },
    ]);
    store().beginNodeDrag(["c"]);
    store().onNodesChange([
      { type: "position", id: "c", position: { x: 400, y: 10 }, dragging: true },
    ]);
    store().endNodeDrag();
    expect(node("f").position).toEqual({ x: 600, y: 10 });
    expect(node("x").position).toEqual({ x: 640, y: 70 });
  });

  it("a frame holding just one group member does not split the group", () => {
    store().applyOps([
      {
        op: "add_node",
        node: { id: "f", label: "F", shape: "frame", x: -20, y: -20, width: 200, height: 100 },
      },
    ]);
    store().beginNodeDrag(["f"]);
    store().onNodesChange([
      { type: "position", id: "f", position: { x: -20, y: 80 }, dragging: true },
    ]);
    store().endNodeDrag();
    expect(node("a").position).toEqual({ x: 0, y: 100 });
    expect(node("b").position).toEqual({ x: 200, y: 100 });
  });

  it("opening another document leaves the group", () => {
    store().pickInGroup("a");
    expect(store().enteredGroup).not.toBeNull();
    store().loadDoc(makeDoc([], []), null);
    expect(store().enteredGroup).toBeNull();
  });

  it("⌘G does nothing when already exactly one group — no empty undo step either", () => {
    pick("a", "b");
    const g = node("a").data.groupId;
    const steps = store().past.length;
    expect(store().groupSelection()).toBe(false);
    expect(node("a").data.groupId).toBe(g);
    expect(store().past.length).toBe(steps);
  });

  it("bridge: reuses orphaned group ids, which ungroup can clear", () => {
    store().applyOps([
      { op: "group", ids: ["c", "d"], id: "pair" },
      { op: "delete_node", id: "d" },
    ]);
    expect(store().applyOps([{ op: "group", ids: ["a", "c"], id: "pair" }]).errors).toEqual([]);
    store().applyOps([
      { op: "ungroup", id: "pair" },
      { op: "group", ids: ["b", "c"], id: "solo" },
      { op: "delete_node", id: "b" },
    ]);
    expect(store().applyOps([{ op: "ungroup", id: "solo" }]).errors).toEqual([]);
    expect(node("c").data.groupId).toBeUndefined();
  });

  it("bridge: update_node does not change groupId", () => {
    const r = store().applyOps([{ op: "update_node", id: "c", set: { groupId: "x" } as never }]);
    expect(r.errors[0]).toContain("group and ungroup");
  });
});

describe("Easily missed paths (#173)", () => {
  beforeEach(() => {
    setup();
    store().applyOps([{ op: "group", ids: ["a", "b", "c"], id: "g1" }]);
    pick();
  });

  it("⌘G has nothing to do with only part of a group selected — no empty undo step", () => {
    store().pickInGroup("a");
    pick("a", "b");
    expect(canGroup(store().nodes)).toBe(false);
    const steps = store().past.length;
    expect(store().groupSelection()).toBe(false);
    expect(store().past.length).toBe(steps);
  });

  it("undo and redo leave the group", () => {
    store().pickInGroup("a");
    store().commit();
    store().applyOps([{ op: "set_title", title: "T2" }]);
    store().undo();
    expect(store().enteredGroup).toBeNull();
    store().pickInGroup("a");
    store().redo();
    expect(store().enteredGroup).toBeNull();
  });

  it("⌘-clicking outside the group while entered keeps the whole group in the selection", () => {
    store().pickInGroup("a");
    // the capture phase steps out first, then React Flow adds d
    store().enterGroup(null);
    store().onNodesChange([{ type: "select", id: "d", selected: true }]);
    expect(selected()).toEqual(["a", "b", "c", "d"]);
  });

  it("selection box: a frame that is a group member comes with the group on mere overlap (group D13)", () => {
    store().applyOps([
      { op: "ungroup", id: "g1" },
      {
        op: "add_node",
        node: { id: "f", label: "F", shape: "frame", x: 300, y: 300, width: 400, height: 400 },
      },
      { op: "group", ids: ["f", "d"], id: "fd" },
    ]);
    const box = { x: -10, y: 380, width: 340, height: 60 }; // d whole, f's corner
    const nodes = store().nodes;
    store().onNodesChange(
      withBoxGroupSelection([{ type: "select", id: "d", selected: true }], nodes, null, box),
    );
    expect(selected()).toEqual(["d", "f"]);
  });

  it("dashed outline: from outside only when the whole group is selected; an entered group shows it even with one picked", () => {
    expect(groupOutlineBoxes(store().nodes, null)).toEqual([]);
    pick("a", "b", "c");
    const [box] = groupOutlineBoxes(store().nodes, null);
    expect(box).toMatchObject({ id: "g1", inside: false, x: -6, y: -6 });
    pick("a");
    expect(groupOutlineBoxes(store().nodes, null)).toEqual([]);
    expect(groupOutlineBoxes(store().nodes, "g1")[0]?.inside).toBe(true);
  });
});
