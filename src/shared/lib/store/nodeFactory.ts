import { entityNodeHeight, entityNodeWidth, sanitizeEntityColumns } from "../entityShape";
import { imageSrcError, isImageOriginal } from "../imageData";
import { nanoid } from "nanoid";
import { resizeFloor } from "../resizeFloor";

import {
  classNodeHeight,
  classNodeWidth,
  sanitizeClassMembers,
  sanitizeStereotype,
} from "../classShape";
import {
  BACKDROP_STYLE,
  DEFAULT_NODE_SIZE,
  FRAGMENT_DEFAULT_Z,
  FRAME_DEFAULT_Z,
  isBackdrop,
  PALETTE_COLORS,
} from "../palette";
import { sanitizeBadge, sanitizeDescription, takesBadge, takesDecor } from "../nodeDecor";
import { DEFAULT_ICON, type IconId } from "../iconIds";
import type { DiagramEdge, DiagramNode, PaletteColor, ShapeKind } from "../types";
import {
  isOneOf,
  sanitizeActivations,
  sanitizeBranches,
  sanitizeDestroyY,
  sanitizeFragmentKind,
  sanitizeZ,
} from "./opValidation";

export const nodeCenter = (node: DiagramNode): { x: number; y: number } => {
  const size = DEFAULT_NODE_SIZE[node.data.shape];
  return {
    x: node.position.x + (node.width ?? size.width) / 2,
    y: node.position.y + (node.height ?? size.height) / 2,
  };
};

/**
 * Picks the side handles an edge should attach to, based on where the nodes
 * sit relative to each other. Computed once at edge creation so endpoints
 * stay fixed afterwards. Anchor nodes always attach at their center.
 */
export const pickHandles = (
  source: DiagramNode,
  target: DiagramNode,
): { sourceHandle: string; targetHandle: string } => {
  if (source.id === target.id) {
    if (source.data.shape === "lifeline") {
      // self-message: out the right side, back a little lower
      return { sourceHandle: "right-25", targetHandle: "right-40" };
    }
    // self loop: use perpendicular sides so the loop has room to arc
    const anchor = source.data.shape === "anchor";
    return {
      sourceHandle: anchor ? "center" : "right",
      targetHandle: anchor ? "center" : "top",
    };
  }
  const s = nodeCenter(source);
  const t = nodeCenter(target);
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  if (source.data.shape === "lifeline" && target.data.shape === "lifeline") {
    // message without a specified y: attach mid-line, facing each other
    return {
      sourceHandle: dx >= 0 ? "right-50" : "left-50",
      targetHandle: dx >= 0 ? "left-50" : "right-50",
    };
  }
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const sourceSide = horizontal ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top";
  const targetSide = horizontal ? (dx > 0 ? "left" : "right") : dy > 0 ? "top" : "bottom";
  return {
    sourceHandle: source.data.shape === "anchor" ? "center" : sourceSide,
    targetHandle: target.data.shape === "anchor" ? "center" : targetSide,
  };
};

/**
 * The size a node should have after its shape changes. Icons are a different
 * footprint (a glyph box plus a label line), so entering or leaving `icon`
 * starts from the new shape's default; every other change keeps the size the
 * user set — lifted to the new shape's resize floor, or the first resize would
 * jump (a 160×56 box turned lifeline stayed under its 120 height; #179).
 * Class and entity floors depend on their text and are applied by the callers.
 * Shared by the inspector and the bridge so the two cannot differ.
 */
export const sizeAfterShapeChange = (
  prev: ShapeKind,
  next: ShapeKind,
  current: { width?: number; height?: number },
): { width?: number; height?: number } => {
  if (prev === next) return current;
  if (prev === "icon" || next === "icon") return { ...DEFAULT_NODE_SIZE[next] };
  if (next === "class" || next === "entity") return current;
  const floor = resizeFloor({ label: "", shape: next, color: "mono" });
  return {
    width: current.width === undefined ? undefined : Math.max(current.width, floor.width),
    height: current.height === undefined ? undefined : Math.max(current.height, floor.height),
  };
};

/** Removes anchor nodes that no longer have any edge attached. */
export const pruneOrphanAnchors = (nodes: DiagramNode[], edges: DiagramEdge[]): DiagramNode[] => {
  const referenced = new Set(edges.flatMap((e) => [e.source, e.target]));
  return nodes.filter((n) => n.data.shape !== "anchor" || referenced.has(n.id));
};

