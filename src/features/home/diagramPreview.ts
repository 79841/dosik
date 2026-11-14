import { normalizeDoc } from "../../shared/lib/store/document";
import type { ThemeMode } from "../../shared/lib/theme";
import type { DiagramDoc } from "../../shared/lib/types";
import { renderVectorSvg } from "../export/vectorSvg";
import { loadProject } from "../library/libraryApi";

/**
 * Pictures of diagrams on Home (#161, #220 D14): cards and the Continue well.
 * A diagram is drawn from its file by the window-free vector renderer (#148)
 * — the same shapes and line layout as the canvas, with no canvas mounted
 * and nothing captured.
 */

/** the diagram, normalized the way a file load would leave it */
export const previewDoc = (file: DiagramDoc): DiagramDoc => ({
  ...file,
  ...normalizeDoc(file.nodes, file.edges),
});

/** an `<img>`-ready picture of a diagram, or `null` when it has nothing on it */
export const previewSrc = (file: DiagramDoc, theme: ThemeMode): string | null => {
  const doc = previewDoc(file);
  if (doc.nodes.length === 0) return null;
  // an <img> never runs what is inside it, so a hostile label cannot script the app
  const svg = renderVectorSvg(doc, { theme });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

/** ⑤ pictures held at once — a few screens of cards */
export const PREVIEW_CACHE_LIMIT = 96;
/** ⑤ and data URL characters held at once: a diagram holding images is megabytes of data URL */
export const PREVIEW_CACHE_CHARS = 32_000_000;

interface Held {
  updatedAt: number;
  picture: Promise<string | null>;
  /** the data URL's length once drawn; 0 while it is being drawn */
  chars: number;
  /** the picture once drawn — what `peekPicture` hands out without waiting */
  drawn?: { src: string | null };
}

/**
 * ② One picture per diagram and theme: an unchanged diagram is read
 * and drawn once however often it is shown, and an edited one replaces its
 * old pictures rather than piling up beside them (#161). A Map keeps
 * insertion order, so the first key is the least recently shown.
 */
const cache = new Map<string, Held>();
let limits = { pictures: PREVIEW_CACHE_LIMIT, chars: PREVIEW_CACHE_CHARS };

/** ③ reads under way, per diagram and edit — several pictures of one diagram share one */
const reading = new Map<string, Promise<DiagramDoc>>();

export const readDiagram = (id: string, updatedAt: number): Promise<DiagramDoc> => {
  const key = `${id}:${updatedAt}`;
  const running = reading.get(key);
  if (running) return running;
  // held only while it is out: a later edit, or a picture forgotten since, reads again
  const read = loadProject(id).finally(() => reading.delete(key));
  reading.set(key, read);
  return read;
};

/** ④ the rest of this task first — reads that land together are drawn one task each */
const yieldTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const heldChars = (): number => [...cache.values()].reduce((sum, held) => sum + held.chars, 0);

/** ⑤ forgets the least recently shown until both budgets hold — the newest always stays */
const trim = () => {
  while (cache.size > 1 && (cache.size > limits.pictures || heldChars() > limits.chars)) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

/** A diagram's picture — `null` for an empty one. Rejects when the file cannot be read. */
export const loadPicture = (
  id: string,
  updatedAt: number,
  theme: ThemeMode,
): Promise<string | null> => {
  const key = `${id}:${theme}`;
  const hit = cache.get(key);
  if (hit && hit.updatedAt === updatedAt) {
    // most recently shown goes last
    cache.delete(key);
    cache.set(key, hit);
    return hit.picture;
  }
  const held: Held = { updatedAt, picture: Promise.resolve(null), chars: 0 };
  held.picture = readDiagram(id, updatedAt).then(async (file) => {
    await yieldTask();
    const src = previewSrc(file, theme);
    held.drawn = { src };
    if (cache.get(key) === held) {
      held.chars = src?.length ?? 0;
      trim();
    }
    return src;
  });
  // a failed read is not remembered — the next showing tries again
  held.picture.catch(() => {
    if (cache.get(key) === held) cache.delete(key);
  });
  // a fresh picture is the most recently shown — the key moves to the end
  cache.delete(key);
  cache.set(key, held);
  trim();
  return held.picture;
};

/**
 * A diagram's picture if it is drawn already — `null` for an empty one,
 * `undefined` when it is not (still drawing, never asked for, an older
 * edit). Nothing is read or drawn: the library canvas, zoomed far out,
 * shows what it has and asks for nothing new (#221 D19).
 */
export const peekPicture = (
  id: string,
  updatedAt: number,
  theme: ThemeMode,
): string | null | undefined => {
  const hit = cache.get(`${id}:${theme}`);
  return hit && hit.updatedAt === updatedAt ? hit.drawn?.src : undefined;
};

/** how many pictures are held — for tests */
export const previewCacheSize = (): number => cache.size;

/** test seam: nothing held or being read; `limits` stand in for the budgets */
export const resetPreviewCacheForTests = (
  next: Partial<{ pictures: number; chars: number }> = {},
): void => {
  cache.clear();
  reading.clear();
  limits = { pictures: PREVIEW_CACHE_LIMIT, chars: PREVIEW_CACHE_CHARS, ...next };
};
