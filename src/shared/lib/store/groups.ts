import type { NodeChange } from "@xyflow/react";
import { nanoid } from "nanoid";

import { nodeBounds } from "../edgeUtils";
import type { DiagramNode } from "../types";

/**
 * Groups (#171): shapes bound together by a shared `data.groupId`. One level
 * only — grouping shapes that already belong to groups merges
 * them into one, and ungrouping releases every member.
 *
 * A group of fewer than two shapes is no group: deleting all but one member
 * leaves a stray id that every rule here ignores, and the file loader drops.
 */

/** a new group id */
export const newGroupId = (): string => `g-${nanoid(8)}`;

/** the members of each group with two or more of them */
export const liveGroups = (nodes: DiagramNode[]): Map<string, string[]> => {
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const g = n.data.groupId;
    if (!g) continue;
    groups.set(g, [...(groups.get(g) ?? []), n.id]);
  }
  for (const [g, ids] of groups) if (ids.length < 2) groups.delete(g);
  return groups;
};

/** the shapes of `ids` that can be grouped — a free arrow's endpoint is not a shape */
const groupable = (nodes: DiagramNode[], ids: readonly string[]): DiagramNode[] => {
  const wanted = new Set(ids);
  return nodes.filter((n) => wanted.has(n.id) && n.data.shape !== "anchor");
};

/**
 * `ids` bound into one group, with every group they already touch folded in
 * (no nesting). `null` when fewer than two shapes would be in it.
 */
export const groupNodes = (
  nodes: DiagramNode[],
  ids: readonly string[],
  id: string = newGroupId(),
): DiagramNode[] | null => {
  const picked = groupable(nodes, ids);
  const touched = new Set(picked.map((n) => n.data.groupId).filter(Boolean));
  const members = new Set(picked.map((n) => n.id));
  for (const n of nodes) if (n.data.groupId && touched.has(n.data.groupId)) members.add(n.id);
  if (members.size < 2) return null;
  return nodes.map((n) => (members.has(n.id) ? { ...n, data: { ...n.data, groupId: id } } : n));
};

/** every group touched by `ids` released — `null` when none is */
export const ungroupNodes = (
  nodes: DiagramNode[],
  ids: readonly string[],
): DiagramNode[] | null => {
  const touched = new Set(
    groupable(nodes, ids)
      .map((n) => n.data.groupId)
      .filter(Boolean),
  );
  if (touched.size === 0) return null;
  return nodes.map((n) => {
    if (!n.data.groupId || !touched.has(n.data.groupId)) return n;
    const { groupId: _released, ...data } = n.data;
    return { ...n, data };
  });
};

