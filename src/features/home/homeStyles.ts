import { ACCENT_BUTTON, FOCUS_RING } from "../../shared/lib/palette";

/**
 * Home's shared class strings (#220) — the compact sizes of the design
 * system (`parts/compact/SPEC.md`): 28px controls, radius 6, 12px type. Every
 * colour is a token utility; nothing here draws a border (Borderless) but
 * card C's hairline (#265).
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

/**
 * Card C's line (#265): a hairline (0.5px) inside the card — an outline, so
 * it stays over a full-bleed picture and the card keeps its size. `edge` at
 * rest, so a line this thin still reads on a Recent card or a folder view's
 * card.
 */
export const CARD_LINE = "outline-[0.5px] -outline-offset-[0.5px] outline-edge";
/**
 * A START tile's and the Continue card's hairline — the same 0.5px outline as
 * a card's, a step lighter (`line-strong`); pointing at a tile takes it to
 * `edge`.
 */
export const TILE_LINE = "outline-[0.5px] -outline-offset-[0.5px] outline-line-strong";
/** pointing at a lined tile: its line a step darker */
export const TILE_HOVER = "hover:outline-edge";
/** the hairline between a card C's picture and its caption */
export const CAPTION_LINE = "border-t-[0.5px] border-edge";
/** pointing at a lined card: its line a step darker, `dash` (`HomeCardFx-Fade`) */
export const CARD_HOVER = "hover:outline-dash";
/** a card C caption's quiet text — what a folder holds, when it was edited, where it lives */
export const CAPTION_META = "text-muted-strong";
/** a lined tile's line and ring change at the canvas's pace, where motion is allowed */
export const LINE_EASE =
  "motion-safe:[transition:outline-color_160ms_ease-out,box-shadow_220ms_ease-out]";
/**
 * Pressing a card C shrinks it to 99% in 160ms and lets it out softly in
 * 360ms (`HomeCardFx-Fade`) — the line and the ring change at the canvas's
 * pace with it. All of it only where motion is allowed: with reduced motion
 * the colours change at once and nothing shrinks. `CARD_PRESS` is for a card
 * that is the button itself (Recent); `CARD_BODY_PRESS` for a folder view's
 * card, which shrinks only for a press on its own button — not on Open or
 * More (⋯) over it.
 */
export const CARD_PRESS =
  "motion-safe:active:scale-[.99] motion-safe:active:[transition-duration:160ms,220ms,160ms] motion-safe:[transition:outline-color_160ms_ease-out,box-shadow_220ms_ease-out,scale_360ms_cubic-bezier(0.22,1,0.36,1)]";
export const CARD_BODY_PRESS =
  "motion-safe:has-[[data-card-key]:active]:scale-[.99] motion-safe:has-[[data-card-key]:active]:[transition-duration:160ms,220ms,160ms] motion-safe:[transition:outline-color_160ms_ease-out,box-shadow_220ms_ease-out,scale_360ms_cubic-bezier(0.22,1,0.36,1)]";
/** a card C's caption under its hairline: the line and a tint follow the card's pointer */
export const CAPTION_POINTING =
  "group-hover/card:border-dash group-hover/card:bg-hover motion-safe:transition-colors motion-safe:duration-160 motion-safe:ease-out";
