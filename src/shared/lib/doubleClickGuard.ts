/**
 * A click that opens something changes the screen at once — a folder's view,
 * a document tab — and a double click's later presses then land on that new
 * screen: on a card in the same place, a dashed New card, or an editor whose
 * canvas zooms or starts a label edit on a double click. After such a click
 * the rest of the same double click is swallowed at the window's capture
 * phase — every press, release and click of that multi-click (`detail ≥ 2`)
 * and its `dblclick` — until a new click starts (`detail` 1) or the
 * double-click time is over. Generous on purpose: a later event with
 * `detail ≥ 2` belongs to that double click whenever it comes.
 */
const EVENTS = ["mousedown", "mouseup", "click", "dblclick"] as const;
const DOUBLE_CLICK_MS = 1000;

let disarm: (() => void) | null = null;

export const swallowRestOfDoubleClick = (): void => {
  disarm?.();
  const swallow = (e: MouseEvent) => {
    if (e.type !== "dblclick" && e.detail < 2) {
      stop();
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const timer = window.setTimeout(() => stop(), DOUBLE_CLICK_MS);
  const stop = () => {
    window.clearTimeout(timer);
    for (const type of EVENTS) window.removeEventListener(type, swallow, true);
    disarm = null;
  };
  for (const type of EVENTS) window.addEventListener(type, swallow, true);
  disarm = stop;
};

/**
 * Whether a click on something that opens opens it: not a double click's
 * later clicks. A mouse's click (`detail` 1) also swallows the rest of its
 * double click; a keyboard's (`detail` 0 — Space on a button) has none.
 */
export const clickOpens = (e: { detail: number }): boolean => {
  if (e.detail > 1) return false;
  if (e.detail === 1) swallowRestOfDoubleClick();
  return true;
};
