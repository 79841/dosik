import type { FolderMeta } from "../library/libraryApi";
import { allDiagrams, type FoundDiagram, newestFirst } from "../library/libraryTree";

/** What Home's cards show, decided without React (#220). */

/**
 * a diagram with the folder it is listed in and the folders above it, from
 * the project down to that folder (#229 D5)
 */
export type DiagramEntry = FoundDiagram;

/**
 * where a diagram lives, as Continue and Recent name it (#231 D10): the
 * project, then the folders down to the one it is in — the project alone for
 * a diagram at its top
 */
export const pathNames = (entry: DiagramEntry): string[] => entry.path.map((f) => f.name);

/** the dashboard's RECENT row draws four at most; one row shows as many as it holds at the card size (D10, #236 D7) */
export const RECENT_ON_DASHBOARD = 4;

/** every diagram at every depth, most recently edited first — Recent's view (D10, #229 D5) */
export const allRecent = (folders: FolderMeta[]): DiagramEntry[] =>
  allDiagrams(folders).sort((a, b) => newestFirst(a.diagram, b.diagram));

/**
 * CONTINUE and RECENT (D9·D10): Continue is the most recently edited diagram
 * that could be read — one that cannot would only fail to resume.
 * Recent is the four after it, the unreadable ones too, so no diagram shows
 * twice. A library of one readable diagram has Continue alone.
 */
export const continueAndRecent = (
  folders: FolderMeta[],
): { continued: DiagramEntry | null; recent: DiagramEntry[] } => {
  const all = allRecent(folders);
  const continued = all.find((e) => e.diagram.readable) ?? null;
  const recent = all.filter((e) => e !== continued).slice(0, RECENT_ON_DASHBOARD);
  return { continued, recent };
};
