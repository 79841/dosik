import { baseKeymap, splitBlock } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorState, Plugin, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { type CSSProperties, useLayoutEffect, useRef } from "react";

import { useCommitDrafts } from "../../shared/lib/commitDrafts";
import { docToText, textOffsetToPos, textToDoc } from "./textDoc";

/** how an editor closed: kept (Enter, a click away), dropped (Esc), or kept and moving on (Tab) */
export type EditorFinish = "commit" | "cancel" | "next" | "prev";

/** the editor views by their DOM — the tests (and the app's eval checks) reach a view through it */
const views = new WeakMap<Element, EditorView>();
export const editorViewOf = (dom: Element | null): EditorView | undefined =>
  dom ? views.get(dom) : undefined;

export interface TextEditorProps {
  /** the text it opens with */
  value: string;
  /** Shift+Enter starts a new line (a compartment's new row); off for a badge or stereotype */
  multiline: boolean;
  /** one line that never wraps — an icon's name, a frame's title */
  nowrap?: boolean;
  /** what is selected when it opens, in text offsets — the whole text by default */
  select?: [number, number];
  /** at most this many characters; the store trims to the same */
  maxLength?: number;
  ariaLabel: string;
  /** on the editable element — the drawn text's own font, size, colour and alignment */
  className?: string;
  /** on the element holding it — its place and size in the shape */
  hostClassName?: string;
  style?: CSSProperties;
  /**
   * It sits on a tile, which stays light in the dark theme: the selection is
   * drawn in the light scheme's colours, or it would be white on pale blue.
   */
  onLightTile?: boolean;
  /** stretches of each line drawn in another colour, as the drawn text has them — a member's visibility mark */
  tintLine?: (line: string) => { from: number; to: number; color: string }[];
  /** every change, as text — a compartment's card grows with its rows */
  onChange?: (text: string) => void;
  /**
   * Closed: how, the text as it stands, and whether it was touched at all —
   * an untouched editor must not write back over a change made meanwhile (an
   * agent's, the edit bar's)
   */
  onFinish: (how: EditorFinish, text: string, touched: boolean) => void;
  /** Save (⌘S): write what is typed so far and stay open (#219); `touched` as for `onFinish` */
  onSave: (text: string, touched: boolean) => void;
}

/**
 * A shape's text, edited where it is drawn (#281): one block per line
 * (`textDoc`), on ProseMirror so typing — Korean composition above all —
 * selection and undo inside the text are a proven editor's, not ours.
 *
 * Enter keeps the text, Shift+Enter breaks the line, Esc drops the typing,
 * a click away keeps it — each closes it once, whichever comes first.
 * Tab / Shift+Tab hand the text over and leave the rest to the owner: it
 * opens the next text (this editor goes) or, on a shape with one text, keeps
 * this one going. The blur its own unmount may bring is ignored — the editor
 * is torn down in a layout effect, before its element leaves the page.
 */
export const TextEditor = ({
  value,
  multiline,
  nowrap = false,
  select,
  maxLength,
  ariaLabel,
  className = "",
  hostClassName = "",
  style,
  onLightTile = false,
  tintLine,
  onChange,
  onFinish,
  onSave,
}: TextEditorProps) => {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // the latest callbacks, read when a key or a blur needs them
  const latest = useRef({ onChange, onFinish });
  latest.current = { onChange, onFinish };

  // the text it opened with — whether the editor was touched is measured against it
  const opened = useRef<ReturnType<typeof textToDoc> | null>(null);
  const touched = (view: EditorView) =>
    opened.current === null || !view.state.doc.eq(opened.current);

  useCommitDrafts(true, () => {
    const view = viewRef.current;
    if (!view) return;
    onSave(docToText(view.state.doc), touched(view));
    // what is saved is the new starting point: closing untouched after it writes nothing
    opened.current = view.state.doc;
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the editor is made once per opening; its text then lives in it
  useLayoutEffect(() => {
    const mount = host.current;
    if (!mount) return;
    let closed = false;
    const finish = (how: EditorFinish): boolean => {
      if (closed) return true;
      // Tab moves on, and the owner may keep this editor going
      if (how === "commit" || how === "cancel") closed = true;
      latest.current.onFinish(how, docToText(view.state.doc), touched(view));
      // kept going after Tab wrote it, what it holds is the new starting point
      if (!closed) opened.current = view.state.doc;
      return true;
    };
    const plugins = [
      history(),
      keymap({
        Enter: () => finish("commit"),
        "Shift-Enter": (state, dispatch) => (multiline ? splitBlock(state, dispatch) : true),
        Escape: () => finish("cancel"),
        Tab: () => finish("next"),
        "Shift-Tab": () => finish("prev"),
        "Mod-z": undo,
        "Shift-Mod-z": redo,
        "Mod-y": redo,
      }),
      keymap(baseKeymap),
    ];
    if (tintLine) {
      plugins.push(
        new Plugin({
          props: {
            decorations: (state) => {
              const marks: Decoration[] = [];
              state.doc.forEach((line, offset) => {
                for (const { from, to, color } of tintLine(line.textContent)) {
                  const start = offset + 1;
                  marks.push(
                    Decoration.inline(start + from, start + to, { style: `color: ${color}` }),
                  );
                }
              });
              return DecorationSet.create(state.doc, marks);
            },
          },
        }),
      );
    }
    if (maxLength !== undefined) {
      plugins.push(
        new Plugin({
          filterTransaction: (tr) => !tr.docChanged || [...docToText(tr.doc)].length <= maxLength,
        }),
      );
    }
    const doc = textToDoc(value);
    opened.current = doc;
    const [from, to] = select ?? [0, value.length];
    const state = EditorState.create({
      doc,
      plugins,
      selection: TextSelection.create(doc, textOffsetToPos(doc, from), textOffsetToPos(doc, to)),
    });
    const view: EditorView = new EditorView(mount, {
      state,
      attributes: {
        role: "textbox",
        "aria-label": ariaLabel,
        "aria-multiline": multiline ? "true" : "false",
        // WKWebView capitalises, corrects and underlines words in an editable
        // element otherwise — wrong for every name and identifier (#174)
        spellcheck: "false",
        autocapitalize: "off",
        autocorrect: "off",
        class: `select-text outline-none ${nowrap || !multiline ? "whitespace-pre" : "whitespace-pre-wrap break-words"} ${className}`,
      },
      dispatchTransaction: (tr) => {
        view.updateState(view.state.apply(tr));
        if (tr.docChanged) latest.current.onChange?.(docToText(view.state.doc));
      },
      // a one-line text takes pasted lines as one line
      transformPastedText: (text) => (multiline ? text : text.replace(/\s*\r?\n\s*/g, " ")),
      handleDOMEvents: {
        blur: () => {
          finish("commit");
          return false;
        },
      },
    });
    viewRef.current = view;
    views.set(view.dom, view);
    view.focus();
    return () => {
      closed = true;
      views.delete(view.dom);
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  return (
    <div
      ref={host}
      // a drag must not move the shape, a double-click must not reopen it
      // as another text, a right-click opens the system's text menu (D3)
      className={`nodrag nowheel pointer-events-auto ${hostClassName}`}
      style={onLightTile ? { colorScheme: "light", ...style } : style}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
};
