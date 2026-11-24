import { useRef } from "react";

import { DEFAULT_NODE_SIZE, SHAPE_KINDS, SHAPE_ROLES } from "../../shared/lib/palette";
import { keyshortcuts, shortcutLabel } from "../../shared/lib/shortcutLabel";
import { useDiagramStore } from "../../shared/lib/store";
import type { ShapeKind } from "../../shared/lib/types";
import { useMenuKeys } from "../../shared/lib/useMenuKeys";
import { useOutsideDismiss } from "../../shared/lib/useOutsideDismiss";
import { usePopupPosition } from "../../shared/lib/usePopupPosition";
import { useCanvasUiStore } from "./canvasUiStore";
import { pasteAt } from "./canvasViewport";
import { pasteOntoCanvas } from "./imagePaste";
import { MenuItem, MenuSubmenu } from "./menuParts";

/**
 * The shapes Add shape › offers: the left rail's, minus the two that need
 * more than a click — a picture starts from a file, an icon from its glyph —
 * and the text shape, which is Add text, opening for typing.
 */
export const ADDABLE_SHAPES: ShapeKind[] = SHAPE_KINDS.filter(
  (shape) => shape !== "image" && shape !== "icon" && shape !== "text",
);

/**
 * The empty canvas's right-click menu (#281): Paste, Add shape ›, Add text,
 * Select all. What it adds lands where it was opened, centred there, as a
 * drop from the rail does. A fixed sibling of the flow like the other menus,
 * so it never reaches an export.
 */
export const CanvasContextMenu = () => {
  const menu = useCanvasUiStore((s) => s.canvasMenu);
  const ref = useRef<HTMLDivElement>(null);
  const position = usePopupPosition(ref, menu && { x: menu.clientX, y: menu.clientY });
  const close = () => useCanvasUiStore.getState().setCanvasMenu(null);
  useOutsideDismiss(ref, menu !== null, close);
  const onKeyDown = useMenuKeys(ref, false, { onEscape: close });
  if (!menu) return null;

  const at = { x: menu.flowX, y: menu.flowY };
  const add = (shape: ShapeKind): string => {
    const size = DEFAULT_NODE_SIZE[shape];
    return useDiagramStore
      .getState()
      .addNode(shape, { x: at.x - size.width / 2, y: at.y - size.height / 2 });
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Canvas actions"
      className="nodelete fixed z-50 w-48 rounded-lg bg-surface p-1.5 shadow-popover ring-1 ring-line"
      style={position}
      onKeyDown={onKeyDown}
    >
      <MenuItem
        hint={shortcutLabel("V")}
        keys={keyshortcuts("V")}
        onClick={() => {
          close();
          // what ⌘V pastes, a picture or Mermaid code landing where the menu opened
          void pasteAt(at, pasteOntoCanvas);
        }}
      >
        Paste
      </MenuItem>
      <MenuSubmenu label="Add shape">
        {ADDABLE_SHAPES.map((shape) => (
          <MenuItem
            key={shape}
            onClick={() => {
              close();
              add(shape);
            }}
          >
            {SHAPE_ROLES[shape]}
          </MenuItem>
        ))}
      </MenuSubmenu>
      <MenuItem
        onClick={() => {
          close();
          // a text shape is only its text: it opens for typing
          const id = add("text");
          useCanvasUiStore.getState().setNodeTextEdit({ nodeId: id, part: "label" });
        }}
      >
        Add text
      </MenuItem>
      <div className="my-1 h-px bg-line" />
      <MenuItem
        hint={shortcutLabel("A")}
        keys={keyshortcuts("A")}
        onClick={() => {
          close();
          useDiagramStore.getState().selectAll();
        }}
      >
        Select all
      </MenuItem>
    </div>
  );
};
