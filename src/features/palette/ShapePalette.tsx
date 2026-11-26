import { useId, useLayoutEffect, useRef, useState } from "react";
import { useReactFlow, useStore } from "@xyflow/react";

import { useCanvasUiStore } from "../canvas/canvasUiStore";
import { SHAPE_DRAG_MIME } from "../canvas/DiagramCanvas";
import { pickImageFile } from "../canvas/imageFiles";
import {
  imageFromBlob,
  LEFT_BEFORE_PICTURE,
  placeImage,
  watchDocument,
} from "../canvas/imageInput";
import { toastError } from "../../shared/lib/toastStore";
import { PREVIEW_COLOR, ShapePreview } from "./ShapePreview";
import {
  DEFAULT_NODE_SIZE,
  FOCUS_ITEM,
  SHAPE_GROUPS,
  SHAPE_LABELS,
  SHAPE_ROLES,
  TEXT_MUTED,
} from "../../shared/lib/palette";
import { IconButton } from "../../shared/ui/IconButton";
import { useMenuKeys } from "../../shared/lib/useMenuKeys";
import { useOutsideDismiss } from "../../shared/lib/useOutsideDismiss";
import type { ShapeGroupId } from "../../shared/lib/palette";
import { useDiagramStore } from "../../shared/lib/store";
import { ICON_IDS, ICON_LABELS, type IconId } from "../../shared/lib/iconIds";
import { IconGlyph } from "../../shared/lib/icons";
import type { ShapeKind } from "../../shared/lib/types";

/** the arrow tool's glyph, at the strip's 24×16 (drawn at 36×24 and scaled) */
const ArrowPreview = () => (
  <svg width={24} height={16} viewBox="0 0 36 24" aria-hidden="true" className="overflow-visible">
    <line x1={2} y1={18} x2={28} y2={6} stroke={PREVIEW_COLOR.stroke} strokeWidth={1.8} />
    <polygon points="34,3.2 26,4.6 29.5,11.8" fill={PREVIEW_COLOR.stroke} />
  </svg>
);

/** least gap between a flyout and the canvas column's edge */
const FLYOUT_MARGIN = 8;

/**
 * The box a flyout stays inside: the canvas column (#219 D8) — it starts
 * under the band and the toolbar row, so the window would let a flyout cover
 * them. The window when there is no column (a test, a bare render).
 */
const flyoutBounds = (el: HTMLElement): { top: number; bottom: number } => {
  const column = el.closest("[data-editor-canvas]")?.getBoundingClientRect();
  return column && column.bottom > column.top
    ? { top: column.top, bottom: column.bottom }
    : { top: 0, bottom: window.innerHeight };
};

/** the icon flyout's grid: six to a row (its `grid-cols-6`) */
const ICON_COLUMNS = 6;

type ShapeGroup = (typeof SHAPE_GROUPS)[number];

/**
 * One group's flyout — a `role="menu"`, so it keeps the menus' keyboard
 * (`useMenuKeys`, #219): the first item takes the focus when it
 * opens, ↑↓ Home End move (←→ too in the icon grid), Escape closes back to
 * the group's button and Tab closes and goes on. Mounted while its group is
 * open, so a switch to another group opens fresh.
 */
const ShapeFlyout = ({
  group,
  onAdd,
  onClose,
}: {
  group: ShapeGroup;
  onAdd: (shape: ShapeKind, icon?: IconId) => void;
  /** `toButton`: the keyboard goes back to the group's button, not the page */
  onClose: (toButton: boolean) => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  // A flyout centres on its trigger, so near the top or bottom of a short
  // canvas it would hang off the edge — with eight groups the Flowchart list
  // did at the minimum height (#180). Nudge it back inside the canvas
  // column, and keep it no taller than the column (#219 D8).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.marginTop = "";
    const bounds = flyoutBounds(el);
    el.style.maxHeight = `${bounds.bottom - bounds.top - 2 * FLYOUT_MARGIN}px`;
    const { top, bottom } = el.getBoundingClientRect();
    const ceiling = bounds.top + FLYOUT_MARGIN;
    const floor = bounds.bottom - FLYOUT_MARGIN;
    const over = top < ceiling ? ceiling - top : bottom > floor ? floor - bottom : 0;
    if (over !== 0) el.style.marginTop = `${over}px`;
  }, []);

  const icons = group.id === "icons";
  const onKeyDown = useMenuKeys(ref, true, {
    onEscape: () => onClose(true),
    onTab: () => onClose(false),
    columns: icons ? ICON_COLUMNS : 1,
  });
  // a pick or a drag closes it from inside: back to the button, like the
  // toolbar's menus — on the page, Backspace would delete the selection
  const pick = (shape: ShapeKind, icon?: IconId) => {
    onAdd(shape, icon);
    onClose(true);
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={group.label}
      onKeyDown={onKeyDown}
      className={`absolute left-full top-1/2 z-20 ml-2 overflow-y-auto ${icons ? "w-56" : "w-48"} -translate-y-1/2 rounded-lg bg-surface p-1.5 shadow-popover ring-1 ring-line`}
    >
      <p
        className={`px-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide ${TEXT_MUTED}`}
      >
        {group.label}
      </p>
      {icons ? (
        // one shape kind, many glyphs: a grid instead of the shape list
        <div className="grid grid-cols-6 gap-0.5">
          {ICON_IDS.map((icon) => (
            <button
              key={icon}
              type="button"
              role="menuitem"
              title={ICON_LABELS[icon]}
              aria-label={ICON_LABELS[icon]}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(SHAPE_DRAG_MIME, `icon:${icon}`);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onDragEnd={() => onClose(true)}
              onClick={() => pick("icon", icon)}
              className={`flex h-8 w-8 cursor-grab items-center justify-center rounded-md transition-colors hover:bg-hover active:cursor-grabbing ${FOCUS_ITEM}`}
            >
              <svg width={20} height={20} aria-hidden="true">
                <IconGlyph icon={icon} size={20} color={PREVIEW_COLOR.stroke} />
              </svg>
            </button>
          ))}
        </div>
      ) : (
        group.shapes.map((shape) => (
          <button
            key={shape}
            type="button"
            role="menuitem"
            title={SHAPE_LABELS[shape]}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(SHAPE_DRAG_MIME, shape);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onDragEnd={() => onClose(true)}
            onClick={() => pick(shape)}
            className={`flex w-full cursor-grab items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-hover active:cursor-grabbing ${FOCUS_ITEM}`}
          >
            <span className="flex h-6 w-9 shrink-0 items-center justify-center">
              <ShapePreview shape={shape} width={30} height={20} />
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] text-muted-strong">{SHAPE_ROLES[shape]}</span>
              {/* geometry as a subtitle, skipped when it repeats the role */}
              {SHAPE_LABELS[shape] !== SHAPE_ROLES[shape] && (
                <span className={`block text-[10px] ${TEXT_MUTED}`}>{SHAPE_LABELS[shape]}</span>
              )}
            </span>
          </button>
        ))
      )}
    </div>
  );
};

