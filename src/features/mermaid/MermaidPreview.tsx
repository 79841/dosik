import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, Info } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { TEXT_MUTED, TEXT_MUTED_HOVER } from "../../shared/lib/palette";
import { useDiagramStore } from "../../shared/lib/store";
import { documentMayHaveChanged } from "../../shared/lib/store/document";
import { type ThemeMode, useThemeStore } from "../../shared/lib/theme";
import { type MermaidMode, useChatStore } from "../ai/chatStore";
import { runExport } from "../export/exportActions";
import { fenceMermaid, toMermaid } from "../export/markdown";
import { omittedFrom } from "../export/mermaidNotes";
import { selectionDoc } from "../export/selection";
import { highlightMermaid, type TokenKind } from "./highlightMermaid";
import { renderMermaid } from "./renderMermaid";

/**
 * The code view's colours. The keyword takes the one accent (`primary`, #158);
 * comments and brackets are the muted token; links, strings, labels and
 * annotations get hues of their own — this is code, read faster in colour.
 */
const TOKEN_CLASS: Record<TokenKind, string> = {
  keyword: "font-semibold text-primary",
  arrow: "text-sky-700 dark:text-sky-300",
  string: "text-emerald-700 dark:text-emerald-300",
  label: "text-amber-700 dark:text-amber-300",
  comment: `italic ${TEXT_MUTED}`,
  annotation: "text-pink-700 dark:text-pink-300",
  punct: TEXT_MUTED,
  plain: "",
};

/** edits land in bursts (a drag is dozens); the preview redraws once they settle */
const SETTLE_MS = 250;

type Scope = "selection" | "diagram";

interface Source {
  /** null when nothing in scope would be drawn (a free arrow is two anchors, which Mermaid leaves out) */
  code: string | null;
  scope: Scope;
}

/**
 * What the preview shows as Mermaid — the generator the `.mmd` and Markdown
 * exports use. What is picked, when something is (the same piece a selection
 * export takes); otherwise the whole diagram.
 */
const currentSource = (): Source => {
  const state = useDiagramStore.getState();
  const whole = state.toDoc();
  const picked = selectionDoc(whole, state.nodes, state.edges);
  const doc = picked ?? whole;
  return {
    code: doc.nodes.some((n) => n.data.shape !== "anchor") ? toMermaid(doc) : null,
    scope: picked ? "selection" : "diagram",
  };
};

