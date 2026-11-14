import { create } from "zustand";

import { toastError, useToastStore } from "../../shared/lib/toastStore";
import type { DiagramDoc } from "../../shared/lib/types";
import { blankDoc } from "../library/libraryApi";
import { newDiagramTab } from "../library/tabActions";
import { buildFragment } from "../mermaid/import/buildFragment";
import { parseMermaid } from "../mermaid/import/parseMermaid";
import { drewMessage } from "../mermaid/import/pasteMermaid";
import { type ImportKind, MermaidImportError } from "../mermaid/import/plan";
import { mermaidSource } from "../mermaid/mermaidSource";
import { docFromFragment, STARTER_TITLE, starterDoc } from "./starters";

/** what a START tile (or the New menu) makes — a blank diagram or a template */
export type StartKind = "blank" | ImportKind;

interface StartingState {
  /** the kinds being made right now — their tiles are busy */
  starting: readonly StartKind[];
}

/** which START kinds are on their way (D6) — a tile shows `aria-busy` while its kind is here */
export const useStartingStore = create<StartingState>(() => ({ starting: [] }));

const setStarting = (kind: StartKind, on: boolean) =>
  useStartingStore.setState(({ starting }) => ({
    starting: on ? [...starting, kind] : starting.filter((k) => k !== kind),
  }));

/**
 * A new library diagram holding `doc`, opened in a new tab — the same way
 * the tab strip's + and ⌘T go (#218 D11), in `folder` or where `targetFolder`
 * says (#220 D8). `announce` is told once it is open. A failure is a toast and
 * the screen stays; resolves whether it opened. `doc` may be the way to build
 * it — built here, so a template that cannot be built is a toast like a
 * failed save (#220).
 */
export const openNewDiagram = async (
  doc: DiagramDoc | (() => DiagramDoc),
  folder?: string,
  announce?: string,
): Promise<boolean> => {
  try {
    await newDiagramTab(folder, typeof doc === "function" ? doc() : doc);
  } catch (error) {
    toastError(error);
    return false;
  }
  if (announce) useToastStore.getState().pushToast(announce);
  return true;
};

/**
 * START (D6): a blank diagram or a template, into `folder` or the target.
 * Pressed again while that kind is still being made, it makes nothing more.
 */
export const startDiagram = async (kind: StartKind, folder?: string): Promise<void> => {
  if (useStartingStore.getState().starting.includes(kind)) return;
  setStarting(kind, true);
  try {
    await openNewDiagram(kind === "blank" ? blankDoc : () => starterDoc(kind), folder);
  } finally {
    setStarting(kind, false);
  }
};

/**
 * From Mermaid… (D15): pasted text as a document — judged (#200 D2), parsed
 * by mermaid.js (loaded on first use), built like a paste, and titled by its
 * kind. Nothing is saved: the dialog decides. What cannot be drawn throws a
 * `MermaidImportError` whose message the dialog shows as it is; `message` is
 * what the toast says once the diagram is open.
 */
export const diagramFromMermaid = async (
  text: string,
): Promise<{ doc: DiagramDoc; message: string }> => {
  const source = mermaidSource(text);
  if (!source) {
    throw new MermaidImportError(
      "This doesn't look like Mermaid — it should start with flowchart, sequenceDiagram, classDiagram or erDiagram",
    );
  }
  const plan = await parseMermaid(source.code);
  const fragment = buildFragment(plan);
  const shapes = fragment.nodes.filter((n) => n.data.shape !== "anchor").length;
  if (shapes === 0) throw new MermaidImportError("The Mermaid diagram has no shapes to draw");
  return {
    doc: docFromFragment(fragment, STARTER_TITLE[plan.kind]),
    message: drewMessage(shapes, plan.omitted, source.blocks),
  };
};
