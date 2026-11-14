/**
 * A folder view's cards as a grid for the keyboard (#231 D7): ←→ go to the
 * card before or after (stopping at the ends), ↑↓ to the same column a row
 * up or down (staying put when that cell is empty), Home and End to the first
 * and last. Pure, like the tree's and the board's moves (#217 D29, #221 D20);
 * the view reads the number of columns off the grid as it is drawn.
 */
export type GridKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

const GRID_KEYS: ReadonlySet<string> = new Set<GridKey>([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

export const isGridKey = (key: string): key is GridKey => GRID_KEYS.has(key);

/** where `key` goes from card `at` of `count`, `cols` to a row */
export const gridMove = (count: number, cols: number, at: number, key: GridKey): number => {
  const last = Math.max(count - 1, 0);
  const row = Math.max(cols, 1);
  switch (key) {
    case "ArrowLeft":
      return Math.max(at - 1, 0);
    case "ArrowRight":
      return Math.min(at + 1, last);
    case "ArrowUp":
      return at - row >= 0 ? at - row : at;
    case "ArrowDown":
      return at + row <= last ? at + row : at;
    case "Home":
      return 0;
    case "End":
      return last;
  }
};

/**
 * The tracks of `value` at the top level: `repeat(N, …)` counts N times what
 * it repeats, a function such as `minmax(…)` one, line names `[…]` none.
 */
const countTracks = (value: string): number => {
  let tracks = 0;
  let i = 0;
  while (i < value.length) {
    if (/\s/.test(value[i]!)) {
      i++;
      continue;
    }
    // one top-level token: up to whitespace outside brackets
    let depth = 0;
    let j = i;
    for (; j < value.length; j++) {
      const ch = value[j]!;
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      else if (depth === 0 && /\s/.test(ch)) break;
    }
    const token = value.slice(i, j);
    const repeat = /^repeat\((\d+)\s*,(.*)\)$/s.exec(token);
    if (repeat) tracks += Number(repeat[1]) * Math.max(countTracks(repeat[2]!), 1);
    else if (!token.startsWith("[")) tracks += 1;
    i = j;
  }
  return tracks;
};

/** the columns grid `el` has right now — as many as the browser laid out (1-4 at the card sizes, #236 D5); 1 when it cannot be read */
export const columnsOf = (el: Element | null): number => {
  if (!el) return 1;
  const value = getComputedStyle(el).gridTemplateColumns.trim();
  if (!value || value === "none") return 1;
  return Math.max(countTracks(value), 1);
};
