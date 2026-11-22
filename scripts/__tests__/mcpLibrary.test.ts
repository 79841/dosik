// @vitest-environment node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  addProject,
  createDiagram,
  createFolder,
  createLibrary,
  listProject,
  listProjects,
  nodeLibraryFs,
} from "../mcp/library.mjs";

/**
 * The MCP server's library tools (#253), on folders of the test's own: a
 * home folder with Documents in it, an app data folder, and work folders
 * beside them. Nothing here reaches the user's Documents or app data.
 */
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const DOC = '{"version":1,"title":"x","nodes":[],"edges":[]}';

const put = (path: string, text = DOC) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

type Fs = typeof nodeLibraryFs;

const sandbox = ({ env = {}, fs }: { env?: Record<string, string>; fs?: Partial<Fs> } = {}) => {
  // the real path: macOS's temp folder is behind a link, and listings spell paths the real way
  const base = realpathSync(mkdtempSync(join(tmpdir(), "dosik-mcp-lib-")));
  made.push(base);
  const home = join(base, "home");
  const appData = join(base, "appdata");
  mkdirSync(home, { recursive: true });
  const lib = createLibrary({
    bundleId: "app.test",
    env: { DOSIK_APP_DATA: appData, ...env },
    home,
    now: () => 1000,
    fs: { ...nodeLibraryFs, ...fs },
  });
  const library = join(home, "Documents", "Dosik");
  const record = join(appData, "library");
  return {
    base,
    home,
    appData,
    library,
    record,
    inbox: join(record, "inbox"),
    lib,
    work: join(base, "work"),
  };
};

const writeState = (record: string, state: unknown) =>
  put(join(record, "state.json"), JSON.stringify(state));

const project = (path: string, ids: Record<string, string> = {}) => ({
  id: `p${Math.random().toString(36).slice(2, 8)}`,
  path,
  ids,
  order: {},
});

/** the notes in the inbox, oldest first — what the app takes in */
const notes = (inbox: string) =>
  existsSync(inbox)
    ? readdirSync(inbox)
        .map((name) => ({ name, note: JSON.parse(readFileSync(join(inbox, name), "utf8")) }))
        .sort((a, b) => a.note.at - b.note.at)
    : [];

const noteName = (path: string) =>
  `${createHash("sha256").update(path).digest("hex").slice(0, 32)}.json`;

