import { Plus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useCommitDrafts } from "../../shared/lib/commitDrafts";
import { FOCUS_RING } from "../../shared/lib/palette";
import { revealScroll, type ScrollFade, scrollFade } from "../../shared/lib/scrollReveal";
import { keyshortcuts, shortcutLabel } from "../../shared/lib/shortcutLabel";
import { useDiagramStore } from "../../shared/lib/store";
import { isMacPlatform } from "../../shared/lib/windowChrome";
import { AppGlyph } from "../../shared/ui/AppGlyph";
import { ICON_STROKE, IconButton, SMALL_ICON_SIZE } from "../../shared/ui/IconButton";
import { PLAIN_TEXT } from "../../shared/ui/plainText";
import { useAppStore } from "../library/appStore";
import { useLibraryStore } from "../library/libraryStore";
import { findDiagram } from "../library/libraryTree";
import { closeDocumentTab, goToTab, newDiagram, returnHome } from "../library/navigation";
import {
  type DocTab,
  NEW_TAB_ROOM,
  STICKY_WIDTH,
  separatorAfter,
  TAB_FILLET,
  sourceOf,
  stripLayout,
  tabTitle,
} from "../library/tabModel";

/** the sheet below — the active tab's `aria-controls` */
export const DOC_PANEL_ID = "doc-panel";
export const HOME_TAB_ID = "doc-tab-home";
/** a document tab's DOM id — the sheet is labelled by the active one */
export const documentTabId = (tab: string): string => `doc-tab-${tab}`;

/**
 * A scrolled strip's hidden ends fade out over 24px (D13). The Library tab
 * stays sharp: the left fade starts where the pinned tab and its gap end
 * (46 = the 8px fillet room + 38 = `STICKY_WIDTH`, #231 D22); on the right
 * the fillet room past the old edge is hidden whole. Literal classes —
 * Tailwind only sees what is written out.
 */
const FADE_CLASS = {
  none: "",
  left: "[mask-image:linear-gradient(to_right,black_46px,transparent_46px,black_70px)]",
  right: "[mask-image:linear-gradient(to_left,transparent_8px,black_32px)]",
  both: "[mask-image:linear-gradient(to_right,black_46px,transparent_46px,black_70px,black_calc(100%_-_32px),transparent_calc(100%_-_8px))]",
} as const satisfies Record<ScrollFade, string>;

/**
 * The active tab joins the sheet below it: its own surface, and an 8px
 * concave corner on each side where it meets the sheet (the design's
 * radial-gradient fillets). They hang past the tab — the strip's clip leaves
 * room for them (#231 D22) — and sit over a neighbour's hover, but take no
 * clicks: the corner they cover is the neighbour's to press.
 */
const Fillets = () => (
  <>
    <span
      data-tab-fillet
      aria-hidden="true"
      className="pointer-events-none absolute -left-2 bottom-0 z-[1] h-2 w-2 bg-[radial-gradient(circle_at_0_0,transparent_7.5px,var(--surface)_8px)]"
    />
    <span
      data-tab-fillet
      aria-hidden="true"
      className="pointer-events-none absolute -right-2 bottom-0 z-[1] h-2 w-2 bg-[radial-gradient(circle_at_100%_0,transparent_7.5px,var(--surface)_8px)]"
    />
  </>
);

const TAB_BASE = "relative flex h-8 flex-none items-center rounded-t-lg transition-colors";

/**
 * The active document's title, edited in place over its tab (#219 D3).
 * Enter and blur commit; Escape keeps the old title; a blank one is no
 * title, so the old one stays. `onDone(true)` when the keyboard ended it —
 * focus then goes back to the tab.
 */
