import { useEffect, useRef } from "react";

import { PALETTE_COLORS, swatchStyle } from "../../shared/lib/palette";
import { useDiagramStore } from "../../shared/lib/store";
import { canGroup, canUngroup } from "../../shared/lib/store/groups";
import type { PaletteColor } from "../../shared/lib/types";
import { useMenuKeys } from "../../shared/lib/useMenuKeys";
import { usePopupPosition } from "../../shared/lib/usePopupPosition";
import { useOutsideDismiss } from "../../shared/lib/useOutsideDismiss";
import { hasExportableSelection } from "../export/selection";
import { pickedShapes } from "../inspector/useSelectionEditing";
import { type NodeMenuState, useCanvasUiStore } from "./canvasUiStore";
import { ExportSelectionItems } from "./ExportSelectionItems";
import { MenuItem } from "./menuParts";
import {
  addableTextParts,
  isListPart,
  type NodeTextPart,
  nodeTextParts,
  textPartPatch,
  textPartValue,
} from "./nodeTextParts";

/** the ids the edit items act on — the same pick the edit bar makes */
const pickedIds = () => pickedShapes(useDiagramStore.getState().nodes).map((n) => n.id);

/** what a text is called in the menu — one row of a compartment is one attribute */
const TEXT_NOUN: Record<NodeTextPart, string> = {
  label: "name",
  description: "description",
  badge: "badge",
  stereotype: "stereotype",
  attributes: "attribute",
  methods: "method",
  columns: "column",
};

/**
 * The menu of one text in a shape — its description, badge, stereotype or a
 * row (#281): open it for typing, or take it away. A row goes alone; the rest
 * of its compartment stays.
 */
const TextMenuItems = ({
  menu,
  part,
  close,
}: {
  menu: NodeMenuState;
  part: NodeTextPart;
  close: () => void;
}) => {
  const noun = TEXT_NOUN[part];
  const edit = () => {
    useCanvasUiStore.getState().setNodeTextEdit({
      nodeId: menu.nodeId,
      part,
      ...(isListPart(part) ? { line: menu.line ?? 0 } : {}),
    });
    close();
  };
  const remove = () => {
    const store = useDiagramStore.getState();
    const node = store.nodes.find((n) => n.id === menu.nodeId);
    if (node) {
      const text = isListPart(part)
        ? textPartValue(node.data, part)
            .split("\n")
            .filter((_, i) => i !== (menu.line ?? 0))
            .join("\n")
        : "";
      store.updateNodeData(node.id, textPartPatch(part, text));
    }
    close();
  };
  return (
    <>
      {/* no ↵ here: Enter on a selected shape opens its name, not this text */}
      <MenuItem onClick={edit}>Edit {noun}</MenuItem>
      <div className="my-1 h-px bg-line" />
      <MenuItem danger onClick={remove}>
        Remove {noun}
      </MenuItem>
    </>
  );
};

/**
 * Right-click menu for shapes: editing what is picked (#159) — colour, order,
 * delete — and exporting it (#139).
 *
 * The selection is made on the canvas, so the action on it starts there too;
 * the bottom edit bar holds the rest of the editing. The toolbar keeps the
 * whole-document exports, which have no shape to start from.
 *
 * It sits outside `.react-flow__viewport` (a `fixed` sibling of the flow, like
 * `EdgeContextMenu`), so it never reaches an export of its own.
 */
