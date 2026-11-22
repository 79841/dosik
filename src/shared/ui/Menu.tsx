import { Check, ChevronRight, type LucideIcon } from "lucide-react";
import { type ReactNode, type RefObject, useId, useRef, useState } from "react";

import { FOCUS_ITEM } from "../lib/palette";
import { useMenuKeys } from "../lib/useMenuKeys";
import { usePopupPosition } from "../lib/usePopupPosition";
import { useOutsideDismiss } from "../lib/useOutsideDismiss";
import { SMALL_ICON_SIZE } from "./IconButton";

/**
 * A menu is at least this wide — the canvas draws every menu at 184 (#230). A menu opened under a button's right edge starts
 * this far to its left.
 */
export const MENU_MIN_WIDTH = 184;

/** a right-click menu opens this far right of and below the pointer (the canvas's menus) */
export const MENU_POINTER_OFFSET = 2;

/** where a menu opened by a right-click at `pointer` goes (#230) */
export const besidePointer = (pointer: { x: number; y: number }): { x: number; y: number } => ({
  x: pointer.x + MENU_POINTER_OFFSET,
  y: pointer.y + MENU_POINTER_OFFSET,
});

/**
 * where a menu opened from button `el` goes: its right end on the button's,
 * `gap` below it — 4 (#230); the sidebar's + hangs its menu 2 below (#256)
 */
export const belowRightOf = (el: Element, gap = 4): { x: number; y: number } => {
  const box = el.getBoundingClientRect();
  return { x: box.right - MENU_MIN_WIDTH, y: box.bottom + gap };
};

export interface MenuItem {
  /** what tells it apart when two labels are the same — a project's id; the label if not given */
  id?: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  /** a choice among the items (`menuitemradio`): ticked when it is the current one */
  checked?: boolean;
  /** the item moves focus itself (an input, another menu) — the opener does not take it back */
  takesFocus?: boolean;
  /** a rule before the item, between groups (the canvas's menus) */
  separatorBefore?: boolean;
  /**
   * A popover the item opens beside the menu, which stays open — Move to…'s
   * picker (#229 D13). Choosing the item, or →, opens it in place of
   * `onSelect`. `done.back` closes it and returns to the item; `done.close`
   * closes the menu and asks for focus back; `done.dismiss` closes it and
   * lets the focus go on (Tab). `id` is for the element the item controls.
   */
  picker?: (
    place: { menu: DOMRect; item: DOMRect },
    done: { back: () => void; close: () => void; dismiss: () => void },
    id: string,
  ) => ReactNode;
}

/**
 * A popup menu at a point (#217 D10 — a tree row's `…`; since #220 also
 * Home's card, project and New menus and the Change menu). It stays on
 * screen (#142) and a click outside closes it (#80). It takes focus when it
 * opens — the ticked item if there is one; the keyboard (`useMenuKeys`) goes
 * ↑↓ Home End, Enter or Space picks, Escape closes it and asks for focus
 * back — `onClose(true)` — and Tab closes it and lets the focus go on.
 */
export const Menu = ({
  at,
  label,
  items,
  opener,
  onSelect,
  onClose,
}: {
  at: { x: number; y: number };
  /** what the menu is for — its name */
  label: string;
  items: MenuItem[];
  /** the button that opened it — pressing it again closes the menu, not a click outside */
  opener?: RefObject<HTMLElement | null>;
  /** an item was picked: the caller closes the menu and runs it */
  onSelect: (item: MenuItem) => void;
  onClose: (returnFocus: boolean) => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  /** the item whose picker is open, with where it opened */
  const [picking, setPicking] = useState<{
    key: string;
    place: { menu: DOMRect; item: DOMRect };
  } | null>(null);
  /** what holds the open picker — a press there is not outside the menu */
  const pickerBox = useRef<HTMLDivElement>(null);
  const pickerId = useId();
  useOutsideDismiss(ref, true, () => onClose(false), { ignore: [opener, pickerBox] });
  const { left, top } = usePopupPosition(ref, at);
  // a menu takes focus when it opens — the ticked item if there is one — so
  // the keyboard can go on from here (the shared menu keys, #219)
  const move = useMenuKeys(ref, true, {
    onEscape: () => onClose(true),
    onTab: () => onClose(false),
    checkedFirst: true,
  });
  const keyOf = (item: MenuItem) => item.id ?? item.label;
  const openPicker = (item: MenuItem, button: HTMLElement) => {
    const menu = ref.current?.getBoundingClientRect();
    if (!menu) return;
    setPicking({ key: keyOf(item), place: { menu, item: button.getBoundingClientRect() } });
  };
  const pickerItem = picking ? items.find((i) => keyOf(i) === picking.key) : undefined;

  return (
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        data-tauri-drag-region="false"
        onKeyDown={(e) => {
          const item = items.find((i) => keyOf(i) === (e.target as HTMLElement).dataset.key);
          if (e.key === "ArrowRight" && item?.picker) {
            e.preventDefault();
            e.stopPropagation();
            openPicker(item, e.target as HTMLElement);
            return;
          }
          move(e);
        }}
        style={{ left, top }}
        // nodelete: Backspace here must not delete the canvas selection
        className="nodelete fixed z-50 flex min-w-46 max-w-72 flex-col rounded-[10px] bg-surface p-1 shadow-popover"
      >
        {items.flatMap((item) => {
          const Icon = item.icon;
          const radio = item.checked !== undefined;
          const key = keyOf(item);
          const picked = picking?.key === key;
          const rule = item.separatorBefore ? (
            <hr key={`${key}-rule`} className="my-1 h-px flex-none border-0 bg-line" />
          ) : null;
          const button = (
            // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked only rides on the menuitemradio role, set together
            <button
              key={key}
              type="button"
              data-key={key}
              role={radio ? "menuitemradio" : "menuitem"}
              aria-checked={radio ? item.checked : undefined}
              aria-haspopup={item.picker ? "tree" : undefined}
              aria-expanded={item.picker ? picked : undefined}
              aria-controls={picked ? pickerId : undefined}
              tabIndex={-1}
              onClick={(e) => {
                if (item.picker) openPicker(item, e.currentTarget);
                else onSelect(item);
              }}
              className={`flex h-7 w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-[12px] font-medium transition-colors hover:bg-hover ${FOCUS_ITEM} ${item.danger ? "text-danger" : "text-ink"} ${picked ? "bg-hover" : ""}`}
            >
              {Icon ? (
                <Icon
                  size={SMALL_ICON_SIZE}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className={item.danger ? "flex-none" : "flex-none text-icon"}
                />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.checked ? (
                <Check size={13} strokeWidth={2.25} aria-hidden="true" className="flex-none" />
              ) : null}
              {item.picker ? (
                <ChevronRight
                  size={13}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="flex-none text-muted"
                />
              ) : null}
            </button>
          );
          return rule ? [rule, button] : [button];
        })}
      </div>
      {picking && pickerItem?.picker ? (
        // the picker is drawn fixed beside the menu; this box only holds it, outside the menu's role
        <div ref={pickerBox}>
          {pickerItem.picker(
            picking.place,
            {
              back: () => {
                setPicking(null);
                ref.current
                  ?.querySelector<HTMLElement>(`[data-key="${CSS.escape(picking.key)}"]`)
                  ?.focus();
              },
              close: () => onClose(true),
              dismiss: () => onClose(false),
            },
            pickerId,
          )}
        </div>
      ) : null}
    </>
  );
};
