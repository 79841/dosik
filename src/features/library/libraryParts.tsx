import { useLayoutEffect, useRef, useState } from "react";

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

/** Inline rename: Enter or leaving the field keeps it, Escape keeps the old name. */
export const NameInput = ({
  name,
  label,
  onDone,
  size = "md",
}: {
  name: string;
  label: string;
  onDone: (name: string | null) => void;
  size?: keyof typeof NAME_INPUT_SIZE;
}) => {
  const [value, setValue] = useState(name);
  const field = useRef<HTMLInputElement>(null);
  // Enter and blur both end the edit; Escape must not be undone by the blur after it
  const settled = useRef(false);
  // focused as it mounts — on the library board without scrolling: the board's
  // camera brings the frame into view, a scroll would skew it (#221)
  useLayoutEffect(() => {
    field.current?.focus({ preventScroll: size === "board" });
  }, [size]);
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
