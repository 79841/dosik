import { Ellipsis } from "lucide-react";
import { type ReactNode, type RefObject, useId, useRef, useState } from "react";

import { FOCUS_RING } from "../../shared/lib/palette";
import { belowRightOf, Menu, type MenuItem } from "../../shared/ui/Menu";
import type { ItemKey } from "../library/libraryApi";
import { screenStamp, stillOnScreen } from "../library/screenStamp";
import { isMenuKey } from "./board/boardParts";
import { useHomeSelection } from "./homeSelection";

type Point = { x: number; y: number };

/** what marks a card's main button (`data-card-key`) — the grid finds its cards by it (#231 D7) */
export const CARD_KEY_ATTR = "data-card-key";

/**
 * After a move took a card out of its view (#229): the focus,
 * and the selection with it (#231 D7), go to the card beside it — the next,
 * else the one before, else the dashed New card — never to the page. Only
 * while the screen is the one the move was asked from and the focus is
 * still on that card or nowhere (#218 D15).
 */
export const followMoveAway = (
  main: HTMLElement | null,
  folder: string,
  move: () => Promise<boolean>,
): void => {
  const asked = screenStamp();
  const item = main?.closest("li") ?? null;
  const next = item?.nextElementSibling;
  const before = item?.previousElementSibling;
  const card = (li: Element | null | undefined) =>
    li?.querySelector<HTMLElement>(`[${CARD_KEY_ATTR}]`) ?? null;
  const beside = card(next) ?? card(before) ?? next?.querySelector<HTMLElement>("button") ?? null;
  void move().then((moved) => {
    if (!moved || !beside?.isConnected || !stillOnScreen(asked, { where: [item] })) return;
    const key = beside.getAttribute(CARD_KEY_ATTR) as ItemKey | null;
    if (key) useHomeSelection.getState().select(folder, key);
    beside.focus();
  });
};

/**
 * A card of a folder view (#231 D7, D8) — a folder's or a diagram's, the
 * same frame: radius 8, 10 in, raised; pointing at it or focus inside it
 * lifts it and shows Open and More at top 16 / right 16 — none of that
 * while its name is being edited, when it rests and a double click does not
 * open it (`Home-States` 3). One press anywhere
 * on it selects it (the 1.5px ink ring) and puts the focus on its main
 * button, the grid's roving stop; a double click, Enter or Open opens it;
 * Space selects; Shift+F10 or the menu key opens More. Open and More are
 * the pointer's (the tree row's `…` rule) — the keyboard has Enter and
 * Shift+F10. The grid's arrows and Escape are the folder view's.
 */
