import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { FOCUS_RING } from "../../shared/lib/palette";
import { readClipboardText } from "../../shared/lib/systemClipboard";
import { isMacPlatform } from "../../shared/lib/windowChrome";
import { PLAIN_TEXT } from "../../shared/ui/plainText";
import { MermaidImportError } from "../mermaid/import/plan";
import { mermaidSource } from "../mermaid/mermaidSource";
import { FRAME_BUTTON, INK_BUTTON } from "./homeStyles";
import { diagramFromMermaid, openNewDiagram } from "./newDiagram";

const FOCUSABLE = "textarea, button:not(:disabled)";

/**
 * What the user typed, kept while the dialog is taken down without being
 * closed — a bridge op from Home opening a new tab, ⌘W, a tab switch the
 * keymap let through. Opening it again brings the text back; Cancel and
 * Create are the user's own ends and drop it (#220).
 */
let draft = "";

export const resetMermaidDraftForTests = (): void => {
  draft = "";
};

/**
 * From Mermaid… (#220 D15): pasted Mermaid becomes a new diagram in `folder`
 * (or where new diagrams go). The clipboard fills the field when it holds
 * Mermaid — shown, not drawn: Create decides. Whatever cannot be drawn is
 * said here, in the dialog, and nothing is saved; the text stays to be fixed.
 * Cancel and Escape close it and drop a draw still under way; focus goes back
 * to what opened it. Unmounting (another tab, Home gone) drops the draw too.
 * Once the drawing is being saved there is no going back — Cancel and Escape
 * wait for it (#220): a file written and then not opened would be
 * a diagram nobody asked for.
 *
 * A native `<dialog>` opened with `showModal()` (#220): the top
 * layer, over the chrome band too, with everything behind it inert — a tab
 * clicked behind it would take Home down and the text with it. Its own
 * closing is never left to the browser, so the guards above hold: Escape is
 * taken at keydown, which keeps the browser's close request from starting
 * (WebView2's Chromium lets a page refuse a `cancel` only once per user
 * gesture); any `cancel` that comes anyway is refused and handled here; and
 * a close the browser forces is a close.
 */
export const MermaidDialog = ({
  folder,
  returnTo,
  onClose,
}: {
  folder?: string;
  /** what gets focus back on Cancel — what had it when the dialog opened, unless told */
  returnTo?: HTMLElement | null;
  onClose: () => void;
}) => {
  const titleId = useId();
  const hintId = useId();
  const [text, setText] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  /** drawing: Cancel drops it; saving: past the point Cancel can take back */
  const [busy, setBusy] = useState<"drawing" | "saving" | null>(null);
  const shell = useRef<HTMLDialogElement>(null);
  const box = useRef<HTMLDivElement>(null);
  /** what had focus when it opened — it gets it back */
  const opener = useRef<HTMLElement | null>(
    returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
  );
  /** the user typed before the clipboard answered (or left a draft): theirs stays */
  const typed = useRef(draft !== "");
  /** closed: a draw that lands later is dropped */
  const closed = useRef(false);
  /** the last Escape finished a Hangul syllable — its `cancel` is the input method's */
  const composingEscape = useRef(false);
  // modal before the first paint; StrictMode's second run finds it open
  useLayoutEffect(() => {
    if (shell.current && !shell.current.open) shell.current.showModal();
  }, []);
  // gone is closed too — StrictMode's second mount opens it again
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void readClipboardText().then((clip) => {
      if (live && clip && !typed.current && mermaidSource(clip)) setText(clip);
    });
    return () => {
      live = false;
    };
  }, []);

  /** done: the modal lets go first — behind it nothing, the opener included, can take focus */
  const finish = () => {
    closed.current = true;
    shell.current?.close();
    onClose();
  };

  /** closed by the user: the focus goes back to what opened it */
  const leave = () => {
    draft = "";
    finish();
    opener.current?.focus();
  };

  const close = () => {
    if (busy !== "saving") leave();
  };

  const create = async () => {
    if (busy || text.trim() === "") return;
    setBusy("drawing");
    setError(null);
    let drawn: Awaited<ReturnType<typeof diagramFromMermaid>>;
    try {
      drawn = await diagramFromMermaid(text);
    } catch (failure) {
      if (closed.current) return;
      setError(
        failure instanceof MermaidImportError
          ? failure.message
          : `Error: ${failure instanceof Error ? failure.message : String(failure)}`,
      );
      setBusy(null);
      return;
    }
    if (closed.current) return;
    setBusy("saving");
    // a failed save is a toast (openNewDiagram); the text stays here to try again
    if (await openNewDiagram(drawn.doc, folder, drawn.message)) {
      draft = "";
      finish();
      return;
    }
    if (!closed.current) setBusy(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    // Escape or Enter that finishes a Hangul syllable is the input method's,
    // not ours (as appKeymap); Tab still keeps the focus in here
    if (e.key === "Escape") composingEscape.current = e.nativeEvent.isComposing;
    if (e.nativeEvent.isComposing && (e.key === "Escape" || e.key === "Enter")) return;
    if (e.key === "Escape") {
      // prevented: no close request — the dialog closes itself, or waits for a save
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Enter" && (isMacPlatform() ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      void create();
    } else if (e.key === "Tab") {
      // the dialog is modal: Tab goes round inside it
      const stops = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length];
      if (next) {
        e.preventDefault();
        next.focus();
      }
    }
  };

  return (
    // the dialog is the whole window's dim; ::backdrop stays clear, as it
    // reads no theme variables in older WebKit
    <dialog
      ref={shell}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={hintId}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        // a close request that got past keydown: ours to decide — not while
        // saving, not for an Escape that finished a syllable
        e.preventDefault();
        if (composingEscape.current) composingEscape.current = false;
        else close();
      }}
      onClose={() => {
        // closed by the browser all the same (a cancel it would not let us refuse)
        if (!closed.current) leave();
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none items-center justify-center bg-surface/60 p-8 text-ink open:flex backdrop:bg-transparent"
    >
      <div
        ref={box}
        // nodelete: Backspace in the field must reach nothing else
        className="nodelete flex w-[480px] max-w-full flex-col rounded-xl bg-surface p-4 shadow-popover"
      >
        <h2 id={titleId} className="m-0 text-[14px] font-semibold leading-5 text-ink">
          New diagram from Mermaid
        </h2>
        <p id={hintId} className="m-0 mt-0.5 text-[11.5px] leading-4 text-muted">
          Flowchart, sequence, class and ER diagrams
        </p>
        <textarea
          aria-label="Mermaid code"
          autoFocus
          value={text}
          onChange={(e) => {
            typed.current = true;
            draft = e.target.value;
            setText(e.target.value);
          }}
          placeholder={"flowchart LR\n  A --> B"}
          className={`mt-3 h-48 w-full resize-none rounded-lg bg-frame p-3 font-mono text-[12px] leading-[18px] text-ink placeholder:text-muted ${FOCUS_RING}`}
          {...PLAIN_TEXT}
        />
        {error ? (
          <p role="alert" className="m-0 mt-2 text-[11.5px] leading-4 text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={busy === "saving"}
            className={FRAME_BUTTON}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy !== null || text.trim() === ""}
            aria-keyshortcuts={isMacPlatform() ? "Meta+Enter" : "Control+Enter"}
            className={INK_BUTTON}
          >
            {busy ? "Drawing…" : "Create"}
          </button>
        </div>
      </div>
    </dialog>
  );
};
