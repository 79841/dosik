import {
  AlignHorizontalDistributeCenter,
  ArrowLeftRight,
  Boxes,
  Braces,
  BringToFront,
  ChartGantt,
  Frame,
  GitFork,
  Group,
  MoveRight,
  RotateCcw,
  Route,
  SendToBack,
  Spline,
  Tags,
  Trash2,
  Type,
  Ungroup,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { takesDecor } from "../../shared/lib/nodeDecor";
import { useDiagramStore } from "../../shared/lib/store";
import { canGroup, canUngroup } from "../../shared/lib/store/groups";
import {
  ISLAND_GAP,
  ISLAND_HEIGHT,
  ISLAND_INSET,
  SHAPE_STRIP_WIDTH,
  TOAST_BOTTOM,
  ZOOM_ISLAND_HEIGHT,
  ZOOM_ISLAND_WIDTH,
} from "../../shared/lib/editorLayout";
import { useContentWidth } from "../../shared/lib/sidebarLayout";
import { useOutsideDismiss } from "../../shared/lib/useOutsideDismiss";
import { ICON_STROKE, IconButton, TOOL_ICON_SIZE } from "../../shared/ui/IconButton";
import type { DiagramEdge } from "../../shared/lib/types";
import { useSelectionEditing } from "../inspector/useSelectionEditing";
import { ShapePreview } from "../palette/ShapePreview";
import {
  AlignSection,
  ClassSection,
  ColorDot,
  EdgeColorSection,
  EndsSection,
  FrameSection,
  IconSection,
  LabelsSection,
  LifelineSection,
  LineSection,
  NodeColorSection,
  PathSection,
  RelationSection,
  SectionLabel,
  ShapeSection,
  TextSection,
} from "./sections";

/** a line whose path carries something the user moved by hand */
const hasHandShapedPath = (edge: DiagramEdge): boolean =>
  Boolean(edge.data?.waypoints?.length) ||
  edge.data?.labelT !== undefined ||
  edge.data?.selfLoopWidth !== undefined;

const icon = { size: TOOL_ICON_SIZE, strokeWidth: ICON_STROKE, "aria-hidden": true } as const;

/** how far above the canvas's bottom edge the bar sits (`island-inset`) */
export const EDIT_BAR_BOTTOM = ISLAND_INSET;
/** one row of the bar (`island-height`) */
export const EDIT_BAR_HEIGHT = ISLAND_HEIGHT;
/**
 * toasts rise this far while the bar is up, clearing its top by 8px (#159
 * D4) — on its usual row, the editor's 60 they already rest at (#231 D18)
 */
export const TOAST_LIFT = EDIT_BAR_BOTTOM + EDIT_BAR_HEIGHT + 8 - TOAST_BOTTOM;
/** the zoom island at the bottom right, its inset and a gap — where the bar's row ends */
const ZOOM_CLEARANCE = ISLAND_INSET + ZOOM_ISLAND_WIDTH + ISLAND_GAP;
/** a band narrower than this sends the bar up a row, over the zoom island */
const MIN_BAR_WIDTH = 260;
/** the row above the zoom island: its top plus the gap */
const RAISED_BOTTOM = ISLAND_INSET + ZOOM_ISLAND_HEIGHT + ISLAND_GAP;
/**
 * Raised, the bar starts right of the shape strip: wrapped onto two rows on a
 * short canvas it reaches the strip's bottom, and would cover it (#219)
 */
const RAISED_START = ISLAND_INSET + SHAPE_STRIP_WIDTH + ISLAND_GAP;

/**
 * Where the bar goes in a canvas `canvasWidth` wide (#219 D9): the canvas's
 * bottom centre, in the band left of the zoom island — pushed left inside
 * the band when the centre would reach the island. A canvas too narrow for
 * that band (the 960 window with the sidebar and the panel docked) sends the
 * bar up a row, above the island, where it has the canvas's width right of
 * the shape strip.
 * `maxWidth` is the band, whatever the bar measures: the bar's width never
 * depends on where it is, so measuring it cannot move it back and forth.
 * Pure, so the arithmetic is testable without layout.
 */
export const editBarPlacement = (
  canvasWidth: number,
  barWidth: number,
): { left: number; maxWidth: number; bottom: number } => {
  const besideZoom = canvasWidth - ZOOM_CLEARANCE - ISLAND_INSET;
  const raised = besideZoom < MIN_BAR_WIDTH;
  const start = raised ? RAISED_START : ISLAND_INSET;
  const end = raised ? canvasWidth - ISLAND_INSET : canvasWidth - ZOOM_CLEARANCE;
  const centred = canvasWidth / 2 - barWidth / 2;
  return {
    left: Math.max(start, Math.min(centred, end - barWidth)),
    maxWidth: end - start,
    bottom: raised ? RAISED_BOTTOM : EDIT_BAR_BOTTOM,
  };
};

/** keep this much of the canvas column's edge free beside a popover */
const POPOVER_MARGIN = 8;

/** the canvas column's left and right — the window's when there is no column */
const columnBounds = (el: HTMLElement): { left: number; right: number } => {
  const column = el.closest("[data-editor-canvas]")?.getBoundingClientRect();
  return column && column.right > column.left
    ? { left: column.left, right: column.right }
    : { left: 0, right: window.innerWidth };
};

/**
 * A bar button whose section opens above it. One is open at a time. The
 * popover centres on its button and slides sideways if that would cross the
 * canvas column's edge (#219 D9) — the end buttons of a wide bar sit close
 * to it, and past the right one is the docked panel.
 */
const Panel = ({
  label,
  glyph,
  open,
  onToggle,
  wide,
  children,
}: {
  label: string;
  glyph: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  /** member lists and relation grids need more room than a row of swatches */
  wide?: boolean;
  children: React.ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    // nothing laid out (a test DOM, a hidden window) — nothing to keep on screen
    if (box.width === 0) return;
    // measured where it would sit unshifted
    const left = box.left - shift;
    const right = box.right - shift;
    const bounds = columnBounds(ref.current);
    const next =
      left < bounds.left + POPOVER_MARGIN
        ? bounds.left + POPOVER_MARGIN - left
        : right > bounds.right - POPOVER_MARGIN
          ? bounds.right - POPOVER_MARGIN - right
          : 0;
    if (next !== shift) setShift(next);
  });
  return (
    <div className="relative">
      <IconButton
        label={label}
        size={32}
        tooltip="above"
        expanded={open}
        popup="dialog"
        onClick={onToggle}
      >
        {glyph}
      </IconButton>
      {open ? (
        <div
          ref={ref}
          role="dialog"
          aria-label={label}
          style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
          // a long member list or many activation rows must scroll, not run
          // off the top of the window
          // above the neighbouring buttons' tooltips, which share the bar's layer
          className={`absolute bottom-full left-1/2 z-50 mb-3 max-h-[min(60vh,32rem)] overflow-y-auto rounded-lg bg-surface p-3 shadow-popover ring-1 ring-line ${
            wide ? "w-72" : "w-60"
          }`}
        >
          <SectionLabel>{label}</SectionLabel>
          {children}
        </div>
      ) : null}
    </div>
  );
};

