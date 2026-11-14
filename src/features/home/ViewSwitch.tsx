import { LayoutGrid, type LucideIcon, SquareDashed } from "lucide-react";
import { useRef } from "react";

import { FOCUS_RING } from "../../shared/lib/palette";
import { type HomeMode, useHomeMode } from "./homeMode";

const OPTIONS: { mode: HomeMode; label: string; icon: LucideIcon }[] = [
  { mode: "cards", label: "Cards", icon: LayoutGrid },
  { mode: "canvas", label: "Canvas", icon: SquareDashed },
];

/**
 * Home's Cards / Canvas switch (#221 D1, #231 D4) — always the last thing in
 * Home's header row, one look: a frame-tone track, the chosen segment lifted
 * on the surface. A radio group: one Tab stop, ←→ move the focus and pick.
 * It only changes how the same `homeView` is shown. The header row is drawn
 * once, whatever the view and mode, so the radio pressed keeps its focus.
 */
export const ViewSwitch = () => {
  const mode = useHomeMode((s) => s.mode);
  const setMode = useHomeMode((s) => s.setMode);
  const group = useRef<HTMLDivElement>(null);

  const pick = (next: HomeMode) => {
    if (next !== mode) setMode(next);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (
      e.key !== "ArrowLeft" &&
      e.key !== "ArrowRight" &&
      e.key !== "ArrowUp" &&
      e.key !== "ArrowDown"
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const at = OPTIONS.findIndex((o) => o.mode === mode);
    const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const next = (at + step + OPTIONS.length) % OPTIONS.length;
    pick(OPTIONS[next]!.mode);
    // the focus goes with the choice, as in any radio group
    group.current?.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus();
  };

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label="View"
      onKeyDown={onKeyDown}
      className="inline-flex flex-none gap-0.5 rounded-[7px] bg-frame p-0.5"
    >
      {OPTIONS.map(({ mode: option, label, icon: Icon }) => {
        const checked = option === mode;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a segmented control — a button that is a radio, the design's segment, not a native dot
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => pick(option)}
            className={`flex h-6 items-center gap-1.5 rounded-[5px] pl-2 pr-2.5 text-[12px] transition-colors ${
              checked
                ? "bg-surface font-semibold text-ink shadow-segment"
                : "font-medium text-icon hover:text-ink"
            } ${FOCUS_RING}`}
          >
            <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
};
