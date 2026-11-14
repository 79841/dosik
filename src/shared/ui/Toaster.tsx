import { CircleAlert, X } from "lucide-react";
import { TOAST_BOTTOM } from "../lib/editorLayout";
import { type Toast, useToastStore } from "../lib/toastStore";
import { TEXT_MUTED, TEXT_MUTED_HOVER } from "../lib/palette";

/**
 * Bottom-centre toast stack. Newest at the bottom, so a burst of messages
 * reads top-down in the order they happened. Each toast has its own close
 * button; when several are up, a "Dismiss all" appears above them. A toast
 * under the pointer or holding focus does not expire — nothing should vanish
 * while it is being read or about to be clicked — and the two are tracked
 * separately, so focus leaving does not release a toast the pointer is on.
 *
 * The live region wraps only the messages and is always mounted: a region has
 * to exist before its content changes for screen readers to announce it
 * reliably, and a control inside it would be read out as part of the news.
 * Errors carry `role="alert"` (assertive) on top of the polite region.
 *
 * One toast (#231 D18, the canvas's `HomeCollapse-Hidden` hint, DS
 * `.dsk-toast`): a light tile, 30 tall on one line — 5 above and below a 20
 * row, 0 5 0 10 — radius 8, `shadow-raised`, the text `icon` 11.5/500 on a
 * 16 line, a 20 dismiss button with an 11 X, all centred on the row. A long
 * one wraps inside the canvas (#219) — anywhere, when it has no place to
 * break (a path) — and the toast grows 16 a line with the same 5 above and
 * below, the X centred on its height. An error is the same toast in the
 * danger pair, a `deep-rose` alert icon 15 ahead of the sentence — the tile
 * stays light in both themes, so the icon keeps one colour too — and the X
 * `tile-ink-muted`; the icon says "Error", so a caught error's "Error: " is
 * read out but not drawn. A shortcut in the sentence ("Sidebar hidden · ⌘\
 * to show") is a `kbd` 11/600 `ink` where it stands, so what is read out is
 * the sentence as it was.
 *
 * Bottom-centre is shared with the editor's bottom islands, which hold the
 * stack on the row above them (#231 D18); with the edit bar (#159), which
 * lifts it above itself when it is raised or wraps; and on Home's library
 * board with its bottom islands (#221) — the highest lift wins. Each has a
 * variable of its own: one owner clearing its lift as it goes must not take
 * another's with it (Workspace and its edit bar go in the same commit Home's board comes in, #221). In the editor the centre is the canvas's,
 * not the sheet's: the docked side panel takes the sheet's right end, and
 * while it is up the stack leaves its width free (#219 D16).
 */
/**
 * Where a notice at the bottom centre rests: 16 up on Home's sheet, lifted
 * onto the editor's row above its islands, over a raised or wrapped edit bar,
 * or over the library board's islands, whichever reaches highest. The arrow
 * tool's hint shares it.
 */
export const NOTICE_BOTTOM = `calc(${TOAST_BOTTOM}px + max(var(--dsk-toast-editor-lift, 0px), var(--dsk-toast-lift, 0px), var(--dsk-toast-board-lift, 0px)))`;

/** the toast's sentence, its shortcut (if it holds one) drawn as a `kbd` in place */
const ToastKeys = ({ text, keys }: Pick<Toast, "text" | "keys">) => {
  const at = keys ? text.indexOf(keys) : -1;
  if (!keys || at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <kbd className="font-[inherit] text-[11px] font-semibold text-ink">{keys}</kbd>
      {text.slice(at + keys.length)}
    </>
  );
};

/** …its prefix (if it starts with one) kept for screen readers alone */
const ToastText = ({ text, keys, prefix }: Pick<Toast, "text" | "keys" | "prefix">) => {
  if (!prefix || !text.startsWith(prefix)) return <ToastKeys text={text} keys={keys} />;
  return (
    <>
      <span className="sr-only">{prefix}</span>
      <ToastKeys text={text.slice(prefix.length)} keys={keys} />
    </>
  );
};

export const Toaster = () => {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismissToast);
  const dismissAll = useToastStore((s) => s.dismissAll);
  const hold = useToastStore((s) => s.holdToast);
  const release = useToastStore((s) => s.releaseToast);
  return (
    <div
      // the editor's islands and the board's share the bottom centre and lift
      // the stack above themselves through these variables. The docked
      // panel's width is left free on the right, so it centres on the canvas
      style={{
        bottom: NOTICE_BOTTOM,
        right: "var(--dsk-toast-right, 0px)",
      }}
      className="pointer-events-none absolute left-0 z-40 flex flex-col items-center gap-2"
    >
      {toasts.length > 1 ? (
        <button
          type="button"
          onClick={dismissAll}
          className={`pointer-events-auto rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${TEXT_MUTED} ${TEXT_MUTED_HOVER} hover:bg-hover`}
        >
          Dismiss all
        </button>
      ) : null}
      <div aria-live="polite" className="flex w-full flex-col items-center gap-2">
        {toasts.map((t) => {
          const error = t.kind === "error";
          return (
            <div
              key={t.id}
              role={error ? "alert" : "status"}
              onMouseEnter={() => hold(t.id, "pointer")}
              onMouseLeave={() => release(t.id, "pointer")}
              onFocus={() => hold(t.id, "focus")}
              onBlur={() => release(t.id, "focus")}
              className={`pointer-events-auto flex min-h-[30px] max-w-[min(28rem,calc(100%_-_24px))] items-center gap-1.5 rounded-lg py-[5px] pr-[5px] pl-2.5 text-[11.5px] font-medium shadow-raised ${
                error ? "bg-tile-rose text-tile-ink" : "bg-surface text-icon"
              }`}
            >
              {error ? (
                <CircleAlert
                  size={15}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className="flex-none text-deep-rose"
                />
              ) : null}
              <span className="min-w-0 whitespace-pre-wrap leading-4 [overflow-wrap:anywhere]">
                <ToastText text={t.text} keys={t.keys} prefix={t.prefix} />
              </span>
              <button
                type="button"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={() => dismiss(t.id)}
                className={`flex size-5 shrink-0 items-center justify-center rounded-sm transition-colors ${
                  error
                    ? "text-tile-ink-muted hover:bg-tile-ink/10 hover:text-tile-ink"
                    : "text-icon hover:bg-hover hover:text-ink"
                }`}
              >
                <X size={11} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
