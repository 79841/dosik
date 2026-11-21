/**
 * What the library names things on disk, for the MCP server — the same rules
 * the app keeps in `src-tauri/src/library/names.rs` and `walk.rs`: a project,
 * a folder or a diagram is called what its folder or file is called, so a
 * name asked for becomes a file name, cleaned so every file system takes it
 * and made unique among its siblings.
 *
 * Both sides are tested against one list of cases,
 * `src-tauri/src/library/rules.json`, so they cannot drift apart unseen.
 */

/** a name is at most this many characters — what the app's name fields allow */
export const MAX_NAME_CHARS = 80;
/** and at most this many bytes of UTF-8, so the extension and a " 2" still fit */
export const MAX_NAME_BYTES = 240;

/** how deep folders nest — a project is level 1; deeper ones are not read */
export const MAX_DEPTH = 10;

export const UNTITLED_DIAGRAM = "Untitled Diagram";
export const UNTITLED_FOLDER = "Untitled Folder";
export const UNTITLED_PROJECT = "Untitled Project";

/** a diagram's file: `<name>.dosik` */
export const DIAGRAM_EXT = ".dosik";
/** what diagrams were saved as before — still listed and opened */
export const OLD_DIAGRAM_EXT = ".dosik.json";

/** every temp file ends with it — the listing never shows one */
export const TMP_EXT = ".tmp";

const asciiLower = (text) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * The diagram name a file name carries: the name without `.dosik` or the
 * older `.dosik.json`, either in any case — `null` for any other file.
 */
export const diagramStem = (file) => {
  const lower = asciiLower(file);
  for (const ext of [OLD_DIAGRAM_EXT, DIAGRAM_EXT]) {
    if (lower.endsWith(ext) && file.length > ext.length) return file.slice(0, -ext.length);
  }
  return null;
};

/**
 * What the entry `name` is to the library — `dir` when it is a real
 * directory: `skip` (hidden, a temp file), `folder`, `diagram` or `other`
 * (a file of the user's).
 */
export const classify = (name, dir) => {
  if (name.startsWith(".") || asciiLower(name).endsWith(TMP_EXT)) return "skip";
  if (dir) return "folder";
  return diagramStem(name) === null ? "other" : "diagram";
};

/** characters no file name may hold on one platform or another */
const FORBIDDEN = new Set(["/", "\\", ":", "*", "?", '"', "<", ">", "|"]);
const CONTROL = /^\p{Cc}$/u;
const WHITE = /^\p{White_Space}$/u;

/** names Windows keeps for devices, whatever follows a dot */
const RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

const utf8Length = (text) => Buffer.byteLength(text, "utf8");

const isTrimmed = (c) => c === "." || WHITE.test(c);

const trimEnds = (name) => {
  const chars = [...name];
  let start = 0;
  let end = chars.length;
  while (start < end && isTrimmed(chars[start])) start += 1;
  while (end > start && isTrimmed(chars[end - 1])) end -= 1;
  return chars.slice(start, end).join("");
};

/** `name` cut to `chars` characters and `bytes` bytes, never inside one, trimmed again */
const cutTo = (name, chars, bytes) => {
  let out = "";
  let count = 0;
  for (const c of name) {
    if (count === chars || utf8Length(out) + utf8Length(c) > bytes) break;
    out += c;
    count += 1;
  }
  return trimEnds(out);
};

const trimEndWhite = (text) => {
  const chars = [...text];
  let end = chars.length;
  while (end > 0 && WHITE.test(chars[end - 1])) end -= 1;
  return chars.slice(0, end).join("");
};

/** `name` with a `-` after a Windows device name — `con` and `con.txt` are both the console there */
const avoidReserved = (name) => {
  const dot = name.indexOf(".");
  const stem = trimEndWhite(dot === -1 ? name : name.slice(0, dot));
  return RESERVED.has(stem.toLowerCase()) ? `${stem}-${name.slice(stem.length)}` : name;
};

/**
 * `raw` as a file name: forbidden and control characters become `-`; dots
 * and spaces at either end go (a leading dot hides a file, a trailing one
 * Windows drops); a Windows device name gets a `-`; at most
 * `MAX_NAME_CHARS` and `MAX_NAME_BYTES`; nothing left is `fallback`.
 */