describe("list_projects", () => {
  it("lists nothing in an empty library, and makes nothing", () => {
    const { lib, library, appData } = sandbox();
    expect(listProjects(lib)).toEqual({ libraryFolder: library, projects: [] });
    expect(existsSync(library)).toBe(false);
    expect(existsSync(appData)).toBe(false);
  });

  it("lists the library folder's folders by name — not hidden ones, nor a loose diagram", () => {
    const { lib, library } = sandbox();
    for (const name of ["beta", "Alpha", "item 10", "item 9", ".hidden", "build.tmp"]) {
      mkdirSync(join(library, name), { recursive: true });
    }
    put(join(library, "Loose.dosik"));
    expect(listProjects(lib).projects).toEqual(
      ["Alpha", "beta", "item 9", "item 10"].map((name) => ({
        name,
        path: join(library, name),
        missing: false,
      })),
    );
  });

  it("follows the app's record: its order, a folder from elsewhere, one that cannot be found", () => {
    const { lib, library, record, work } = sandbox();
    mkdirSync(join(work, "Repo"), { recursive: true });
    mkdirSync(join(library, "Mine"), { recursive: true });
    mkdirSync(join(library, "Extra"), { recursive: true });
    writeState(record, {
      v: 1,
      defaultLocation: library,
      projects: [
        project(join(work, "Repo")),
        project(join(library, "Mine")),
        project(join(work, "Gone")),
        // removed in the file manager while the library folder stays: no project any more
        project(join(library, "Removed")),
      ],
    });
    // a folder new in the library folder takes its place by name, as the app gives it
    expect(listProjects(lib).projects).toEqual([
      { name: "Extra", path: join(library, "Extra"), missing: false },
      { name: "Repo", path: join(work, "Repo"), missing: false },
      { name: "Mine", path: join(library, "Mine"), missing: false },
      { name: "Gone", path: join(work, "Gone"), missing: true },
    ]);
  });

  it("goes on past a project it may not look at — that one cannot be found, the rest work", () => {
    let locked = "";
    const { lib, library, record, work, inbox } = sandbox({
      fs: {
        kind: (path: string) => {
          if (path === locked || path.startsWith(`${locked}${sep}`)) {
            throw Object.assign(new Error(`EACCES: ${path}`), { code: "EACCES" });
          }
          return nodeLibraryFs.kind(path);
        },
      },
    });
    locked = join(work, "Locked");
    mkdirSync(join(work, "Repo"), { recursive: true });
    mkdirSync(join(library, "Mine"), { recursive: true });
    writeState(record, {
      v: 1,
      defaultLocation: library,
      projects: [project(locked), project(join(work, "Repo")), project(join(library, "Mine"))],
    });
    // a note of something in it the app has not taken in yet: passed over, kept
    put(join(inbox, "n.json"), JSON.stringify({ path: join(locked, "Sub"), at: 1 }));
    expect(listProjects(lib).projects).toEqual([
      { name: "Locked", path: locked, missing: true },
      { name: "Repo", path: join(work, "Repo"), missing: false },
      { name: "Mine", path: join(library, "Mine"), missing: false },
    ]);
    expect(existsSync(join(inbox, "n.json"))).toBe(true);
    expect(createFolder(lib, join(work, "Repo", "Docs"))).toMatchObject({ name: "Docs" });
    expect(createDiagram(lib, join(library, "Mine"), "Flow")).toMatchObject({ name: "Flow" });
    mkdirSync(join(work, "Other"), { recursive: true });
    expect(addProject(lib, join(work, "Other"))).toMatchObject({ path: join(work, "Other") });
    expect(listProject(lib, join(work, "Repo"))).toMatchObject({ name: "Repo" });
    // the project itself: said plainly, not a raw error
    expect(() => createFolder(lib, join(locked, "Sub"))).toThrow(/cannot be found/);
  });

  it("keeps a folder added from elsewhere and not found as the app does, once the library folder moved onto its parent", () => {
    const { lib, record, work } = sandbox();
    mkdirSync(join(work, "Here"), { recursive: true });
    writeState(record, {
      v: 1,
      defaultLocation: work,
      projects: [
        { ...project(join(work, "Gone")), keptAdded: true },
        // one of the library folder's that went: no project any more
        project(join(work, "Removed")),
      ],
    });
    expect(listProjects(lib).projects).toEqual([
      { name: "Gone", path: join(work, "Gone"), missing: true },
      { name: "Here", path: join(work, "Here"), missing: false },
    ]);
  });

  it("takes the library folder the record names over its own rule", () => {
    const { lib, library, record, base } = sandbox();
    const elsewhere = join(base, "Elsewhere");
    mkdirSync(join(elsewhere, "P"), { recursive: true });
    mkdirSync(join(library, "Q"), { recursive: true });
    writeState(record, { v: 1, defaultLocation: elsewhere, projects: [] });
    expect(listProjects(lib)).toEqual({
      libraryFolder: elsewhere,
      projects: [{ name: "P", path: join(elsewhere, "P"), missing: false }],
    });
  });

  it("says the projects of a library folder that is gone cannot be found", () => {
    const { lib, library, record } = sandbox();
    writeState(record, { v: 1, defaultLocation: library, projects: [project(join(library, "P"))] });
    expect(listProjects(lib).projects).toEqual([
      { name: "P", path: join(library, "P"), missing: true },
    ]);
  });

  it("reads a record it cannot parse as none — the app starts over from it too", () => {
    const { lib, library, record } = sandbox();
    mkdirSync(join(library, "P"), { recursive: true });
    put(join(record, "state.json"), "{");
    expect(listProjects(lib).projects.map((p) => p.name)).toEqual(["P"]);
  });

  it("shows a folder of the library folder it added on top, as the app puts it", () => {
    const { lib, library } = sandbox();
    for (const name of ["Alpha", "Beta"]) mkdirSync(join(library, name), { recursive: true });
    addProject(lib, join(library, "Zed"));
    expect(listProjects(lib).projects.map((p) => p.name)).toEqual(["Zed", "Alpha", "Beta"]);
  });

  it("shows a folder it added on top, before the app has taken it in", () => {
    const { lib, library, work } = sandbox();
    mkdirSync(join(library, "Mine"), { recursive: true });
    mkdirSync(work, { recursive: true });
    addProject(lib, join(work, "session-1"));
    addProject(lib, join(work, "session-2"));
    expect(listProjects(lib).projects.map((p) => p.name)).toEqual([
      "session-2",
      "session-1",
      "Mine",
    ]);
  });
});