const TitleInput = ({
  title,
  left,
  width,
  onDone,
}: {
  title: string;
  left: number;
  width: number;
  onDone: (byKey: boolean) => void;
}) => {
  const [value, setValue] = useState(title);
  // Enter and blur both end the edit; the blur after Escape must not commit
  const settled = useRef(false);
  const finish = (commit: boolean, byKey: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const next = value.trim();
    // the title field the toolbar had: no undo step (setTitle makes none)
    if (commit && next !== "" && next !== title) useDiagramStore.getState().setTitle(next);
    onDone(byKey);
  };
  // Save (⌘S) takes the title typed so far; the field stays open (#219)
  useCommitDrafts(true, () => {
    const next = value.trim();
    if (next !== "" && next !== useDiagramStore.getState().title) {
      useDiagramStore.getState().setTitle(next);
    }
  });
  return (
    <input
      {...PLAIN_TEXT}
      aria-label="Diagram title"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(true, false)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(false, true);
        }
      }}
      style={{ left, width }}
      // select-text: the band is select-none, which in WebKit takes the
      // field's drag-select and caret with it (#219)
      className="absolute top-1 z-20 h-6 select-text rounded-(--radius-control) bg-hover px-1.5 text-[12px] font-semibold text-ink outline-none"
    />
  );
};

/**
 * The tabs in the chrome band (#218 R1): the Library tab pinned first — Home,
 * at its last view, under the app glyph (#231 D16) — a tab for every open
 * document, New diagram (+) after them.
 *
 * Document tabs share the room evenly from 176 down to 112 (D13); past that
 * the strip scrolls sideways — Library pinned over its left edge, + outside it,
 * the hidden ends faded, the wheel turned sideways, the active tab always in
 * view. The geometry is `tabModel.stripLayout`'s; a ResizeObserver gives it
 * the room.
 *
 * Activation is manual (WAI-ARIA tabs, D22): ←→ Home End only move focus,
 * Enter or Space activates — activating changes the whole screen. Close
 * buttons sit outside the tablist, laid over their tabs in the same scrolling
 * box (the design's way), so the tablist holds tabs only.
 *
 * A double-click or F2 on a document tab renames the diagram there, in a
 * field laid over the tab the same way (#219 D3) — an inactive tab is
 * activated first. The sidebar's Rename asks for it through `appStore`.
 */
