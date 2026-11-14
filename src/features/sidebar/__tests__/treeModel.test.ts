import { describe, expect, it } from "vitest";

import type { HomeView } from "../../library/homeView";
import type { FolderMeta } from "../../library/libraryApi";
import {
  buildTree,
  diagramKey,
  HOME_KEY,
  homeOpenKeys,
  homeSelectionKey,
  openKeys,
  folderKey,
  RECENT_KEY,
  selectedKey,
  treeKeyAction,
  visibleRows,
} from "../treeModel";

const folders = (): FolderMeta[] => [
  {
    folders: [],
    id: "pay",
    name: "Payments",
    updatedAt: 3,
    diagrams: [
      { id: "co", title: "Checkout", updatedAt: 3, readable: true },
      { id: "le", title: "Ledger", updatedAt: 2, readable: true },
      { id: "br", title: "(unreadable)", updatedAt: 1, readable: false },
    ],
  },
  { folders: [], id: "empty", name: "Sketches", updatedAt: 1, diagrams: [] },
];

describe("tree model (#217 R3)", () => {
  it("project → diagram — diagrams are leaves, there are no page rows (#229 D6, T37)", () => {
    const [pay, empty] = buildTree(folders(), []);
    expect(pay?.key).toBe(folderKey("pay"));
    expect(pay?.children.map((d) => [d.key, d.kind === "diagram" ? d.title : null])).toEqual([
      [diagramKey("co"), "Checkout"],
      [diagramKey("le"), "Ledger"],
      [diagramKey("br"), "(unreadable)"],
    ]);
    for (const d of pay?.children ?? []) {
      expect(d).not.toHaveProperty("pages");
      expect(d).not.toHaveProperty("expandable");
    }
    expect(empty?.children).toEqual([]);
  });

  it("an empty project cannot be expanded (T14, D7)", () => {
    const [pay, empty] = buildTree(folders(), []);
    expect(pay?.expandable).toBe(true);
    expect(empty?.expandable).toBe(false);
  });

  it("overlays every open tab — live titles (T13, D8, #218 D19)", () => {
    const [pay] = buildTree(folders(), [
      { id: "co", title: "Checkout v2" },
      { id: "le", title: "Ledger" },
    ]);
    expect(pay?.children.map((d) => (d.kind === "diagram" ? d.title : null))).toEqual([
      "Checkout v2",
      "Ledger",
      "(unreadable)",
    ]);
  });

  it("selected row — the diagram for a document tab, the resolved view's row on Home (T15, #220 D3·T9)", () => {
    const pay = { kind: "folder", folder: "pay" } as const;
    const dashboard = { kind: "dashboard" } as const;
    const at = (view: "home" | "editor", homeView: HomeView, projectId: string | null = null) =>
      selectedKey({ view, homeView, folders: folders(), projectId });
    expect(at("home", dashboard)).toBe(HOME_KEY);
    expect(at("home", { kind: "recent" })).toBe(RECENT_KEY);
    expect(at("home", pay)).toBe(folderKey("pay"));
    // resolved against the listing: a gone project is the dashboard
    expect(at("home", { kind: "folder", folder: "gone" })).toBe(HOME_KEY);
    expect(at("editor", pay, "co")).toBe(diagramKey("co"));
    expect(at("editor", dashboard)).toBeNull();
  });

  it("homeSelectionKey — the row key for each view", () => {
    expect(homeSelectionKey({ kind: "dashboard" })).toBe("nav:home");
    expect(homeSelectionKey({ kind: "recent" })).toBe("nav:recent");
    expect(homeSelectionKey({ kind: "folder", folder: "pay" })).toBe("folder:pay");
  });

  it("rows the Home view expands — a project view expands that project, an empty one has nothing to expand (#220 D3, #231 D1)", () => {
    expect(homeOpenKeys({ kind: "dashboard" }, folders())).toEqual([]);
    expect(homeOpenKeys({ kind: "recent" }, folders())).toEqual([]);
    // canvas Hybrid-Folder-Cards: the row of the folder on show is unfolded too
    expect(homeOpenKeys({ kind: "folder", folder: "pay" }, folders())).toEqual([folderKey("pay")]);
    expect(homeOpenKeys({ kind: "folder", folder: "empty" }, folders())).toEqual([]);
    expect(homeOpenKeys({ kind: "folder", folder: "gone" }, folders())).toEqual([]);
    expect(homeOpenKeys({ kind: "folder", folder: "pay" }, null)).toEqual([]);
  });

  it("opening a diagram expands its project — nothing if it is not in the listing", () => {
    expect(openKeys(folders(), "le")).toEqual([folderKey("pay")]);
    expect(openKeys(folders(), "ghost")).toEqual([]);
    expect(openKeys(null, "le")).toEqual([]);
    expect(openKeys(folders(), null)).toEqual([]);
  });

  it("visible rows — only expanded ones, with level and parent", () => {
    const tree = buildTree(folders(), []);
    expect(visibleRows(tree, new Set()).map((r) => r.key)).toEqual([
      folderKey("pay"),
      folderKey("empty"),
    ]);
    const rows = visibleRows(tree, new Set([folderKey("pay"), diagramKey("co")]));
    expect(rows.map((r) => [r.key, r.level, r.parent, r.expandable])).toEqual([
      [folderKey("pay"), 1, null, true],
      [diagramKey("co"), 2, folderKey("pay"), false],
      [diagramKey("le"), 2, folderKey("pay"), false],
      [diagramKey("br"), 2, folderKey("pay"), false],
      [folderKey("empty"), 1, null, false],
    ]);
  });

  it("rows that cannot expand do not count as expanded", () => {
    const tree = buildTree(folders(), []);
    const rows = visibleRows(tree, new Set([folderKey("empty")]));
    expect(rows.find((r) => r.key === folderKey("empty"))?.expanded).toBe(false);
  });
});