describe("add_project", () => {
  it("makes the last folder and tells the app through its inbox", () => {
    const { lib, inbox, work } = sandbox();
    mkdirSync(join(work, "session"), { recursive: true });
    const target = join(work, "session", "diagrams");
    const out = addProject(lib, target);
    expect(out).toEqual({ path: target, made: true, note: expect.stringMatching(/sidebar/) });
    expect(existsSync(target)).toBe(true);
    // the note the app reads: `{path, at}`, named by the path, written whole
    expect(readdirSync(inbox)).toEqual([noteName(target)]);
    expect(notes(inbox)[0]?.note).toEqual({ path: target, at: 1000 });
  });

  it("takes a folder that is there — the session folder itself", () => {
    const { lib, inbox, work } = sandbox();
    put(join(work, "session", "Plan.dosik"));
    expect(addProject(lib, join(work, "session"))).toMatchObject({
      path: join(work, "session"),
      made: false,
    });
    expect(notes(inbox).map((n) => n.note.path)).toEqual([join(work, "session")]);
  });

  it("says a folder already in the library is — and tells the app nothing again", () => {
    const { lib, inbox, library, record, work } = sandbox();
    mkdirSync(join(library, "P"), { recursive: true });
    mkdirSync(join(work, "Repo"), { recursive: true });
    mkdirSync(join(work, "S"), { recursive: true });
    writeState(record, { v: 1, defaultLocation: library, projects: [project(join(work, "Repo"))] });
    addProject(lib, join(work, "S"));
    for (const path of [
      join(library, "P"),
      join(work, "Repo"),
      join(work, "S"),
      `${join(work, "S")}/`,
    ]) {
      expect(addProject(lib, path), path).toMatchObject({ alreadyInLibrary: true, made: false });
    }
    expect(notes(inbox)).toHaveLength(1);
  });

  it("names a folder it makes by the library's rules", () => {
    const { lib, work } = sandbox();
    mkdirSync(work, { recursive: true });
    expect(addProject(lib, join(work, "a:b?"))).toMatchObject({
      path: join(work, "a-b-"),
      made: true,
    });
    expect(existsSync(join(work, "a-b-"))).toBe(true);
    expect(addProject(lib, join(work, "diagrams.tmp"))).toMatchObject({
      path: join(work, "diagrams.tmp-"),
      made: true,
    });
  });

  it("refuses a relative path, a ~ path and a broad one", () => {
    const { lib, home, inbox } = sandbox();
    expect(() => addProject(lib, "work/diagrams")).toThrow(/must be absolute/);
    expect(() => addProject(lib, "~/diagrams")).toThrow(/`~` is not expanded/);
    expect(() => addProject(lib, "")).toThrow(/must be a string/);
    expect(() => addProject(lib, 3)).toThrow(/must be a string/);
    for (const broad of ["/", home, dirname(home)]) {
      expect(() => addProject(lib, broad), broad).toThrow(/too broad/);
    }
    expect(notes(inbox)).toEqual([]);
  });

  it("refuses a folder that overlaps the library", () => {
    const { lib, home, library, inbox, work } = sandbox();
    mkdirSync(join(library, "P", "deeper"), { recursive: true });
    mkdirSync(join(work, "S", "inner"), { recursive: true });
    addProject(lib, join(work, "S"));
    expect(() => addProject(lib, join(work, "S", "inner"))).toThrow(
      new RegExp(`inside the project ${join(work, "S")}.*create_folder`),
    );
    expect(() => addProject(lib, work)).toThrow(/holds the project/);
    expect(() => addProject(lib, library)).toThrow(/holds the library folder/);
    expect(() => addProject(lib, join(home, "Documents"))).toThrow(/holds the library folder/);
    expect(() => addProject(lib, join(library, "P", "deeper"))).toThrow(
      new RegExp(`inside the project ${join(library, "P")}`),
    );
    expect(notes(inbox)).toHaveLength(1);
  });

  it("makes only the last folder", () => {
    const { lib, work } = sandbox();
    expect(() => addProject(lib, join(work, "a", "b"))).toThrow(
      /There is no folder .*makes only the last folder/,
    );
    expect(existsSync(join(work, "a"))).toBe(false);
  });

  it("refuses a file", () => {
    const { lib, work } = sandbox();
    put(join(work, "notes.txt"), "x");
    expect(() => addProject(lib, join(work, "notes.txt"))).toThrow(/not a folder/);
  });

  it("never makes again the folder of a project that cannot be found — the app locates it", () => {
    const { lib, library, record, work } = sandbox();
    mkdirSync(work, { recursive: true });
    writeState(record, { v: 1, defaultLocation: library, projects: [project(join(work, "Gone"))] });
    // an empty folder made there would take the place of one moved or on a drive away
    expect(() => addProject(lib, join(work, "Gone"))).toThrow(/cannot be found.*Locate/);
    expect(existsSync(join(work, "Gone"))).toBe(false);
    expect(listProjects(lib).projects).toEqual([
      { name: "Gone", path: join(work, "Gone"), missing: true },
    ]);
  });

  it("sends notes in order, even two in one millisecond", () => {
    const { lib, inbox, work } = sandbox();
    mkdirSync(work, { recursive: true });
    addProject(lib, join(work, "one"));
    addProject(lib, join(work, "two"));
    expect(notes(inbox).map((n) => [n.note.path, n.note.at])).toEqual([
      [join(work, "one"), 1000],
      [join(work, "two"), 1001],
    ]);
  });

  it("works with a development run's library under DOSIK_DEV=1", () => {
    const { lib, appData, home } = sandbox({ env: { DOSIK_DEV: "1" } });
    expect(listProjects(lib).libraryFolder).toBe(join(home, "Documents", "Dosik Dev"));
    mkdirSync(join(home, "work"), { recursive: true });
    addProject(lib, join(home, "work", "d"));
    expect(readdirSync(join(appData, "library-dev", "inbox"))).toHaveLength(1);
    expect(existsSync(join(appData, "library"))).toBe(false);
  });
});

