import { Ellipsis } from "lucide-react";
import { type ReactNode, type RefObject, useId, useRef, useState } from "react";

import { clickOpens } from "../../shared/lib/doubleClickGuard";
import { FOCUS_CARD_BUTTON, FOCUS_CARD_WITHIN, FOCUS_RING } from "../../shared/lib/palette";
import { isMacContextClick } from "../../shared/lib/windowChrome";
import { belowRightOf, besidePointer, Menu, type MenuItem } from "../../shared/ui/Menu";
import type { ItemKey } from "../library/libraryApi";
import { screenStamp, stillOnScreen } from "../library/screenStamp";
import { isMenuKey } from "./board/boardParts";
import {
  CAPTION_LINE,
  CAPTION_META,
  CAPTION_POINTING,
  CARD_BODY_PRESS,
  CARD_HOVER,
  CARD_LINE,
} from "./homeStyles";

type Point = { x: number; y: number };

/** what marks a card's main button (`data-card-key`) — the grid finds its cards by it (#231 D7) */
export const CARD_KEY_ATTR = "data-card-key";

/**
 * After a move took a card out of its view (#229): the focus goes to the
 * card beside it — the next, else the one before, else the dashed New card
 * — never to the page. Only while the screen is the one the move was asked
 * from and the focus is still on that card or nowhere (#218 D15).
 */
export const followMoveAway = (main: HTMLElement | null, move: () => Promise<boolean>): void => {
  const asked = screenStamp();
  const item = main?.closest("li") ?? null;
  const next = item?.nextElementSibling;
  const before = item?.previousElementSibling;
  const card = (li: Element | null | undefined) =>
    li?.querySelector<HTMLElement>(`[${CARD_KEY_ATTR}]`) ?? null;
  const beside = card(next) ?? card(before) ?? next?.querySelector<HTMLElement>("button") ?? null;
  void move().then((moved) => {
    if (!moved || !beside?.isConnected || !stillOnScreen(asked, { where: [item] })) return;
    beside.focus();
  });
};

/**
 * A card of a folder view (#231 D8, card C of #265) — a folder's or a
 * diagram's, the same frame: radius 8, a hairline, the picture full bleed and
 * under it the 40px caption bar (the kind's glyph, the name, the meta).
 *
 * One click anywhere on it opens it — it is one button, picture and caption
 * — and so do Enter and Space; there is no selection (#265). A double click's
 * second click is dropped: it lands on the view the first one opened. Pointing
 * at it darkens its lines, tints the caption bar and brings Open and More down
 * at top 10 / right 10; the keyboard's focus inside it draws the ring round
 * it. None of that while its name is being edited, when it rests and does not
 * open (`Home-States` 3) — the ring stays, round the field. Only a press on
 * the card itself shrinks it — pressing Open or More leaves it be. A
 * right-click anywhere on it, Shift+F10 or the menu key opens More's menu.
 * Open and More are the pointer's (the tree row's `…` rule). The grid's
 * arrows are the folder view's.
 */
export const CardFrame = ({
  card,
  name,
  label,
  glyph,
  stop,
  main,
  well,
  meta,
  editor,
  menuItems,
  onOpen,
}: {
  /** the item's key — the grid's handle on the card */
  card: ItemKey;
  name: string;
  /** the main button's accessible name */
  label: string;
  /** the kind's glyph at the caption bar's start, 16 */
  glyph: ReactNode;
  /** the grid's one Tab stop */
  stop: boolean;
  main: RefObject<HTMLButtonElement | null>;
  /** the picture well: 15:8, full bleed */
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

  const body = (
    <>
      {well}
      <span
        data-caption-bar=""
        className={`flex h-10 items-center gap-2 px-3 ${CAPTION_LINE} ${
          editor ? "" : CAPTION_POINTING
        }`}
      >
        {glyph}
        {editor ?? (
          <span
            id={nameId}
            className="min-w-0 flex-auto truncate text-[12px] font-semibold leading-4 text-ink"
          >
            {name}
          </span>
        )}
        <span className={`flex-none whitespace-nowrap text-[11px] leading-[14px] ${CAPTION_META}`}>
          {meta}
        </span>
      </span>
    </>
  );

  return (
    <li className="flex min-w-0">
      <article
        aria-labelledby={editor ? undefined : nameId}
        aria-label={editor ? name : undefined}
        // More's menu beside the pointer (#230) — the system's own in a name field
        onContextMenu={
          editor
            ? undefined
            : (e) => {
                e.preventDefault();
                setMenuAt(besidePointer({ x: e.clientX, y: e.clientY }));
              }
        }
        // resting while the name is edited, though the focus is inside it (Home-States 3)
        className={`group/card relative flex min-w-0 flex-1 flex-col rounded-lg bg-surface ${CARD_LINE} ${FOCUS_CARD_WITHIN} ${
          editor ? "" : `${CARD_HOVER} ${CARD_BODY_PRESS}`
        }`}
      >
        {editor ? (
          <div className="flex flex-col overflow-hidden rounded-lg">{body}</div>
        ) : (
          <button
            ref={main}
            type="button"
            data-card-key={card}
            tabIndex={stop ? 0 : -1}
            aria-label={label}
            aria-keyshortcuts="Enter Shift+F10"
            // one open per double click — the rest of it would land on the
            // screen it opened (`clickOpens`). A ctrl+click is macOS's right
            // click (#230 D9), not an open
            onClick={(e) => {
              if (!isMacContextClick(e) && clickOpens(e)) onOpen();
            }}
            // Enter opens at once; with a modifier it is nothing, not the
            // button's own click. Space is the button's own click
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!(e.shiftKey || e.altKey || e.metaKey || e.ctrlKey)) onOpen();
                return;
              }
              if (e.altKey || e.metaKey || e.ctrlKey) return;
              if (isMenuKey(e)) {
                e.preventDefault();
                setMenuAt(belowRightOf(more.current ?? e.currentTarget));
              }
            }}
            // the ring is the card's, round its line — but high contrast drops
            // shadows and marks this outline instead
            className={`flex flex-col overflow-hidden rounded-lg text-left ${FOCUS_CARD_BUTTON}`}
          >
            {body}
          </button>
        )}
        {/* none while the name is edited (Home-States 3), though the focus is inside the card */}
        {editor ? null : (
          <div
            data-card-controls=""
            className={`absolute right-2.5 top-2.5 flex items-center gap-1.5 group-focus-within/card:pointer-events-auto group-focus-within/card:translate-y-0 group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:translate-y-0 group-hover/card:opacity-100 motion-safe:[transition:opacity_160ms_ease-out,translate_160ms_cubic-bezier(0.2,0.7,0.2,1)] ${
              menuAt
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none -translate-y-1 opacity-0"
            }`}
          >
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Open ${name}`}
              // one open per double click, as the card's (`clickOpens`)
              onClick={(e) => {
                if (clickOpens(e)) onOpen();
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
              className={`flex h-6 w-6 items-center justify-center rounded-full inset-ring inset-ring-line-strong ${FOCUS_RING} ${
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
