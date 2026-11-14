import { ACCENT_BUTTON, FOCUS_RING } from "../../shared/lib/palette";

/**
 * Home's shared class strings (#220) — the compact sizes of the design
 * system (`parts/compact/SPEC.md`): 28px controls, radius 6, 12px type. Every
 * colour is a token utility; nothing here draws a border (Borderless).
 */

/** a filled ink button's look, sizes and spacing left to the caller */
export const INK_FILL = `flex flex-none items-center text-[12px] font-semibold disabled:cursor-default disabled:opacity-60 ${ACCENT_BUTTON} ${FOCUS_RING}`;
/** a filled ink button — New project, Create */
export const INK_BUTTON = `h-7 gap-2 rounded-md px-3 ${INK_FILL}`;
/** a quiet button on the frame tone — Move to…, Cancel, Try again */
export const FRAME_BUTTON = `flex h-7 flex-none items-center gap-1.5 rounded-md bg-frame px-2.5 text-[12px] font-semibold text-ink transition-colors hover:bg-selected disabled:cursor-default disabled:opacity-60 ${FOCUS_RING}`;
/** a section's label: 10.5 uppercase, muted, 10 above what it labels (D5) */
export const SECTION_LABEL =
  "m-0 text-[10.5px] font-semibold uppercase leading-[14px] tracking-[0.06em] text-muted";
