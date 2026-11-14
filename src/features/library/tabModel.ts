import type { Viewport } from "@xyflow/react";

import type { DocSnapshot } from "../../shared/lib/store/tabs";
import { TAB_PINNED_WIDTH, TAB_WIDTH } from "../../shared/lib/windowChrome";

/**
 * The document tabs as data (#218): finding, closing, cycling, the strip's
 * geometry and the session that survives a restart. Pure — `tabActions`
 * performs, the strip draws.
 */

/** one open document */
export interface DocTab {
  /** the tab's own id, for its life — React's key and the DOM id */
  id: string;
  /** a library diagram's id; the active tab's live value is the store's */
  projectId: string | null;
  /** an external file's path; the active tab's live value is the store's (Save As) */
  filePath: string | null;
  /** the title as last known — what a tab not read yet is called (D14) */
  title: string;
  /**
   * The document while the tab is not on screen (D1). `null` while it is
   * active — the store holds it then — and while it has not been read yet.
   */
  doc: DocSnapshot | null;
  /** false for a tab restored from the last session, until it is first activated (D15) */
  loaded: boolean;
  /** being read right now — the strip marks it busy (D22) */
  loading?: boolean;
  /** where its canvas was when it was left; null until it has been on screen (D5) */
  viewport: Viewport | null;
  /** an external file's bytes as last known to match the file (D8, #123) */
  baseline: string | null;
}

let tabSeq = 0;

/** a fresh tab id — unique for the app's run, safe as a DOM id */
export const newTabId = (): string => `tab-${++tabSeq}`;

/**
 * A tab for the document at `where`, not on screen yet and never left —
 * read already, or (`loaded: false`) restored from the last session (D15).
 */
export const newTab = (
  where: Pick<DocTab, "projectId" | "filePath" | "title">,
  loaded = true,
): DocTab => ({ id: newTabId(), ...where, doc: null, loaded, viewport: null, baseline: null });

/** the store's fields that say where the active tab's document lives */
type Live = { projectId: string | null; filePath: string | null };

/** what a document is: the same library id, or the same file path (D9) */
export type DocSource = { projectId: string } | { filePath: string };

/** where a tab's document lives — the live store's values for the active tab */
export const sourceOf = (tab: DocTab, activeTab: string | null, live: Live): Live =>
  tab.id === activeTab ? live : tab;

export const findTab = (
  tabs: readonly DocTab[],
  activeTab: string | null,
  live: Live,
  target: DocSource,
): DocTab | undefined =>
  tabs.find((tab) => {
    const at = sourceOf(tab, activeTab, live);
    return "projectId" in target
      ? at.projectId === target.projectId
      : at.projectId === null && at.filePath === target.filePath;
  });

/**
 * Which tab is active after `closing` closes (D10): the right neighbour, then
 * the left one, then Home (`null`). Closing another tab changes nothing.
 */
export const nextActiveAfterClose = (
  tabs: readonly DocTab[],
  activeTab: string | null,
  closing: string,
): string | null => {
  if (closing !== activeTab) return activeTab;
  const at = tabs.findIndex((t) => t.id === closing);
  return tabs[at + 1]?.id ?? tabs[at - 1]?.id ?? null;
};

/** ⌃Tab / ⌃⇧Tab (D12): the next or previous tab, Home (`null`) included, round */
export const cycleTarget = (
  tabs: readonly DocTab[],
  activeTab: string | null,
  dir: 1 | -1,
): string | null => {
  const ring: (string | null)[] = [null, ...tabs.map((t) => t.id)];
  const at = Math.max(0, ring.indexOf(activeTab));
  return ring[(at + dir + ring.length) % ring.length] ?? null;
};

/**
 * ⌘1–⌘9 (D12): ⌘1 Home (`null`), ⌘2–⌘8 the (n−1)th document tab, ⌘9 the
 * last tab. `undefined`: no such tab — the key does nothing.
 */
export const nthTarget = (tabs: readonly DocTab[], n: number): string | null | undefined => {
  if (n === 1) return null;
  if (n === 9) return tabs[tabs.length - 1]?.id ?? null;
  return tabs[n - 2]?.id;
};

/** a hairline after the `index`th document tab — only between two inactive ones (D14) */
export const separatorAfter = (
  tabs: readonly DocTab[],
  activeTab: string | null,
  index: number,
): boolean => {
  const here = tabs[index];
  const next = tabs[index + 1];
  return !!here && !!next && here.id !== activeTab && next.id !== activeTab;
};