export const DocumentTabs = ({ mac = isMacPlatform() }: { mac?: boolean }) => {
  const tabs = useAppStore((s) => s.tabs);
  const activeTab = useAppStore((s) => s.activeTab);
  const liveTitle = useDiagramStore((s) => s.title);
  const liveProjectId = useDiagramStore((s) => s.projectId);
  const liveFilePath = useDiagramStore((s) => s.filePath);
  const folders = useLibraryStore((s) => s.folders);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** the room the strip has, + button aside; unknown (Infinity) until measured */
  const [available, setAvailable] = useState(Number.POSITIVE_INFINITY);
  const [scrollLeft, setScrollLeft] = useState(0);
  /** after a × the focus goes to whichever tab is active then (D10) */
  const focusActive = useRef(false);
  /** the document tab whose title is being edited — only ever the active one */
  const [editing, setEditing] = useState<string | null>(null);
  const titleEditRequest = useAppStore((s) => s.titleEditRequest);
  const focusSelected = () =>
    listRef.current?.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus();

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0) setAvailable(width - NEW_TAB_ROOM);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const layout = stripLayout(available, tabs.length);
  const viewWidth = Math.min(layout.contentWidth, available);
  const activeIndex = tabs.findIndex((t) => t.id === activeTab);

  // the active tab comes into view when it is activated and when the room changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: tabs.length moves the active tab's left
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || activeIndex < 0) return;
    const left = layout.lefts[activeIndex] ?? 0;
    const next = revealScroll(view.scrollLeft, viewWidth, left, layout.width, STICKY_WIDTH);
    if (next !== view.scrollLeft) {
      view.scrollLeft = next;
      setScrollLeft(next);
    }
  }, [activeTab, activeIndex, layout.width, viewWidth, tabs.length]);

  useEffect(() => {
    if (!focusActive.current) return;
    focusActive.current = false;
    focusSelected();
  });

  // the sidebar's Rename (#219 D3): taken once; it is for the tab it opened
  useEffect(() => {
    if (titleEditRequest === null) return;
    const tab = useAppStore.getState().takeTitleEdit();
    if (tab !== null && tab === activeTab) setEditing(tab);
  }, [titleEditRequest, activeTab]);

  // the title being edited is the active document's: another tab coming up
  // ends the edit (its blur has already committed into the one left)
  if (editing !== null && editing !== activeTab) setEditing(null);

  /** edits `id`'s title — activating it first, when it is not the active tab */
  const startEdit = (id: string) => {
    if (id === useAppStore.getState().activeTab) {
      setEditing(id);
      return;
    }
    void goToTab(id).then(() => {
      if (useAppStore.getState().activeTab === id) setEditing(id);
    });
  };

  const fade = scrollFade(layout.overflow, scrollLeft, viewWidth, layout.contentWidth);

  const live = { projectId: liveProjectId, filePath: liveFilePath };
  const listed = (projectId: string | null) =>
    projectId && folders ? findDiagram(folders, projectId)?.diagram.title : undefined;
  const labelOf = (tab: DocTab) =>
    tabTitle(tab, tab.id === activeTab, liveTitle, listed(tab.projectId));
  /** where the document lives: "Project / Folder / Title", or the external file's path (D14, #229) */
  const whereOf = (tab: DocTab, label: string) => {
    const { projectId, filePath } = sourceOf(tab, activeTab, live);
    if (projectId === null) return filePath ?? label;
    const found = folders ? findDiagram(folders, projectId) : null;
    return found ? [...found.path.map((f) => f.name), label].join(" / ") : label;
  };

  const close = (id: string) => {
    void closeDocumentTab(id).then((closed) => {
      if (!closed) return;
      // now, if the strip has already drawn the close; else once it does
      focusSelected();
      focusActive.current = true;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const all = [...(listRef.current?.querySelectorAll<HTMLElement>("[role=tab]") ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "F2") {
      const tab = tabs.find((t) => documentTabId(t.id) === (e.target as HTMLElement).id);
      if (!tab) return;
      e.preventDefault();
      e.stopPropagation();
      startEdit(tab.id);
      return;
    }
    let next: number;
    if (e.key === "ArrowRight") next = at + 1;
    else if (e.key === "ArrowLeft") next = at - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = all.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    all[(next + all.length) % all.length]?.focus();
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const view = viewRef.current;
    // only a strip that scrolls turns the wheel sideways
    if (!view || !layout.overflow || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    view.scrollLeft += e.deltaY;
    setScrollLeft(view.scrollLeft);
  };

  const homeActive = activeTab === null;
  return (
    <div ref={rootRef} className="flex min-w-0 flex-1 items-end">
      <div
        ref={viewRef}
        data-tab-scroll
        data-overflow={layout.overflow}
        data-fade={fade}
        // 8 past each end, where the active tab's fillets hang (#231 D22) —
        // the -8 margins give the room back, so nothing moves
        style={{ width: viewWidth + 2 * TAB_FILLET }}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        onWheel={onWheel}
        // no scrollbar: the wheel, the keys and the tree reach every tab
        className={`relative -mx-2 h-8 flex-none overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${FADE_CLASS[fade]}`}
      >
        <div className="box-content h-8 px-2" style={{ width: layout.contentWidth }}>
          <div className="relative h-8" style={{ width: layout.contentWidth }}>
            <div
              ref={listRef}
              role="tablist"
              aria-label="Open documents"
              onKeyDown={onKeyDown}
              className="flex h-8 items-end gap-0.5"
            >
              {/* pinned over a scrolled strip's left edge, the gap after it included —
                  its padding covers that gap and its margin gives it back, so the
                  first document tab starts at 38 (`STICKY_WIDTH`), not 40. It
                  reaches back over the fillet room too (-ml-2 pl-2), and covers
                  only once something is scrolled under it: unscrolled, the first
                  tab's left fillet hangs over its right edge (#231 D22) */}
              <div
                className={`sticky left-0 -ml-2 -mr-0.5 flex-none pl-2 pr-0.5 ${
                  scrollLeft > 0 ? "z-10 bg-frame" : ""
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  id={HOME_TAB_ID}
                  aria-label="Library"
                  title="Library"
                  aria-selected={homeActive}
                  aria-controls={homeActive ? DOC_PANEL_ID : undefined}
                  tabIndex={homeActive ? 0 : -1}
                  onClick={returnHome}
                  className={`${TAB_BASE} w-9 justify-center ${FOCUS_RING} ${
                    homeActive ? "bg-surface text-ink" : "text-icon hover:bg-hover"
                  }`}
                >
                  {homeActive ? <Fillets /> : null}
                  <AppGlyph size={SMALL_ICON_SIZE} strokeWidth={ICON_STROKE} />
                </button>
              </div>
              {tabs.map((tab, i) => {
                const active = tab.id === activeTab;
                const label = labelOf(tab);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={documentTabId(tab.id)}
                    aria-selected={active}
                    aria-controls={active ? DOC_PANEL_ID : undefined}
                    aria-keyshortcuts={active ? keyshortcuts("W", mac) : undefined}
                    aria-busy={tab.loading ? true : undefined}
                    tabIndex={active ? 0 : -1}
                    title={whereOf(tab, label)}
                    style={{ width: layout.width }}
                    onClick={() => void goToTab(tab.id)}
                    onDoubleClick={() => startEdit(tab.id)}
                    // a middle press would start the webview's autoscroll
                    onMouseDown={(e) => {
                      if (e.button === 1) e.preventDefault();
                    }}
                    onAuxClick={(e) => {
                      if (e.button !== 1) return;
                      e.preventDefault();
                      close(tab.id);
                    }}
                    className={`${TAB_BASE} gap-2 pl-2.5 pr-[30px] text-left text-[12px] ${FOCUS_RING} ${
                      active
                        ? "bg-surface font-semibold text-ink"
                        : "font-medium text-icon hover:bg-hover"
                    }`}
                  >
                    {active ? <Fillets /> : null}
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {separatorAfter(tabs, activeTab, i) ? (
                      <span
                        data-tab-separator
                        aria-hidden="true"
                        className="absolute -right-0.5 top-2.5 h-3 w-px bg-line-strong"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
            {tabs.map((tab, i) => {
              const active = tab.id === activeTab;
              if (editing === tab.id) {
                return (
                  <TitleInput
                    key={tab.id}
                    title={liveTitle}
                    left={(layout.lefts[i] ?? 0) + 4}
                    width={layout.width - 8}
                    onDone={(byKey) => {
                      setEditing(null);
                      if (byKey) document.getElementById(documentTabId(tab.id))?.focus();
                    }}
                  />
                );
              }
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-label={`Close ${labelOf(tab)}`}
                  // ⌘W closes from the keyboard; one tab stop stays the strip's
                  tabIndex={-1}
                  onClick={() => close(tab.id)}
                  style={{ left: layout.closeLefts[i] }}
                  className={`absolute top-[7px] flex h-[18px] w-[18px] items-center justify-center rounded-[4px] transition-colors hover:bg-hover ${FOCUS_RING} ${
                    active ? "text-icon" : "text-muted-strong"
                  }`}
                >
                  <X size={11} strokeWidth={2.2} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {/* positioned, so it stays above the strip's widened box (8 past its end,
          #231 D22), which reaches 2px under the button */}
      <div className="relative mb-1 ml-1.5 flex-none">
        <IconButton
          label="New diagram"
          size={24}
          shortcut={shortcutLabel("T", mac)}
          keyshortcuts={keyshortcuts("T", mac)}
          onClick={() => void newDiagram()}
        >
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
};
