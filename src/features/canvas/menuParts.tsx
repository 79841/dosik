import { ChevronRight } from "lucide-react";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

const ITEM =
  "flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-[12px] font-medium transition-colors focus-visible:bg-hover disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent";

/**
 * One item of a canvas right-click menu (#139, #281): its label and, on the
 * right, the shortcut that does the same.
 */
export const MenuItem = ({
  onClick,
  children,
  danger,
  disabled,
  hint,
  keys,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** the key that does the same, shown quiet on the right */
  hint?: string;
  /** that key as `aria-keyshortcuts` — the shown hint is not read out */
  keys?: string;
}) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    disabled={disabled}
    aria-keyshortcuts={keys}
    className={`${ITEM} ${danger ? "text-danger hover:bg-danger/10" : "text-muted-strong hover:bg-hover"}`}
  >
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {hint ? (
      <span aria-hidden="true" className="shrink-0 text-muted">
        {hint}
      </span>
    ) : null}
  </button>
);

const SUB_ITEMS = '[role^="menuitem"]:not(:disabled)';

/** how long a submenu waits after the pointer leaves — time to cross over to it on a slant */
const SUBMENU_CLOSE_DELAY = 300;

/**
 * An item that opens a menu beside it (#281 — the empty canvas's Add shape ›):
 * on hover or a click, and from the keyboard with → (← or Escape go back to
 * the item). It opens to the right, or to the left where the window ends, and
 * moves up where it would run past the bottom. Leaving it closes it after a
 * moment, so the pointer may cut across the item below on its way. Its keys
 * stay inside it, so the menu around it does not walk them too.
 */
export const MenuSubmenu = ({ label, children }: { label: string; children: React.ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ left: false, up: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const sub = useRef<HTMLDivElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const box = sub.current?.getBoundingClientRect();
    if (!box) return;
    setPlace({
      left: box.right > window.innerWidth - 8,
      up: Math.max(0, box.bottom - (window.innerHeight - 8)),
    });
  }, [open]);
  // a close still pending when the menu goes must not fire on an unmounted item
  useEffect(
    () => () => {
      if (closing.current) clearTimeout(closing.current);
    },
    [],
  );

  const clearClose = () => {
    if (closing.current) clearTimeout(closing.current);
    closing.current = null;
  };
  const close = () => {
    clearClose();
    setOpen(false);
    setPlace({ left: false, up: 0 });
  };
  const items = () => [...(sub.current?.querySelectorAll<HTMLElement>(SUB_ITEMS) ?? [])];
  /** opens it — from the keyboard its first item takes the focus, from the mouse nothing moves */
  const enter = (fromKeyboard: boolean) => {
    clearClose();
    setOpen(true);
    // after the menu is drawn
    if (fromKeyboard) requestAnimationFrame(() => items()[0]?.focus());
  };
  const back = () => {
    close();
    trigger.current?.focus();
  };
  const onSubKeyDown = (e: KeyboardEvent) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") all[(at + 1) % all.length]?.focus();
    else if (e.key === "ArrowUp") all[(at - 1 + all.length) % all.length]?.focus();
    else if (e.key === "ArrowLeft" || e.key === "Escape") back();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => enter(false)}
      onMouseLeave={() => {
        clearClose();
        closing.current = setTimeout(close, SUBMENU_CLOSE_DELAY);
      }}
    >
      <button
        ref={trigger}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        // a click opens it — the hover that came first may have already; a
        // click from Enter or Space carries no pointer (`detail` 0)
        onClick={(e) => enter(e.detail === 0)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight") return;
          e.preventDefault();
          e.stopPropagation();
          enter(true);
        }}
        className={`${ITEM} text-muted-strong hover:bg-hover ${open ? "bg-hover" : ""}`}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight
          size={13}
          strokeWidth={2}
          aria-hidden="true"
          className="shrink-0 text-muted"
        />
      </button>
      {open ? (
        // the padding bridges the gap to the item, so crossing it is not leaving
        <div
          className={`absolute z-10 ${place.left ? "right-full pr-1" : "left-full pl-1"}`}
          style={{ top: -place.up }}
        >
          <div
            ref={sub}
            role="menu"
            aria-label={label}
            className="w-44 rounded-lg bg-surface p-1.5 shadow-popover ring-1 ring-line"
            onKeyDown={onSubKeyDown}
          >
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
};
