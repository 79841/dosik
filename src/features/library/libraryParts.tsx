import { type RefObject, useLayoutEffect, useRef, useState } from "react";

import { MAX_FOLDER_NAME } from "./libraryApi";
import { PLAIN_TEXT } from "../../shared/ui/plainText";

/** below this a library read is local-disk fast — placeholders would only flash (Home, the tree) */
export const SKELETON_DELAY_MS = 300;

/** a heading's field, a tree row's — 26px rows take a 22px field (#217) — and a canvas frame's, in board units (#221) */
const NAME_INPUT_SIZE = {
  md: "rounded-md px-2 py-1 text-[13.5px] font-semibold",
  sm: "h-[22px] rounded-[4px] px-1.5 text-[12px] font-medium",
  board: "h-8 rounded-[6px] px-2 text-[16px] font-semibold",
} as const;

/** the narrowest a tree row's rename field gets, however little room is left (Sidebar-Deep) */
const LIST_FIELD_MIN = 96;

/** Inline rename: Enter or leaving the field keeps it, Escape keeps the old name. */
export const NameInput = ({
  name,
  label,
  onDone,
  size = "md",
  list,
}: {
  name: string;
  label: string;
  onDone: (name: string | null) => void;
  size?: keyof typeof NAME_INPUT_SIZE;
  /**
   * the sideways-scrolling tree list (keeping `--list-w`) of the row it is
   * in, a row as wide as the widest: the field ends 8px in from the list's
   * visible right edge instead of running past it, cut square — but is never
   * narrower than {@link LIST_FIELD_MIN}, the list scrolling to show it then
   */
  list?: RefObject<HTMLElement | null>;
}) => {
  const [value, setValue] = useState(name);
  const field = useRef<HTMLInputElement>(null);
  // Enter and blur both end the edit; Escape must not be undone by the blur after it
  const settled = useRef(false);
  // focused as it mounts — on the library board without scrolling: the board's
  // camera brings the frame into view, a scroll would skew it (#221)
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.focus({ preventScroll: size === "board" });
    const box = list?.current;
    if (!box) return;
    // from where it starts in its row — which starts at the list's left edge —
    // to 8px short of the visible right edge, as the list is scrolled now
    const taken = el.offsetLeft + 8 - box.scrollLeft;
    el.style.maxWidth = `max(${LIST_FIELD_MIN}px, calc(var(--list-w) - ${taken}px))`;
    // less room than that: the list scrolls so the field keeps the 8px inset
    const short = LIST_FIELD_MIN - (box.clientWidth - taken);
    if (short > 0) box.scrollLeft += short;
  }, [size, list]);
  const finish = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    onDone(commit ? value : null);
  };
  return (
    <input
      {...PLAIN_TEXT}
      ref={field}
      aria-label={label}
      value={value}
      maxLength={MAX_FOLDER_NAME}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          // the edit's end and nothing else: the focus may go back to the
          // button that opened it, which must not take the key as its press
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") finish(false);
      }}
      className={`min-w-0 flex-1 bg-surface text-ink outline-none ring-1 ring-primary ${NAME_INPUT_SIZE[size]}`}
    />
  );
};

/**
 * A tree row's indent at `level` (#229 D6): 4 + 16 per level after the first —
 * the sidebar's tree and the Move to… picker. Static classes, for Tailwind.
 */
const INDENT = [
  "pl-1",
  "pl-5",
  "pl-9",
  "pl-13",
  "pl-17",
  "pl-21",
  "pl-25",
  "pl-29",
  "pl-33",
  "pl-37",
  "pl-41",
] as const;
export const indentClass = (level: number): string =>
  INDENT[Math.min(Math.max(level, 1), INDENT.length) - 1]!;

/**
 * Keeps `--list-w` on a sideways-scrolling tree list at its visible width —
 * its client width, less a classic scroll bar — for {@link RowPaint}'s boxes
 * and the rename field. Not `100cqw`: engines size an `overflow: auto`
 * container before its scroll bars come, so a classic one (Windows, macOS
 * with a mouse) would hide the boxes' far corners under it.
 */
export const useListWidth = (list: RefObject<HTMLElement | null>) => {
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const keep = () => el.style.setProperty("--list-w", `${el.clientWidth}px`);
    keep();
    // the content box: it narrows as a classic scroll bar comes
    const watch = new ResizeObserver(keep);
    watch.observe(el);
    return () => watch.disconnect();
  }, [list]);
};

/**
 * A tree row's paint on a box as wide as the list's visible part, stuck to
 * the list's left edge, with the row's corners (canvas `Sidebar-Deep`): rows
 * are as wide as the widest row and the list scrolls sideways, so a fill or a
 * ring on the row itself would run past the list's edge and end square there.
 * The box sticks inside a layer over the whole row, which it never leaves.
 * The `fill` layer lies under the row's content, the `ring` layer over it and
 * over the row's sticky tail. The sidebar's tree and the Move to… picker.
 *
 * It takes: the list keeps `--list-w` ({@link useListWidth}) — without it
 * the box falls back to the row's width, cut square again — and has no
 * padding on either side (the box sticks to the scroll box's edge, its rows
 * start there); the row is `relative isolate` and rounded.
 */
export const RowPaint = ({
  layer,
  className = "",
}: {
  layer: "fill" | "ring";
  className?: string;
}) => (
  <span
    aria-hidden="true"
    className={`pointer-events-none absolute inset-0 rounded-[inherit] ${layer === "fill" ? "-z-10" : "z-10"}`}
  >
    <span
      data-fill={layer === "fill" ? "" : undefined}
      data-ring={layer === "ring" ? "" : undefined}
      className={`sticky left-0 block h-full w-(--list-w) rounded-[inherit] ${className}`}
    />
  </span>
);
