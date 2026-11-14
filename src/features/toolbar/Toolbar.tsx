import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Code,
  Download,
  Network,
  Redo2,
  Save,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useRef, useState } from "react";

import type { LayoutDirection } from "../../shared/lib/autoLayout";
import { FOCUS_ITEM, TEXT_MUTED } from "../../shared/lib/palette";
import { keyshortcuts, shortcutLabel } from "../../shared/lib/shortcutLabel";
import { useDiagramStore } from "../../shared/lib/store";
import { arrangeableSelection } from "../../shared/lib/store/layout";
import { toastError, useToastStore } from "../../shared/lib/toastStore";
import { useMenuKeys } from "../../shared/lib/useMenuKeys";
import { useOutsideDismiss } from "../../shared/lib/useOutsideDismiss";
import { isMacPlatform } from "../../shared/lib/windowChrome";
import { ICON_STROKE, IconButton, TOOL_ICON_SIZE } from "../../shared/ui/IconButton";
import { type PanelView, panelToggleId, SIDE_PANEL_ID, useChatStore } from "../ai/chatStore";
import {
  copyMarkdown,
  copyPng,
  copySvg,
  exportMarkdown,
  exportPng,
  exportSvg,
} from "../export/exportActions";
import { useLibraryStore } from "../library/libraryStore";
import { findDiagram } from "../library/libraryTree";
import { viewInHome } from "../library/navigation";
import { PathCrumbs } from "../library/PathCrumbs";
import { saveActiveDocument } from "../library/saveDocument";
import {
  DIRECTION_LABEL,
  LAYOUT_ROWS,
  type LayoutAxis,
  loadReversed,
  saveReversed,
} from "./layoutDirections";

/** the way each direction's row points */
const DIRECTION_ARROW = {
  TB: ArrowDown,
  BT: ArrowUp,
  LR: ArrowRight,
  RL: ArrowLeft,
} as const satisfies Record<LayoutDirection, unknown>;

const icon = { size: TOOL_ICON_SIZE, strokeWidth: ICON_STROKE, "aria-hidden": true } as const;
const chevron = {
  size: 12,
  strokeWidth: 2,
  "aria-hidden": true,
  className: "text-muted",
} as const;

const Divider = () => <span aria-hidden="true" className="mx-1 h-4 w-px flex-none bg-selected" />;

/** a menu item: 28 tall, 12px, the design's compact menu */
const ITEM = `flex h-7 w-full items-center gap-2 rounded-(--radius-button) px-2 text-left text-[12px] font-medium text-ink transition-colors hover:bg-hover ${FOCUS_ITEM}`;
/** a menu hanging under its toolbar button, right-aligned with it */
const MENU =
  "absolute right-0 top-full z-50 mt-1.5 flex flex-col rounded-(--radius-island) bg-surface p-1 shadow-popover";

/**
 * The toolbar row at the top of the editor's sheet (#219 D2): the diagram's
 * path on its left (#229 D3), its actions on its right — [Save │] Undo · Redo
 * │ Arrange ▾ · Export ▾ │ Mermaid preview │ Ask AI. The title is edited in
 * the tab (D4); New and Open live in the tab strip, the sidebar and ⌘T / ⌘O;
 * Save is here only for an external file, which has no autosave (D5). Not a
 * window drag region — the band is (D21).
 */
