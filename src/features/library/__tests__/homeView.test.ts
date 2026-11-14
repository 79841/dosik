import { describe, expect, it } from "vitest";

import { DASHBOARD, homeFolderOf, resolveHomeView, sameHomeView } from "../homeView";
import type { FolderMeta } from "../libraryApi";

const folders: FolderMeta[] = [
  {
    id: "work",
    name: "Work",
    updatedAt: 3,
    diagrams: [
      { id: "p1", title: "Checkout", updatedAt: 3, readable: true },
      { id: "broken", title: "(unreadable)", updatedAt: 2, readable: false },
    ],
    folders: [
      {
        id: "sub",
        name: "Sub",
        updatedAt: 2,
        diagrams: [{ id: "deep", title: "Deep", updatedAt: 2, readable: true }],
        folders: [{ id: "subsub", name: "Subsub", updatedAt: 1, diagrams: [], folders: [] }],
      },
    ],
  },
  { id: "empty", name: "Empty", updatedAt: 1, diagrams: [], folders: [] },
];

describe("Home views — dashboard · recent · folder (#220 D1, #229 D5, #231 D1·T4)", () => {
  describe("resolveHomeView (T1, T34)", () => {
    it("keeps a view that is in the listing — folders at any depth", () => {
      for (const view of [
        DASHBOARD,
        { kind: "recent" } as const,
        { kind: "folder", folder: "empty" } as const,
        { kind: "folder", folder: "sub" } as const,
        { kind: "folder", folder: "subsub" } as const,
      ]) {
        expect(resolveHomeView(view, folders)).toBe(view);
      }
    });

    it("a vanished folder → dashboard", () => {
      expect(resolveHomeView({ kind: "folder", folder: "gone" }, folders)).toEqual(DASHBOARD);
    });

    it("keeps the view when there is no listing yet (loading)", () => {
      const view = { kind: "folder", folder: "gone" } as const;
      expect(resolveHomeView(view, null)).toBe(view);
    });
  });

  it("homeFolderOf — the folder for a folder view, null for dashboard, Recent and vanished ones", () => {
    expect(homeFolderOf({ kind: "folder", folder: "empty" }, folders)).toBe("empty");
    expect(homeFolderOf({ kind: "folder", folder: "subsub" }, folders)).toBe("subsub");
    expect(homeFolderOf(DASHBOARD, folders)).toBeNull();
    expect(homeFolderOf({ kind: "recent" }, folders)).toBeNull();
    expect(homeFolderOf({ kind: "folder", folder: "gone" }, folders)).toBeNull();
    expect(homeFolderOf({ kind: "folder", folder: "empty" }, null)).toBeNull();
  });

  it("sameHomeView — same shape means same view", () => {
    expect(sameHomeView(DASHBOARD, { kind: "dashboard" })).toBe(true);
    expect(sameHomeView({ kind: "recent" }, { kind: "recent" })).toBe(true);
    expect(sameHomeView({ kind: "recent" }, DASHBOARD)).toBe(false);
    expect(sameHomeView({ kind: "folder", folder: "a" }, { kind: "folder", folder: "a" })).toBe(
      true,
    );
    expect(sameHomeView({ kind: "folder", folder: "a" }, { kind: "folder", folder: "b" })).toBe(
      false,
    );
  });
});