const Divider = () => <div className="mx-1 h-4 w-px bg-line" />;

/**
 * Editing the selection, from a bar at the bottom of the canvas (#159) — the
 * right-hand inspector it replaces covered the diagram. Shapes, lines, or
 * both: each gets the buttons that apply to it, and a button opens its
 * section above the bar. Everything edits the whole selection.
 *
 * It lives in the canvas column (#219 D9): centred in the canvas, clear of
 * the zoom island, placed by the column's width — the docked panel narrows
 * the column, so the bar follows the canvas's centre as the panel opens,
 * closes or is dragged wider.
 */
export const EditBar = () => {
  const e = useSelectionEditing();
  const update = useDiagramStore((s) => s.updateNodeData);
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // the content (the window less the docked sidebar, #217 D24) stands in for
  // the canvas column until the column has been measured
  const contentWidth = useContentWidth();
  /** the canvas column's width and the bar's own, measured; 0 until they are */
  const [measured, setMeasured] = useState({ canvas: 0, bar: 0 });
  // booleans, so the bar re-renders only when they flip (#171)
  const groupable = useDiagramStore((s) => canGroup(s.nodes));
  const ungroupable = useDiagramStore((s) => canUngroup(s.nodes));
  /**
   * Every way a section closes goes through here. A field mid-edit commits on
   * blur; closing first would unmount it unblurred and drop what was typed
   * (#159) — whether the user clicked away or an agent's edit took the
   * section away under them.
   */
  const closeSection = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && ref.current?.contains(active)) active.blur();
    setOpen(null);
  };
  useOutsideDismiss(ref, open !== null, closeSection);

  const visible = e.selectedNodes.length > 0 || e.selectedEdges.length > 0;
  const placement = editBarPlacement(measured.canvas || contentWidth, measured.bar);

  // The column's width moves the bar; the bar's own width (its buttons, its
  // rows) only centres it. `width: max-content` under the band's `maxWidth`
  // keeps that width independent of where the bar is, so this never loops.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!visible || !el) return;
    const column = el.parentElement;
    const measure = () => {
      const next = { canvas: column?.clientWidth ?? 0, bar: el.offsetWidth };
      setMeasured((prev) => (prev.canvas === next.canvas && prev.bar === next.bar ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (column) observer.observe(column);
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  // toasts share the bottom centre; while the bar is up they move above it —
  // measured, since a narrow window wraps the bar onto more rows (#159)
  useEffect(() => {
    const el = ref.current;
    if (!visible || !el) return;
    const root = document.documentElement;
    const apply = () => {
      const height = el.offsetHeight || EDIT_BAR_HEIGHT;
      root.style.setProperty(
        "--dsk-toast-lift",
        `${placement.bottom + height + 8 - TOAST_BOTTOM}px`,
      );
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--dsk-toast-lift");
    };
  }, [visible, placement.bottom]);

  const node = e.firstNode;
  const edge = e.firstEdge;
  // the sections the selection offers right now; an open one that is no longer
  // among them (the bar went away, undo turned the class back into a box)
  // closes rather than popping up again later by itself
  const offered = new Set<string>([
    // a frame is an area, not a box: it takes no other shape (#170 D8)
    ...(node ? ["color"] : []),
    // drawn texts are typed on the canvas (#281); an image's alt text is not drawn
    ...(node?.data.shape === "image" ? ["text"] : []),
    ...(node && node.data.shape !== "frame" ? ["shape"] : []),
    ...(node && (node.data.shape === "icon" || takesDecor(node.data.shape)) ? ["icon"] : []),
    ...(e.soleClass ? ["class"] : []),
    ...(e.soleLifeline ? ["lifeline"] : []),
    ...(e.soleFragment ? ["fragment"] : []),
    ...(e.selectedLifelines.length >= 2 ? ["align"] : []),
    ...(edge ? ["edge-color", "line", "path", "ends", "labels", "relation"] : []),
  ]);
  const stale = open !== null && !offered.has(open);
  // biome-ignore lint/correctness/useExhaustiveDependencies: closeSection only reads refs and setters
  useEffect(() => {
    if (stale) closeSection();
  }, [stale]);

  if (!visible) return null;
  const toggle = (id: string) => () => setOpen((prev) => (prev === id ? null : id));
  const panel = (id: string) => ({ open: open === id, onToggle: toggle(id) });

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Edit selection"
      // the canvas's bottom centre, clear of the zoom island (#219 D9)
      style={{
        bottom: placement.bottom,
        left: placement.left,
        maxWidth: placement.maxWidth,
      }}
      // nodelete: Backspace in a field here edits the field, not the diagram.
      // w-max: as wide as its buttons, wrapping onto a second row past maxWidth
      className="nodelete absolute z-30 flex min-h-10 w-max flex-wrap items-center justify-center gap-0.5 rounded-(--radius-island) bg-surface px-1 py-1 shadow-raised"
    >
      {node ? (
        <>
          <Panel label="Color" glyph={<ColorDot color={node.data.color} />} {...panel("color")}>
            <NodeColorSection e={e} />
          </Panel>
          {node.data.shape === "frame" ? null : (
            <Panel
              label="Shape"
              glyph={<ShapePreview shape={node.data.shape} width={22} height={16} />}
              {...panel("shape")}
            >
              <ShapeSection e={e} />
            </Panel>
          )}
          {node.data.shape === "image" ? (
            <Panel label="Alt text" glyph={<Type {...icon} />} {...panel("text")}>
              <TextSection e={e} update={update} />
            </Panel>
          ) : null}
          {node.data.shape === "icon" || takesDecor(node.data.shape) ? (
            <Panel label="Icon" glyph={<Boxes {...icon} />} {...panel("icon")}>
              <IconSection e={e} update={update} />
            </Panel>
          ) : null}
          {e.soleClass ? (
            <Panel label="Class" glyph={<Braces {...icon} />} {...panel("class")}>
              <ClassSection e={e} update={update} />
            </Panel>
          ) : null}
          {e.soleLifeline ? (
            <Panel label="Activations" glyph={<ChartGantt {...icon} />} wide {...panel("lifeline")}>
              <LifelineSection e={e} />
            </Panel>
          ) : null}
          {e.soleFragment ? (
            <Panel label="Fragment" glyph={<Frame {...icon} />} {...panel("fragment")}>
              <FrameSection e={e} update={update} />
            </Panel>
          ) : null}
          {e.selectedLifelines.length >= 2 ? (
            <Panel
              label="Align"
              glyph={<AlignHorizontalDistributeCenter {...icon} />}
              {...panel("align")}
            >
              <AlignSection e={e} />
            </Panel>
          ) : null}
          <IconButton
            label="Bring to front"
            size={32}
            tooltip="above"
            onClick={() => e.setNodeZ("front")}
          >
            <BringToFront {...icon} />
          </IconButton>
          <IconButton
            label="Send to back"
            size={32}
            tooltip="above"
            onClick={() => e.setNodeZ("back")}
          >
            <SendToBack {...icon} />
          </IconButton>
          {groupable ? (
            <IconButton
              label="Group"
              size={32}
              tooltip="above"
              onClick={() => useDiagramStore.getState().groupSelection()}
            >
              <Group {...icon} />
            </IconButton>
          ) : null}
          {ungroupable ? (
            <IconButton
              label="Ungroup"
              size={32}
              tooltip="above"
              onClick={() => useDiagramStore.getState().ungroupSelection()}
            >
              <Ungroup {...icon} />
            </IconButton>
          ) : null}
        </>
      ) : null}
      {node && edge ? <Divider /> : null}
      {edge ? (
        <>
          <Panel
            label="Line color"
            glyph={<ColorDot color={edge.data?.color} />}
            {...panel("edge-color")}
          >
            <EdgeColorSection e={e} />
          </Panel>
          <Panel label="Line" glyph={<Spline {...icon} />} {...panel("line")}>
            <LineSection e={e} />
          </Panel>
          <Panel label="Path" glyph={<Route {...icon} />} {...panel("path")}>
            <PathSection e={e} />
          </Panel>
          <Panel label="Arrowheads" glyph={<MoveRight {...icon} />} {...panel("ends")}>
            <EndsSection e={e} />
          </Panel>
          <Panel label="Labels" glyph={<Tags {...icon} />} {...panel("labels")}>
            <LabelsSection e={e} />
          </Panel>
          <Panel label="Relation" glyph={<GitFork {...icon} />} wide {...panel("relation")}>
            <RelationSection e={e} />
          </Panel>
          <IconButton label="Reverse" size={32} tooltip="above" onClick={e.reverseSelectedEdges}>
            <ArrowLeftRight {...icon} />
          </IconButton>
          {/* what the user moved by hand — bends slid into the line, a label
              slid along it, a loop's reach — goes, and the line routes itself
              again. Off when there is nothing of that to undo (#204) */}
          <IconButton
            label="Reset path — undo the bends and label you moved"
            size={32}
            tooltip="above"
            disabled={!e.selectedEdges.some(hasHandShapedPath)}
            onClick={() =>
              e.patchEdges({ waypoints: undefined, labelT: undefined, selfLoopWidth: undefined })
            }
          >
            <RotateCcw {...icon} />
          </IconButton>
        </>
      ) : null}
      {node || edge ? <Divider /> : null}
      <IconButton label="Delete selection" size={32} tooltip="above" onClick={e.deleteSelection}>
        <Trash2 {...icon} className="text-danger" />
      </IconButton>
    </div>
  );
};
