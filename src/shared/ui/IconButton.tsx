import { useId } from "react";

import { FOCUS_RING } from "../lib/palette";

/**
 * The design system's icon-button heights (#217 D30, #219): chrome band 24,
 * rows and the toolbar row 28, the canvas islands 32, 36 before the compact pass
 */
export type IconButtonSize = 24 | 28 | 32 | 36;

const SIZE_CLASS: Record<IconButtonSize, string> = {
  24: "h-6 min-w-6 rounded-[5px] px-1",
  28: "h-7 min-w-7 rounded-md px-1.5",
  32: "h-8 min-w-8 rounded-(--radius-button) px-1",
  36: "h-9 min-w-9 rounded-md px-2",
};

/** where the tooltip hangs from the button */
const TOOLTIP_PLACE = {
  above: "bottom-full mb-2",
  below: "top-full mt-2",
  right: "left-full ml-2 top-1/2 -translate-y-1/2",
} as const;

/** where a tooltip below or above lines up with its button */
const TOOLTIP_ALIGN = {
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
  start: "left-0",
} as const;

/**
 * A toolbar button that is an icon (#158). The label is a tooltip that shows
 * on hover and keyboard focus, and the button is named by it
 * (`aria-labelledby`) — one string, read once. The browser's
 * `title` tooltip arrives a second late and cannot match the app, so it is not
 * set. `children` is the icon, optionally followed by a disclosure chevron.
 * A button that opens a menu passes `expanded`; the tooltip stays out of the
 * way while the menu is open, since both hang below the button.
 *
 * A shortcut (#217) shows after the label in the tooltip, dimmed — not part of
 * the name, which `aria-keyshortcuts` completes instead.
 */
export const IconButton = ({
  id,
  controls,
  label,
  onClick,
  disabled,
  busy,
  pressed,
  expanded,
  tooltip = "below",
  align = "center",
  size = 36,
  shortcut,
  keyshortcuts,
  popup,
  children,
}: {
  /** the button's own DOM id — for focus to come back to it */
  id?: string;
  /** what it opens or toggles, while that is on screen (`aria-controls`) */
  controls?: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /**
   * its action is under way: a press waits and assistive tech hears it is
   * busy; it keeps the focus (aria-disabled, not disabled)
   */
  busy?: boolean;
  pressed?: boolean;
  /** set on a button that opens a menu: whether the menu is open */
  expanded?: boolean;
  /** what pressing it opens, when it opens something (`aria-haspopup`) */
  popup?: "menu" | "dialog";
  /**
   * where the tooltip hangs — "above" for a bar at the bottom of the canvas,
   * "right" for the vertical shape strip on its left
   */
  tooltip?: keyof typeof TOOLTIP_PLACE;
  /**
   * "end" lines the tooltip up with the button's right edge — a button near a
   * column's right edge; "start" with its left edge — a button at the window's
   * left edge
   */
  align?: keyof typeof TOOLTIP_ALIGN;
  size?: IconButtonSize;
  /** shown in the tooltip, e.g. `⌘\` */
  shortcut?: string;
  /** the same shortcut for assistive tech, e.g. `Meta+Backslash` */
  keyshortcuts?: string;
  children: React.ReactNode;
}) => {
  const labelId = useId();
  return (
    <button
      type="button"
      id={id}
      aria-controls={controls}
      aria-labelledby={labelId}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-haspopup={popup}
      aria-keyshortcuts={keyshortcuts}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={busy ? undefined : onClick}
      disabled={disabled}
      // a pressed toggle and an open menu's button wear `selected` (the design
      // system's "pressed toggle or open menu button"), over the hover wash
      className={`group/icon relative flex items-center justify-center gap-0.5 transition-colors ${FOCUS_RING} aria-expanded:bg-selected aria-pressed:bg-selected aria-pressed:text-ink disabled:opacity-35 disabled:hover:bg-transparent ${busy ? "cursor-default text-muted" : "text-icon hover:bg-hover"} ${SIZE_CLASS[size]}`}
    >
      {children}
      <span
        id={labelId}
        role="tooltip"
        // the design's tooltip: 22 tall, 7 in, radius 5, 11px
        className={`pointer-events-none absolute z-40 ${tooltip === "right" ? "" : TOOLTIP_ALIGN[align]} ${TOOLTIP_PLACE[tooltip]} flex h-[22px] items-center whitespace-nowrap rounded-(--radius-control) bg-ink-surface px-[7px] text-[11px] font-medium text-surface opacity-0 transition-opacity group-hover/icon:opacity-100 group-hover/icon:delay-300 group-focus-visible/icon:opacity-100 group-aria-expanded/icon:hidden`}
      >
        {label}
        {shortcut ? (
          <span aria-hidden="true" className="ml-1.5 text-on-ink-muted">
            {shortcut}
          </span>
        ) : null}
      </span>
    </button>
  );
};

/** Lucide's default 24px is too big for a 36px button; 18px reads at a glance */
export const ICON_SIZE = 18;
/** the icon in a 28 or 32 toolbar / island button (`icon-size`, #219) */
export const TOOL_ICON_SIZE = 16;
/** the icon in a 24 or 28 button — the chrome band, the sidebar's rows (#217 D30) */
export const SMALL_ICON_SIZE = 15;
/** stroke a touch lighter than Lucide's 2 — the app's lines are 1.5 */
export const ICON_STROKE = 1.75;
