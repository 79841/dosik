import { beforeEach, describe, expect, it } from "vitest";

import { useHomeSelection } from "../../home/homeSelection";
import { useAppStore } from "../appStore";
import { blankDoc, type FolderMeta, itemKey } from "../libraryApi";
import { useLibraryStore } from "../libraryStore";
import { openDocument, resetTabsForTests, showHomeTab } from "../tabActions";
import { defaultTarget, namedTarget, targetFolder } from "../targets";

/** newest first, as `list_library` sorts them — the order Rust's `default_target` agrees with */
const library = (): FolderMeta[] => [
  {
    id: "work",
    name: "Work",
    updatedAt: 5,
    diagrams: [{ id: "p1", title: "Checkout", updatedAt: 5, readable: true }],
    folders: [
      {
        id: "chk",
        name: "Checkout folder",
        updatedAt: 4,
        diagrams: [{ id: "deep", title: "Deep", updatedAt: 4, readable: true }],
        folders: [{ id: "flw", name: "Flows", updatedAt: 1, diagrams: [], folders: [] }],
      },
    ],
  },
  {
    id: "side",
    name: "Side",
    updatedAt: 3,
    diagrams: [{ id: "p2", title: "Ledger", updatedAt: 3, readable: true }],
    folders: [],
  },
  { id: "empty", name: "Empty", updatedAt: 1, diagrams: [], folders: [] },
];

describe("where a new diagram goes (#220 D8)", () => {
  beforeEach(() => {
    resetTabsForTests();
    useHomeSelection.getState().clear();
    useAppStore.setState({ newDiagramTarget: null });
    useLibraryStore.setState({ folders: library(), readFailed: false });
  });

  describe("defaultTarget (T3)", () => {
    it("the most recently changed project in the listing", () => {
      expect(defaultTarget(library())?.id).toBe("work");
    });

    it("null when there is no project", () => {
      expect(defaultTarget([])).toBeNull();
      expect(defaultTarget(null)).toBeNull();
    });
  });

  describe("namedTarget — the name the dashboard row shows", () => {
    it("the one picked with Change, else the default", () => {
      expect(namedTarget(library(), null)?.name).toBe("Work");
      expect(namedTarget(library(), "side")?.name).toBe("Side");
    });

    it("the default if the picked one vanished, null if there are no projects", () => {
      expect(namedTarget(library(), "gone")?.name).toBe("Work");
      expect(namedTarget([], "side")).toBeNull();
    });
  });

  describe("targetFolder (T4)", () => {
    it("① the project the caller chose comes first", () => {
      openDocument(blankDoc(), { projectId: "p1" });
      useAppStore.setState({ newDiagramTarget: "side" });
      expect(targetFolder("empty")).toBe("empty");
    });

    it("② the active document tab's project — the Home view and Change are not consulted", () => {
      useAppStore.getState().setHomeView({ kind: "folder", folder: "empty" });
      useAppStore.setState({ newDiagramTarget: "side" });
      openDocument(blankDoc(), { projectId: "p1" });
      expect(targetFolder()).toBe("work");
    });

    it("when a document tab is active the Home view is not consulted — external files use Change, then the default", () => {
      useAppStore.getState().setHomeView({ kind: "folder", folder: "empty" });
      openDocument(blankDoc(), { filePath: "/tmp/x.dosik.json" });
      expect(targetFolder()).toBe("work");
      useAppStore.setState({ newDiagramTarget: "side" });
      expect(targetFolder()).toBe("side");
    });

    it("a project not found is never a target — Home showing it, Change having picked it, or the newest (#253 R7)", () => {
      const lost: FolderMeta = {
        id: "arc",
        name: "architecture",
        updatedAt: 99,
        missing: true,
        diagrams: [],
        folders: [],
      };
      useLibraryStore.setState({ folders: [lost, ...library()] });
      showHomeTab({ kind: "folder", folder: "arc" });
      expect(targetFolder()).toBe("work");
      useAppStore.setState({ newDiagramTarget: "arc" });
      expect(targetFolder()).toBe("work");
      expect(namedTarget([lost, ...library()], "arc")?.id).toBe("work");
      expect(defaultTarget([lost])).toBeNull();
    });

    it("③ when Home is active, the Home view's folder", () => {
      useAppStore.setState({ newDiagramTarget: "work" });
      showHomeTab({ kind: "folder", folder: "empty" });
      expect(targetFolder()).toBe("empty");
    });

    it("card selection does not affect the target — the view's folder stays (#231 D7, T6)", () => {
      showHomeTab({ kind: "folder", folder: "work" });
      useHomeSelection.getState().select("work", itemKey("folder", "chk"));
      expect(targetFolder()).toBe("work");
      showHomeTab({ kind: "folder", folder: "side" });
      useHomeSelection.getState().select("side", itemKey("diagram", "p2"));
      expect(targetFolder()).toBe("side");
      showHomeTab({ kind: "dashboard" });
      useAppStore.setState({ newDiagramTarget: "empty" });
      expect(targetFolder()).toBe("empty");
    });

    it("④ on dashboard or Recent, the project picked with Change — skipped if it vanished", () => {
      showHomeTab({ kind: "recent" });
      useAppStore.setState({ newDiagramTarget: "side" });
      expect(targetFolder()).toBe("side");
      useAppStore.setState({ newDiagramTarget: "gone" });
      expect(targetFolder()).toBe("work");
    });

    it("⑤ the default; ⑥ with no projects, folder is not passed", () => {
      expect(targetFolder()).toBe("work");
      useLibraryStore.setState({ folders: [] });
      expect(targetFolder()).toBeUndefined();
      useLibraryStore.setState({ folders: null });
      expect(targetFolder()).toBeUndefined();
    });

    it("nested folders are targets too — from the caller, the folder holding the active tab's diagram, Home's folder view (#229 D14, T35)", () => {
      expect(targetFolder("flw")).toBe("flw");
      openDocument(blankDoc(), { projectId: "deep" });
      expect(targetFolder()).toBe("chk");
      showHomeTab({ kind: "folder", folder: "flw" });
      expect(targetFolder()).toBe("flw");
    });

    it("skips a vanished Home view", () => {
      showHomeTab({ kind: "folder", folder: "gone" });
      expect(targetFolder()).toBe("work");
    });
  });
});
