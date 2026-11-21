import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import nodePath from "node:path";

import {
  classify,
  clean,
  DIAGRAM_EXT,
  diagramStem,
  fold,
  MAX_DEPTH,
  naturalCmp,
  TMP_EXT,
  UNTITLED_DIAGRAM,
  UNTITLED_FOLDER,
  UNTITLED_PROJECT,
  uniqueName,
} from "./names.mjs";
import { appDataDir, isDevRun, libraryLocation, libraryRecordDir } from "./paths.mjs";
import { ToolError } from "./toolError.mjs";

/**
 * The user's Dosik library, for an agent (#253): its projects are real
 * folders — every folder in the library folder (`Documents/Dosik` in the
 * home folder) and the folders added from elsewhere — and its diagrams
 * `<name>.dosik` files in them. These tools list them, add a folder as a project, and make folders
 * and diagrams, with no app running.
 *
 * The app alone writes its record (`<app data>/library/state.json`); this
 * only reads it. What the server makes it tells the app through the inbox
 * beside it — a `{path, at}` note per thing made — which the app takes in at
 * its next listing: at once while it runs (it watches the inbox), else when
 * it starts. A folder outside every project becomes a project on top; an
 * item inside one goes on top of its folder.
 *
 * Names follow the app's rules (`names.mjs`), and so does what a project
 * shows: a folder inside one only when a diagram is in it or under it, or
 * when the app knows it — a project made of a repository does not list
 * every folder of it.
 *
 * Everything touches the disk through `lib.fs`, so tests run on folders of
 * their own and never on the user's Documents or app data.
 */

const STATE_FILE = "state.json";
const INBOX_DIR = "inbox";

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** The file system as the library tools use it — Node's, unless a test gives its own. */
export const nodeLibraryFs = {
  readText: (path) => readFileSync(path, "utf8"),
  /**
   * The entries of `dir`, without following links: `{name, dir, file}`. A
   * name that is not UTF-8 is left out, as the app leaves it out — its
   * record speaks JSON.
   */
  entries: (dir) =>
    readdirSync(dir, { withFileTypes: true, encoding: "buffer" }).flatMap((entry) => {
      try {
        return [{ name: utf8.decode(entry.name), dir: entry.isDirectory(), file: entry.isFile() }];
      } catch {
        return [];
      }
    }),
  /** `"dir"`, `"file"`, `"other"` (a link, a device) — `null` when nothing is there */
  kind: (path) => {
    try {
      const stat = lstatSync(path);
      if (stat.isDirectory()) return "dir";
      return stat.isFile() ? "file" : "other";
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
      throw error;
    }
  },
  realpath: (path) => realpathSync.native(path),
  /** one folder — its parent must be there */
  makeDir: (path) => mkdirSync(path),
  makeDirs: (path) => mkdirSync(path, { recursive: true }),
  /** a new file, synced — never over one that is there */
  writeNew: (path, text) => {
    const fd = openSync(path, "wx");
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  },
  link: (from, to) => linkSync(from, to),
  rename: (from, to) => renameSync(from, to),
  remove: (path) => rmSync(path, { force: true }),
};

/**
 * The library as this server reaches it: where the app keeps its record and
 * where its library folder is when the record does not say — the app's own
 * rules (`paths.mjs`), `DOSIK_APP_DATA`, `DOSIK_DEV` and `DOSIK_LIBRARY_DIR`
 * included.
 *
 * @param {{
 *   bundleId: string;
 *   platform?: string;
 *   env?: Record<string, string | undefined>;
 *   home?: string;
 *   fs?: typeof nodeLibraryFs;
 *   now?: () => number;
 *   pid?: number;
 * }} options
 */
