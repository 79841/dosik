import { ChevronRight } from "lucide-react";

import { indentClass } from "../library/libraryParts";

import type { TreeNode } from "./treeModel";
import { NodeGlyph, shownName } from "./treeRowParts";

/**
 * Where a dragged row would land (#260 R2, canvas `Sidebar-Drag` ①·④): the
 * row itself at 40%, at the spot's depth — its chevron (folded), glyph, name
 * and count; no fill, no `…`. Drawn over the list at its worked-out place
 * `top`, so it jumps from slot to slot while the rows glide out of its way.
 * Not a tree item: screen readers hear the move from the tree.
 */
export const TreePreviewRow = ({
  node,
  level,
  top,
}: {
  node: TreeNode;
  level: number;
  top: number;
}) => {
  const count = node.kind !== "diagram" && node.count > 0 ? node.count : null;
  return (
    <li
      data-drop-preview=""
      aria-hidden="true"
      style={{ top }}
      className="pointer-events-none absolute left-0 min-w-full"
    >
      <div
        className={`flex h-[30px] items-center gap-1 whitespace-nowrap rounded-[5px] pr-2 text-[13px] font-medium text-ink opacity-40 ${indentClass(level)}`}
      >
        {node.kind !== "diagram" && node.expandable ? (
          <span className="flex h-3.5 w-3.5 flex-none items-center justify-center text-icon">
            <ChevronRight size={14} strokeWidth={2} />
          </span>
        ) : (
          <span className="w-3.5 flex-none" />
        )}
        <NodeGlyph node={node} />
        <span className="ml-0.5 flex-[1_0_auto]">{shownName(node)}</span>
        {count !== null ? (
          <span className="flex-none pl-3 text-[12px] font-medium text-muted-strong">{count}</span>
        ) : null}
      </div>
    </li>
  );
};