describe("tree keyboard (#217 D29, T17)", () => {
  const tree = buildTree(folders(), []);
  const open = new Set([folderKey("pay")]);
  const rows = visibleRows(tree, open);

  it("↑↓ go to neighbouring rows, Home·End to the first·last — stopping at the ends", () => {
    expect(treeKeyAction(rows, folderKey("pay"), "ArrowDown")).toEqual({
      focus: diagramKey("co"),
    });
    expect(treeKeyAction(rows, diagramKey("co"), "ArrowUp")).toEqual({ focus: folderKey("pay") });
    expect(treeKeyAction(rows, folderKey("pay"), "ArrowUp")).toEqual({
      focus: folderKey("pay"),
    });
    expect(treeKeyAction(rows, diagramKey("le"), "End")).toEqual({ focus: folderKey("empty") });
    expect(treeKeyAction(rows, folderKey("empty"), "Home")).toEqual({
      focus: folderKey("pay"),
    });
  });

  it("→ expands a collapsed row and goes to the first child of an expanded one — diagrams are leaves", () => {
    expect(treeKeyAction(visibleRows(tree, new Set()), folderKey("pay"), "ArrowRight")).toEqual({
      expand: folderKey("pay"),
    });
    expect(treeKeyAction(rows, folderKey("pay"), "ArrowRight")).toEqual({
      focus: diagramKey("co"),
    });
    // nothing to open
    expect(treeKeyAction(rows, diagramKey("co"), "ArrowRight")).toEqual({});
  });

  it("← collapses an expanded row and goes to the parent from a collapsed one", () => {
    expect(treeKeyAction(rows, folderKey("pay"), "ArrowLeft")).toEqual({
      collapse: folderKey("pay"),
    });
    expect(treeKeyAction(rows, diagramKey("le"), "ArrowLeft")).toEqual({
      focus: folderKey("pay"),
    });
    expect(treeKeyAction(rows, folderKey("empty"), "ArrowLeft")).toEqual({});
  });

  it("keys the tree does not handle give null — the event is not blocked", () => {
    expect(treeKeyAction(rows, folderKey("pay"), "a")).toBeNull();
    expect(treeKeyAction(rows, "nope", "ArrowDown")).toEqual({ focus: folderKey("pay") });
  });
});

