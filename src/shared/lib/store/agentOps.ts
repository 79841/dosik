import {
  effectiveMarkerEnd,
  effectiveMarkerStart,
  newEdgeMarkerEnd,
  newMessageMarkerEnd,
  lifelineAttachRange,
  lifelineLineRange,
  messageHandles,
  mixedMessageHandle,
  pruneSpentWaypoints,
  SELF_MESSAGE_GAP,
} from "../edgeUtils";
import {
  classNodeHeight,
  classNodeWidth,
  sanitizeClassMembers,
  sanitizeStereotype,
} from "../classShape";
import { entityNodeHeight, entityNodeWidth, sanitizeEntityColumns } from "../entityShape";
import { DECOR_SHAPES, fitDecorToShape, keepsIcon, takesBadge, takesDecor } from "../nodeDecor";
import { BACKDROP_STYLE, DEFAULT_NODE_SIZE, isBackdrop } from "../palette";
import { DEFAULT_ICON } from "../iconIds";
import { elidedSrc, imageSrcError, isElidedSrc } from "../imageData";
import type { DiagramEdge, DiagramNode } from "../types";
import { FRAGMENT_KINDS } from "../types";
import { makeEdge, normalizeEdge } from "./edgeFactory";
import {
  createShapeNode,
  DEFAULT_SHAPE,
  NEW_SHAPE_FALLBACK,
  normalizeNode,
  pickHandles,
  pruneOrphanAnchors,
  sizeAfterShapeChange,
} from "./nodeFactory";
import {
  activationsError,
  edgeStyleErrors,
  nodeFieldErrors,
  sanitizeActivations,
  sanitizeBranches,
  sanitizeFragmentKind,
  sanitizeZ,
  visibleDestroyY,
} from "./opValidation";
import { docErrors, isDiagramDocShape, isMultiPage } from "./document";
import { LAYOUT_DIRECTIONS, NOT_LAID_OUT } from "../autoLayout";
import { groupNodes, liveGroups } from "./groups";
import { bothEnds, placeEnds } from "../placeEnds";
import { applyLayout, layoutPositions } from "./layout";
import { revealRequestFor } from "./reveal";
import type { DiagramState, StoreGet, StoreSet } from "./state";

/**
 * Levels every message in the document. Used after a wholesale replacement
 * (set_diagram / file load), where handles come from outside and may encode a
 * tilted message. A no-op for already-level documents.
 */
export const resnapAllMessages = (get: StoreGet): void => {
  const lifelines = get()
    .nodes.filter((n) => n.data.shape === "lifeline")
    .map((n) => n.id);
  if (lifelines.length > 0) get().resnapMessages(lifelines);
};

/**
 * The diagram an agent sent (set_diagram's document), checked against the
 * nodes it replaces. Unlike a file load, which silently drops corrupt
 * leftovers, the bridge has a caller to tell.
 *
 * Pictures: a placeholder read through get_diagram — or no `src` at all — on
 * an image that has a picture takes that picture back. An agent cannot make a
 * picture, so dropping one is never what it meant, and it would reach disk
 * with the autosave behind an `errors: []` (#155). Anything else
 * unusable is an error, as add_node would make it.
 */
const agentDoc = (
  doc: { nodes: DiagramNode[]; edges: DiagramEdge[] },
  current: DiagramNode[],
): { errors: string[]; nodes: DiagramNode[] } => {
  const pictures = new Map(current.map((n) => [n.id, n.data.src]));
  const nodes = doc.nodes.map((n) => {
    const kept = pictures.get(n.id);
    if (n.data.shape !== "image" || kept === undefined) return n;
    return isElidedSrc(n.data.src) || n.data.src === undefined
      ? { ...n, data: { ...n.data, src: kept } }
      : n;
  });
  const errors = nodes.flatMap((n, i) => {
    if (n.data.shape !== "image" || n.data.src === undefined) return [];
    const error = imageSrcError(n.data.src);
    return error ? [`nodes[${i}] ${error}`] : [];
  });
  // a backdrop endpoint (fragment, frame) never renders
  const frames = new Set(nodes.filter((n) => isBackdrop(n.data.shape)).map((n) => n.id));
  if (doc.edges.some((e) => frames.has(e?.source) || frames.has(e?.target))) {
    errors.push("fragments and frames cannot be edge endpoints");
  }
  return { errors, nodes };
};

/** the page ops, gone with the pages (#229 D15): refused with the reason, not "unknown op" */
export const REMOVED_PAGE_OPS: ReadonlySet<string> = new Set([
  "add_page",
  "switch_page",
  "rename_page",
  "delete_page",
]);

