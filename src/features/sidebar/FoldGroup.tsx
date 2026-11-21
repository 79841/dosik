import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

/** how long a folder's rows take to unfold or fold (#260 R1) */
export const FOLD_MS = 180;

/**
 * The fold motion (canvas `Sidebar-Drag` ③): height and opacity together,
 * ease-out. None under reduced motion — the rows come and go at once.
 */
const FOLD_MOTION =
  "motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-180 motion-safe:ease-[cubic-bezier(0.2,0,0,1)]";

/**
 * closed: nothing drawn · opening: drawn at height 0, for one layout ·
 * growing: on its way to full height · open · closing: on its way to 0
 */
type Phase = "closed" | "opening" | "growing" | "open" | "closing";

/**
 * A tree row's children, unfolding and folding (#260 R1): the list grows
 * from height 0 and fades in, and folds back the same way; a toggle before
 * the motion ends turns it back from where it is. Folding, the rows stay
 * until the motion ends — out of the focus' and screen readers' reach — and
 * are then let go. Open from the start, it is just open. `render` builds the
 * rows only while they are drawn.
 *
 * It clips its rows only while it moves: open, a row gliding out of its
 * place in a drag (#260 R2) must not be cut at the group's edge.
 */
export const FoldGroup = ({ open, render }: { open: boolean; render: () => ReactNode }) => {
  const [phase, setPhase] = useState<Phase>(open ? "open" : "closed");
  const box = useRef<HTMLDivElement>(null);

  // the prop moved: the motion starts, or turns back, from where it is
  if (open && (phase === "closed" || phase === "closing")) {
    setPhase(phase === "closed" ? "opening" : "growing");
  } else if (!open && phase !== "closed" && phase !== "closing") {
    setPhase("closing");
  }

  useLayoutEffect(() => {
    if (phase !== "opening") return;
    // laid out at height 0 first, so going to full height is a transition
    void box.current?.offsetHeight;
    setPhase("growing");
  }, [phase]);

  /** the motion is over: open, or gone */
  const settle = () =>
    setPhase((now) => (now === "growing" ? "open" : now === "closing" ? "closed" : now));

  // a transition that never runs (reduced motion, a browser that cannot
  // animate the rows' height) ends no later than this
  // biome-ignore lint/correctness/useExhaustiveDependencies: settle only reads the phase it is handed
  useEffect(() => {
    if (phase !== "growing" && phase !== "closing") return;
    const timer = setTimeout(settle, FOLD_MS + 50);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === "closed") return null;
  const shut = phase === "opening" || phase === "closing";
  const leaving = phase === "closing";
  return (
    <div
      ref={box}
      data-fold=""
      inert={leaving}
      aria-hidden={leaving ? "true" : undefined}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget) settle();
      }}
      // overflow-y-clip, not hidden: it makes no scroll box, so a row's
      // sticky tail still sticks to the list's edge (Sidebar-Deep)
      className={`grid ${phase === "open" ? "" : "overflow-y-clip"} ${FOLD_MOTION} ${
        shut ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
      }`}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: the WAI-ARIA tree's child list is a group */}
      <ul role="group" className="m-0 flex min-h-0 list-none flex-col p-0 [&>li]:mt-px">
        {render()}
      </ul>
    </div>
  );
};