export const createLibrary = ({
  bundleId,
  platform = process.platform,
  env = process.env,
  home = homedir(),
  fs = nodeLibraryFs,
  now = Date.now,
  pid = process.pid,
}) => {
  const dev = isDevRun(env);
  const appData = appDataDir(bundleId, platform, env, home);
  return {
    fs,
    path: nodePath,
    home,
    now,
    pid,
    recordDir: libraryRecordDir(appData, dev, platform),
    fallbackLocation: libraryLocation(env, dev, home, platform),
    // notes go out in order, even two in one millisecond: a project's note
    // must be taken in before the note of a folder made in it
    lastAt: 0,
    seq: 0,
  };
};

// ---------------------------------------------------------------- paths

/** whether `child` is `parent` or inside it, by whole names */
const within = (paths, child, parent) => {
  const c = paths.resolve(child);
  const p = paths.resolve(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith(paths.sep) ? p : p + paths.sep);
};

/**
 * Too broad to be a project: a root, or the home folder or one holding it —
 * the app's `is_broad`.
 */
export const isBroad = (target, home, paths = nodePath) => {
  const at = paths.resolve(target);
  return paths.dirname(at) === at || (typeof home === "string" && within(paths, home, at));
};

/**
 * `target` as the file system has it, as far as it is there — the rest as
 * given — so two spellings of one folder compare equal, there or not.
 */
const normalized = (lib, target) => {
  const paths = lib.path;
  const rest = [];
  let at = paths.resolve(target);
  for (;;) {
    try {
      return paths.join(lib.fs.realpath(at), ...rest.reverse());
    } catch {
      const parent = paths.dirname(at);
      if (parent === at) return paths.resolve(target);
      rest.push(paths.basename(at));
      at = parent;
    }
  }
};

const sameFolder = (lib, a, b) =>
  lib.path.resolve(a) === lib.path.resolve(b) || normalized(lib, a) === normalized(lib, b);

const isRealDir = (lib, path) => lib.fs.kind(path) === "dir";

/** every entry of `dir` — none when it cannot be read */
const allEntries = (lib, dir) => {
  try {
    return lib.fs.entries(dir);
  } catch {
    return [];
  }
};

const childRel = (rel, name) => (rel === "" ? name : `${rel}/${name}`);

// ---------------------------------------------------------------- the record

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What the app's record says: the library folder, and each project's folder
 * and the items it has ids for. A record that is not there or cannot be read
 * is an empty one — the app starts over from it too.
 */
const readRecord = (lib) => {
  const paths = lib.path;
  let parsed;
  try {
    parsed = JSON.parse(lib.fs.readText(paths.join(lib.recordDir, STATE_FILE)));
  } catch {
    parsed = undefined;
  }
  const projects = Array.isArray(parsed?.projects)
    ? parsed.projects
        .filter((p) => typeof p?.path === "string" && paths.isAbsolute(p.path))
        .map((p) => ({ path: p.path, ids: isObject(p.ids) ? p.ids : {} }))
    : [];
  const location = parsed?.defaultLocation;
  return {
    projects,
    defaultLocation:
      typeof location === "string" && paths.isAbsolute(location) ? location : undefined,
  };
};

