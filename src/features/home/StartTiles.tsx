import { type MouseEvent, type Ref, useRef, useState } from "react";

import { clickOpens } from "../../shared/lib/doubleClickGuard";
import { FOCUS_CARD, FOCUS_RING } from "../../shared/lib/palette";
import { START_GRID } from "./homeGrid";
import { LINE_EASE, TILE_HOVER, TILE_LINE } from "./homeStyles";
import { MermaidDialog } from "./MermaidDialog";
import { startDiagram, useStartingStore } from "./newDiagram";
import { StartArt } from "./StartArt";
import { START_OPTIONS, type StartOption } from "./startOptions";

const TILE = "flex h-[112px] w-full flex-col rounded-lg text-left aria-busy:cursor-progress";
/**
 * a light tile's hairline, a step darker under the pointer, and the ring
 * round it (card C, #265); the ink tile has no line and keeps the outline ring
 */
const LINED = `${TILE_LINE} ${TILE_HOVER} ${FOCUS_CARD} ${LINE_EASE}`;

/** a tile with a chip and a second line — Blank (the inverted hero) and From Mermaid… */
const ChipTile = ({
  ref,
  option,
  hero,
  busy,
  onClick,
}: {
  ref?: Ref<HTMLButtonElement>;
  option: StartOption;
  hero: boolean;
  busy: boolean;
  onClick: (e: MouseEvent) => void;
}) => {
  const Icon = option.icon;
  return (
    <button
      ref={ref}
      type="button"
      aria-label={`${option.label}, ${option.sub}`}
      aria-busy={busy || undefined}
      onClick={onClick}
      className={`${TILE} items-start p-2.5 ${hero ? `bg-ink-surface text-surface ${FOCUS_RING}` : `bg-surface text-ink ${LINED}`}`}
    >
      <span
        aria-hidden="true"
        className={`flex h-6 w-6 items-center justify-center rounded-md ${hero ? "bg-on-ink-line" : "bg-hover"}`}
      >
        <Icon
          size={15}
          strokeWidth={hero ? 2 : 1.75}
          className={hero ? "text-surface" : "text-icon"}
        />
      </span>
      <span className="mt-auto text-[12px] font-semibold leading-[15px]">{option.label}</span>
      <span
        className={`mt-0.5 text-[11px] leading-[14px] ${hero ? "text-on-ink-soft" : "text-muted"}`}
      >
        {option.sub}
      </span>
    </button>
  );
};

/**
 * START (#220 D6): six tiles, two columns each — three to a row when the
 * content is narrower than 752px. A tile makes its kind in the project new
 * diagrams go to and opens it; From Mermaid… asks for the text first. A tile
 * whose diagram is being made is busy, and pressing it again makes nothing.
 */
export const StartTiles = () => {
  const starting = useStartingStore((s) => s.starting);
  const [mermaid, setMermaid] = useState(false);
  // the dialog gives the focus back here: after a mouse click WebKit leaves it
  // on <body>, so what had it when the dialog opened is no answer (#220)
  const mermaidTile = useRef<HTMLButtonElement>(null);
  return (
    <>
      <ul aria-label="New diagram" className={`m-0 list-none p-0 ${START_GRID}`}>
        {START_OPTIONS.map((option) => {
          const { choice } = option;
          const busy = choice !== "mermaid" && starting.includes(choice);
          return (
            <li key={choice} className="min-w-0">
              {choice === "blank" || choice === "mermaid" ? (
                <ChipTile
                  ref={choice === "mermaid" ? mermaidTile : undefined}
                  option={option}
                  hero={choice === "blank"}
                  busy={busy}
                  // one per double click — the rest would land on what it opened
                  onClick={(e) => {
                    if (!clickOpens(e)) return;
                    if (choice === "mermaid") setMermaid(true);
                    else void startDiagram("blank");
                  }}
                />
              ) : (
                <button
                  type="button"
                  aria-busy={busy || undefined}
                  onClick={(e) => {
                    if (clickOpens(e)) void startDiagram(choice);
                  }}
                  className={`${TILE} ${LINED} bg-surface px-1.5 pb-2 pt-1.5 text-ink`}
                >
                  <span
                    aria-hidden="true"
                    className="block h-[76px] w-full overflow-hidden rounded-md"
                  >
                    <StartArt kind={choice} />
                  </span>
                  <span className="mt-auto truncate pl-1 text-[12px] font-semibold leading-[15px]">
                    {option.label}
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {mermaid ? (
        <MermaidDialog returnTo={mermaidTile.current} onClose={() => setMermaid(false)} />
      ) : null}
    </>
  );
};
