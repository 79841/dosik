#!/usr/bin/env node
/**
 * Checks that this public repository carries nothing private and stays English.
 *
 *   node scripts/check-public.mjs                      tracked files in the working tree
 *   node scripts/check-public.mjs --rev <commit>       the tree of a commit
 *   node scripts/check-public.mjs --messages <range>   commit messages, e.g. origin/main..HEAD
 *   ... --markers <file>                               also refuse these strings (one per line)
 *
 * Files must not hold agent instruction or settings files, symlinks, local-only
 * folders (.workbench, .worktrees), local home folders or temp paths,
 * secret-shaped strings, links to private chat or design pages, notes about how
 * the work was reviewed or decided, or Korean outside the test data listed in
 * scripts/hangul-allowed.txt. Commit messages must be English, without such
 * notes and without issue numbers (issues are not tracked in this repository).
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** precomposed syllables, compatibility jamo, and the decomposed (NFD) jamo blocks */
export const HANGUL = /[\uAC00-\uD7A3\u3131-\u318E\u1100-\u11FF\uA960-\uA97F\uD7B0-\uD7FF]/;

/** notes about how the work was reviewed or decided, in English and Korean */
export const PROCESS_NOTE = new RegExp(
  [
    "[Uu]ser (decision|request|instruction|feedback)",
    "[Oo]wner decision",
    "[Uu]ser.s (call|decision|request)",
    "[Oo]wner.s (call|decision)",
    "PR [Rr]eviews?",
    "(^|[^A-Za-z])[Rr]eviews? ?([0-9]+ ?)?[CWS][0-9]",
    ", [Rr]eviews?\\)",
    "[Rr]eview rounds?",
    "\uC0AC\uC6A9\uC790 ?(\uACB0\uC815|\uC9C0\uC2DC|\uC694\uCCAD|\uBA85\uC2DC|\uD655\uC778)",
    "PR ?\uB9AC\uBDF0",
    "#[0-9]+ (PR )?(\uC7AC?\uB9AC\uBDF0|[Rr]eviews?)",
    "(^|[^\uD504])\uB9AC\uBDF0 ?([0-9]+ ?)?[CWS][0-9]",
    "\\((\uC7AC|\uB0B4\uBD80 |\uB514\uC790\uC778 |\uCF54\uB4DC )?\uB9AC\uBDF0[):]",
    "\uB9AC\uBDF0\uAC00 \uC9DA\uC740",
    "\uB9AC\uBDF0 \uB77C\uC6B4\uB4DC",
    "\uB77C\uC6B4\uB4DC ?[0-9]+ ?(\uB9AC\uBDF0|[CWS][0-9])",
  ].join("|"),
  "m",
);

/** links to private chat and design pages, and the agent instruction file's name */
export const PRIVATE_LINK = /claude\.ai\/(artifact|public|code|share|chat|project)|CLAUDE\.md/i;

export const SECRET =
  /sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-)?[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,}/;

export const LOCAL_PATH =
  /\/private\/(tmp|var)\/|\/var\/folders\/|~\/(Desktop|Documents|Downloads)\//i;