export const ShapePalette = () => {
  const addNode = useDiagramStore((s) => s.addNode);
  const arrowMode = useCanvasUiStore((s) => s.arrowMode);
  const setArrowMode = useCanvasUiStore((s) => s.setArrowMode);
  const { screenToFlowPosition } = useReactFlow();
  const [openGroup, setOpenGroup] = useState<ShapeGroupId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const idPrefix = useId();
  const buttonId = (group: ShapeGroupId) => `${idPrefix}-${group}`;

  useOutsideDismiss(rootRef, openGroup !== null, () => setOpenGroup(null));

  /** closes the open flyout — from inside it, `toButton` gives the keyboard back to its button */
  const closeFlyout = (toButton: boolean) => {
    const group = openGroup;
    setOpenGroup(null);
    if (toButton && group) document.getElementById(buttonId(group))?.focus();
  };

  const canvasNode = useStore((s) => s.domNode);
  // the window centre is not the canvas centre — the sidebar, the toolbar row
  // and the docked panel take their share — so use React Flow's own box
  // (#125, #127)
  const viewportCenter = () => {
    const rect = canvasNode?.getBoundingClientRect();
    return screenToFlowPosition(
      rect && rect.width > 0
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    );
  };

  const addAtCenter = (shape: ShapeKind, icon?: IconId) => {
    const position = viewportCenter();
    // centre the new node's own box on the viewport centre (drop does the same)
    const size = DEFAULT_NODE_SIZE[shape];
    addNode(
      shape,
      { x: position.x - size.width / 2, y: position.y - size.height / 2 },
      icon ? { icon } : undefined,
    );
  };

  const addImageFromFile = () => {
    setOpenGroup(null);
    // the picture goes to the diagram it was picked for, or nowhere (#218)
    const pickedFor = watchDocument(LEFT_BEFORE_PICTURE);
    void pickImageFile()
      .then(async (picked) => {
        if (!picked) return;
        const image = await imageFromBlob(picked.blob);
        if (!pickedFor.left()) placeImage(image, viewportCenter(), picked.original);
      })
      .catch(toastError);
  };

  return (
    <div
      ref={rootRef}
      role="toolbar"
      aria-label="Shapes"
      aria-orientation="vertical"
      // an island at the canvas column's left middle: 40 wide, 32 buttons (#219 D8).
      // nodelete: Backspace on a focused button or flyout item must not delete
      // the canvas selection — like the zoom island and the edit bar (#219)
      className="nodelete absolute top-1/2 left-3 z-10 flex w-10 -translate-y-1/2 flex-col gap-0.5 rounded-(--radius-island) bg-surface p-1 shadow-raised"
    >
      {SHAPE_GROUPS.map((group) => {
        const open = openGroup === group.id;
        // a picture starts from a file: the button picks one, no flyout (#219 T8)
        if (group.id === "image") {
          return (
            <IconButton
              key={group.id}
              label={group.label}
              size={32}
              tooltip="right"
              onClick={addImageFromFile}
            >
              <ShapePreview shape={group.icon} width={24} height={16} />
            </IconButton>
          );
        }
        return (
          <div key={group.id} className="relative">
            {/* the name is the tooltip, to the right of the strip (#219 D8) */}
            <IconButton
              id={buttonId(group.id)}
              label={group.label}
              size={32}
              tooltip="right"
              popup="menu"
              expanded={open}
              onClick={() => setOpenGroup(open ? null : group.id)}
            >
              <ShapePreview shape={group.icon} width={24} height={16} />
            </IconButton>
            {open && <ShapeFlyout group={group} onAdd={addAtCenter} onClose={closeFlyout} />}
          </div>
        );
      })}
      <span aria-hidden="true" className="mx-1.5 my-[3px] h-px bg-line" />
      <IconButton
        label="Arrow tool — drag on canvas to draw (Esc to exit)"
        size={32}
        tooltip="right"
        pressed={arrowMode}
        onClick={() => {
          setOpenGroup(null);
          setArrowMode(!arrowMode);
        }}
      >
        <ArrowPreview />
      </IconButton>
    </div>
  );
};
