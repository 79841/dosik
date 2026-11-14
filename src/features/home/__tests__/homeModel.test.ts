import { describe, expect, it } from "vitest";

import type { FolderMeta } from "../../library/libraryApi";
import { allRecent, continueAndRecent, pathNames, RECENT_ON_DASHBOARD } from "../homeModel";

const diagram = (id: string, updatedAt: number, readable = true) => ({
  id,
  title: id.toUpperCase(),
  updatedAt,
  readable,
});

const library = (): FolderMeta[] => [
  {
    folders: [],
    id: "work",
    name: "Work",
    updatedAt: 90,
    diagrams: [diagram("a", 90), diagram("c", 70), diagram("e", 50)],
  },
  {
    folders: [],
    id: "side",
    name: "Side",
    updatedAt: 80,
    diagrams: [diagram("b", 80, false), diagram("d", 60), diagram("f", 40)],
  },
];

const ids = (entries: { diagram: { id: string } }[]) => entries.map((e) => e.diagram.id);

describe("Home model (#220)", () => {
  describe("Continue and Recent (D9·D10, T15)", () => {
    it("Continue = the most recent readable one, Recent = the next 4", () => {
      const { continued, recent } = continueAndRecent(library());
      expect(continued?.diagram.id).toBe("a");
      expect(continued?.folder.id).toBe("work");
      expect(ids(recent)).toEqual(["b", "c", "d", "e"]);
      expect(RECENT_ON_DASHBOARD).toBe(4);
    });

    it("if the newest is unreadable, Continue is the next one — the unreadable one stays in Recent", () => {
      const folders = library();
      folders[1]!.diagrams[0]!.updatedAt = 100;
      const { continued, recent } = continueAndRecent(folders);
      expect(continued?.diagram.id).toBe("a");
      expect(ids(recent)).toEqual(["b", "c", "d", "e"]);
    });

    it("one diagram → Continue only, no Recent", () => {
      const { continued, recent } = continueAndRecent([
        { folders: [], id: "w", name: "W", updatedAt: 1, diagrams: [diagram("only", 1)] },
      ]);
      expect(continued?.diagram.id).toBe("only");
      expect(recent).toEqual([]);
    });

    it("empty library → neither", () => {
      expect(continueAndRecent([])).toEqual({ continued: null, recent: [] });
    });

    it("allRecent — all diagrams newest first, no cap", () => {
      expect(ids(allRecent(library()))).toEqual(["a", "b", "c", "d", "e", "f"]);
    });

    it("counts diagrams in nested folders too — with their folder and the path from the top (#229 D5, T41)", () => {
      const folders = library();
      folders[1]!.folders = [
        {
          id: "chk",
          name: "Checkout",
          updatedAt: 95,
          diagrams: [],
          folders: [
            {
              id: "flw",
              name: "Flows",
              updatedAt: 95,
              diagrams: [diagram("deep", 95)],
              folders: [],
            },
          ],
        },
      ];
      const all = allRecent(folders);
      expect(ids(all)).toEqual(["deep", "a", "b", "c", "d", "e", "f"]);
      expect(all[0]!.folder.id).toBe("flw");
      expect(all[0]!.path.map((f) => f.id)).toEqual(["side", "chk", "flw"]);
      expect(continueAndRecent(folders).continued?.diagram.id).toBe("deep");
    });
  });
});

describe("Recent·Continue are newest first regardless of user order (#230 D15, T25)", () => {
  it("same result with the list array reversed and the diagram order changed", () => {
    const shuffled = library()
      .reverse()
      .map((f) => ({ ...f, diagrams: [...f.diagrams].reverse() }));
    expect(ids(allRecent(shuffled))).toEqual(ids(allRecent(library())));
    expect(continueAndRecent(shuffled).continued?.diagram.id).toBe("a");
  });
});

describe("the path holding a diagram — Continue chip·Recent description (#231 D10, T22)", () => {
  it("a top-level diagram shows only the project, a nested one the project down to its folder", () => {
    const folders = library();
    folders[1]!.folders = [
      {
        id: "auth",
        name: "Auth",
        updatedAt: 95,
        diagrams: [diagram("login", 95)],
        folders: [],
      },
    ];
    const all = allRecent(folders);
    const named = (id: string) => pathNames(all.find((e) => e.diagram.id === id)!);
    expect(named("login")).toEqual(["Side", "Auth"]);
    expect(named("a")).toEqual(["Work"]);
  });
});