const HOME =
  /\/Users\/[A-Za-z0-9._-]+|\\\/Users\\\/[A-Za-z0-9._-]+|(^|["' =:(])\/home\/[a-z0-9._-]+|[A-Za-z]:(\\\\|\\|\/)+[Uu]sers(\\\\|\\|\/)+[A-Za-z0-9._-]+/gm;
/** made-up home folders that tests use */
export const FAKE_HOMES = new Set(["a", "a2", "someone", "someone2", "u"]);

/** an issue number such as #12 — issues live outside this repository */
export const ISSUE_REF = /(^|[\s(])#[0-9]+\b/m;

const AGENT_FILES = new Set([
  "agents.md",
  "gemini.md",
  ".cursorrules",
  "copilot-instructions.md",
  ".mcp.json",
  ".ds_store",
]);
const LOCAL_ONLY = [".workbench", ".worktrees"];

/** home folder names in a text, minus the made-up ones */
export function homeNames(text) {
  const names = new Set();
  for (const match of text.matchAll(HOME)) {
    const name = match[0].replace(/^.*([Uu]sers|home)(\\\\|\\|\/)+/, "");
    if (!FAKE_HOMES.has(name)) names.add(name);
  }
  return [...names];
}

/** case-insensitive literal markers, or null when there are none */
export function markerPattern(markers) {
  const values = markers.map((m) => m.trim()).filter((m) => m.length >= 3);
  if (values.length === 0) return null;
  return new RegExp(values.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
}

function isText(buffer) {
  return !buffer.subarray(0, 8000).includes(0);
}

/**
 * @param {{path: string, mode: string, content: Buffer}[]} files
 * @param {{allowedHangul?: string[], markers?: string[]}} options
 * @returns {string[]} problems, one line each
 */
export function checkFiles(files, { allowedHangul = [], markers = [] } = {}) {
  const problems = [];
  const extra = markerPattern(markers);
  const allowed = new Set(allowedHangul);
  const withHangul = new Set();

  for (const { path, mode, content } of files) {
    const segments = path.split("/");
    const name = basename(path).toLowerCase();
    if (LOCAL_ONLY.includes(segments[0])) problems.push(`${path}: local-only folder is tracked`);
    const agentDir = segments.some((s) => s.toLowerCase() === ".claude");
    if (agentDir || /^claude.*\.md$/.test(name) || AGENT_FILES.has(name)) {
      problems.push(`${path}: agent or OS file`);
    }
    if (HANGUL.test(path)) problems.push(`${path}: Korean in the file path`);
    if (extra?.test(path)) problems.push(`${path}: private marker in the file path`);
    if (mode === "120000") {
      problems.push(`${path}: symlink`);
      continue;
    }

    const raw = content.toString("latin1");
    if (PRIVATE_LINK.test(raw)) problems.push(`${path}: private link or agent file name`);
    if (SECRET.test(raw)) problems.push(`${path}: secret-shaped string`);
    if (LOCAL_PATH.test(raw)) problems.push(`${path}: local path`);
    const homes = homeNames(raw);
    if (homes.length > 0) problems.push(`${path}: local home folder (${homes.join(", ")})`);
    if (extra?.test(raw) || extra?.test(content.toString("utf8"))) {
      problems.push(`${path}: private marker`);
    }

    if (!isText(content)) continue;
    const text = content.toString("utf8");
    if (PROCESS_NOTE.test(text)) problems.push(`${path}: note about reviews or decisions`);
    if (HANGUL.test(text)) {
      withHangul.add(path);
      if (!allowed.has(path)) problems.push(`${path}: Korean text (allowed only as test data)`);
    }
  }

  for (const path of allowed) {
    if (!withHangul.has(path)) {
      problems.push(`${path}: listed in scripts/hangul-allowed.txt but has no Korean — remove it`);
    }
  }
  return problems;
}

/**
 * @param {{id: string, message: string}[]} commits
 * @param {{markers?: string[]}} options
 * @returns {string[]} problems, one line each
 */
export function checkMessages(commits, { markers = [] } = {}) {
  const problems = [];
  const extra = markerPattern(markers);
  for (const { id, message } of commits) {
    const short = id.slice(0, 7);
    if (HANGUL.test(message)) problems.push(`${short}: Korean in the commit message`);
    if (PROCESS_NOTE.test(message)) problems.push(`${short}: note about reviews or decisions`);
    if (ISSUE_REF.test(message)) problems.push(`${short}: issue number in the commit message`);
    if (PRIVATE_LINK.test(message) || SECRET.test(message) || LOCAL_PATH.test(message)) {
      problems.push(`${short}: private link, secret or local path in the commit message`);
    }
    if (homeNames(message).length > 0)
      problems.push(`${short}: local home folder in the commit message`);
    if (extra?.test(message)) problems.push(`${short}: private marker in the commit message`);
  }
  return problems;
}

/** the allowlist, without comments and blank lines */
export function parseList(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function git(root, args, options = {}) {
  return execFileSync("git", args, { cwd: root, maxBuffer: 1 << 30, ...options });
}

function workingTreeFiles(root) {
  const entries = git(root, ["ls-files", "-s", "-z"]).toString("utf8").split("\0").filter(Boolean);
  const files = [];
  for (const entry of entries) {
    const [meta, path] = entry.split("\t");
    const mode = meta.split(" ")[0];
    const full = join(root, path);
    if (mode === "160000" || !existsSync(full)) continue;
    const link = lstatSync(full).isSymbolicLink();
    files.push({
      path,
      mode: link ? "120000" : mode,
      content: link ? Buffer.alloc(0) : readFileSync(full),
    });
  }
  return files;
}

function commitFiles(root, rev) {
  const entries = git(root, ["ls-tree", "-r", "-z", "--full-tree", rev])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const [meta, path] = entry.split("\t");
      const [mode, type, id] = meta.split(" ");
      return { mode, type, id, path };
    })
    .filter((e) => e.type === "blob");
  // one cat-file process for every blob: "<id> blob <size>\n<content>\n" each
  const out = git(root, ["cat-file", "--batch"], {
    input: `${entries.map((e) => e.id).join("\n")}\n`,
  });
  const files = [];
  let at = 0;
  for (const entry of entries) {
    const headerEnd = out.indexOf(10, at);
    const size = Number(out.subarray(at, headerEnd).toString("latin1").split(" ")[2]);
    const content = out.subarray(headerEnd + 1, headerEnd + 1 + size);
    at = headerEnd + 1 + size + 1;
    files.push({ path: entry.path, mode: entry.mode, content: Buffer.from(content) });
  }
  return files;
}

function rangeMessages(root, range) {
  const out = git(root, ["log", "--format=%H%x00%B%x1e", range]).toString("utf8");
  return out
    .split("\x1e")
    .map((chunk) => chunk.replace(/^\n/, ""))
    .filter((chunk) => chunk.includes("\0"))
    .map((chunk) => {
      const [id, message] = chunk.split("\0");
      return { id, message };
    });
}

const USAGE = "usage: check-public.mjs [--rev <commit> | --messages <range>] [--markers <file>]";

/**
 * Options as given, or an error for anything unknown or missing a value — a typo
 * must not quietly turn into a check of the working tree.
 * @param {string[]} args
 * @returns {{rev?: string, messages?: string, markers?: string} | {error: string}}
 */
export function parseArgs(args) {
  const names = new Set(["--rev", "--messages", "--markers"]);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const [name, value] = [args[i], args[i + 1]];
    if (!names.has(name)) return { error: `unknown argument: ${name}` };
    if (value === undefined || value.startsWith("--")) return { error: `${name} needs a value` };
    options[name.slice(2)] = value;
  }
  if (options.rev && options.messages) return { error: "use --rev or --messages, not both" };
  return options;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`check-public: ${parsed.error}\n${USAGE}`);
    process.exit(2);
  }
  const markers = parsed.markers ? parseList(readFileSync(parsed.markers, "utf8")) : [];
  const range = parsed.messages;
  const rev = parsed.rev;

  let problems;
  let what;
  if (range) {
    const commits = rangeMessages(root, range);
    problems = checkMessages(commits, { markers });
    what = `${commits.length} commit messages`;
  } else {
    const files = rev ? commitFiles(root, rev) : workingTreeFiles(root);
    const listPath = "scripts/hangul-allowed.txt";
    const list = rev
      ? files.find((f) => f.path === listPath)?.content.toString("utf8")
      : existsSync(join(root, listPath)) && readFileSync(join(root, listPath), "utf8");
    const allowedHangul = list ? parseList(list) : [];
    problems = checkFiles(files, { allowedHangul, markers });
    what = `${files.length} files`;
  }

  if (problems.length > 0) {
    console.error(`check-public: ${problems.length} problem(s) in ${what}`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`check-public: ${what} OK`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