export const Toolbar = ({ mac = isMacPlatform() }: { mac?: boolean }) => {
  const projectId = useDiagramStore((s) => s.projectId);
  const undo = useDiagramStore((s) => s.undo);
  const redo = useDiagramStore((s) => s.redo);
  const canUndo = useDiagramStore((s) => s.past.length > 0);
  const canRedo = useDiagramStore((s) => s.future.length > 0);
  const panelOpen = useChatStore((s) => s.open);
  const panelView = useChatStore((s) => s.view);
  const togglePanel = useChatStore((s) => s.togglePanel);

  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const pushToast = useToastStore((s) => s.pushToast);

  useOutsideDismiss(exportRef, exportOpen, () => setExportOpen(false));

  const [layoutOpen, setLayoutOpen] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const layoutMenuRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(layoutRef, layoutOpen, () => setLayoutOpen(false));

  /**
   * A menu closed from inside it — Escape or an item chosen — gives the focus
   * back to its button, not to the page, where Backspace would delete the
   * selection (#219). The button is the wrapper's first.
   */
  const closeArrange = () => {
    setLayoutOpen(false);
    layoutRef.current?.querySelector<HTMLElement>("button")?.focus();
  };
  const closeExport = () => {
    setExportOpen(false);
    exportRef.current?.querySelector<HTMLElement>("button")?.focus();
  };
  // the menus' keyboard: ↑↓ Home End, Escape, Tab (#219)
  const arrangeKeys = useMenuKeys(layoutMenuRef, layoutOpen, {
    onEscape: closeArrange,
    onTab: () => setLayoutOpen(false),
  });
  const exportKeys = useMenuKeys(exportMenuRef, exportOpen, {
    onEscape: closeExport,
    onTab: () => setExportOpen(false),
  });

  /**
   * Arranges only what the user picked — two or more shapes, or a frame and
   * what is inside it (#182). Never the whole diagram: one canvas often holds
   * several diagrams, and arranging them all at once merges them into one
   * block. With less than that picked the menu says so instead.
   */
  // counted only while the menu is open — a drag would otherwise recount every frame
  const arrangeable = useDiagramStore((s) =>
    layoutOpen ? arrangeableSelection(s.nodes).length : 0,
  );
  const [reversed, setReversed] = useState(loadReversed);
  const flip = (axis: LayoutAxis) => {
    const next = { ...reversed, [axis]: !reversed[axis] };
    setReversed(next);
    saveReversed(next);
  };
  const arrange = (direction: LayoutDirection) => {
    closeArrange();
    const store = useDiagramStore.getState();
    const result = store.autoLayout(direction, arrangeableSelection(store.nodes));
    // "too few" cannot come from here: the items are off below two shapes
    pushToast(
      result.reason === "unchanged"
        ? "Already arranged"
        : `Arranged ${result.moved} shapes${
            result.framesAdjusted
              ? ` — ${result.framesAdjusted === 1 ? "frame" : "frames"} adjusted to fit`
              : ""
          }`,
    );
  };

  // outcomes are toasts, not toolbar chrome: the toolbar is for actions, and a
  // message that appears inside it reads as a control (#81)
  const run = async (task: () => Promise<string | null>) => {
    closeExport();
    try {
      const message = await task();
      if (message) pushToast(message);
    } catch (error) {
      toastError(error);
    }
  };

  /**
   * A panel toggle (D13): pressed while its view is the one on show; an id,
   * so the panel's Close can give focus back to it; `aria-controls` while
   * the panel is up.
   */
  const toggle = (view: PanelView) => ({
    id: panelToggleId(view),
    pressed: panelOpen && panelView === view,
    controls: panelOpen ? SIDE_PANEL_ID : undefined,
    onClick: () => togglePanel(view),
  });

  return (
    // nodelete: Backspace on a crumb or a button here must not delete the
    // canvas selection (D20)
    <div className="nodelete flex h-9 flex-none items-center gap-2 bg-surface px-2">
      <DiagramPath />
      <div
        role="toolbar"
        aria-label="Diagram actions"
        className="ml-auto flex flex-none items-center gap-0.5"
      >
        {projectId === null ? (
          // an external file has no autosave: Save is how it reaches the disk (D5)
          <>
            <IconButton
              label="Save"
              size={28}
              shortcut={shortcutLabel("S", mac)}
              keyshortcuts={keyshortcuts("S", mac)}
              onClick={() => void saveActiveDocument()}
            >
              <Save {...icon} />
            </IconButton>
            <Divider />
          </>
        ) : null}
        <IconButton
          label="Undo"
          size={28}
          shortcut={shortcutLabel("Z", mac)}
          keyshortcuts={keyshortcuts("Z", mac)}
          onClick={undo}
          disabled={!canUndo}
        >
          <Undo2 {...icon} />
        </IconButton>
        <IconButton
          label="Redo"
          size={28}
          shortcut={shortcutLabel("Z", mac, { shift: true })}
          keyshortcuts={keyshortcuts("Z", mac, { shift: true })}
          onClick={redo}
          disabled={!canRedo}
        >
          <Redo2 {...icon} />
        </IconButton>
        <Divider />
        <div className="relative" ref={layoutRef}>
          <IconButton
            label="Arrange"
            size={28}
            popup="menu"
            expanded={layoutOpen}
            onClick={() => setLayoutOpen((v) => !v)}
          >
            <Network {...icon} />
            <ChevronDown {...chevron} />
          </IconButton>
          {layoutOpen ? (
            <div
              ref={layoutMenuRef}
              role="menu"
              aria-label="Arrange"
              onKeyDown={arrangeKeys}
              className={`${MENU} w-52`}
            >
              {LAYOUT_ROWS.map(({ axis, directions }) => {
                const direction = directions[reversed[axis] ? 1 : 0];
                const Arrow = DIRECTION_ARROW[direction];
                return (
                  // a row lays out an item and its flip — the menu's items are theirs
                  <div key={axis} role="none" className="flex items-center gap-0.5">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={arrangeable < 2}
                      aria-describedby={arrangeable < 2 ? "layout-needs-selection" : undefined}
                      onClick={() => arrange(direction)}
                      className={`${ITEM} min-w-0 flex-1 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent`}
                    >
                      <Arrow
                        size={15}
                        strokeWidth={ICON_STROKE}
                        aria-hidden="true"
                        className="text-icon"
                      />
                      {DIRECTION_LABEL[direction]}
                    </button>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-label={`Flip ${axis} direction`}
                      aria-checked={reversed[axis]}
                      title={`Flip to ${DIRECTION_LABEL[directions[reversed[axis] ? 0 : 1]]}`}
                      onClick={() => flip(axis)}
                      // on: the selected wash, which the hover wash must not cover
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-button) transition-colors ${FOCUS_ITEM} ${
                        reversed[axis] ? "bg-selected text-ink" : "text-icon hover:bg-hover"
                      }`}
                    >
                      {axis === "vertical" ? (
                        <ArrowUpDown size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
                      ) : (
                        <ArrowLeftRight size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                );
              })}
              {arrangeable < 2 ? (
                // the disabled items' description, not an item of the menu
                <p
                  id="layout-needs-selection"
                  role="none"
                  className={`px-2 pb-1 pt-1 text-[11px] leading-snug ${TEXT_MUTED}`}
                >
                  Select two or more shapes to arrange
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="relative" ref={exportRef}>
          <IconButton
            label="Export"
            size={28}
            popup="menu"
            expanded={exportOpen}
            onClick={() => setExportOpen((v) => !v)}
          >
            <Download size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
            <span data-label aria-hidden="true" className="ml-1 text-[12px] font-medium text-ink">
              Export
            </span>
            <ChevronDown {...chevron} />
          </IconButton>
          {exportOpen ? (
            <div
              ref={exportMenuRef}
              role="menu"
              aria-label="Export"
              onKeyDown={exportKeys}
              className={`${MENU} w-44`}
            >
              {(
                [
                  // copying first: exporting is usually on the way to pasting (#143)
                  // Markdown first in both groups: the one export that must always be there (#192)
                  ["Copy as Markdown", () => run(() => copyMarkdown())],
                  ["Copy image", () => run(() => copyPng())],
                  ["Copy as SVG", () => run(() => copySvg())],
                  ["—", null],
                  ["Markdown (.md)", () => run(() => exportMarkdown())],
                  ["PNG image", () => run(() => exportPng())],
                  ["SVG image", () => run(() => exportSvg())],
                ] as [string, (() => void) | null][]
              ).map(([label, handler]) =>
                handler === null ? (
                  <hr key="rule" className="my-1 h-px border-0 bg-line" />
                ) : (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    onClick={handler}
                    className={ITEM}
                  >
                    {label}
                  </button>
                ),
              )}
              {/* The selection lives on the canvas, so exporting it starts there
                  too — right-click a shape (#139). The toolbar keeps the whole
                  document, which has no place on the canvas to start from. */}
            </div>
          ) : null}
        </div>
        <Divider />
        <IconButton label="Mermaid preview" size={28} {...toggle("mermaid")}>
          <Code {...icon} />
        </IconButton>
        <Divider />
        <IconButton label="Ask AI" size={28} align="end" {...toggle("chat")}>
          <Sparkles size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <span data-label aria-hidden="true" className="ml-1.5 text-[12px] font-semibold">
            Ask AI
          </span>
        </IconButton>
      </div>
    </div>
  );
};

/**
 * Where the open diagram is (#229 D3): the folders the listing finds it in,
 * then its live title. An external file, or a new diagram the listing does
 * not have yet, is its title alone. An ancestor brings up the Home tab on
 * that folder; the document stays in its tab.
 */
const DiagramPath = () => {
  const projectId = useDiagramStore((s) => s.projectId);
  const title = useDiagramStore((s) => s.title);
  const folders = useLibraryStore((s) => s.folders);
  const found = projectId !== null && folders ? findDiagram(folders, projectId) : null;
  return (
    <PathCrumbs
      path={found?.path ?? []}
      current={title}
      onCrumb={(folder) => viewInHome({ kind: "folder", folder })}
      // the text starts at the sheet + 22, as the Home header's does
      className="ml-2 flex-1"
    />
  );
};
