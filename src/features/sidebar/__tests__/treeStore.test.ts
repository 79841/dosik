import { beforeEach, describe, expect, it } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { useAppStore } from "../../library/appStore";
import { blankDoc, type FolderMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { openDocument, resetTabsForTests, showHomeTab } from "../../library/tabActions";
import { diagramKey, folderKey } from "../treeModel";
import { resetTreeForTests, useTreeStore } from "../treeStore";

const library = (): FolderMeta[] => [
  {
    folders: [{ id: "flw", name: "Flows", updatedAt: 1, diagrams: [], folders: [] }],
    id: "pay",
    name: "Payments",
    updatedAt: 2,
    diagrams: [{ id: "co", title: "Checkout", updatedAt: 2, readable: true }],
  },
  { folders: [], id: "ops", name: "Ops", updatedAt: 1, diagrams: [] },
];
const expanded = () => [...useTreeStore.getState().expanded].sort();

describe("tree expansion (#217 D7, T16)", () => {
  beforeEach(() => {
    useDiagramStore.getState().loadDoc(blankDoc(), null);
    useLibraryStore.setState({ folders: library(), readFailed: false });
    resetTreeForTests();
  });

  it("everything starts collapsed (#176)", () => {
    expect(expanded()).toEqual([]);
  });

  it("expands, collapses and toggles", () => {
    const tree = useTreeStore.getState();
    tree.expand([folderKey("pay"), folderKey("ops")]);
    expect(expanded()).toEqual([folderKey("ops"), folderKey("pay")]);
    tree.collapse(folderKey("ops"));
    expect(expanded()).toEqual([folderKey("pay")]);
    tree.toggle(folderKey("pay"));
    expect(expanded()).toEqual([]);
    tree.toggle(folderKey("pay"));
    expect(expanded()).toEqual([folderKey("pay")]);
  });

  it("opening a diagram expands its project and scrolls its row into view", () => {
    useDiagramStore.getState().openProject("co", blankDoc());
    expect(expanded()).toEqual([folderKey("pay")]);
    expect(useTreeStore.getState().reveal).toBe(diagramKey("co"));
    useTreeStore.getState().clearReveal();
    expect(useTreeStore.getState().reveal).toBeNull();
  });

  it("if it opened before the listing arrived, expands when the listing arrives", () => {
    useLibraryStore.setState({ folders: null });
    useDiagramStore.getState().openProject("co", blankDoc());
    expect(expanded()).toEqual([]);
    useLibraryStore.setState({ folders: library() });
    expect(expanded()).toEqual([folderKey("pay")]);
  });

  it("expansion stays when going Home — it does not reopen what the user collapsed", () => {
    useDiagramStore.getState().openProject("co", blankDoc());
    useTreeStore.getState().collapse(folderKey("pay"));
    // the library is listed again (a save, Home on show)
    useLibraryStore.setState({ folders: library() });
    expect(expanded()).toEqual([]);
    useDiagramStore.getState().loadDoc(blankDoc(), null);
    expect(expanded()).toEqual([]);
  });

  describe("when the Home view changes, expands its row and ancestors and scrolls it into view (#220 D3, T9, #231 D1)", () => {
    beforeEach(() => {
      resetTabsForTests();
      resetTreeForTests();
    });
    /** the library with something in Flows — a folder row that can unfold */
    const filled = (): FolderMeta[] => {
      const listed = library();
      listed[0]!.folders[0]!.diagrams = [
        { id: "rf", title: "Refund flow", updatedAt: 3, readable: true },
      ];
      return listed;
    };

    it("empty folder view → expands the ancestors and scrolls that folder row into view (#231 D1 — there is no diagram view)", () => {
      showHomeTab({ kind: "folder", folder: "flw" });
      expect(expanded()).toEqual([folderKey("pay")]);
      expect(useTreeStore.getState().reveal).toBe(folderKey("flw"));
    });

    it("folder view → expands that folder row too — canvas Hybrid-Folder-Cards", () => {
      useLibraryStore.setState({ folders: filled() });
      showHomeTab({ kind: "folder", folder: "flw" });
      expect(expanded()).toEqual([folderKey("flw"), folderKey("pay")]);
      expect(useTreeStore.getState().reveal).toBe(folderKey("flw"));
    });

    it("only once — a row the user collapsed stays collapsed when a new listing arrives or the same view is picked again", () => {
      useLibraryStore.setState({ folders: filled() });
      showHomeTab({ kind: "folder", folder: "flw" });
      useTreeStore.getState().collapse(folderKey("flw"));
      // a save, an agent's op: the library is listed again
      useLibraryStore.setState({ folders: filled() });
      expect(expanded()).toEqual([folderKey("pay")]);
      // the same view again, as a fresh object — Home's heading takes focus (a crumb, after a delete)
      useAppStore.getState().setHomeView({ kind: "folder", folder: "flw" }, true);
      expect(expanded()).toEqual([folderKey("pay")]);
    });

    it("expands again after visiting another view and coming back — including via a document tab back to Home", () => {
      useLibraryStore.setState({ folders: filled() });
      showHomeTab({ kind: "folder", folder: "flw" });
      useTreeStore.getState().collapse(folderKey("flw"));
      showHomeTab({ kind: "dashboard" });
      expect(expanded()).toEqual([folderKey("pay")]);
      showHomeTab({ kind: "folder", folder: "flw" });
      expect(expanded()).toEqual([folderKey("flw"), folderKey("pay")]);

      useTreeStore.getState().collapse(folderKey("flw"));
      openDocument(blankDoc(), { projectId: "co" });
      showHomeTab();
      expect(expanded()).toEqual([folderKey("flw"), folderKey("pay")]);
    });

    it("expands once when something appears in the empty folder being viewed — stays collapsed if collapsed", () => {
      showHomeTab({ kind: "folder", folder: "flw" });
      expect(expanded()).toEqual([folderKey("pay")]);
      useLibraryStore.setState({ folders: filled() });
      expect(expanded()).toEqual([folderKey("flw"), folderKey("pay")]);
      useTreeStore.getState().collapse(folderKey("flw"));
      useLibraryStore.setState({ folders: filled() });
      expect(expanded()).toEqual([folderKey("pay")]);
    });

    it("even then it does not re-expand the ancestors — the user collapsed them", () => {
      showHomeTab({ kind: "folder", folder: "flw" });
      useTreeStore.getState().collapse(folderKey("pay"));
      useLibraryStore.setState({ folders: filled() });
      expect(expanded()).toEqual([folderKey("flw")]);
    });

    it("does not expand for things that appear after leaving the view", () => {
      showHomeTab({ kind: "folder", folder: "flw" });
      showHomeTab({ kind: "dashboard" });
      useLibraryStore.setState({ folders: filled() });
      expect(expanded()).toEqual([folderKey("pay")]);

      useLibraryStore.setState({ folders: library() });
      showHomeTab({ kind: "folder", folder: "flw" });
      openDocument(blankDoc(), { filePath: "/tmp/x.dosik.json" });
      useLibraryStore.setState({ folders: filled() });
      expect(expanded()).toEqual([folderKey("pay")]);
    });

    it("before the listing arrives, when it arrives", () => {
      useLibraryStore.setState({ folders: null });
      showHomeTab({ kind: "folder", folder: "flw" });
      expect(expanded()).toEqual([]);
      useLibraryStore.setState({ folders: library() });
      expect(expanded()).toEqual([folderKey("pay")]);
      expect(useTreeStore.getState().reveal).toBe(folderKey("flw"));
    });

    it("does not re-expand when the view is unchanged — what the user collapsed stays collapsed", () => {
      showHomeTab({ kind: "folder", folder: "flw" });
      useTreeStore.getState().collapse(folderKey("pay"));
      useLibraryStore.setState({ folders: library() });
      showHomeTab({ kind: "folder", folder: "flw" });
      expect(expanded()).toEqual([]);
    });

    it("a Home view changed while a document tab was active applies on returning to Home", () => {
      openDocument(blankDoc(), { projectId: "co" });
      resetTreeForTests();
      useAppStore.getState().setHomeView({ kind: "folder", folder: "flw" });
      expect(expanded()).toEqual([]);
      showHomeTab();
      expect(expanded()).toEqual([folderKey("pay")]);
    });
  });

  it("only one rename at a time in the tree", () => {
    useTreeStore.getState().setRenaming("ops");
    expect(useTreeStore.getState().renaming).toBe("ops");
    useTreeStore.getState().setRenaming(null);
    expect(useTreeStore.getState().renaming).toBeNull();
  });
});

describe("selected row (#230 D8, T15)", () => {
  beforeEach(() => {
    resetTabsForTests();
    useDiagramStore.getState().loadDoc(blankDoc(), null);
    useLibraryStore.setState({ folders: library(), readFailed: false });
    resetTreeForTests();
  });
  const picked = () => useTreeStore.getState().picked;

  it("selects the row clicked once and forgets it when the location changes — Home's view, the editor's diagram", () => {
    useTreeStore.getState().pick(folderKey("ops"));
    expect(picked()).toBe(folderKey("ops"));
    showHomeTab({ kind: "folder", folder: "pay" });
    expect(picked()).toBeNull();
    useTreeStore.getState().pick(diagramKey("co"));
    openDocument(blankDoc(), { projectId: "co" });
    expect(picked()).toBeNull();
  });

  it("the selected row stays when a new listing arrives — if the location is unchanged", () => {
    useTreeStore.getState().pick(folderKey("ops"));
    useLibraryStore.setState({ folders: library() });
    expect(picked()).toBe(folderKey("ops"));
  });
});