export const NodeContextMenu = () => {
  const menu = useCanvasUiStore((s) => s.nodeMenu);
  const setNodeMenu = useCanvasUiStore((s) => s.setNodeMenu);
  // the menu is open, so these are not the every-drag subscription the
  // toolbar had to guard against
  const exportable = useDiagramStore((s) =>
    menu === null ? false : hasExportableSelection(s.nodes, s.edges),
  );
  const editable = useDiagramStore((s) =>
    menu === null ? false : s.nodes.some((n) => n.selected && n.data.shape !== "anchor"),
  );
  // the keyboard path anchors on the first selected node, which may be a
  // free-arrow end — the colour to tick is the first real shape's
  const color = useDiagramStore((s) => {
    if (menu === null) return undefined;
    const clicked = s.nodes.find((n) => n.id === menu.nodeId);
    const shape =
      clicked && clicked.data.shape !== "anchor"
        ? clicked
        : s.nodes.find((n) => n.selected && n.data.shape !== "anchor");
    return shape?.data.color;
  });
  // the clicked shape's data — its texts decide the text items (#281)
  const clicked = useDiagramStore((s) =>
    menu === null ? undefined : s.nodes.find((n) => n.id === menu.nodeId)?.data,
  );
  // a menu opened on one of the shape's texts is that text's, while the text is there
  const textPart =
    menu?.textPart && clicked && nodeTextParts(clicked).includes(menu.textPart)
      ? menu.textPart
      : undefined;
  const groupable = useDiagramStore((s) => (menu === null ? false : canGroup(s.nodes)));
  const ungroupable = useDiagramStore((s) => (menu === null ? false : canUngroup(s.nodes)));
  const ref = useRef<HTMLDivElement>(null);
  // the placement hook is told "open" by the same test that decides whether
  // anything renders — otherwise a menu whose content arrives a render later
  // keeps its stale spot, since nothing in the anchor changed (#142)
  const shown = menu !== null && (exportable || editable || textPart) ? menu : null;
  const position = usePopupPosition(ref, shown && { x: shown.clientX, y: shown.clientY });

  useOutsideDismiss(ref, menu !== null, () => setNodeMenu(null));

  // Opened from the keyboard, the menu takes the focus on its first item and
  // owes it back on close: the button holding it goes with the menu, and the
  // focus would land on <body> (#139). A right-click leaves the focus where it
  // was. This effect notes where that is before `useMenuKeys` moves it.
  const keyboardOwned = shown !== null && shown.fromKeyboard === true;
  useEffect(() => {
    if (!keyboardOwned) return;
    const returnTo = document.activeElement as HTMLElement | null;
    return () => {
      // only the focus the menu took, or the page's when it went with the
      // menu — not a text editor an item just opened (#281), which would
      // close the moment it lost the focus
      const now = document.activeElement;
      const lost = now === null || now === document.body || !now.isConnected;
      if (lost && returnTo?.isConnected) returnTo.focus();
    };
  }, [keyboardOwned]);
  const close = (): void => setNodeMenu(null);
  // the arrow keys walk every item — colours, order, delete and the export
  // group — as one menu, which is what `role="menu"` promises (#219)
  const onKeyDown = useMenuKeys(ref, keyboardOwned, { onEscape: close });

  if (!shown) return null;
  const store = useDiagramStore.getState();
  const paint = (c: PaletteColor) => {
    // one undo step however many shapes are picked
    store.setNodesColor(pickedIds(), c);
    close();
  };

  if (textPart) {
    return (
      <div
        ref={ref}
        role="menu"
        aria-label={`${TEXT_NOUN[textPart][0]!.toUpperCase()}${TEXT_NOUN[textPart].slice(1)} actions`}
        className="nodelete fixed z-50 w-52 rounded-lg bg-surface p-1.5 shadow-popover ring-1 ring-line"
        style={position}
        onKeyDown={onKeyDown}
      >
        <TextMenuItems menu={shown} part={textPart} close={close} />
      </div>
    );
  }

  // the shape's own texts: its name, and the ones it can take (#281)
  const openText = (part: NodeTextPart, adding: boolean) => {
    useCanvasUiStore
      .getState()
      .setNodeTextEdit({ nodeId: shown.nodeId, part, ...(adding ? { adding } : {}) });
    close();
  };
  // a menu opened from the keyboard over several shapes names none of them:
  // whose text Edit or Add would open is not for the menu to guess
  const oneShape = !shown.fromKeyboard || pickedIds().length <= 1;
  const textItems =
    oneShape && clicked && nodeTextParts(clicked).includes("label") ? (
      <>
        <MenuItem onClick={() => openText("label", false)} hint="↵" keys="Enter">
          Edit text
        </MenuItem>
        {addableTextParts(clicked).map(({ part, enabled }) => (
          <MenuItem key={part} disabled={!enabled} onClick={() => openText(part, true)}>
            Add {TEXT_NOUN[part]}
          </MenuItem>
        ))}
        <div className="my-1 h-px bg-line" />
      </>
    ) : null;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Shape actions"
      // nodelete: Backspace on a focused item must not delete the selection
      // the menu is about — Delete is an item of its own (#219)
      className="nodelete fixed z-50 w-52 rounded-lg bg-surface p-1.5 shadow-popover ring-1 ring-line"
      style={position}
      onKeyDown={onKeyDown}
    >
      {editable ? (
        <>
          <fieldset aria-label="Color" className="m-0 flex flex-wrap gap-1 border-0 px-2 py-1.5">
            {PALETTE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="menuitemradio"
                aria-checked={c === color}
                aria-label={`Color ${c}`}
                title={c}
                onClick={() => paint(c)}
                className="h-5 w-5 rounded-full transition-transform hover:scale-110"
                style={swatchStyle(c, c === color, 3.5)}
              />
            ))}
          </fieldset>
          <div className="my-1 h-px bg-line" />
          {textItems}
          <MenuItem
            onClick={() => {
              store.setNodeZ(pickedIds(), "front");
              close();
            }}
          >
            Bring to front
          </MenuItem>
          <MenuItem
            onClick={() => {
              store.setNodeZ(pickedIds(), "back");
              close();
            }}
          >
            Send to back
          </MenuItem>
          {groupable ? (
            <MenuItem
              onClick={() => {
                store.groupSelection();
                close();
              }}
            >
              Group
            </MenuItem>
          ) : null}
          {ungroupable ? (
            <MenuItem
              onClick={() => {
                store.ungroupSelection();
                close();
              }}
            >
              Ungroup
            </MenuItem>
          ) : null}
          <MenuItem
            danger
            onClick={() => {
              const s = useDiagramStore.getState();
              s.deleteElements(
                s.nodes.filter((n) => n.selected).map((n) => n.id),
                s.edges.filter((e) => e.selected).map((e) => e.id),
              );
              close();
            }}
          >
            Delete
          </MenuItem>
        </>
      ) : null}
      {exportable ? (
        <>
          {editable ? <div className="my-1 h-px bg-line" /> : null}
          <ExportSelectionItems onDone={close} />
        </>
      ) : null}
    </div>
  );
};