const useSettledSource = (): Source => {
  const [source, setSource] = useState(currentSource);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useDiagramStore.subscribe((state, prev) => {
      // a selection change is a change of `nodes` too — it is caught here
      if (!documentMayHaveChanged(state, prev)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = currentSource();
        // the same source again (a drag Mermaid does not show) is no update
        setSource((now) => (now.code === next.code && now.scope === next.scope ? now : next));
      }, SETTLE_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);
  return source;
};

const MODES: { mode: MermaidMode; label: string }[] = [
  { mode: "preview", label: "Preview" },
  { mode: "code", label: "Code" },
];

type Drawing = { svg: string } | { error: string };

/**
 * The last finished drawing and what it was drawn from. Switching to the chat
 * and back remounts the preview: with the same code and theme it shows this at
 * once and does not draw again; with anything else it waits for the new one —
 * an old picture (or an error already fixed) beside new code would mislead.
 */
let last: { code: string; theme: ThemeMode; drawing: Drawing } | null = null;

export const resetPreviewForTests = (): void => {
  last = null;
};

const remembered = (code: string | null, theme: ThemeMode): Drawing | null =>
  last && last.code === code && last.theme === theme ? last.drawing : null;

/**
 * The right panel's Mermaid view (#194): what the diagram's Mermaid draws as —
 * with mermaid.js, the engine GitHub uses — over the code itself, ready to
 * copy. Follows the canvas as it is edited.
 */
export const MermaidPreview = () => {
  const { code, scope } = useSettledSource();
  const mode = useChatStore((s) => s.mermaidMode);
  const setMode = useChatStore((s) => s.setMermaidMode);
  const theme = useThemeStore((s) => s.theme);
  const hasNodes = useDiagramStore((s) => s.nodes.length > 0);
  const [drawing, setDrawing] = useState<Drawing | null>(() => remembered(code, theme));
  /** a render is under way — separate from `drawing`, which keeps the last picture meanwhile */
  const [busy, setBusy] = useState(false);
  const figureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (code === null) return;
    const known = remembered(code, theme);
    if (known) {
      setDrawing(known);
      setBusy(false);
      return;
    }
    // an edit in place keeps the picture up until the new one lands — it
    // would otherwise blink out after every change. A remount or another
    // document starts empty already (the useState above); an error, though,
    // is dropped at once: the edit may well have fixed it
    setDrawing((d) => (d && "error" in d ? null : d));
    setBusy(true);
    // only the latest request may land: a slow render of an older diagram
    // finishing late must not cover the newer one (D6)
    let current = true;
    const land = (next: Drawing) => {
      if (!current) return;
      last = { code, theme, drawing: next };
      setDrawing(next);
      setBusy(false);
    };
    renderMermaid(code, theme).then(
      (svg) => land({ svg }),
      (error: unknown) => land({ error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
  }, [code, theme]);

  // set as markup, not through React: it is a whole SVG document. mermaid's
  // `strict` mode has already sanitised the labels in it (renderMermaid)
  useLayoutEffect(() => {
    if (figureRef.current)
      figureRef.current.innerHTML = drawing && "svg" in drawing ? drawing.svg : "";
  }, [drawing]);

  // from `code` alone — not again for every mode switch or arriving picture
  const block = useMemo(() => (code === null ? "" : fenceMermaid(code)), [code]);
  const omitted = useMemo(() => (code === null ? [] : omittedFrom(code)), [code]);
  const lines = useMemo(() => (code === null ? [] : highlightMermaid(code)), [code]);

  if (code === null) {
    return (
      <div
        className={`flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-relaxed text-balance ${TEXT_MUTED}`}
      >
        <p className="max-w-[34ch]">
          {/* nodes but no code: only anchors, i.e. free arrows */}
          {hasNodes
            ? "Free arrows have no Mermaid form — draw a shape to see one."
            : "Nothing to preview yet. Draw a shape and its Mermaid shows here."}
        </p>
      </div>
    );
  }

  /** nothing to show yet, as opposed to redrawing over a picture */
  const empty = drawing === null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pt-1">
        {/* the design system's segmented control: track padding 2, radius 7; items 24, radius 5 */}
        <fieldset
          aria-label="Show"
          className="m-0 flex min-w-0 gap-0.5 rounded-[7px] border-0 bg-frame p-0.5"
        >
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              aria-pressed={mode === m.mode}
              onClick={() => setMode(m.mode)}
              className={`h-6 rounded-(--radius-control) px-[9px] text-[12px] transition-colors ${
                mode === m.mode
                  ? "bg-surface font-semibold text-ink shadow-segment"
                  : `font-medium ${TEXT_MUTED} ${TEXT_MUTED_HOVER}`
              }`}
            >
              {m.label}
            </button>
          ))}
        </fieldset>
        {/* what the preview is of: the picked shapes, or the diagram when nothing is picked */}
        <span className={`truncate text-[11px] font-medium ${TEXT_MUTED}`}>
          {scope === "selection" ? "Selection" : "Whole diagram"}
        </span>
        <button
          type="button"
          onClick={() =>
            void runExport(async () => {
              await writeText(block);
              return "Copied as Mermaid block";
            })
          }
          aria-label="Copy Mermaid"
          title="Copy as a Markdown block"
          className={`ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-(--radius-button) px-2 text-[11px] font-semibold transition-colors hover:bg-hover ${TEXT_MUTED} ${TEXT_MUTED_HOVER}`}
        >
          <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
          Copy
        </button>
      </div>
      {omitted.length > 0 ? (
        // the export's own `%% omitted` list, so the preview and the file agree
        <p className={`flex items-start gap-1.5 px-3 pt-2 text-[11px] leading-snug ${TEXT_MUTED}`}>
          <Info size={13} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
          <span>Not in Mermaid: {omitted.join(", ")}</span>
        </p>
      ) : null}
      {drawing && "error" in drawing ? (
        <div className="px-3 pt-2">
          <p className="rounded-(--radius-card) bg-danger/10 px-2.5 py-2 text-[12px] leading-relaxed text-danger">
            Mermaid couldn't draw this: {drawing.error}
          </p>
        </div>
      ) : null}
      {/* both stay mounted: the drawing keeps up while the code is showing, so
          switching back is instant */}
      <div className="relative min-h-0 flex-1" hidden={mode !== "preview"}>
        {empty ? (
          <p
            className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] ${TEXT_MUTED}`}
          >
            Drawing…
          </p>
        ) : null}
        <div
          ref={figureRef}
          role="img"
          // the scope rides in the name, so a screen reader hears it change
          aria-label={`Mermaid diagram — ${scope === "selection" ? "selection" : "whole diagram"}`}
          aria-busy={busy || empty}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a tall diagram overflows the pane — the keyboard must reach it to scroll
          tabIndex={0}
          // centred both ways (#198): m-auto in a flex box. Mermaid sizes its SVG
          // to the pane's width (an inline max-width), so a wide drawing shrinks
          // to fit; a tall one overflows downward, and m-auto then lets it
          // scroll from the top instead of cutting it off
          className="flex h-full overflow-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [&>svg]:m-auto [&>svg]:h-auto"
        />
      </div>
      {/* scrolls on its own, so it takes focus: the keyboard can scroll it too */}
      <section
        aria-label="Mermaid code"
        hidden={mode !== "code"}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <pre className="m-0 font-mono text-[11.5px] leading-relaxed text-ink">
          {/* the code itself, highlighted — the fences are Markdown's, and Copy adds them (#198) */}
          <code>
            {/* tokens only while the code shows: a hidden pane need not be
                rebuilt, span by span, after every edit */}
            {(mode === "code" ? lines : []).map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
              <Fragment key={i}>
                {i > 0 ? "\n" : null}
                {line.map((token, j) =>
                  token.kind === "plain" ? (
                    token.text
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
                    <span key={j} data-token={token.kind} className={TOKEN_CLASS[token.kind]}>
                      {token.text}
                    </span>
                  ),
                )}
              </Fragment>
            ))}
          </code>
        </pre>
      </section>
    </div>
  );
};