/** the live, not-stepped-into groups that `changes` select or deselect a member of */
const touchedGroups = (
  changes: NodeChange<DiagramNode>[],
  nodes: DiagramNode[],
  entered: string | null,
): { groups: Map<string, string[]>; verdict: Map<string, boolean> } => {
  const groups = liveGroups(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const verdict = new Map<string, boolean>();
  for (const c of changes) {
    if (c.type !== "select") continue;
    const g = byId.get(c.id)?.data.groupId;
    if (!g || g === entered || !groups.has(g)) continue;
    // picking any member picks the group; otherwise a member let go lets it go
    if (c.selected) verdict.set(g, true);
    else if (!verdict.has(g)) verdict.set(g, false);
  }
  return { groups, verdict };
};

/** `changes` with every select change on a ruled group's member replaced by one for all members */
const ruleGroups = (
  changes: NodeChange<DiagramNode>[],
  groups: Map<string, string[]>,
  verdict: Map<string, boolean>,
): NodeChange<DiagramNode>[] => {
  if (verdict.size === 0) return changes;
  const ruled = new Set([...verdict.keys()].flatMap((g) => groups.get(g) ?? []));
  return [
    ...changes.filter((c) => !(c.type === "select" && ruled.has(c.id))),
    // explicit for every member — React Flow re-reads only what a change names
    ...[...verdict].flatMap(([g, on]) =>
      (groups.get(g) ?? []).map(
        (id): NodeChange<DiagramNode> => ({ type: "select", id, selected: on }),
      ),
    ),
  ];
};

/**
 * A group is selected or not as a whole (#171) — unless it is the group the
 * user has stepped into (`entered`), where shapes are picked one by one.
 * Picking a member picks the group; letting one go (⌘-click) lets the group
 * go, rather than leaving it half selected (#171).
 */
export const withGroupSelection = (
  changes: NodeChange<DiagramNode>[],
  nodes: DiagramNode[],
  entered: string | null,
): NodeChange<DiagramNode>[] => {
  const { groups, verdict } = touchedGroups(changes, nodes, entered);
  return ruleGroups(changes, groups, verdict);
};

/**
 * The same, for a selection box: React Flow sends only what changed in the
 * set of shapes the box touches, so a box that grows past a group and on to
 * another shape lets the group go member by member (#171). The box
 * decides instead: a group it touches anywhere is selected, whole.
 */
export const withBoxGroupSelection = (
  changes: NodeChange<DiagramNode>[],
  nodes: DiagramNode[],
  entered: string | null,
  box: { x: number; y: number; width: number; height: number },
): NodeChange<DiagramNode>[] => {
  const { groups, verdict } = touchedGroups(changes, nodes, entered);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const touches = (id: string) => {
    const n = byId.get(id);
    if (!n) return false;
    const b = nodeBounds(n);
    return (
      b.x < box.x + box.width &&
      b.x + b.width > box.x &&
      b.y < box.y + box.height &&
      b.y + b.height > box.y
    );
  };
  for (const g of verdict.keys()) verdict.set(g, (groups.get(g) ?? []).some(touches));
  return ruleGroups(changes, groups, verdict);
};

/** group ids made fresh — a pasted copy is a group of its own, not part of the original */
export const remapGroupIds = (nodes: DiagramNode[]): DiagramNode[] => {
  const fresh = new Map<string, string>();
  return nodes.map((n) => {
    const g = n.data.groupId;
    if (!g) return n;
    if (!fresh.has(g)) fresh.set(g, newGroupId());
    return { ...n, data: { ...n.data, groupId: fresh.get(g)! } };
  });
};

/** a group id left with a single member, or none, removed — what the file loader keeps */
export const dropLoneGroupIds = (nodes: DiagramNode[]): DiagramNode[] => {
  const groups = liveGroups(nodes);
  if (!nodes.some((n) => n.data.groupId && !groups.has(n.data.groupId))) return nodes;
  return nodes.map((n) => {
    if (!n.data.groupId || groups.has(n.data.groupId)) return n;
    const { groupId: _lone, ...data } = n.data;
    return { ...n, data };
  });
};

/** the picked shapes — what grouping acts on */
const pickedShapes = (nodes: DiagramNode[]) =>
  nodes.filter((n) => n.selected && n.data.shape !== "anchor");

/**
 * Whether Group has something to do: two or more picked shapes that are not
 * all of one group already.
 */
export const canGroup = (nodes: DiagramNode[]): boolean => {
  const picked = pickedShapes(nodes);
  if (picked.length < 2) return false;
  const g = picked[0]!.data.groupId;
  const groups = liveGroups(nodes);
  // all of one group — the whole of it or part: grouping folds the rest in,
  // so the result is that same group (#173)
  const isOneGroup = g !== undefined && groups.has(g) && picked.every((n) => n.data.groupId === g);
  return !isOneGroup;
};

/** whether Ungroup has something to do: a picked shape belongs to a group */
export const canUngroup = (nodes: DiagramNode[]): boolean => {
  const groups = liveGroups(nodes);
  return pickedShapes(nodes).some((n) => n.data.groupId && groups.has(n.data.groupId));
};

/** how far a group's outline stands off its members, in diagram px */
export const GROUP_OUTLINE_PAD = 6;

/**
 * The dashed boxes to draw (#171 D7): around a group selected whole, and,
 * fainter, around the group stepped into while one of its shapes is picked.
 */
export const groupOutlineBoxes = (
  nodes: DiagramNode[],
  entered: string | null,
): { id: string; x: number; y: number; w: number; h: number; inside: boolean }[] => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: { id: string; x: number; y: number; w: number; h: number; inside: boolean }[] = [];
  for (const [g, ids] of liveGroups(nodes)) {
    const members = ids.map((id) => byId.get(id)!);
    const inside = g === entered;
    const shown = inside ? members.some((n) => n.selected) : members.every((n) => n.selected);
    if (!shown) continue;
    const rects = members.map(nodeBounds);
    const x = Math.min(...rects.map((r) => r.x)) - GROUP_OUTLINE_PAD;
    const y = Math.min(...rects.map((r) => r.y)) - GROUP_OUTLINE_PAD;
    const right = Math.max(...rects.map((r) => r.x + r.width)) + GROUP_OUTLINE_PAD;
    const bottom = Math.max(...rects.map((r) => r.y + r.height)) + GROUP_OUTLINE_PAD;
    out.push({ id: g, x, y, w: right - x, h: bottom - y, inside });
  }
  return out;
};