describe("list_project", () => {
  it("lists folders and diagrams by name, as the app shows them", () => {
    const { lib, library, record, base } = sandbox();
    const p = join(library, "P");
    put(join(p, "B.dosik"));
    put(join(p, "a.dosik"));
    put(join(p, "Old.dosik.json"));
    put(join(p, "Sub", "c.dosik"));
    put(join(p, "Deep", "x", "y.dosik"));
    mkdirSync(join(p, "Empty"));
    mkdirSync(join(p, "Known"));
    put(join(p, ".hidden", "z.dosik"));
    put(join(p, "notes.txt"), "x");
    put(join(p, "t.dosik.tmp"));
    put(join(base, "elsewhere", "far.dosik"));
    symlinkSync(join(base, "elsewhere"), join(p, "link"));
    writeState(record, {
      v: 1,
      defaultLocation: library,
      projects: [project(p, { Known: "k1", "a.dosik": "d1" })],
    });
    const at = (...names: string[]) => join(p, ...names);
    expect(listProject(lib, p)).toEqual({
      name: "P",
      path: p,
      folders: [
        {
          name: "Deep",
          path: at("Deep"),
          folders: [
            {
              name: "x",
              path: at("Deep", "x"),
              folders: [],
              diagrams: [{ name: "y", path: at("Deep", "x", "y.dosik") }],
            },
          ],
          diagrams: [],
        },
        // no diagram, but the app knows it
        { name: "Known", path: at("Known"), folders: [], diagrams: [] },
        {
          name: "Sub",
          path: at("Sub"),
          folders: [],
          diagrams: [{ name: "c", path: at("Sub", "c.dosik") }],
        },
      ],
      diagrams: [
        { name: "a", path: at("a.dosik") },
        { name: "B", path: at("B.dosik") },
        { name: "Old", path: at("Old.dosik.json") },
      ],
    });
  });

  it("lists a folder of a project too", () => {
    const { lib, library } = sandbox();
    put(join(library, "P", "Sub", "c.dosik"));
    expect(listProject(lib, join(library, "P", "Sub"))).toEqual({
      name: "Sub",
      path: join(library, "P", "Sub"),
      folders: [],
      diagrams: [{ name: "c", path: join(library, "P", "Sub", "c.dosik") }],
    });
  });

  it("reads no deeper than the app — ten levels, the project being one", () => {
    const { lib, library } = sandbox();
    const p = join(library, "P");
    const levels = Array.from({ length: 9 }, (_, i) => `f${i + 2}`);
    put(join(p, ...levels, "d.dosik"));
    put(join(p, ...levels, "f11", "e.dosik"));
    let node = listProject(lib, p);
    for (const name of levels) {
      expect(node.folders.map((f: { name: string }) => f.name)).toEqual([name]);
      node = node.folders[0];
    }
    expect(node.folders).toEqual([]);
    expect(node.diagrams.map((d: { name: string }) => d.name)).toEqual(["d"]);
  });

  it("refuses what is not in the library, cannot be found, or is hidden", () => {
    const { lib, library, record, work } = sandbox();
    put(join(library, "P", ".git", "x.dosik"));
    mkdirSync(work, { recursive: true });
    writeState(record, { v: 1, defaultLocation: library, projects: [project(join(work, "Gone"))] });
    expect(() => listProject(lib, work)).toThrow(/not in the Dosik library.*add_project/);
    expect(() => listProject(lib, join(work, "Gone"))).toThrow(/cannot be found/);
    expect(() => listProject(lib, join(library, "P", ".git"))).toThrow(/does not show/);
    expect(() => listProject(lib, "P")).toThrow(/absolute/);
  });
});