/** what a new shape is when nothing says otherwise — square and black/white (#158) */
export const DEFAULT_SHAPE: ShapeKind = "rect";
export const DEFAULT_COLOR: PaletteColor = "mono";
/** what a node becomes when its shape or colour is missing (or not a colour) */
export interface NodeFallback {
  shape: ShapeKind;
  color: PaletteColor;
}
/**
 * A file that says nothing means the defaults of the builds that wrote it, so
 * old files open looking as they did — new defaults are for new shapes (#158 D5).
 */
export const FILE_FALLBACK: NodeFallback = { shape: "rounded", color: "violet" };
/**
 * An agent's `set_diagram` that says nothing means what `add_node` would make:
 * it is drawing now, from the same instructions (#158).
 */
export const NEW_SHAPE_FALLBACK: NodeFallback = { shape: DEFAULT_SHAPE, color: DEFAULT_COLOR };

export const createShapeNode = (
  shape: ShapeKind,
  position: { x: number; y: number },
  options: {
    id?: string;
    label?: string;
    color?: PaletteColor;
    width?: number;
    height?: number;
    /** the glyph of an icon node (defaults to DEFAULT_ICON), or a box's icon */
    icon?: IconId;
    /** box shapes only (#160) */
    badge?: string;
    description?: string;
    /** shape "image" only — the caller has validated it (imageData.ts) */
    src?: string;
    /** shape "image" only — the file the picture came from (`isImageOriginal`) */
    original?: string;
    /** shape "entity" only — raw column lines, cleaned here */
    columns?: string[];
  } = {},
): DiagramNode => {
  const size = DEFAULT_NODE_SIZE[shape];
  const isFragment = shape === "fragment";
  const isIcon = shape === "icon";
  const columns = shape === "entity" ? sanitizeEntityColumns(options.columns) : undefined;
  // an entity is at least as big as its rows, like a class box
  const width =
    shape === "entity"
      ? entityNodeWidth({ label: options.label ?? "", columns }, options.width ?? size.width)
      : (options.width ?? size.width);
  const height =
    shape === "entity"
      ? Math.max(options.height ?? 0, entityNodeHeight(columns))
      : (options.height ?? size.height);
  return {
    id: options.id ?? nanoid(8),
    type: "shape",
    position,
    width,
    height,
    // a frame that covers its contents is useless — start behind the edge layer.
    // the wrapper (.react-flow__node) is pointer-events:all and spans the whole
    // node, so the frame must switch it off there; the painted parts inside
    // switch it back on. Setting it on our own root is not enough.
    ...(isFragment ? { zIndex: FRAGMENT_DEFAULT_Z, style: BACKDROP_STYLE } : {}),
    // a frame (#170) goes further back still, and its title is its label
    ...(shape === "frame" ? { zIndex: FRAME_DEFAULT_Z, style: BACKDROP_STYLE } : {}),
    data: {
      label: options.label ?? "",
      shape,
      color:
        options.color ??
        (shape === "sticky" ? "amber" : shape === "anchor" ? "gray" : DEFAULT_COLOR),
      ...(isFragment ? { fragmentKind: "alt" as const } : {}),
      ...(isIcon ? { icon: options.icon ?? DEFAULT_ICON } : {}),
      ...(!isIcon && options.icon && takesDecor(shape) ? { icon: options.icon } : {}),
      ...(takesBadge(shape) && sanitizeBadge(options.badge)
        ? { badge: sanitizeBadge(options.badge) }
        : {}),
      ...(takesDecor(shape) && sanitizeDescription(options.description)
        ? { description: sanitizeDescription(options.description) }
        : {}),
      ...(shape === "image" && options.src ? { src: options.src } : {}),
      ...(shape === "image" && isImageOriginal(options.original)
        ? { original: options.original }
        : {}),
      ...(columns ? { columns } : {}),
    },
  };
};