/** the notes in the inbox the app has not taken in yet, oldest first */
const readNotes = (lib) => {
  const paths = lib.path;
  const dir = paths.join(lib.recordDir, INBOX_DIR);
  return allEntries(lib, dir)
    .filter((e) => e.file && e.name.endsWith(".json") && classify(e.name, false) !== "skip")
    .flatMap((e) => {
      try {
        const note = JSON.parse(lib.fs.readText(paths.join(dir, e.name)));
        if (typeof note?.path !== "string" || !paths.isAbsolute(note.path)) return [];
        return [{ path: note.path, at: Number.isFinite(note.at) ? note.at : 0 }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.at - b.at);
};

/**
 * The project `target` is in, and where in it (`""`: the project itself,
 * `/` between names) — `undefined` outside every project.
 */
const projectAt = (lib, projects, target) => {
  const paths = lib.path;
  const at = paths.resolve(target);
  let atReal;
  for (const project of projects) {
    let rest;
    if (within(paths, at, project.path)) {
      rest = paths.relative(paths.resolve(project.path), at);
    } else {
      atReal ??= normalized(lib, at);
      const root = normalized(lib, project.path);
      if (within(paths, atReal, root)) rest = paths.relative(root, atReal);
    }
    if (rest !== undefined) {
      return { project, rel: rest.split(paths.sep).filter(Boolean).join("/") };
    }
  }
  return undefined;
};

const projectEntry = (path, source, ids = {}, missing = false) => ({
  path,
  ids,
  missing,
  source,
  // items inside it the inbox names: the app gives them ids when it takes them in
  pending: new Set(),
});

/**
 * The library as the app will list it next: the record's projects (one in
 * the library folder whose folder is gone is no project any more, while the
 * library folder is there — it was removed in the file manager), the library
 * folder's folders the record does not have yet, and the folders the inbox
 * hands over.
 */
const look = (lib) => {
  const paths = lib.path;
  const record = readRecord(lib);
  const defaultLocation = record.defaultLocation ?? lib.fallbackLocation;
  const defaultThere = isRealDir(lib, defaultLocation);
  const projects = [];
  for (const p of record.projects) {
    const there = isRealDir(lib, p.path);
    if (!there && defaultThere && paths.dirname(p.path) === defaultLocation) continue;
    projects.push(projectEntry(p.path, "record", p.ids, !there));
  }
  if (defaultThere) {
    const fresh = allEntries(lib, defaultLocation)
      .filter((e) => e.dir && classify(e.name, true) === "folder")
      .map((e) => paths.join(defaultLocation, e.name))
      .filter((p) => !projects.some((q) => within(paths, q.path, p) || sameFolder(lib, q.path, p)))
      .sort((a, b) => naturalCmp(paths.basename(a), paths.basename(b)));
    for (const p of fresh) projects.push(projectEntry(p, "default"));
  }
  const added = [];
  for (const note of readNotes(lib)) {
    if (lib.fs.kind(note.path) === null) continue;
    const found = projectAt(lib, [...added, ...projects], note.path);
    if (found) {
      if (found.rel !== "") found.project.pending.add(found.rel);
    } else if (isRealDir(lib, note.path)) {
      added.unshift(projectEntry(note.path, "note"));
    }
  }
  return { defaultLocation, projects: [...added, ...projects] };
};

// ---------------------------------------------------------------- notes

/**
 * Tells the app about `target`: a note in its inbox, written whole (a temp
 * file renamed into place — the app never reads half a note).
 */
const writeNote = (lib, target) => {
  const paths = lib.path;
  const dir = paths.join(lib.recordDir, INBOX_DIR);
  const at = Math.max(lib.now(), lib.lastAt + 1);
  lib.lastAt = at;
  const name = createHash("sha256").update(target).digest("hex").slice(0, 32);
  const tmp = paths.join(dir, `.${name}-${lib.pid}-${lib.seq++}${TMP_EXT}`);
  try {
    lib.fs.makeDirs(dir);
    lib.fs.writeNew(tmp, `${JSON.stringify({ path: target, at })}\n`);
    lib.fs.rename(tmp, paths.join(dir, `${name}.json`));
  } catch (error) {
    try {
      lib.fs.remove(tmp);
    } catch {}
    throw new ToolError(
      `Made ${target}, but could not tell the Dosik app about it (${error?.message ?? error}).`,
    );
  }
};

/**
 * Tells the app about `target`, made in `project`. A project the app has not
 * listed yet — a folder new in the library folder — is told first, so the
 * app knows it by the time it reads the note of what was made in it.
 */
const announce = (lib, project, target) => {
  if (project.source === "default") writeNote(lib, project.path);
  writeNote(lib, target);
};

// ---------------------------------------------------------------- checks

const refuse = (message) => {
  throw new ToolError(message);
};

/** `value` as a whole path, resolved — `what` names it in the refusal */
const requirePath = (lib, value, what = "`path`") => {
  if (typeof value !== "string" || value === "") {
    refuse(`${what} must be a string — an absolute path.`);
  }
  if (value.startsWith("~")) {
    refuse(
      `${what} must be absolute — \`~\` is not expanded here; write the folder out (got: ${value}).`,
    );
  }
  if (!lib.path.isAbsolute(value)) refuse(`${what} must be absolute (got: ${value}).`);
  return lib.path.resolve(value);
};

/**
 * The folder `dir` of a project, there to make things in: inside a project
 * that can be found, through real folders only (a link is never followed out
 * of a project), none of them hidden, no deeper than the app reads. `path`
 * is the folder spelt from the project's own path, as listings spell it.
 */
const folderIn = (lib, view, dir) => {
  const paths = lib.path;
  if (sameFolder(lib, dir, view.defaultLocation)) {
    refuse(
      `${dir} is the library folder itself — a folder there is a project of its own: use add_project.`,
    );
  }
  const found = projectAt(lib, view.projects, dir);
  if (!found) {
    refuse(
      `${dir} is not in the Dosik library — list_projects lists its projects, and add_project adds a folder as one.`,
    );
  }
  if (found.project.missing || !isRealDir(lib, found.project.path)) {
    refuse(`The project ${found.project.path} cannot be found on disk.`);
  }
  const names = found.rel === "" ? [] : found.rel.split("/");
  if (names.some((name) => classify(name, true) !== "folder")) {
    refuse(`${dir} is in a folder the library does not show (a hidden or temporary one).`);
  }
  const depth = names.length + 1;
  if (depth > MAX_DEPTH) {
    refuse(
      `${dir} is deeper than the library reads — folders nest at most ${MAX_DEPTH} deep (the project is 1).`,
    );
  }
  let at = found.project.path;
  for (const name of names) {
    at = paths.join(at, name);
    const kind = lib.fs.kind(at);
    if (kind === null) refuse(`There is no folder ${at} — make it first with create_folder.`);
    if (kind !== "dir") refuse(`${at} is not a folder (a link is not followed).`);
  }
  return { ...found, depth, path: at };
};

// ---------------------------------------------------------------- the tools

const ADDED_NOTE =
  "In the Dosik library now. An open app shows it in the sidebar within a few seconds; a closed one, the next time it starts.";

/** `list_projects` — every project, in the order the app keeps */
export const listProjects = (lib) => {
  const view = look(lib);
  return {
    libraryFolder: view.defaultLocation,
    projects: view.projects.map((p) => ({
      name: lib.path.basename(p.path),
      path: p.path,
      missing: p.missing,
    })),
  };
};

/**
 * `add_project` — a folder as a project. One that is not there is made —
 * only the last folder, named by the library's rules. Refused like the app
 * refuses it: too broad, holding the library folder, inside a project or
 * holding one. One already in the library is said to be.
 */
export const addProject = (lib, raw) => {
  const paths = lib.path;
  let target = requirePath(lib, raw);
  if (!isBroad(target, lib.home, paths) && lib.fs.kind(target) === null) {
    target = paths.join(paths.dirname(target), clean(paths.basename(target), UNTITLED_PROJECT));
  }
  if (isBroad(target, lib.home, paths)) {
    refuse(
      `${target} is too broad a folder for a project (a root, or the home folder or one holding it) — pick a folder of its own.`,
    );
  }
  const view = look(lib);
  const parent = paths.dirname(target);
  const makeIt = () => {
    if (!isRealDir(lib, parent)) {
      refuse(
        `There is no folder ${parent} to make ${paths.basename(target)} in — add_project makes only the last folder.`,
      );
    }
    try {
      lib.fs.makeDir(target);
      return true;
    } catch (error) {
      if (error?.code === "EEXIST") return false;
      throw new ToolError(`Could not make ${target}: ${error?.message ?? error}`);
    }
  };

  const known = view.projects.find((p) => sameFolder(lib, p.path, target));
  if (known) {
    // a project that cannot be found comes back when its folder is made again
    const made = lib.fs.kind(known.path) === null ? makeIt() : false;
    return { path: known.path, alreadyInLibrary: true, made };
  }

  const wanted = normalized(lib, target);
  const library = normalized(lib, view.defaultLocation);
  if (within(paths, library, wanted)) {
    refuse(
      `${target} holds the library folder (${view.defaultLocation}) — pick a folder of its own.`,
    );
  }
  if (within(paths, wanted, library) && paths.dirname(wanted) !== library) {
    const top = paths.relative(library, wanted).split(paths.sep)[0];
    refuse(
      `${target} is inside the project ${paths.join(view.defaultLocation, top)} — make folders in a project with create_folder.`,
    );
  }
  for (const project of view.projects) {
    const there = normalized(lib, project.path);
    if (within(paths, wanted, there)) {
      refuse(
        `${target} is inside the project ${project.path} — make folders in it with create_folder.`,
      );
    }
    if (within(paths, there, wanted)) {
      refuse(`${target} holds the project ${project.path} — add a folder that holds no project.`);
    }
  }

  const made = lib.fs.kind(target) === null ? makeIt() : false;
  if (!isRealDir(lib, target)) refuse(`${target} is not a folder (a link is not followed).`);
  writeNote(lib, target);
  return { path: target, made, note: ADDED_NOTE };
};

/** a folder as the walk found it — everything under it, as far as the app reads */
const walkFolder = (lib, dir, rel, depth) => {
  const paths = lib.path;
  const folders = [];
  const diagrams = [];
  for (const entry of allEntries(lib, dir)) {
    const kind = classify(entry.name, entry.dir);
    const at = paths.join(dir, entry.name);
    if (entry.dir && kind === "folder") {
      if (depth < MAX_DEPTH)
        folders.push(walkFolder(lib, at, childRel(rel, entry.name), depth + 1));
    } else if (entry.file && kind === "diagram") {
      diagrams.push({ name: diagramStem(entry.name), path: at, file: entry.name });
    }
  }
  const holds = diagrams.length > 0 || folders.some((f) => f.holds);
  return { name: paths.basename(dir), path: dir, rel, folders, diagrams, holds };
};

/** the walked folder as the app shows it, by name — `null` for a folder it does not show */
const shown = (node, known, top) => {
  const folders = node.folders
    .map((f) => shown(f, known, false))
    .filter((f) => f !== null)
    .sort((a, b) => naturalCmp(a.name, b.name));
  if (!top && !node.holds && !known(node.rel) && folders.length === 0) return null;
  const diagrams = node.diagrams
    .sort((a, b) => naturalCmp(a.name, b.name) || naturalCmp(a.file, b.file))
    .map(({ name, path }) => ({ name, path }));
  return { name: node.name, path: node.path, folders, diagrams };
};

/**
 * @typedef {{
 *   name: string;
 *   path: string;
 *   folders: Tree[];
 *   diagrams: { name: string; path: string }[];
 * }} Tree
 */

/**
 * `list_project` — a project, or a folder of one, as its tree
 * @returns {Tree}
 */
export const listProject = (lib, raw) => {
  const at = folderIn(lib, look(lib), requirePath(lib, raw));
  const { ids, pending } = at.project;
  const known = (rel) => Object.hasOwn(ids, rel) || pending.has(rel);
  // the folder asked for always shows: only the ones under it may not
  return /** @type {Tree} */ (shown(walkFolder(lib, at.path, at.rel, at.depth), known, true));
};

/** a new folder in `dir`, named `wanted` — " 2" when the name is taken there */
const makeFolderIn = (lib, dir, wanted) => {
  const paths = lib.path;
  // every entry counts — hidden ones, links, files — since any is in the way
  const taken = new Set(allEntries(lib, dir).map((e) => fold(e.name)));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const name = uniqueName(wanted, (candidate) => taken.has(fold(candidate)));
    try {
      lib.fs.makeDir(paths.join(dir, name));
      return name;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw new ToolError(`Could not make ${paths.join(dir, name)}: ${error?.message ?? error}`);
      }
      taken.add(fold(name));
    }
  }
  return refuse(`No free name for ${wanted} in ${dir}.`);
};

/** `create_folder` — a folder in a project, at most `MAX_DEPTH` deep */
export const createFolder = (lib, raw) => {
  const paths = lib.path;
  const target = requirePath(lib, raw);
  const at = folderIn(lib, look(lib), paths.dirname(target));
  if (at.depth >= MAX_DEPTH) {
    refuse(
      `Folders nest at most ${MAX_DEPTH} deep (the project is 1), and ${at.path} is ${at.depth} deep already.`,
    );
  }
  const name = makeFolderIn(lib, at.path, clean(paths.basename(target), UNTITLED_FOLDER));
  const made = paths.join(at.path, name);
  announce(lib, at.project, made);
  return { path: made, name };
};

/**
 * The entry of `dir` a new diagram called `name` would clash with: a file
 * called `<name>.dosik`, or a diagram showing that name (`.dosik.json`
 * too), in any case.
 */
const clashingDiagram = (lib, dir, name) => {
  const file = fold(`${name}${DIAGRAM_EXT}`);
  const shows = fold(name);
  const entry = allEntries(lib, dir).find((e) => {
    const stem = diagramStem(e.name);
    return fold(e.name) === file || (stem !== null && fold(stem) === shows);
  });
  return entry ? lib.path.join(dir, entry.name) : undefined;
};

const alreadyThere = (name, dir, file) =>
  `A diagram called "${name}" is already in ${dir} (${file}) — edit it with apply_ops and \`file\`, or pick another title.`;

/**
 * Puts `text` at `dest`, whole and never over anything there: a temp file
 * beside it (hidden, so no listing shows it), then a hard link — which fails
 * when `dest` is taken, where a rename would replace it. Where the disk has
 * no hard links, `dest` is looked at first and the temp file renamed.
 */
const placeNew = (lib, dest, text, taken) => {
  const paths = lib.path;
  const tmp = paths.join(paths.dirname(dest), `.dosik-mcp-${lib.pid}-${lib.seq++}${TMP_EXT}`);
  try {
    lib.fs.writeNew(tmp, text);
    try {
      lib.fs.link(tmp, dest);
    } catch (error) {
      if (error?.code === "EEXIST" || lib.fs.kind(dest) !== null) return taken();
      lib.fs.rename(tmp, dest);
    }
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(`Could not write ${dest}: ${error?.message ?? error}`);
  } finally {
    try {
      lib.fs.remove(tmp);
    } catch {}
  }
};

/** `create_diagram` — an empty `<title>.dosik` in a project or a folder of one */
export const createDiagram = (lib, raw, title) => {
  const paths = lib.path;
  const dir = requirePath(lib, raw);
  if (title !== undefined && title !== null && typeof title !== "string") {
    refuse("`title` must be a string.");
  }
  const at = folderIn(lib, look(lib), dir);
  const name = clean(title ?? "", UNTITLED_DIAGRAM);
  const clash = clashingDiagram(lib, at.path, name);
  if (clash) refuse(alreadyThere(name, at.path, clash));
  const file = paths.join(at.path, `${name}${DIAGRAM_EXT}`);
  const doc = { version: 1, title: name, nodes: [], edges: [] };
  placeNew(lib, file, `${JSON.stringify(doc, null, 2)}\n`, () =>
    refuse(alreadyThere(name, at.path, file)),
  );
  announce(lib, at.project, file);
  return { path: file, name };
};

// ---------------------------------------------------------------- definitions

const PATH_OF = (what) => ({ type: "string", description: what });

const NO_APP =
  " Works without the Dosik app; an open app shows the change in its sidebar within a few seconds.";

/** the five tools an agent sees for the library, after the six for diagrams */
export const libraryToolDefinitions = () => [
  {
    name: "list_projects",
    description:
      "List the projects of the user's Dosik library — the folders the app shows in its sidebar: " +
      "every folder in the library folder (`libraryFolder`, usually Documents/Dosik in the home " +
      "folder) and folders added from elsewhere. A project's `path` is what list_project, create_folder and " +
      "create_diagram take; `missing: true` means the app cannot find that folder. " +
      "Works without the Dosik app.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "add_project",
    description:
      "Add a folder to the Dosik library as a project, so its diagrams show in the app. `path` is " +
      "absolute; a folder that is not there is made (only the last folder — its parent must " +
      "exist). To keep this conversation's diagrams together, use a folder in the working " +
      "directory such as `<working directory>/diagrams`, or the working directory itself. " +
      "Refused: a relative path, a root or home folder, the library folder or a folder holding " +
      "it, and a folder inside a project or holding one. A folder already in the library comes " +
      "back with `alreadyInLibrary: true`." +
      NO_APP,
    inputSchema: {
      type: "object",
      properties: { path: PATH_OF("Absolute path of the folder to add.") },
      required: ["path"],
    },
  },
  {
    name: "list_project",
    description:
      "List what is in a project, or in a folder of one: its folders and diagrams with their " +
      "absolute paths, by name. A folder shows, as in the app, when a diagram is in it or under " +
      "it, or when it was made in Dosik. A diagram's `path` is what the other tools' `file` " +
      "takes. Works without the Dosik app.",
    inputSchema: {
      type: "object",
      properties: { path: PATH_OF("Absolute path of a project, or of a folder in one.") },
      required: ["path"],
    },
  },
  {
    name: "create_folder",
    description:
      "Make a folder in a project. `path` is the new folder's absolute path; its parent must be " +
      "the project or a folder in it. The name is made safe for every file system and gets " +
      '" 2" when it is taken — the result says the path it got. Folders nest at most 10 deep ' +
      "(the project is 1)." +
      NO_APP,
    inputSchema: {
      type: "object",
      properties: { path: PATH_OF("Absolute path of the folder to make.") },
      required: ["path"],
    },
  },
  {
    name: "create_diagram",
    description:
      "Make an empty diagram — a `<title>.dosik` file — in a project or a folder of one. Its " +
      "title is its file's name, made safe for every file system (left out: Untitled Diagram); " +
      "a diagram of that name already in the folder is refused. Returns its `path`: draw in it " +
      "with apply_ops and `file`, or show it with open_in_dosik." +
      NO_APP,
    inputSchema: {
      type: "object",
      properties: {
        path: PATH_OF("Absolute path of the project or folder to make it in."),
        title: { type: "string", description: "The diagram's name — its file's name." },
      },
      required: ["path"],
    },
  },
];

export const LIBRARY_TOOL_NAMES = libraryToolDefinitions().map((t) => t.name);

/** runs one of the library tools on `lib` (`createLibrary`) */
export const runLibraryTool = (name, args, lib) => {
  if (!lib) throw new ToolError(`${name} is not available: this server has no library.`);
  switch (name) {
    case "list_projects":
      return listProjects(lib);
    case "add_project":
      return addProject(lib, args?.path);
    case "list_project":
      return listProject(lib, args?.path);
    case "create_folder":
      return createFolder(lib, args?.path);
    case "create_diagram":
      return createDiagram(lib, args?.path, args?.title);
    default:
      throw new ToolError(`Unknown tool: ${name}`);
  }
};
