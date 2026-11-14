import { useRef } from "react";

import { pickEdgeStyle } from "../../shared/lib/edgeUtils";
import { ACCENT_SURFACE, PALETTE_COLORS, swatchStyle, TEXT_MUTED } from "../../shared/lib/palette";
import { useDiagramStore } from "../../shared/lib/store";
import type { EdgePathStyle, PaletteColor } from "../../shared/lib/types";
import { useMenuKeys } from "../../shared/lib/useMenuKeys";
import { usePopupPosition } from "../../shared/lib/usePopupPosition";
import { useOutsideDismiss } from "../../shared/lib/useOutsideDismiss";
import { hasExportableSelection } from "../export/selection";
import { useCanvasUiStore } from "./canvasUiStore";
import { ExportSelectionItems } from "./ExportSelectionItems";

const PATH_STYLES: { id: EdgePathStyle; label: string }[] = [
  { id: "orthogonal", label: "Elbow" },
  { id: "straight", label: "Straight" },
  { id: "curved", label: "Curved" },
];

const MenuButton = ({
  onClick,
  children,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className={`w-full rounded-md px-3 py-1.5 text-left text-[12px] font-medium transition-colors ${
      danger ? "text-danger hover:bg-danger/10" : "text-muted-strong hover:bg-hover"
    }`}
  >
    {children}
  </button>
);

/** Right-click menu for edges. */
export const EdgeContextMenu = () => {
  const menu = useCanvasUiStore((s) => s.edgeMenu);
  const setEdgeMenu = useCanvasUiStore((s) => s.setEdgeMenu);
  const setEdgeLabelEdit = useCanvasUiStore((s) => s.setEdgeLabelEdit);
  const copiedStyle = useCanvasUiStore((s) => s.copiedEdgeStyle);
  const setCopiedStyle = useCanvasUiStore((s) => s.setCopiedEdgeStyle);
  const edge = useDiagramStore((s) => s.edges.find((e) => e.id === menu?.edgeId));
  /**
   * A free arrow is an edge holding two anchors, and selecting it alone is a
   * selection worth exporting — without this entry that selection has no way
   * out, which is a capability #48 shipped (#139).
   *
   * Only when the clicked edge is itself part of the selection. A right-click
   * on an edge does not change the selection here (unlike a shape, where the
   * menu is *about* the selection), so otherwise the group would offer to
   * export something the user did not click.
   */
  const exportable = useDiagramStore((s) => {
    if (menu === null) return false;
    if (!s.edges.some((e) => e.id === menu.edgeId && e.selected)) return false;
    return hasExportableSelection(s.nodes, s.edges);
  });
  const ref = useRef<HTMLDivElement>(null);
  // "open" for placement is the render condition itself (see NodeContextMenu)
  const shown = menu !== null && edge !== undefined ? menu : null;
  const position = usePopupPosition(ref, shown && { x: shown.clientX, y: shown.clientY });

  // Escape closing is new here — the hook aligns all popups on one contract
  useOutsideDismiss(ref, menu !== null, () => setEdgeMenu(null));
  const close = (): void => setEdgeMenu(null);
  // the menus' keyboard, every item one menu (#219). Only a
  // right-click opens it, and that leaves the focus where it was (as the
  // shape menu does): the keys work once the focus is in it
  const onKeyDown = useMenuKeys(ref, false, { onEscape: close });

  if (!shown || !edge) return null;
  const store = useDiagramStore.getState();

  return (
    <div
      ref={ref}
      // the shared export group carries `role="menuitem"`, which ARIA expects a
      // menu to own (#139)
      role="menu"
      aria-label="Edge actions"
      // nodelete: Backspace on a focused item must not delete the selection (#219)
      className="nodelete fixed z-50 w-48 rounded-lg bg-surface p-1.5 shadow-popover ring-1 ring-line"
      style={position}
      onKeyDown={onKeyDown}
    >
      <div className="flex flex-wrap gap-1 px-2 py-1.5">
        <button
          type="button"
          role="menuitem"
          title="Default color"
          aria-label="Default color"
          onClick={() => {
            store.updateEdgeData(edge.id, { color: undefined });
            close();
          }}
          className="h-5 w-5 rounded-full"
          style={swatchStyle(undefined, false)}
        />
        {PALETTE_COLORS.map((color: PaletteColor) => (
          <button
            key={color}
            type="button"
            role="menuitem"
            title={color}
            aria-label={`Color ${color}`}
            onClick={() => {
              store.updateEdgeData(edge.id, { color });
              close();
            }}
            className="h-5 w-5 rounded-full"
            style={swatchStyle(color, false)}
          />
        ))}
      </div>
      <div className="flex gap-1 px-2 pb-1.5">
        {PATH_STYLES.map((ps) => (
          <button
            key={ps.id}
            type="button"
            role="menuitemradio"
            aria-checked={(edge.data?.pathStyle ?? "orthogonal") === ps.id}
            onClick={() => {
              store.updateEdgeData(edge.id, { pathStyle: ps.id });
              close();
            }}
            className={`flex-1 rounded-md px-1 py-1 text-[11px] font-medium ${
              (edge.data?.pathStyle ?? "orthogonal") === ps.id
                ? ACCENT_SURFACE
                : `bg-frame ${TEXT_MUTED} hover:bg-selected hover:text-muted-strong`
            }`}
          >
            {ps.label}
          </button>
        ))}
      </div>
      <div className="my-1 h-px bg-line" />
      <MenuButton
        onClick={() => {
          setEdgeLabelEdit({ edgeId: edge.id, which: "center" });
          close();
        }}
      >
        Edit label
      </MenuButton>
      <MenuButton
        onClick={() => {
          store.reverseEdge(edge.id);
          close();
        }}
      >
        Reverse direction
      </MenuButton>
      <MenuButton
        onClick={() => {
          // the same as the edit bar's Reset path (#204)
          store.updateEdgeData(edge.id, {
            waypoints: undefined,
            labelT: undefined,
            selfLoopWidth: undefined,
          });
          close();
        }}
      >
        Reset path
      </MenuButton>
      <div className="my-1 h-px bg-line" />
      <MenuButton
        onClick={() => {
          setCopiedStyle(pickEdgeStyle(edge.data ?? {}));
          close();
        }}
      >
        Copy style
      </MenuButton>
      {copiedStyle ? (
        <MenuButton
          onClick={() => {
            store.updateEdgeData(edge.id, copiedStyle);
            close();
          }}
        >
          Paste style
        </MenuButton>
      ) : null}
      <div className="my-1 h-px bg-line" />
      <MenuButton
        danger
        onClick={() => {
          store.deleteElements([], [edge.id]);
          close();
        }}
      >
        Delete
      </MenuButton>
      {exportable ? (
        <>
          <div className="my-1 h-px bg-line" />
          <ExportSelectionItems onDone={close} />
        </>
      ) : null}
    </div>
  );
};