export const normalizeNode = (
  raw: DiagramNode,
  fallback: NodeFallback = FILE_FALLBACK,
): DiagramNode => {
  // file load and set_diagram skip the per-op validators, so lifeline extras are
  // re-validated here — an unusable value is dropped rather than stored
  const shape = raw.data.shape ?? fallback.shape;
  const isLifeline = shape === "lifeline";
  const height = raw.height ?? DEFAULT_NODE_SIZE[shape].height;
  const activations = isLifeline ? sanitizeActivations(raw.data.activations) : null;
  const destroyY = isLifeline ? sanitizeDestroyY(raw.data.destroyY) : null;
  const isFragment = shape === "fragment";
  const branches = isFragment ? sanitizeBranches(raw.data.branches) : null;
  const isClass = shape === "class";
  const isIcon = shape === "icon";
  const isEntity = shape === "entity";
  const columns = isEntity ? sanitizeEntityColumns(raw.data.columns) : undefined;
  const stereotype = isClass ? sanitizeStereotype(raw.data.stereotype) : undefined;
  const attributes = isClass ? sanitizeClassMembers(raw.data.attributes) : undefined;
  const methods = isClass ? sanitizeClassMembers(raw.data.methods) : undefined;
  const z = sanitizeZ(raw.zIndex);
  // style is derived from the shape, never carried over: a stale
  // pointer-events:none on a non-fragment makes the node unclickable.
  // `measured` is React Flow's DOM cache. Saves no longer write it (toDoc),
  // but older files do; dropping it makes every loaded node wait for a real
  // measurement, so a queued fit-on-open (#81) sees the size the content
  // floor below decides, not the one the file remembers
  const { zIndex: _dropZ, style: _dropStyle, measured: _dropMeasured, ...rest } = raw;
  return {
    ...rest,
    type: "shape",
    // content sets the floor for both axes; a stored size may only add to it
    width: isClass
      ? classNodeWidth(
          { label: raw.data.label ?? "", stereotype, attributes, methods },
          raw.width ?? DEFAULT_NODE_SIZE.class.width,
        )
      : isEntity
        ? entityNodeWidth(
            { label: raw.data.label ?? "", columns },
            raw.width ?? DEFAULT_NODE_SIZE.entity.width,
          )
        : (raw.width ?? DEFAULT_NODE_SIZE[shape].width),
    // a class box grows with its content; a stored height only ever adds to it
    height: isClass
      ? Math.max(height, classNodeHeight({ stereotype, attributes, methods }))
      : isEntity
        ? Math.max(height, entityNodeHeight(columns))
        : height,
    ...(z !== null ? { zIndex: z } : shape === "frame" ? { zIndex: FRAME_DEFAULT_Z } : {}),
    // files carry no style — restore a backdrop's click-through wrapper
    ...(isBackdrop(shape) ? { style: BACKDROP_STYLE } : {}),
    data: {
      label: raw.data.label ?? "",
      shape,
      // a colour the palette does not have would draw with no tokens at all
      color: isOneOf(raw.data.color, PALETTE_COLORS) ? raw.data.color : fallback.color,
      ...(activations ? { activations } : {}),
      ...(destroyY !== null ? { destroyY } : {}),
      // an unusable operator falls back to the default rather than rendering blank
      ...(isFragment ? { fragmentKind: sanitizeFragmentKind(raw.data.fragmentKind) ?? "alt" } : {}),
      ...(branches !== null ? { branches } : {}),
      ...(stereotype ? { stereotype } : {}),
      ...(isClass && raw.data.isAbstract === true ? { isAbstract: true } : {}),
      ...(attributes ? { attributes } : {}),
      ...(methods ? { methods } : {}),
      // a group id travels as it is; a group left with one member is dropped
      // across the diagram (dropLoneGroupIds), and an anchor is never a member (#171)
      ...(typeof raw.data.groupId === "string" &&
      raw.data.groupId !== "" &&
      raw.data.groupId.length <= 64 &&
      shape !== "anchor"
        ? { groupId: raw.data.groupId }
        : {}),
      ...(columns ? { columns } : {}),
      // an unknown id is kept (a newer build's icon renders as a placeholder,
      // the file is not damaged); only a missing one gets the default
      ...(isIcon
        ? {
            icon: typeof raw.data.icon === "string" && raw.data.icon ? raw.data.icon : DEFAULT_ICON,
          }
        : {}),
      // a box keeps its icon, badge and description; other shapes never had
      // them, and a value written by hand is cleaned like the bridge cleans it (#160)
      ...(takesDecor(shape) && typeof raw.data.icon === "string" && raw.data.icon
        ? { icon: raw.data.icon }
        : {}),
      ...(takesBadge(shape) && sanitizeBadge(raw.data.badge)
        ? { badge: sanitizeBadge(raw.data.badge) }
        : {}),
      ...(takesDecor(shape) && sanitizeDescription(raw.data.description)
        ? { description: sanitizeDescription(raw.data.description) }
        : {}),
      // a picture that is not a usable data URL is dropped, the node stays —
      // it renders as an empty frame the user can see and delete (#8)
      ...(shape === "image" && imageSrcError(raw.data.src) === null ? { src: raw.data.src } : {}),
      // the file it came from: kept only as a picture's absolute path
      ...(shape === "image" && isImageOriginal(raw.data.original)
        ? { original: raw.data.original }
        : {}),
    },
  };
};
