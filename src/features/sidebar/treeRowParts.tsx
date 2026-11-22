import { DiagramGlyph, FolderGlyph } from "../../shared/ui/KindGlyph";
import { ProjectBadge } from "../../shared/ui/ProjectBadge";

import type { TreeNode } from "./treeModel";

/** the name a tree row shows — an open diagram's live title (D8) */
export const shownName = (node: TreeNode): string =>
  node.kind === "diagram" ? node.title : node.folder.name;

/**
 * A tree row's glyph (#229 D6, #236 D2·D3): a project's badge — greyed for
 * a project not found (#253 R7) — a folder's Folder (FolderOpen while
 * unfolded), a diagram's mark — coloured by kind, selected or not.
 */
export const NodeGlyph = ({
  node,
  open = false,
  greyed = false,
}: {
  node: TreeNode;
  open?: boolean;
  greyed?: boolean;
}) =>
  node.kind === "diagram" ? (
    <DiagramGlyph />
  ) : node.kind === "folder" ? (
    <FolderGlyph open={open} />
  ) : (
    <ProjectBadge id={node.folder.id} name={node.folder.name} greyed={greyed} />
  );
