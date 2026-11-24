import { act } from "@testing-library/react";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import { editorViewOf } from "../TextEditor";
import { textToDoc } from "../textDoc";

/**
 * Replaces an open editor's whole text, as typing it would — jsdom cannot
 * type into a contenteditable, so the tests go through the editor's own view.
 */
export const typeText = (target: EditorView | Element, text: string): void => {
  const view = target instanceof Element ? editorViewOf(target) : target;
  if (!view) throw new Error("no editor here");
  act(() => {
    const { state } = view;
    const doc = textToDoc(text);
    const tr = state.tr.replaceWith(0, state.doc.content.size, doc.content);
    view.dispatch(tr.setSelection(TextSelection.atEnd(tr.doc)));
  });
};