/**
 * Why an op stops the batch, or null: the ops after a page op or a
 * `new_diagram` were meant for another page or diagram, and must not land on
 * this one (#229 D15). `new_diagram` is the bridge's alone — it splits the
 * batch before the store sees it (`features/agent/bridgeBatch`); a chat turn
 * or the headless CLI edits one diagram.
 */
const batchStopper = (op: string): string | null => {
  if (REMOVED_PAGE_OPS.has(op)) {
    return `${op}: pages were removed — a diagram is one canvas. Use new_diagram to start another diagram.`;
  }
  if (op === "new_diagram") {
    return "new_diagram: only POST /api/ops can start a new diagram — this edits one diagram";
  }
  return null;
};

/** the second line of a stopped batch: how much of it was left unapplied */
export const notAppliedAfter = (op: string, n: number): string =>
  `${op}: the ${n} op${n === 1 ? "" : "s"} after it ${n === 1 ? "was" : "were"} not applied`;

const NOT_APPLIED_AFTER = /^[a-z_]+: the (\d+) ops? after it (?:was|were) not applied$/;

/** how many ops a `notAppliedAfter` line left unapplied — `null` for any other error */
export const notAppliedCount = (line: string): number | null => {
  const match = NOT_APPLIED_AFTER.exec(line);
  return match ? Number(match[1]) : null;
};

/**
 * A batch's errors as a person is told them: the ops that failed, and how
 * many a stop left unapplied — a `notAppliedAfter` line is no failure of its
 * own (the headless report and the chat's activity line, #229)
 */
export const tallyErrors = (errors: readonly string[]): { failed: number; skipped: number } => {
  let failed = 0;
  let skipped = 0;
  for (const error of errors) {
    const left = notAppliedCount(error);
    if (left === null) failed += 1;
    else skipped += left;
  }
  return { failed, skipped };
};

/**
 * The applyOps action, extracted whole: validates then applies each op in
 * order, collecting per-op errors instead of aborting the batch.
 */