export const CardFrame = ({
  card,
  folder,
  name,
  label,
  selected,
  stop,
  main,
  well,
  meta,
  editor,
  menuItems,
  onOpen,
}: {
  /** the item's key — what the selection holds */
  card: ItemKey;
  /** the folder whose view the card is in */
  folder: string;
  name: string;
  /** the main button's accessible name */
  label: string;
  selected: boolean;
  /** the grid's one Tab stop */
  stop: boolean;
  main: RefObject<HTMLButtonElement | null>;
  /** the picture well: 168 high, radius 6 */
  well: ReactNode;
  meta: string;
  /** a name being edited, in place of the name — the card is no button meanwhile */
  editor?: ReactNode;
  menuItems: MenuItem[];
  onOpen: () => void;
}) => {
  const nameId = useId();
  const [menuAt, setMenuAt] = useState<Point | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const select = () => useHomeSelection.getState().select(folder, card);

  const body = (
    <>
      {well}
      {editor ?? (
        <span
          id={nameId}
          className="mt-2.5 truncate px-1 text-[12px] font-semibold leading-4 text-ink"
        >
          {name}
        </span>
      )}
      <span className="mt-0.5 px-1 text-[11px] leading-[14px] text-muted">{meta}</span>
    </>
  );

  return (
    <li className="flex min-w-0">
      <article
        aria-labelledby={editor ? undefined : nameId}
        aria-label={editor ? name : undefined}
        // a press anywhere on the card is the card's: it is selected and its
        // main button takes the focus — the primary button only, a ctrl+click
        // is macOS's right-click (#230 D9)
        onPointerDown={(e) => {
          if (e.button !== 0 || e.ctrlKey) return;
          if ((e.target as Element).closest("input")) return;
          select();
          main.current?.focus({ preventScroll: true });
        }}
        // …and the press's own focus does not take it away again: off the
        // card's buttons there is nothing to focus but the page
        onMouseDown={(e) => {
          if (!(e.target as Element).closest("button, input")) e.preventDefault();
        }}
        onDoubleClick={(e) => {
          if (editor || (e.target as Element).closest("[data-card-controls]")) return;
          onOpen();
        }}
        // resting while the name is edited, though the focus is inside it (Home-States 3)
        className={`group/card relative flex min-w-0 flex-1 flex-col rounded-lg bg-surface p-2.5 shadow-raised motion-safe:transition-shadow ${
          editor ? "" : "focus-within:shadow-lifted hover:shadow-lifted"
        } ${selected ? "ring-[1.5px] ring-ink" : ""}`}
      >
        {editor ? (
          <div className="flex flex-col">{body}</div>
        ) : (
          <button
            ref={main}
            type="button"
            data-card-key={card}
            tabIndex={stop ? 0 : -1}
            aria-label={label}
            aria-current={selected ? "true" : undefined}
            aria-keyshortcuts="Enter Shift+F10"
            onKeyDown={(e) => {
              if (e.altKey || e.metaKey || e.ctrlKey) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onOpen();
              } else if (e.key === " ") {
                e.preventDefault();
                select();
              } else if (isMenuKey(e)) {
                e.preventDefault();
                setMenuAt(belowRightOf(more.current ?? e.currentTarget));
              }
            }}
            className={`flex flex-col rounded-md text-left ${FOCUS_RING}`}
          >
            {body}
          </button>
        )}
        {/* none while the name is edited (Home-States 3), though the focus is inside the card */}
        {editor ? null : (
          <div
            data-card-controls=""
            className={`absolute right-4 top-4 flex items-center gap-1.5 group-focus-within/card:opacity-100 group-hover/card:opacity-100 motion-safe:transition-opacity ${
              menuAt ? "opacity-100" : "opacity-0"
            }`}
          >
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Open ${name}`}
              // a double click's second click lands on the view it opened —
              // the same pill of the card in the same place; one open only
              onClick={(e) => {
                if (e.detail <= 1) onOpen();
              }}
              className={`flex h-6 items-center rounded-full bg-ink px-2.5 text-[11.5px] font-semibold text-surface ${FOCUS_RING}`}
            >
              Open
            </button>
            <button
              ref={more}
              type="button"
              tabIndex={-1}
              aria-label={`More for ${name}`}
              aria-haspopup="menu"
              aria-expanded={menuAt !== null}
              onClick={(e) => setMenuAt(menuAt ? null : belowRightOf(e.currentTarget))}
              className={`flex h-6 w-6 items-center justify-center rounded-full shadow-raised ${FOCUS_RING} ${
                menuAt ? "bg-selected text-ink" : "bg-surface text-icon"
              }`}
            >
              <Ellipsis size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
      </article>
      {/* beside the card, not in it: a press or a double click in the menu is not the card's */}
      {menuAt ? (
        <Menu
          at={menuAt}
          label={`More for ${name}`}
          items={menuItems}
          opener={more}
          onSelect={(item) => {
            setMenuAt(null);
            if (!item.takesFocus) main.current?.focus();
            item.onSelect();
          }}
          onClose={(returnFocus) => {
            setMenuAt(null);
            if (returnFocus) main.current?.focus();
          }}
        />
      ) : null}
    </li>
  );
};