/** folders nest (#229 D6, T37) */
describe("tree model — nested folders (#229 D6, T37)", () => {
  const nested = (): FolderMeta[] => [
    {
      id: "pay",
      name: "Payments",
      updatedAt: 9,
      diagrams: [{ id: "led", title: "Ledger", updatedAt: 5, readable: true }],
      folders: [
        {
          id: "chk",
          name: "Checkout",
          updatedAt: 9,
          diagrams: [{ id: "ord", title: "Order", updatedAt: 9, readable: true }],
          folders: [{ id: "flw", name: "Flows", updatedAt: 1, diagrams: [], folders: [] }],
        },
      ],
    },
  ];

  it("project → folders·diagrams (mixed, by recency) → … — keys are folder:<id>, counts are direct children", () => {
    const [pay] = buildTree(nested(), []);
    expect(pay?.key).toBe("folder:pay");
    expect(pay?.kind).toBe("project");
    expect(pay?.count).toBe(2);
    expect(pay?.children.map((c) => [c.kind, c.key])).toEqual([
      ["folder", "folder:chk"],
      ["diagram", "diagram:led"],
    ]);
    const chk = pay?.children[0];
    expect(chk?.kind === "folder" && chk.children.map((c) => c.key)).toEqual([
      "diagram:ord",
      "folder:flw",
    ]);
    const flw = chk?.kind === "folder" ? chk.children[1] : undefined;
    expect(flw?.kind === "folder" && [flw.count, flw.expandable]).toEqual([0, false]);
  });

  it("visible rows — level 1 for projects, k for folders at depth k, k+1 for diagrams inside them", () => {
    const tree = buildTree(nested(), []);
    const rows = visibleRows(tree, new Set(["folder:pay", "folder:chk", "folder:flw"]));
    expect(rows.map((r) => [r.key, r.level, r.parent])).toEqual([
      ["folder:pay", 1, null],
      ["folder:chk", 2, "folder:pay"],
      ["diagram:ord", 3, "folder:chk"],
      ["folder:flw", 3, "folder:chk"],
      ["diagram:led", 2, "folder:pay"],
    ]);
  });

  it("levels go up to 11 — a diagram inside a folder at depth 10", () => {
    let deepest: FolderMeta = {
      id: "d10",
      name: "D10",
      updatedAt: 1,
      diagrams: [{ id: "bottom", title: "Bottom", updatedAt: 1, readable: true }],
      folders: [],
    };
    for (let k = 9; k >= 1; k--) {
      deepest = { id: `d${k}`, name: `D${k}`, updatedAt: 1, diagrams: [], folders: [deepest] };
    }
    const tree = buildTree([deepest], []);
    const all = new Set(Array.from({ length: 10 }, (_, k) => `folder:d${k + 1}`));
    const rows = visibleRows(tree, all);
    expect(rows.at(-1)).toMatchObject({ key: "diagram:bottom", level: 11 });
  });

  it("ancestor chain — up to the containing folder for an open diagram, up to that folder for a folder view (up to its parent for an empty folder)", () => {
    expect(openKeys(nested(), "ord")).toEqual(["folder:pay", "folder:chk"]);
    expect(homeOpenKeys({ kind: "folder", folder: "chk" }, nested())).toEqual([
      "folder:pay",
      "folder:chk",
    ]);
    // Flows holds nothing: nothing of its own to unfold (D7)
    expect(homeOpenKeys({ kind: "folder", folder: "flw" }, nested())).toEqual([
      "folder:pay",
      "folder:chk",
    ]);
    expect(homeSelectionKey({ kind: "folder", folder: "flw" })).toBe("folder:flw");
  });

  it("keyboard — across levels, ← goes to the parent, → to the first child", () => {
    const tree = buildTree(nested(), []);
    const rows = visibleRows(tree, new Set(["folder:pay", "folder:chk"]));
    expect(treeKeyAction(rows, "diagram:ord", "ArrowLeft")).toEqual({ focus: "folder:chk" });
    expect(treeKeyAction(rows, "folder:chk", "ArrowRight")).toEqual({ focus: "diagram:ord" });
    expect(treeKeyAction(rows, "folder:flw", "ArrowRight")).toEqual({});
    expect(treeKeyAction(rows, "folder:chk", "ArrowLeft")).toEqual({ collapse: "folder:chk" });
  });
});
