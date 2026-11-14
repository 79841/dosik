import { useEffect, useRef } from "react";

/**
 * Save's request to every editor of the document that is open (#219): "write what you hold, and keep going".
 *
 * The label editors, the title field and the edit bar's text
 * fields write to the store on blur only. Save used to blur whatever had the
 * focus to get at that text — which closed the label editor, dropped the
 * focus to the page (where the next Backspace deleted the selection) and
 * blurred the chat and the settings too. A document editor saves
 * mid-sentence instead: on this request each open editor writes its current
 * text, and keeps its focus, its caret and its selection. Fields that are not
 * the document's — the chat, a search, an API key — do not listen, so Save
 * never touches them.
 *
 * Leaving a tab and closing one still blur (`tabActions.commitEditing`): the
 * editor goes with the document there, as it should.
 *
 * A window event rather than a list in this module: a hot reload must not
 * leave Save talking to an old copy of the list.
 */
export const COMMIT_DRAFTS_EVENT = "dosik:commit-drafts";

/** asks every open editor of the document to write what it holds — done when this returns */
export const commitDrafts = (): void => {
  window.dispatchEvent(new Event(COMMIT_DRAFTS_EVENT));
};

/**
 * Answers `commitDrafts` with `write` while `listening` (an editor passes
 * whether it is open). The latest `write` runs, so it reads the latest state;
 * it must write only what differs from the store, and leave the field alone.
 */
export const useCommitDrafts = (listening: boolean, write: () => void): void => {
  const latest = useRef(write);
  latest.current = write;
  useEffect(() => {
    if (!listening) return;
    const onRequest = () => latest.current();
    window.addEventListener(COMMIT_DRAFTS_EVENT, onRequest);
    return () => window.removeEventListener(COMMIT_DRAFTS_EVENT, onRequest);
  }, [listening]);
};
