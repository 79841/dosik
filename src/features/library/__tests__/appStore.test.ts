import { describe, expect, it } from "vitest";

import { useAppStore } from "../appStore";
import { DASHBOARD } from "../homeView";
import { type DocTab, newTab } from "../tabModel";

const tab = (): DocTab => newTab({ projectId: "p1", filePath: null, title: "One" });

describe("appStore", () => {
  it("the app starts on the Home dashboard with no tabs — when there is no saved session (#218 D15, #220 T2)", () => {
    expect(useAppStore.getState()).toMatchObject({
      view: "home",
      tabs: [],
      activeTab: null,
      homeView: DASHBOARD,
      newDiagramTarget: null,
    });
  });

  it("there is no old homeFolder or Recent focus request — a single homeView replaces them (#220 T2)", () => {
    const state = useAppStore.getState() as unknown as Record<string, unknown>;
    for (const gone of ["homeFolder", "recentFocus", "setHomeFolder", "requestRecentFocus"]) {
      expect(state).not.toHaveProperty(gone);
    }
  });

  it("view follows the active tab — set together with the Home view (#218, #220 T2)", () => {
    const t = tab();
    useAppStore.getState().commitTabs({ tabs: [t], activeTab: t.id });
    expect(useAppStore.getState()).toMatchObject({ view: "editor", activeTab: t.id });
    const states: unknown[] = [];
    const off = useAppStore.subscribe((s) => states.push(s));
    useAppStore.getState().commitTabs({
      tabs: [t],
      activeTab: null,
      homeView: { kind: "folder", folder: "f1" },
    });
    off();
    // one set: never Home with the old view, or the new view on the editor
    expect(states).toHaveLength(1);
    expect(useAppStore.getState()).toMatchObject({
      view: "home",
      homeView: { kind: "folder", folder: "f1" },
    });
    // homeView left out stays as it was
    useAppStore.getState().commitTabs({ tabs: [], activeTab: null });
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "f1" });
  });

  it("setHomeView changes only what Home shows — the active tab stays (#220 D1)", () => {
    const t = tab();
    useAppStore.getState().commitTabs({ tabs: [t], activeTab: t.id });
    useAppStore.getState().setHomeView({ kind: "recent" });
    expect(useAppStore.getState()).toMatchObject({
      view: "editor",
      activeTab: t.id,
      homeView: { kind: "recent" },
    });
  });

  it("a move made inside the sheet requests title focus — the counter goes up (#220 D16)", () => {
    const before = useAppStore.getState().homeFocus;
    useAppStore.getState().setHomeView({ kind: "recent" });
    expect(useAppStore.getState().homeFocus).toBe(before);
    useAppStore.getState().setHomeView({ kind: "recent" }, true);
    expect(useAppStore.getState().homeFocus).toBe(before + 1);
    useAppStore
      .getState()
      .commitTabs({ tabs: [], activeTab: null, homeView: DASHBOARD, focus: true });
    expect(useAppStore.getState().homeFocus).toBe(before + 2);
  });

  it("the target picked with Change lives only in session memory (#220 D8)", () => {
    useAppStore.getState().setNewDiagramTarget("work");
    expect(useAppStore.getState().newDiagramTarget).toBe("work");
    useAppStore.getState().setNewDiagramTarget(null);
    expect(useAppStore.getState().newDiagramTarget).toBeNull();
  });

  it("a title edit request is cleared once consumed — sidebar Rename → tab (#219 D3)", () => {
    expect(useAppStore.getState().takeTitleEdit()).toBeNull();
    useAppStore.getState().requestTitleEdit("tab-7");
    expect(useAppStore.getState().titleEditRequest).toBe("tab-7");
    expect(useAppStore.getState().takeTitleEdit()).toBe("tab-7");
    expect(useAppStore.getState().titleEditRequest).toBeNull();
    expect(useAppStore.getState().takeTitleEdit()).toBeNull();
  });

  it("a folder name request carries the requesting screen as a stamp and is cleared once consumed — Home's New folder → card (#231 D8)", () => {
    expect(useAppStore.getState().takeFolderRename()).toBeNull();
    useAppStore.getState().setHomeView({ kind: "folder", folder: "f-0" });
    useAppStore.getState().requestFolderRename("f-1");
    const request = {
      id: "f-1",
      asked: { view: "home", activeTab: null, homeView: { kind: "folder", folder: "f-0" } },
    };
    expect(useAppStore.getState().folderRenameRequest).toEqual(request);
    expect(useAppStore.getState().takeFolderRename()).toEqual(request);
    expect(useAppStore.getState().takeFolderRename()).toBeNull();
  });

  it("changing screens clears a pending folder name request — picking the same view again as a new object is not a change (#231 C1)", () => {
    const at = { kind: "folder", folder: "f-0" } as const;
    useAppStore.getState().commitTabs({ tabs: [], activeTab: null, homeView: at });
    useAppStore.getState().requestFolderRename("f-1");
    // the heading taking focus: the same view as a fresh object
    useAppStore.getState().setHomeView({ ...at }, true);
    expect(useAppStore.getState().folderRenameRequest?.id).toBe("f-1");
    useAppStore.getState().setHomeView({ kind: "folder", folder: "f-2" });
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
    // a document tab comes up: the view and the active tab change
    useAppStore.getState().requestFolderRename("f-1");
    const t = tab();
    useAppStore.getState().commitTabs({ tabs: [t], activeTab: t.id });
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
    useAppStore.getState().commitTabs({ tabs: [], activeTab: null });
  });
});
