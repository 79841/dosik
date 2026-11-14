import { createPortal } from "react-dom";

import { DiagramGlyph, FolderGlyph } from "../../shared/ui/KindGlyph";

import type { TreeNode } from "./treeModel";

/** the lifted row sits this far right of and below the pointer (canvas `Hybrid-Project-Cards`) */
const LIFT_OFFSET = { x: 8, y: 10 } as const;

/**
 * The lifted row that follows the pointer while a tree row is dragged
 * (#230 D9, canvas `Hybrid-Project-Cards` · `Sidebar-States` ④): 26 tall,
 * surface, lifted shadow, the row's glyph (16, coloured — #236) and name — a
 * project's name alone.
 * Drawn on the body, over every floating panel (the peek, menus), and out of
 * the pointer's way; screen readers hear the move from the tree instead.
 */
export const TreeDragLayer = ({ node, at }: { node: TreeNode; at: { x: number; y: number } }) =>
  createPortal(
    <div
      data-drag-row=""
      aria-hidden="true"
      style={{ left: at.x + LIFT_OFFSET.x, top: at.y + LIFT_OFFSET.y }}
      className="pointer-events-none fixed z-[60] flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-md bg-surface pl-2 pr-2.5 text-[12px] font-medium text-ink shadow-lifted"
    >
      {node.kind === "diagram" ? <DiagramGlyph /> : node.kind === "folder" ? <FolderGlyph /> : null}
      <span>{node.kind === "diagram" ? node.title : node.folder.name}</span>
    </div>,
    document.body,
  );