export const clean = (raw, fallback) => {
  const replaced = [...raw].map((c) => (FORBIDDEN.has(c) || CONTROL.test(c) ? "-" : c)).join("");
  const once = cutTo(trimEnds(replaced), MAX_NAME_CHARS, MAX_NAME_BYTES);
  // a truncation can leave a device name behind, and the `-` a long one
  const name = cutTo(avoidReserved(once), MAX_NAME_CHARS, MAX_NAME_BYTES);
  return name.length === 0 ? fallback : name;
};

/**
 * Composes conjoining Hangul jamo into syllables — the algorithmic part of
 * NFC, which is all a Korean name needs; other scripts are left as they are.
 */
const composeHangul = (name) => {
  const S_BASE = 0xac00;
  const L_BASE = 0x1100;
  const V_BASE = 0x1161;
  const T_BASE = 0x11a7;
  const out = [];
  for (const c of name) {
    const code = c.codePointAt(0);
    const prev = out.length > 0 ? out[out.length - 1] : undefined;
    if (prev !== undefined) {
      let composed;
      if (prev >= L_BASE && prev < L_BASE + 19 && code >= V_BASE && code < V_BASE + 21) {
        composed = S_BASE + ((prev - L_BASE) * 21 + (code - V_BASE)) * 28;
      } else if (
        prev >= S_BASE &&
        prev < S_BASE + 11172 &&
        (prev - S_BASE) % 28 === 0 &&
        code > T_BASE &&
        code < T_BASE + 28
      ) {
        composed = prev + (code - T_BASE);
      }
      if (composed !== undefined) {
        out[out.length - 1] = composed;
        continue;
      }
    }
    out.push(code);
  }
  return String.fromCodePoint(...out);
};

/**
 * `name` as two names are compared for a clash: lower case, Hangul composed —
 * macOS ignores case, and hands back names Finder made in decomposed form.
 */
export const fold = (name) => composeHangul(name).toLowerCase();

/** whether two names clash in one folder */
export const same = (a, b) => fold(a) === fold(b);

/**
 * `wanted`, or the first of `wanted 2`, `wanted 3`, … that `taken` does not
 * hold — cut so the number still fits the limits.
 */
export const uniqueName = (wanted, taken) => {
  if (!taken(wanted)) return wanted;
  for (let n = 2; ; n += 1) {
    const suffix = ` ${n}`;
    const base = cutTo(wanted, MAX_NAME_CHARS - suffix.length, MAX_NAME_BYTES - suffix.length);
    const candidate = `${base}${suffix}`;
    if (!taken(candidate)) return candidate;
  }
};

const isDigit = (cp) => cp >= 0x30 && cp <= 0x39;

/** code-point order — what Rust compares `char`s and `str`s by */
const byCodePoint = (a, b) => {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d !== 0) return Math.sign(d);
  }
  return Math.sign(x.length - y.length);
};

/**
 * The order names sort in when nothing else says: ignoring case, numbers by
 * value (`Flow 2` before `Flow 10`); names that still tie go by their
 * characters, so the order never depends on how they were found.
 */
export const naturalCmp = (a, b) => {
  const x = [...fold(a)].map((c) => c.codePointAt(0));
  const y = [...fold(b)].map((c) => c.codePointAt(0));
  let i = 0;
  let j = 0;
  for (;;) {
    if (i >= x.length && j >= y.length) return byCodePoint(a, b);
    if (i >= x.length) return -1;
    if (j >= y.length) return 1;
    if (isDigit(x[i]) && isDigit(y[j])) {
      let nx = "";
      let ny = "";
      while (i < x.length && isDigit(x[i])) nx += String.fromCodePoint(x[i++]);
      while (j < y.length && isDigit(y[j])) ny += String.fromCodePoint(y[j++]);
      const tx = nx.replace(/^0+/, "");
      const ty = ny.replace(/^0+/, "");
      if (tx.length !== ty.length) return Math.sign(tx.length - ty.length);
      if (tx !== ty) return tx < ty ? -1 : 1;
      continue;
    }
    if (x[i] !== y[j]) return Math.sign(x[i] - y[j]);
    i += 1;
    j += 1;
  }
};
