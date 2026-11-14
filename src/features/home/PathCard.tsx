import { Copy, SquareArrowOutUpRight } from "lucide-react";
import {
  Fragment,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { FOCUS_ITEM } from "../../shared/lib/palette";
import { useOutsideDismiss } from "../../shared/lib/useOutsideDismiss";
import { FolderGlyph } from "../../shared/ui/KindGlyph";
import { showInLabel } from "../library/fileManager";
import { copyItemPath, showItemInFinder } from "../library/libraryActions";
import { type ItemPath, libraryPath } from "../library/libraryApi";

/** how long the pointer rests on the current step before the card shows — the app's tooltip delay */
export const OPEN_DELAY_MS = 300;
/** how long the card waits for the pointer to come into it, or back */
export const CLOSE_DELAY_MS = 150;
/** between the step and the card */
const GAP = 4;
/** the card's widest, and its least room from the window's edges — it moves left before it narrows */
const MAX_WIDTH = 600;
const EDGE = 8;

interface OpenCard {
  id: string;
  name: string;
  path: ItemPath;
  at: { x: number; y: number };
}

/**
 * The path card's life (#238 R3, D5): resting on the current step reads the
 * folder's path at once and shows the card 300ms later; leaving before then
 * shows nothing. Once it shows, it stays while the pointer is on the step or
 * the card, and closes 150ms after it leaves both. A path that comes after
 * the pointer left, or for a folder the header no longer shows, is dropped —
 * a late answer never takes the screen (#218 D15) — and one that fails shows
 * nothing: a hover says no errors.
 */
export const usePathCard = (folder: { id: string; name: string } | null) => {
  const [card, setCard] = useState<OpenCard | null>(null);
  const shown = useRef(false);
  /** what the last rest asked for — anything older is void */
  const asked = useRef(0);
  /** the step the pointer is on — pressing it is not "elsewhere" */
  const step = useRef<HTMLElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const close = useCallback(() => {
    asked.current += 1;
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    shown.current = false;
    setCard(null);
  }, []);

  const id = folder?.id ?? null;
  const name = folder?.name ?? null;
  // another folder, or none (a rename under way, another view), or this one renamed:
  // what was asked or shown for the last one is void
  // biome-ignore lint/correctness/useExhaustiveDependencies: `id` and `name` are the triggers
  useEffect(() => close, [id, name, close]);

  const stay = () => clearTimeout(closeTimer.current);
  const leave = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(close, CLOSE_DELAY_MS);
  };

  /** the pointer on the current step (`PathCrumbs`), or off it */
  const onStep = (on: HTMLElement | null) => {
    if (!on) {
      // not shown yet: nothing to wait for
      if (shown.current) leave();
      else close();
      return;
    }
    step.current = on;
    stay();
    if (!folder || shown.current) return;
    const mine = ++asked.current;
    // caught where it is made: a rest that ends before the timer still reads, and may fail
    const reading = libraryPath("folder", folder.id).catch(() => null);
    clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      void reading.then((path) => {
        if (!path || asked.current !== mine) return;
        const box = on.getBoundingClientRect();
        shown.current = true;
        setCard({ ...folder, path, at: { x: box.left, y: box.bottom + GAP } });
      });
    }, OPEN_DELAY_MS);
  };

  return { card, step, onStep, stay, leave, close };
};

/**
 * The path in its parts, each separator in dash as the path wrote it ("\\" on
 * Windows) — the line breaks only after one, so a part stays whole.
 */
const PathText = ({ path }: { path: string }) => {
  // [part, separator, part, …]
  const pieces = path.split(/([\\/])/);
  return (
    <>
      {pieces.map((piece, i) =>
        i % 2 === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the pieces are the path's, in order
          <Fragment key={i}>
            {/* read too: in a path the separator is part of it, not decoration */}
            <span className="text-dash">{piece}</span>
            <wbr />
          </Fragment>
        ) : (
          // whole: an id can hold "-", where the line must not break
          // biome-ignore lint/suspicious/noArrayIndexKey: the pieces are the path's, in order
          <span key={i} className="whitespace-nowrap">
            {piece}
          </span>
        ),
      )}
    </>
  );
};

/**
 * The folder's real path under Home's header step (#238 R3, `Home-PathCard`):
 * the path as the disk names it — ids, from `~`, whole, breaking only after a
 * separator, so the folder's own id is never cut — which opens the folder in
 * the file manager ("Show in …" with the OS's name, as the menus say), and
 * Copy Path. Fixed to the screen, so the header row's clipping
 * cannot cut it; left-aligned to the step, it moves left when the window has
 * no room for it. Pressing the step keeps it; an action, a resized window or
 * the folder renamed closes it.
 */
export const PathCard = ({
  card,
  cardRef,
  step,
  onEnter,
  onLeave,
  onClose,
}: {
  card: OpenCard;
  cardRef: RefObject<HTMLDivElement | null>;
  /** the step it hangs from: pressing it is not "elsewhere" */
  step: RefObject<HTMLElement | null>;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
}) => {
  useOutsideDismiss(cardRef, true, onClose, { ignore: step });
  // a window resized: the place it was given is stale
  useEffect(() => {
    window.addEventListener("resize", onClose);
    return () => window.removeEventListener("resize", onClose);
  }, [onClose]);
  const { at, id, name, path } = card;
  const pathId = useId();
  const maxWidth = Math.min(MAX_WIDTH, window.innerWidth - 2 * EDGE);
  // left-aligned to the step, unless the window's edge would cut it: then it moves left
  const [left, setLeft] = useState(at.x);
  useLayoutEffect(() => {
    const width = cardRef.current?.getBoundingClientRect().width ?? 0;
    setLeft(Math.max(EDGE, Math.min(at.x, window.innerWidth - EDGE - width)));
  }, [at.x, cardRef]);
  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={`Path of ${name}`}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      style={{ left, top: at.y, maxWidth }}
      className="fixed z-50 flex flex-col rounded-[10px] bg-surface p-1 shadow-popover"
    >
      <button
        type="button"
        // the menus' words; the path is its description
        aria-label={showInLabel()}
        aria-describedby={pathId}
        onClick={() => {
          onClose();
          void showItemInFinder("folder", id);
        }}
        className={`flex min-h-[30px] items-center gap-2 rounded-md px-2 py-[5px] text-left transition-colors hover:bg-hover ${FOCUS_ITEM}`}
      >
        <FolderGlyph size={15} />
        <span
          id={pathId}
          className="min-w-0 flex-auto text-[11.5px] leading-4 text-ink underline decoration-dash underline-offset-2"
        >
          <PathText path={path.shown} />
        </span>
        <span className="flex flex-none items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-icon">
          <SquareArrowOutUpRight size={12} strokeWidth={2} aria-hidden="true" />
          {showInLabel()}
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          onClose();
          void copyItemPath("folder", id);
        }}
        className={`flex h-7 items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-[12px] font-medium text-ink transition-colors hover:bg-hover ${FOCUS_ITEM}`}
      >
        <Copy size={15} strokeWidth={1.75} aria-hidden="true" className="flex-none text-icon" />
        Copy Path
      </button>
    </div>
  );
};
