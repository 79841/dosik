import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useEffect } from "react";

/**
 * what a menu's keys walk: the items that can be chosen — `menuitem`,
 * `menuitemcheckbox` and `menuitemradio` alike. One selector, not a list: a
 * list may come back grouped by selector instead of in the menu's order.
 */
const ITEMS = '[role^="menuitem"]:not(:disabled)';

/**
 * A menu's keyboard, the WAI-ARIA menu's (#219): when it opens, the
 * first item that can be chosen takes the focus; ↑↓ move round, Home and End
 * go to the ends; Escape calls `onEscape`, which closes it and gives the
 * focus back to whatever opened it; Tab, when `onTab` is given, closes it and
 * lets the focus go on. The keys it handles stop here: `useOutsideDismiss`
 * hears Escape on the window too, and the canvas keymap would take the
 * arrows. Every menu shares this — the pattern was hand-copied per menu.
 *
 * `ref` is the `role="menu"` element; `open` whether it is on screen (a menu
 * that is mounted only while open passes `true`). `columns` is for items laid
 * out as a grid (the shape strip's icons, #219): ←→ then step one,
 * ↑↓ a row, stopping at the edge. `checkedFirst`: a menu of choices opens on
 * the ticked one (`aria-checked="true"`), when there is one (#220's shared
 * `Menu`). Returns the menu's `onKeyDown`.
 */
export const useMenuKeys = (
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  {
    onEscape,
    onTab,
    columns = 1,
    checkedFirst = false,
  }: { onEscape: () => void; onTab?: () => void; columns?: number; checkedFirst?: boolean },
): ((e: ReactKeyboardEvent) => void) => {
  useEffect(() => {
    if (!open) return;
    const menu = ref.current;
    const checked = checkedFirst
      ? menu?.querySelector<HTMLElement>(`${ITEMS}[aria-checked="true"]`)
      : null;
    (checked ?? menu?.querySelector<HTMLElement>(ITEMS))?.focus();
  }, [ref, open, checkedFirst]);

  return (e) => {
    const all = [...(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => all[(i + all.length) % all.length]?.focus();
    // from outside the items, forward is the first and back the last
    const step = (by: number) => focus(at < 0 ? (by > 0 ? 0 : -1) : at + by);
    /** a row up or down the grid; nothing past the edge */
    const row = (by: number) => {
      if (at < 0 || all[at + by]) step(by);
    };
    const grid = columns > 1;
    const vertical = grid ? row : step;
    if (e.key === "ArrowDown") vertical(columns);
    else if (e.key === "ArrowUp") vertical(-columns);
    else if (grid && e.key === "ArrowRight") step(1);
    else if (grid && e.key === "ArrowLeft") step(-1);
    else if (e.key === "Home") focus(0);
    else if (e.key === "End") focus(-1);
    else if (e.key === "Escape") onEscape();
    else if (e.key === "Tab" && onTab) {
      onTab();
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
};
