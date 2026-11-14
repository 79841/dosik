/**
 * Whether a slow action — a move, a delete, a new folder: a disk write and a
 * fresh listing — may still put the focus somewhere when it ends: only while
 * the focus is on nothing (the page) or still inside where it started. A
 * result that lands after the user went on takes neither the screen nor the
 * focus from that newer choice (#218 D15, #229).
 */
export const focusStillWith = (...where: (Element | null | undefined)[]): boolean => {
  const at = document.activeElement;
  return at === null || at === document.body || where.some((el) => el?.contains(at) === true);
};