/** the hairline between tabs (`space-0.5`) */
export const TAB_GAP = 2;
/** how far a document tab shrinks before the strip scrolls (D13) — 4px grid, ~8 characters */
export const TAB_MIN_WIDTH = 112;
/** the close button's left, back from the tab's right edge: centred 16px inside it */
export const CLOSE_INSET = 25;
/** New diagram (+) after the strip: 6px, then its 24 (SPEC.md) */
export const NEW_TAB_ROOM = 6 + 24;
/** Home and the gap after it — what stays pinned over a scrolled strip's left edge */
export const STICKY_WIDTH = TAB_PINNED_WIDTH + TAB_GAP;
/**
 * The active tab's concave corners, where it flows into the sheet below
 * (`radius-tab`, the DS `.dsk-tab.is-active::before/::after`). They hang this
 * far past the tab, so the strip's clip reaches as far past each end (#231 D22).
 * `DocumentTabs` spells the same 8 out in literal classes Tailwind can see —
 * `-mx-2`·`px-2`·`-ml-2 pl-2`, the fillets' `-left-2`/`-right-2`, the fade
 * stops 46/70 and 8/32 — change them together.
 */
export const TAB_FILLET = 8;

export interface StripLayout {
  /** every document tab's width */
  width: number;
  /** each document tab's left, from the strip's start (Home's left) */
  lefts: number[];
  /** each tab's close button's left, in the same coordinates */
  closeLefts: number[];
  /** the tabs don't fit even at the minimum: the strip scrolls */
  overflow: boolean;
  /** Home and every document tab */
  contentWidth: number;
}

/**
 * The strip in `available` px (D13): document tabs share it evenly from 176
 * down to 112, whole pixels; past that they keep 112 and the strip scrolls.
 */
export const stripLayout = (available: number, count: number): StripLayout => {
  const even = count > 0 ? Math.floor((available - TAB_PINNED_WIDTH - count * TAB_GAP) / count) : 0;
  const width = Math.max(
    TAB_MIN_WIDTH,
    Math.min(TAB_WIDTH, Number.isFinite(even) ? even : TAB_WIDTH),
  );
  const lefts = Array.from({ length: count }, (_, i) => STICKY_WIDTH + i * (width + TAB_GAP));
  const contentWidth = TAB_PINNED_WIDTH + count * (TAB_GAP + width);
  return {
    width,
    lefts,
    closeLefts: lefts.map((left) => left + width - CLOSE_INSET),
    overflow: contentWidth > available,
    contentWidth,
  };
};

/** what a tab is called (D14): the live title, the snapshot's, the listing's, the saved one */
export const tabTitle = (
  tab: DocTab,
  active: boolean,
  liveTitle: string,
  listedTitle: string | undefined,
): string => {
  if (active) return liveTitle;
  if (tab.doc) return tab.doc.title;
  return (!tab.loaded ? listedTitle : undefined) ?? tab.title;
};

/** the library tabs and the active one, as they were when the app last ran (D15) */
export interface TabSession {
  tabs: { projectId: string; title: string }[];
  /** the active tab's diagram; `null` for Home — or an external file, which is not kept */
  active: string | null;
}

export const SESSION_KEY = "dosik.tabs";
const SESSION_VERSION = 1;
/** Rust's own rule for an id (`validate_id`) — a stored value never reaches a path unchecked */
const VALID_ID = /^[A-Za-z0-9_-]{1,32}$/;

export const serializeSession = (
  tabs: readonly DocTab[],
  activeTab: string | null,
  live: { title: string },
): string => {
  const kept = tabs.filter((t) => t.projectId !== null && t.filePath === null);
  const active = kept.find((t) => t.id === activeTab);
  return JSON.stringify({
    v: SESSION_VERSION,
    tabs: kept.map((t) => ({
      projectId: t.projectId,
      title: t.id === activeTab ? live.title : (t.doc?.title ?? t.title),
    })),
    active: active?.projectId ?? null,
  });
};

/** no tabs, Home active — what a missing, broken or unreadable session is */
export const EMPTY_SESSION: TabSession = { tabs: [], active: null };

/** a stored session; anything broken, of another version or with a bad id is no session */
export const parseSession = (raw: string | null): TabSession => {
  if (raw === null) return { ...EMPTY_SESSION };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_SESSION };
    const { v, tabs, active } = value as Record<string, unknown>;
    if (v !== SESSION_VERSION || !Array.isArray(tabs)) return { ...EMPTY_SESSION };
    const kept: TabSession["tabs"] = [];
    for (const entry of tabs) {
      const { projectId, title } = (entry ?? {}) as Record<string, unknown>;
      if (typeof projectId !== "string" || !VALID_ID.test(projectId)) return { ...EMPTY_SESSION };
      if (typeof title !== "string") return { ...EMPTY_SESSION };
      if (!kept.some((t) => t.projectId === projectId)) kept.push({ projectId, title });
    }
    const activeId =
      typeof active === "string" && kept.some((t) => t.projectId === active) ? active : null;
    return { tabs: kept, active: activeId };
  } catch {
    return { ...EMPTY_SESSION };
  }
};