export const createApplyOps =
  (set: StoreSet, get: StoreGet): DiagramState["applyOps"] =>
  (ops, fromAgent = false) => {
    const errors: string[] = [];
    let applied = 0;
    // The batch is one undo step. The history as it was before the batch
    // opened its step: a batch that changed nothing takes the step back out
    // and restores both stacks — `commit` also clears the redo stack and, at
    // the history limit, drops the oldest step (#167)
    const opened = { past: get().past, future: get().future };
    get().commit();
    // only the step this batch opened may be taken back out. By identity: at
    // the history limit a push leaves the length unchanged
    const openedStep = get().past.at(-1);
    const touchedNow: string[] = [];
    // a wholesale swap (clear / set_diagram) asks the viewport to follow — but
    // from what the *batch* ends with, not what the op left: `clear` followed
    // by `add_node` in one batch should land on the added node, not the origin.
    // Undo does not bring the viewport back: a `clear` far from the origin,
    // undone, restores the nodes where they were while the view stays at the
    // origin. Pan/zoom is not undo state anywhere in this app.
    let swapped = false;

    // A run of add_edge ops is placed as one (#204 D6–D8): ends that share a
    // gap are spread together, in order, instead of each new one squeezing in
    // beside the last. The run ends at any other op — one that reads or moves
    // edges — and with the batch.
    let unplaced: string[] = [];
    const placeRun = () => {
      if (unplaced.length === 0) return;
      const { nodes, edges } = get();
      set({ edges: placeEnds(nodes, edges, bothEnds(unplaced)) });
      unplaced = [];
    };

    for (const [at, op] of ops.entries()) {
      if (op.op !== "add_edge") placeRun();
      const stop = batchStopper((op as { op?: unknown }).op as string);
      if (stop) {
        errors.push(stop);
        const left = ops.length - at - 1;
        if (left > 0) errors.push(notAppliedAfter(op.op, left));
        break;
      }
      const { nodes, edges } = get();
      switch (op.op) {
        case "add_node": {
          if (!op.node || typeof op.node !== "object") {
            errors.push("add_node: node object is required");
            break;
          }
          const fieldErrors = nodeFieldErrors(op.node, { requireLabel: true });
          if (fieldErrors.length > 0) {
            errors.push(...fieldErrors.map((e) => `add_node: ${e}`));
            break;
          }
          if (op.node.id && nodes.some((n) => n.id === op.node.id)) {
            errors.push(`add_node: id '${op.node.id}' already exists`);
            break;
          }
          // an icon id on a non-icon shape would be dropped by normalizeNode on
          // reload — reject rather than accept a field that quietly disappears
          const addShape = op.node.shape ?? DEFAULT_SHAPE;
          if (op.node.icon !== undefined && !keepsIcon(addShape)) {
            errors.push('add_node: icon is only valid with shape "icon" or a box shape');
            break;
          }
          if (op.node.badge !== undefined && !takesBadge(addShape)) {
            errors.push(
              `add_node: badge is only valid on box shapes (${DECOR_SHAPES.join("|")}) and frames`,
            );
            break;
          }
          if (op.node.description !== undefined && !takesDecor(addShape)) {
            errors.push(
              `add_node: description is only valid on box shapes (${DECOR_SHAPES.join("|")})`,
            );
            break;
          }
          // the picture is the node — an image without one would be an empty frame
          if (op.node.shape === "image" && op.node.src === undefined) {
            errors.push("add_node: an image needs src (a base64 data URL)");
            break;
          }
          if (op.node.src !== undefined && op.node.shape !== "image") {
            errors.push('add_node: src is only valid with shape "image"');
            break;
          }
          if (op.node.columns !== undefined && op.node.shape !== "entity") {
            errors.push('add_node: columns is only valid with shape "entity"');
            break;
          }
          const node = createShapeNode(
            op.node.shape ?? DEFAULT_SHAPE,
            { x: op.node.x ?? 0, y: op.node.y ?? 0 },
            {
              id: op.node.id,
              label: op.node.label,
              color: op.node.color,
              width: op.node.width,
              height: op.node.height,
              icon: op.node.icon,
              badge: op.node.badge,
              description: op.node.description,
              src: op.node.src,
              columns: op.node.columns,
            },
          );
          set({ nodes: [...nodes, node] });
          touchedNow.push(node.id);
          applied += 1;
          break;
        }
        case "update_node": {
          const node = nodes.find((n) => n.id === op.id);
          if (!node) {
            errors.push(`update_node: no such id '${op.id}'`);
            break;
          }
          if (!op.set || typeof op.set !== "object") {
            errors.push("update_node: set object is required");
            break;
          }
          // a placeholder from get_diagram sent back on its own node means
          // "leave the picture as it is" (#155)
          // — only its *own* placeholder: another node's would be a silent no-op
          const changes =
            node.data.src !== undefined && op.set.src === elidedSrc(node.data.src)
              ? { ...op.set, src: undefined }
              : op.set;
          const fieldErrors = nodeFieldErrors(changes, { requireLabel: false, allowClear: true });
          if (fieldErrors.length > 0) {
            errors.push(...fieldErrors.map((e) => `update_node: ${e}`));
            break;
          }
          const { x, y, width, height, label, shape, color, activations, destroyY } = changes;
          const { fragmentKind, branches, z, icon, src, columns, badge, description } = changes;
          const { stereotype, isAbstract, attributes, methods } = changes;
          const nextShape = shape ?? node.data.shape;
          // a group is made and undone whole, not one member at a time (#171)
          if ("groupId" in changes) {
            errors.push("update_node: groupId is set with the group and ungroup ops");
            break;
          }
          if (icon !== undefined && !keepsIcon(nextShape)) {
            errors.push('update_node: icon is only valid on shape "icon" nodes and box shapes');
            break;
          }
          if (icon === "" && nextShape === "icon") {
            errors.push(
              'update_node: an icon node needs its glyph — "" only removes a box\'s icon',
            );
            break;
          }
          if (badge !== undefined && !takesBadge(nextShape)) {
            errors.push(
              `update_node: badge is only valid on box shapes (${DECOR_SHAPES.join("|")}) and frames`,
            );
            break;
          }
          if (description !== undefined && !takesDecor(nextShape)) {
            errors.push(
              `update_node: description is only valid on box shapes (${DECOR_SHAPES.join("|")})`,
            );
            break;
          }
          if (columns !== undefined && nextShape !== "entity") {
            errors.push('update_node: columns is only valid on shape "entity" nodes');
            break;
          }
          if (src !== undefined && nextShape !== "image") {
            errors.push('update_node: src is only valid on shape "image" nodes');
            break;
          }
          if (nextShape === "image" && (src ?? node.data.src) === undefined) {
            errors.push("update_node: an image needs src (a base64 data URL)");
            break;
          }
          // a frame is an area, not a box: it is never another shape's next
          // shape, nor turned into one (#170 D8)
          if (shape !== undefined && (shape === "frame") !== (node.data.shape === "frame")) {
            errors.push(
              "update_node: a frame cannot change shape, and no shape can become a frame",
            );
            break;
          }
          // same reason as add_edge: a connected node turned into a handle-less
          // frame would strand its edges — visible in the file, gone on canvas
          if (
            shape === "fragment" &&
            node.data.shape !== "fragment" &&
            edges.some((e) => e.source === op.id || e.target === op.id)
          ) {
            errors.push("update_node: cannot turn a connected node into a fragment frame");
            break;
          }
          if ((fragmentKind !== undefined || branches !== undefined) && nextShape !== "fragment") {
            errors.push("update_node: fragmentKind/branches are only valid on fragment nodes");
            break;
          }
          const nextKind = fragmentKind !== undefined ? sanitizeFragmentKind(fragmentKind) : null;
          if (fragmentKind !== undefined && nextKind === null) {
            errors.push(`update_node: fragmentKind must be one of ${FRAGMENT_KINDS.join("|")}`);
            break;
          }
          const nextBranches = branches !== undefined ? sanitizeBranches(branches) : null;
          if (branches !== undefined && nextBranches === null) {
            errors.push("update_node: branches must be a finite number");
            break;
          }
          const nextZ = z !== undefined ? sanitizeZ(z) : null;
          if (z !== undefined && nextZ === null) {
            errors.push("update_node: z must be a finite number");
            break;
          }
          // class fields would be dropped by normalizeNode on reload — reject
          // rather than accept a change that quietly disappears
          const classField =
            stereotype !== undefined ||
            isAbstract !== undefined ||
            attributes !== undefined ||
            methods !== undefined;
          if (classField && nextShape !== "class") {
            errors.push(
              "update_node: stereotype/isAbstract/attributes/methods are only valid on class nodes",
            );
            break;
          }
          // every entry must be a string. `[42]` used to slip through (it *is*
          // an array) and then sanitize to undefined, silently wiping the
          // compartment — the opposite of this op's "no quiet loss" rule
          const badMembers = (value: unknown): boolean =>
            value !== undefined &&
            (!Array.isArray(value) || value.some((line) => typeof line !== "string"));
          if (badMembers(attributes) || badMembers(methods)) {
            errors.push("update_node: attributes/methods must be arrays of strings");
            break;
          }
          // activations only mean something on a lifeline; normalizeNode would
          // drop them on reload, so reject instead of accepting a silent loss
          if (activations !== undefined && (shape ?? node.data.shape) !== "lifeline") {
            errors.push("update_node: activations are only valid on lifeline nodes");
            break;
          }
          if (destroyY !== undefined && (shape ?? node.data.shape) !== "lifeline") {
            errors.push("update_node: destroyY is only valid on lifeline nodes");
            break;
          }
          // null clears the marker. a number must land on the line: the store
          // would keep an out-of-line value (lossless resize) but never draw it,
          // so reject here where the caller can actually see why
          const clearDestroy = destroyY === null;
          let nextDestroyY: number | null = null;
          if (destroyY !== undefined && !clearDestroy) {
            nextDestroyY = visibleDestroyY(
              destroyY,
              height ?? node.height ?? DEFAULT_NODE_SIZE.lifeline.height,
            );
            if (nextDestroyY === null) {
              errors.push("update_node: destroyY must be a finite y within the lifeline's line");
              break;
            }
          }
          const nextActivations =
            activations !== undefined ? sanitizeActivations(activations) : null;
          set({
            nodes: nodes.map((n) => {
              if (n.id !== op.id) return n;
              const data = {
                ...n.data,
                ...(label !== undefined ? { label } : {}),
                ...(shape !== undefined ? { shape } : {}),
                ...(color !== undefined ? { color } : {}),
                ...(nextActivations ? { activations: nextActivations } : {}),
                ...(nextDestroyY !== null ? { destroyY: nextDestroyY } : {}),
                ...(nextKind !== null ? { fragmentKind: nextKind } : {}),
                ...(nextBranches !== null ? { branches: nextBranches } : {}),
                ...(stereotype !== undefined ? { stereotype: sanitizeStereotype(stereotype) } : {}),
                ...(isAbstract !== undefined ? { isAbstract: isAbstract === true } : {}),
                ...(attributes !== undefined
                  ? { attributes: sanitizeClassMembers(attributes) }
                  : {}),
                ...(methods !== undefined ? { methods: sanitizeClassMembers(methods) } : {}),
                ...(icon !== undefined ? { icon } : {}),
                ...(badge !== undefined ? { badge } : {}),
                ...(description !== undefined ? { description } : {}),
                ...(src !== undefined ? { src } : {}),
                ...(columns !== undefined ? { columns: sanitizeEntityColumns(columns) } : {}),
              };
              // the rows belong to the entity shape (#5)
              if (data.shape !== "entity" || data.columns === undefined) delete data.columns;
              // the picture belongs to the image shape, like the glyph to the icon
              if (data.shape !== "image") delete data.src;
              // the glyph and the box decorations follow the shape (#9, #160)
              fitDecorToShape(data, DEFAULT_ICON);
              if (clearDestroy) delete data.destroyY;
              if (data.stereotype === undefined) delete data.stereotype;
              if (data.attributes === undefined) delete data.attributes;
              if (data.methods === undefined) delete data.methods;
              const { style: _staleStyle, ...keep } = n;
              // same rule as the inspector: entering or leaving the icon
              // footprint starts from the new shape's default size
              const base = sizeAfterShapeChange(n.data.shape, data.shape, n);
              return {
                ...keep,
                position: { x: x ?? n.position.x, y: y ?? n.position.y },
                width:
                  data.shape === "class"
                    ? classNodeWidth(data, width ?? base.width ?? 0)
                    : data.shape === "entity"
                      ? entityNodeWidth(data, width ?? base.width ?? 0)
                      : (width ?? base.width),
                // the box must not end up smaller than the members it now holds
                height:
                  data.shape === "class"
                    ? Math.max(height ?? base.height ?? 0, classNodeHeight(data))
                    : data.shape === "entity"
                      ? Math.max(height ?? base.height ?? 0, entityNodeHeight(data.columns))
                      : (height ?? base.height),
                ...(nextZ !== null ? { zIndex: nextZ } : {}),
                // style follows the shape — a fragment turned into a box must
                // not keep pointer-events:none (it would become unclickable),
                // and a box turned into a frame must gain it
                ...(isBackdrop(data.shape) ? { style: BACKDROP_STYLE } : {}),
                data,
              };
            }),
          });
          // moving/resizing a lifeline rescales its pct handles — restore the
          // messages' horizontality, matching the canvas drag/resize behavior.
          // an anchor move drags its found/lost message along the same way —
          // x too, since crossing the lifeline flips the handle side
          if (
            (node.data.shape === "lifeline" && (y !== undefined || height !== undefined)) ||
            (node.data.shape === "anchor" && (x !== undefined || y !== undefined))
          ) {
            get().resnapMessages([op.id]);
          }
          // moving/resizing an endpoint leaves slide waypoints at their old
          // absolute coords — same rule as a canvas drag (#69)
          if (x !== undefined || y !== undefined || width !== undefined || height !== undefined) {
            const state = get();
            const pruned = pruneSpentWaypoints(state.edges, state.nodes, new Set([op.id]));
            if (pruned !== state.edges) set({ edges: pruned });
          }
          touchedNow.push(op.id);
          applied += 1;
          break;
        }
        case "delete_node": {
          if (!nodes.some((n) => n.id === op.id)) {
            errors.push(`delete_node: no such id '${op.id}'`);
            break;
          }
          const remainingEdges = edges.filter((e) => e.source !== op.id && e.target !== op.id);
          set({
            nodes: pruneOrphanAnchors(
              nodes.filter((n) => n.id !== op.id),
              remainingEdges,
            ),
            edges: remainingEdges,
          });
          applied += 1;
          break;
        }
        case "add_edge": {
          if (!op.edge?.source || !op.edge?.target) {
            errors.push("add_edge: source/target are required");
            break;
          }
          if (
            !nodes.some((n) => n.id === op.edge.source) ||
            !nodes.some((n) => n.id === op.edge.target)
          ) {
            errors.push(`add_edge: unknown node '${op.edge.source}'→'${op.edge.target}'`);
            break;
          }
          if (op.edge.id && edges.some((e) => e.id === op.edge.id)) {
            errors.push(`add_edge: id '${op.edge.id}' already exists`);
            break;
          }
          // a backdrop (fragment, frame) has no handles — an edge touching it
          // would live in the document but never render (React Flow needs handles)
          if (
            [op.edge.source, op.edge.target].some((id) => {
              const shape = nodes.find((n) => n.id === id)?.data.shape;
              return shape !== undefined && isBackdrop(shape);
            })
          ) {
            errors.push("add_edge: fragments and frames cannot be edge endpoints");
            break;
          }
          const [styleErrors, patch] = edgeStyleErrors(op.edge);
          if (styleErrors.length > 0) {
            errors.push(...styleErrors.map((e) => `add_edge: ${e}`));
            break;
          }
          const source = nodes.find((n) => n.id === op.edge.source);
          const target = nodes.find((n) => n.id === op.edge.target);
          const handles = source && target ? pickHandles(source, target) : null;
          // a line between two lifelines is a message, as a canvas connection makes it (#210)
          const isMessage = source?.data.shape === "lifeline" && target?.data.shape === "lifeline";
          const edge = makeEdge(
            {
              id: op.edge.id,
              source: op.edge.source,
              target: op.edge.target,
              sourceHandle: handles?.sourceHandle,
              targetHandle: handles?.targetHandle,
            },
            {},
            {
              ...patch,
              markerEnd: isMessage ? newMessageMarkerEnd(patch) : newEdgeMarkerEnd(patch),
              markerStart: effectiveMarkerStart(patch),
            },
          );
          // nobody chose a spot on those sides — placed with the rest of its run
          set({ edges: [...edges, edge] });
          unplaced.push(edge.id);
          touchedNow.push(edge.id);
          applied += 1;
          break;
        }
        case "update_edge": {
          const edge = edges.find((e) => e.id === op.id);
          if (!edge) {
            errors.push(`update_edge: no such id '${op.id}'`);
            break;
          }
          if (!op.set || typeof op.set !== "object") {
            errors.push("update_edge: set object is required");
            break;
          }
          const [styleErrors, patch] = edgeStyleErrors(op.set);
          if (styleErrors.length > 0) {
            errors.push(...styleErrors.map((e) => `update_edge: ${e}`));
            break;
          }
          set({
            edges: edges.map((e) =>
              e.id === op.id
                ? {
                    ...e,
                    data: { variant: "solid", arrow: true, ...e.data, ...patch },
                  }
                : e,
            ),
          });
          touchedNow.push(op.id);
          applied += 1;
          break;
        }
        case "delete_edge": {
          if (!edges.some((e) => e.id === op.id)) {
            errors.push(`delete_edge: no such id '${op.id}'`);
            break;
          }
          const remaining = edges.filter((e) => e.id !== op.id);
          set({ edges: remaining, nodes: pruneOrphanAnchors(nodes, remaining) });
          applied += 1;
          break;
        }
        case "add_message": {
          if (!op.message || typeof op.message !== "object") {
            errors.push("add_message: message object is required");
            break;
          }
          const { from, to, y } = op.message;
          // any object is treated as point intent — a malformed one (missing x)
          // gets the point error, not a confusing "unknown lifeline '[object Object]'"
          const isPoint = (v: unknown): v is { x?: unknown } => typeof v === "object" && v !== null;
          // found/lost message: one end is a point → an anchor node is created there
          if (isPoint(from) || isPoint(to)) {
            if (isPoint(from) && isPoint(to)) {
              errors.push(
                "add_message: only one of from/to may be a point — use add_edge for free arrows",
              );
              break;
            }
            const pointX = isPoint(from) ? from.x : isPoint(to) ? to.x : undefined;
            if (typeof pointX !== "number" || !Number.isFinite(pointX)) {
              errors.push("add_message: point must have a finite x");
              break;
            }
            if (typeof y !== "number" || !Number.isFinite(y)) {
              errors.push("add_message: y must be a finite number");
              break;
            }
            const lifelineId = isPoint(from) ? to : from;
            if (typeof lifelineId !== "string") {
              errors.push("add_message: from/to must be lifeline ids or a point");
              break;
            }
            const lifeline = nodes.find((n) => n.id === lifelineId);
            if (!lifeline) {
              errors.push(`add_message: unknown lifeline '${lifelineId}'`);
              break;
            }
            if (lifeline.data.shape !== "lifeline") {
              errors.push("add_message: from/to must be lifeline nodes");
              break;
            }
            if (op.message.id && edges.some((e) => e.id === op.message.id)) {
              errors.push(`add_message: id '${op.message.id}' already exists`);
              break;
            }
            const [pStyleErrors, pPatch] = edgeStyleErrors({
              label: op.message.label,
              variant: op.message.variant,
              markerEnd: op.message.markerEnd,
            });
            if (pStyleErrors.length > 0) {
              errors.push(...pStyleErrors.map((e) => `add_message: ${e}`));
              break;
            }
            const range = lifelineAttachRange(lifeline);
            const clampedY = Math.min(Math.max(y, range.min), range.max);
            // anchor is 12x12; center it on the point at the (clamped) message y
            const anchor = createShapeNode("anchor", { x: pointX - 6, y: clampedY - 6 });
            const handle = mixedMessageHandle(lifeline, anchor);
            const edge = makeEdge(
              {
                id: op.message.id,
                source: isPoint(from) ? anchor.id : lifeline.id,
                target: isPoint(from) ? lifeline.id : anchor.id,
                sourceHandle: isPoint(from) ? "center" : handle,
                targetHandle: isPoint(from) ? handle : "center",
              },
              {},
              {
                ...pPatch,
                pathStyle: "straight",
                markerEnd: effectiveMarkerEnd(pPatch),
                markerStart: "none",
              },
            );
            set({ nodes: [...nodes, anchor], edges: [...edges, edge] });
            touchedNow.push(edge.id, anchor.id);
            applied += 1;
            break;
          }
          const source = nodes.find((n) => n.id === from);
          const target = nodes.find((n) => n.id === to);
          if (!source || !target) {
            errors.push(`add_message: unknown lifeline '${from}'→'${to}'`);
            break;
          }
          if (source.data.shape !== "lifeline" || target.data.shape !== "lifeline") {
            errors.push("add_message: from/to must be lifeline nodes");
            break;
          }
          if (typeof y !== "number" || !Number.isFinite(y)) {
            errors.push("add_message: y must be a finite number");
            break;
          }
          if (op.message.id && edges.some((e) => e.id === op.message.id)) {
            errors.push(`add_message: id '${op.message.id}' already exists`);
            break;
          }
          const [styleErrors, patch] = edgeStyleErrors({
            label: op.message.label,
            variant: op.message.variant,
            markerEnd: op.message.markerEnd,
          });
          if (styleErrors.length > 0) {
            errors.push(...styleErrors.map((e) => `add_message: ${e}`));
            break;
          }
          // the message must land on both lifelines' lines — reject a y with no overlap
          const sr = lifelineAttachRange(source);
          const tr = lifelineAttachRange(target);
          if (source.id !== target.id && (sr.min > tr.max || tr.min > sr.max)) {
            errors.push("add_message: lifelines' line ranges do not overlap vertically");
            break;
          }
          let clampedY: number;
          if (source.id === target.id) {
            // the loop needs room below y — clamping only to the line end would
            // squash it into a degenerate (spiky) path near the bottom
            if (sr.max - sr.min < SELF_MESSAGE_GAP) {
              // say which limit was hit — a destroy marker looks like a short
              // lifeline from here, and "too short" would send the caller to
              // resize a line that is already long enough
              const capped = lifelineLineRange(source).max > sr.max;
              errors.push(
                capped
                  ? `add_message: lifeline '${from}' has less than ${SELF_MESSAGE_GAP}px above its destroy marker`
                  : `add_message: lifeline '${from}' is too short for a self-message (needs ${SELF_MESSAGE_GAP}px of line)`,
              );
              break;
            }
            clampedY = Math.min(Math.max(y, sr.min), sr.max - SELF_MESSAGE_GAP);
          } else {
            clampedY = Math.min(Math.max(y, sr.min, tr.min), Math.min(sr.max, tr.max));
          }
          const edge = makeEdge(
            {
              id: op.message.id,
              source: source.id,
              target: target.id,
              ...messageHandles(source, target, clampedY),
            },
            {},
            {
              ...patch,
              pathStyle: "straight",
              markerEnd: effectiveMarkerEnd(patch),
              markerStart: "none",
            },
          );
          set({ edges: [...edges, edge] });
          touchedNow.push(edge.id);
          applied += 1;
          break;
        }
        case "add_activation": {
          const node = nodes.find((n) => n.id === op.lifeline);
          if (!node) {
            errors.push(`add_activation: no such id '${op.lifeline}'`);
            break;
          }
          if (node.data.shape !== "lifeline") {
            errors.push("add_activation: target must be a lifeline node");
            break;
          }
          const next = [...(node.data.activations ?? []), { y0: op.y0, y1: op.y1 }];
          const activationError = activationsError(next);
          if (activationError) {
            errors.push(`add_activation: ${activationError}`);
            break;
          }
          set({
            nodes: nodes.map((n) =>
              n.id === op.lifeline ? { ...n, data: { ...n.data, activations: next } } : n,
            ),
          });
          touchedNow.push(op.lifeline);
          applied += 1;
          break;
        }
        case "group": {
          if (
            !Array.isArray(op.ids) ||
            op.ids.length < 2 ||
            op.ids.some((id) => typeof id !== "string")
          ) {
            errors.push("group: ids must be an array of two or more node ids");
            break;
          }
          if (
            op.id !== undefined &&
            (typeof op.id !== "string" || op.id === "" || op.id.length > 64)
          ) {
            errors.push("group: id must be a non-empty string of at most 64 characters");
            break;
          }
          const unknown = op.ids.find((id) => !nodes.some((n) => n.id === id));
          if (unknown !== undefined) {
            errors.push(`group: unknown node '${unknown}'`);
            break;
          }
          if (op.ids.some((id) => nodes.find((n) => n.id === id)?.data.shape === "anchor")) {
            errors.push("group: an anchor (a free arrow's end) cannot be grouped");
            break;
          }
          // a live group of that id holding other shapes; a lone leftover id
          // (its partner deleted) is free to take (#171)
          const holders = op.id === undefined ? undefined : liveGroups(nodes).get(op.id);
          if (holders?.some((id) => !op.ids.includes(id))) {
            errors.push(
              `group: group '${op.id}' already exists — ungroup it first or use another id`,
            );
            break;
          }
          const grouped = groupNodes(nodes, op.ids, op.id);
          if (!grouped) {
            errors.push("group: needs two or more shapes");
            break;
          }
          set({ nodes: grouped });
          applied += 1;
          break;
        }
        case "ungroup": {
          // a lone leftover id is released too — it is no group, but an agent
          // reading data.groupId has no other way to clear it (#171)
          const members =
            typeof op.id === "string"
              ? nodes.filter((n) => n.data.groupId === op.id).map((n) => n.id)
              : [];
          if (members.length === 0) {
            errors.push(`ungroup: no group '${String(op.id)}'`);
            break;
          }
          set({
            nodes: nodes.map((n) => {
              if (!members.includes(n.id)) return n;
              const { groupId: _released, ...data } = n.data;
              return { ...n, data };
            }),
          });
          applied += 1;
          break;
        }
        case "layout": {
          const direction = op.direction ?? "TB";
          if (!LAYOUT_DIRECTIONS.includes(direction)) {
            errors.push("layout: direction must be TB, BT, LR or RL");
            break;
          }
          if (
            op.ids !== undefined &&
            (!Array.isArray(op.ids) || op.ids.some((id) => typeof id !== "string"))
          ) {
            errors.push("layout: ids must be an array of node ids");
            break;
          }
          const unknown = op.ids?.find((id) => !nodes.some((n) => n.id === id));
          if (unknown !== undefined) {
            errors.push(`layout: unknown node '${unknown}'`);
            break;
          }
          // asked to arrange a part that is never arranged: say so rather than
          // move the rest and report success (#154)
          const fixed = op.ids
            ?.map((id) => nodes.find((n) => n.id === id)!)
            .find((n) => NOT_LAID_OUT.includes(n.data.shape));
          if (fixed) {
            errors.push(
              `layout: '${fixed.id}' is a ${fixed.data.shape} — lifelines, fragments, frames and anchors keep their own layout`,
            );
            break;
          }
          const arrangement = layoutPositions(get, direction, op.ids);
          if (arrangement.positions.size < 2) {
            errors.push(
              "layout: needs two or more shapes to arrange (lifelines, fragments, frames and anchors are not arranged)",
            );
            break;
          }
          touchedNow.push(...applyLayout(get, set, arrangement));
          applied += 1;
          break;
        }
        case "set_title": {
          if (typeof op.title !== "string") {
            errors.push("set_title: title (string) is required");
            break;
          }
          set({ title: op.title });
          applied += 1;
          break;
        }
        case "clear": {
          set({ nodes: [], edges: [] });
          swapped = true;
          applied += 1;
          break;
        }
        case "set_diagram": {
          const doc = op.doc;
          if (isMultiPage(doc)) {
            errors.push(
              "set_diagram: a document with pages is not supported — a diagram is one canvas (send nodes and edges)",
            );
            break;
          }
          if (!isDiagramDocShape(doc)) {
            errors.push("set_diagram: doc needs nodes and edges arrays");
            break;
          }
          const shapeErrors = docErrors(doc);
          if (shapeErrors.length > 0) {
            errors.push(...shapeErrors.map((e) => `set_diagram: ${e}`));
            break;
          }
          // the whole diagram — title, nodes, edges — in this batch's one undo step
          const checked = agentDoc(doc, nodes);
          if (checked.errors.length > 0) {
            errors.push(...checked.errors.map((e) => `set_diagram: ${e}`));
            break;
          }
          // an agent's node with no shape or colour gets what add_node gives it
          const normalizedNodes = checked.nodes.map((n) => normalizeNode(n, NEW_SHAPE_FALLBACK));
          set({
            title: doc.title ?? get().title,
            nodes: normalizedNodes,
            edges: doc.edges.map((e) => normalizeEdge(e, normalizedNodes)),
            // same as loadDoc — a wholesale swap must not carry an id-keyed
            // edit request into the new document
            editRequestId: null,
            docVersion: get().docVersion + 1,
          });
          swapped = true;
          resnapAllMessages(get);
          touchedNow.push(...doc.nodes.map((n) => n.id));
          applied += 1;
          break;
        }
        default:
          errors.push(`unknown op: ${JSON.stringify(op)}`);
      }
    }

    placeRun();
    // a batch that changed nothing leaves no step behind
    if (applied === 0 && get().past.at(-1) === openedStep) {
      set({ past: opened.past, future: opened.future });
    }

    // the viewport follows the document, same as a file open (#81, #117)
    if (swapped) set({ revealRequest: revealRequestFor(get().nodes) });

    if (fromAgent && touchedNow.length > 0) {
      const now = Date.now();
      set((state) => ({
        touched: {
          ...state.touched,
          ...Object.fromEntries(touchedNow.map((id) => [id, now])),
        },
      }));
    }
    return { applied, errors };
  };