describe("create_folder", () => {
  it('makes a folder in a project — named by the rules, " 2" when the name is taken', () => {
    const { lib, library } = sandbox();
    const p = join(library, "P");
    mkdirSync(p, { recursive: true });
    put(join(p, "Notes"), "a file of the user's is in the way too");
    expect(createFolder(lib, join(p, "Flows"))).toEqual({ path: join(p, "Flows"), name: "Flows" });
    expect(createFolder(lib, join(p, "flows"))).toEqual({
      path: join(p, "flows 2"),
      name: "flows 2",
    });
    expect(createFolder(lib, join(p, "notes"))).toMatchObject({ name: "notes 2" });
    expect(createFolder(lib, join(p, "x:y"))).toMatchObject({ name: "x-y" });
    expect(existsSync(join(p, "flows 2"))).toBe(true);
    // never a name the listing skips, or takes for a diagram
    expect(createFolder(lib, join(p, "build.tmp"))).toMatchObject({ name: "build.tmp-" });
    expect(createFolder(lib, join(p, "Old.dosik"))).toMatchObject({ name: "Old.dosik-" });
  });

  it("spells a folder asked for in another case as the disk stores it, as the app does", () => {
    const { lib, library, inbox } = sandbox();
    const p = join(library, "P");
    mkdirSync(join(p, "Sub"), { recursive: true });
    // a disk that tells case apart has no "sub": nothing to spell otherwise
    if (!existsSync(join(p, "sub"))) return;
    expect(createFolder(lib, join(p, "sub", "Inner"))).toEqual({
      path: join(p, "Sub", "Inner"),
      name: "Inner",
    });
    expect(createDiagram(lib, join(p, "SUB"), "Flow")).toMatchObject({
      path: join(p, "Sub", "Flow.dosik"),
    });
    expect(listProject(lib, join(p, "sub"))).toMatchObject({ path: join(p, "Sub"), name: "Sub" });
    // the app is told of each by the path it lists
    const told = notes(inbox).map((n) => n.note.path);
    expect(told).toContain(join(p, "Sub", "Inner"));
    expect(told).toContain(join(p, "Sub", "Flow.dosik"));
  });

  it("tells the app of the folder alone — a folder of the library folder the app finds by itself", () => {
    const { lib, library, record, inbox, work } = sandbox();
    mkdirSync(join(library, "P"), { recursive: true });
    createFolder(lib, join(library, "P", "Flows"));
    // a note of the project too would put it on top, and could arrive after the folder's
    expect(notes(inbox).map((n) => n.note.path)).toEqual([join(library, "P", "Flows")]);
    // a project the record has: the folder's note alone
    rmSync(inbox, { recursive: true });
    mkdirSync(join(work, "Repo"), { recursive: true });
    writeState(record, { v: 1, defaultLocation: library, projects: [project(join(work, "Repo"))] });
    createFolder(lib, join(work, "Repo", "Docs"));
    expect(notes(inbox).map((n) => n.note.path)).toEqual([join(work, "Repo", "Docs")]);
  });

  it("shows the empty folder it made in the project's listing at once", () => {
    const { lib, library } = sandbox();
    mkdirSync(join(library, "P"), { recursive: true });
    createFolder(lib, join(library, "P", "Flows"));
    expect(
      listProject(lib, join(library, "P")).folders.map((f: { name: string }) => f.name),
    ).toEqual(["Flows"]);
  });

  it("nests folders at most ten deep", () => {
    const { lib, library } = sandbox();
    const levels = Array.from({ length: 9 }, (_, i) => `f${i + 2}`);
    const deepest = join(library, "P", ...levels);
    mkdirSync(deepest, { recursive: true });
    expect(() => createFolder(lib, join(deepest, "f11"))).toThrow(/at most 10 deep/);
    expect(createFolder(lib, join(dirname(deepest), "g10"))).toMatchObject({ name: "g10" });
  });

  it("refuses a parent that is not there, the library folder itself, and a folder outside", () => {
    const { lib, library, work } = sandbox();
    mkdirSync(join(library, "P"), { recursive: true });
    mkdirSync(work, { recursive: true });
    expect(() => createFolder(lib, join(library, "P", "a", "b"))).toThrow(
      /make it first with create_folder/,
    );
    expect(() => createFolder(lib, join(library, "New"))).toThrow(
      /library folder itself.*add_project/,
    );
    expect(() => createFolder(lib, join(work, "x"))).toThrow(/not in the Dosik library/);
    expect(existsSync(join(library, "New"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("never follows a link out of a project", () => {
    const { lib, library, base } = sandbox();
    mkdirSync(join(library, "P"), { recursive: true });
    mkdirSync(join(base, "outside"));
    symlinkSync(join(base, "outside"), join(library, "P", "link"));
    expect(() => createFolder(lib, join(library, "P", "link", "x"))).toThrow(/not a folder/);
    expect(readdirSync(join(base, "outside"))).toEqual([]);
  });
});

describe("create_diagram", () => {
  it("makes an empty .dosik — the document get_diagram reads — and tells the app", () => {
    const { lib, library, inbox } = sandbox();
    const p = join(library, "P");
    mkdirSync(p, { recursive: true });
    const out = createDiagram(lib, p, "Auth flow");
    expect(out).toEqual({ path: join(p, "Auth flow.dosik"), name: "Auth flow" });
    expect(JSON.parse(readFileSync(out.path, "utf8"))).toEqual({
      version: 1,
      title: "Auth flow",
      nodes: [],
      edges: [],
    });
    // written whole: no temp file stays behind
    expect(readdirSync(p)).toEqual(["Auth flow.dosik"]);
    expect(notes(inbox).map((n) => n.note.path)).toEqual([out.path]);
  });

  it("names it Untitled Diagram without a title, and cleans one it is given", () => {
    const { lib, library } = sandbox();
    const p = join(library, "P");
    mkdirSync(join(p, "Sub"), { recursive: true });
    expect(createDiagram(lib, p).name).toBe("Untitled Diagram");
    // null is no title too — some clients fill optional arguments with it
    expect(createDiagram(lib, join(p, "Sub"), null).name).toBe("Untitled Diagram");
    // a blank title is the default one — taken here, so refused rather than numbered
    expect(() => createDiagram(lib, p, "  ")).toThrow(/"Untitled Diagram" is already in/);
  });

  it("refuses a diagram of that name already there — in any case, or as an older .dosik.json", () => {
    const { lib, library } = sandbox();
    const p = join(library, "P");
    put(join(p, "Flow.dosik"));
    put(join(p, "Old.dosik.json"));
    expect(() => createDiagram(lib, p, "flow")).toThrow(/already in .*Flow\.dosik.*apply_ops/);
    expect(() => createDiagram(lib, p, "OLD")).toThrow(/Old\.dosik\.json/);
    expect(readFileSync(join(p, "Flow.dosik"), "utf8")).toBe(DOC);
  });

  it("cleans the title into a file name, in a folder of a project too", () => {
    const { lib, library } = sandbox();
    const sub = join(library, "P", "Sub");
    mkdirSync(sub, { recursive: true });
    expect(createDiagram(lib, sub, "a/b: c")).toEqual({
      path: join(sub, "a-b- c.dosik"),
      name: "a-b- c",
    });
  });

  it("refuses a title that is not a string and a folder outside the library", () => {
    const { lib, library, work } = sandbox();
    mkdirSync(join(library, "P"), { recursive: true });
    mkdirSync(work, { recursive: true });
    expect(() => createDiagram(lib, join(library, "P"), 3)).toThrow(/`title` must be a string/);
    expect(() => createDiagram(lib, work, "x")).toThrow(/not in the Dosik library/);
  });

  it("never writes over a file that lands meanwhile", () => {
    const exists = Object.assign(new Error("file exists"), { code: "EEXIST" });
    const { lib, library } = sandbox({
      fs: {
        link: (_from: string, to: string) => {
          writeFileSync(to, "theirs");
          throw exists;
        },
      },
    });
    const p = join(library, "P");
    mkdirSync(p, { recursive: true });
    expect(() => createDiagram(lib, p, "Flow")).toThrow(/already in/);
    expect(readFileSync(join(p, "Flow.dosik"), "utf8")).toBe("theirs");
    expect(readdirSync(p)).toEqual(["Flow.dosik"]);
  });

  it("still puts the file in place whole where the disk has no hard links", () => {
    const unsupported = Object.assign(new Error("not permitted"), { code: "EPERM" });
    const { lib, library } = sandbox({
      fs: {
        link: () => {
          throw unsupported;
        },
      },
    });
    const p = join(library, "P");
    mkdirSync(p, { recursive: true });
    const out = createDiagram(lib, p, "Flow");
    expect(JSON.parse(readFileSync(out.path, "utf8")).title).toBe("Flow");
    expect(readdirSync(p)).toEqual(["Flow.dosik"]);
  });
});
