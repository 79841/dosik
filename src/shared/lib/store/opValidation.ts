import { imageSrcError } from "../imageData";
import { MAX_BADGE, MAX_DESCRIPTION } from "../nodeDecor";
import { LIFELINE_HEADER_H, PALETTE_COLORS, SHAPE_KINDS } from "../palette";
import { ICON_IDS } from "../iconIds";
import type {
  DiagramDoc,
  FragmentKind,
  EdgePathStyle,
  EdgeStylePatch,
  EdgeVariant,
  LifelineActivation,
  MarkerShape,
  MarkerSize,
} from "../types";
import { FRAGMENT_KINDS, MAX_FRAGMENT_BRANCHES, MIN_FRAGMENT_BRANCHES } from "../types";

// The bridge feeds applyOps arbitrary JSON from outside the app — every field
// is validated here so malformed input degrades to a per-op error, never a
// crash or polluted state.

export const MAX_LABEL_LENGTH = 10_000;
export const MAX_WAYPOINTS = 100;
export const MAX_ACTIVATIONS = 100;

const EDGE_VARIANTS: EdgeVariant[] = ["solid", "dashed", "dotted", "dashdot"];
const EDGE_PATH_STYLES: EdgePathStyle[] = ["orthogonal", "straight", "curved"];
/**
 * Runtime allowlist. A record rather than a list so the type checker insists
 * on every MarkerShape — a list let a new marker be missed here and rejected
 * only at the bridge. The mirrors outside TypeScript (openapi, AGENT_PROTOCOL,
 * the AI prompt) are held to it by `shapeListDrift.test.ts`.
 */
const MARKER_SET: Record<MarkerShape, true> = {
  none: true,
  arrow: true,
  open: true,
  circle: true,
  diamond: true,
  bar: true,
  many: true,
  triangle: true,
  "diamond-open": true,
  one: true,
  "zero-one": true,
  "one-many": true,
  "zero-many": true,
};
export const MARKER_SHAPES = Object.keys(MARKER_SET) as MarkerShape[];
const MARKER_SIZES: MarkerSize[] = ["sm", "md", "lg"];

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const isOneOf = <T extends string>(v: unknown, list: readonly T[]): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

const checkLabel = (v: unknown, field: string): string | null => {
  if (v === undefined) return null;
  if (typeof v !== "string") return `${field} must be a string`;
  if (v.length > MAX_LABEL_LENGTH) return `${field} exceeds ${MAX_LABEL_LENGTH} chars`;
  return null;
};

/** Field checks shared by add_node's node and update_node's set. */
export const nodeFieldErrors = (
  raw: Record<string, unknown>,
  { requireLabel, allowClear = false }: { requireLabel: boolean; allowClear?: boolean },
): string[] => {
  const errors: string[] = [];
  if (requireLabel && typeof raw.label !== "string") errors.push("label (string) is required");
  else {
    const labelError = checkLabel(raw.label, "label");
    if (labelError) errors.push(labelError);
  }
  if (raw.id !== undefined && typeof raw.id !== "string") errors.push("id must be a string");
  if (raw.shape !== undefined && !isOneOf(raw.shape, SHAPE_KINDS))
    errors.push(`shape must be one of ${SHAPE_KINDS.join("|")}`);
  if (raw.color !== undefined && !isOneOf(raw.color, PALETTE_COLORS))
    errors.push(`color must be one of ${PALETTE_COLORS.join("|")}`);
  // "" removes a box's icon on update_node (allowClear); add_node has nothing to remove
  if (raw.icon === "" && !allowClear)
    errors.push('icon "" has nothing to remove here — leave the field out');
  else if (raw.icon !== undefined && raw.icon !== "" && !isOneOf(raw.icon, ICON_IDS))
    errors.push(`icon must be one of ${ICON_IDS.join("|")}`);
  if (raw.badge !== undefined) {
    if (typeof raw.badge !== "string") errors.push("badge must be a string");
    else if ([...raw.badge.trim().replace(/\s+/g, " ")].length > MAX_BADGE)
      errors.push(`badge exceeds ${MAX_BADGE} chars`);
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") errors.push("description must be a string");
    else if ([...raw.description.trim()].length > MAX_DESCRIPTION)
      errors.push(`description exceeds ${MAX_DESCRIPTION} chars`);
  }
  // every entry a string — `[42]` would sanitize to nothing and quietly wipe
  // the rows, the same rule class members follow (#5)
  if (
    raw.columns !== undefined &&
    (!Array.isArray(raw.columns) || raw.columns.some((c) => typeof c !== "string"))
  )
    errors.push("columns must be an array of strings");
  if (raw.src !== undefined) {
    const srcError = imageSrcError(raw.src);
    if (srcError) errors.push(srcError);
  }
  for (const field of ["x", "y", "width", "height"] as const) {
    if (raw[field] !== undefined && !isFiniteNumber(raw[field]))
      errors.push(`${field} must be a finite number`);
  }
  for (const field of ["width", "height"] as const) {
    if (isFiniteNumber(raw[field]) && (raw[field] as number) <= 0)
      errors.push(`${field} must be positive`);
  }
  if (raw.activations !== undefined) {
    const error = activationsError(raw.activations);
    if (error) errors.push(error);
  }
  return errors;
};

/** Validates a lifeline activations array; returns an error string or null. */
export const activationsError = (raw: unknown): string | null => {
  if (
    !Array.isArray(raw) ||
    raw.length > MAX_ACTIVATIONS ||
    !raw.every((a) => a && isFiniteNumber(a.y0) && isFiniteNumber(a.y1) && a.y0 < a.y1)
  )
    return `activations must be up to ${MAX_ACTIVATIONS} {y0,y1} entries with finite y0 < y1`;
  return null;
};

/**
 * Validated + key-whitelisted activations, or null when the input is unusable.
 * Every path that stores activations goes through this — including file load
 * and set_diagram, which bypass the per-op validators — so a node can never
 * hold a non-finite span that would render as NaN geometry downstream.
 */
export const sanitizeActivations = (raw: unknown): LifelineActivation[] | null => {
  if (activationsError(raw) !== null) return null;
  return (raw as LifelineActivation[]).map(({ y0, y1 }) => ({ y0, y1 }));
};

/** shortest activation bar that stays grabbable at both ends */
export const MIN_ACTIVATION_H = 8;

/**
 * Fits an activation span into the lifeline's line (below the header, above the
 * bottom) while keeping it at least MIN_ACTIVATION_H tall. Shared by the canvas
 * grip drag and the inspector's numeric inputs so both land on the same value —
 * an out-of-range entry is pulled into range rather than rejected.
 */
export const clampActivation = (y0: number, y1: number, height: number): LifelineActivation => {
  const bottom = Math.max(LIFELINE_HEADER_H + MIN_ACTIVATION_H, height);
  const c0 = Math.max(LIFELINE_HEADER_H, Math.min(y0, bottom - MIN_ACTIVATION_H));
  const c1 = Math.min(bottom, Math.max(y1, c0 + MIN_ACTIVATION_H));
  return { y0: c0, y1: c1 };
};

/** Validated combined-fragment operator, or null. */
export const sanitizeFragmentKind = (raw: unknown): FragmentKind | null =>
  isOneOf(raw, FRAGMENT_KINDS) ? raw : null;

/** Branch count clamped into the supported range, or null when not a number. */
export const sanitizeBranches = (raw: unknown): number | null => {
  if (!isFiniteNumber(raw)) return null;
  return Math.min(Math.max(Math.round(raw), MIN_FRAGMENT_BRANCHES), MAX_FRAGMENT_BRANCHES);
};

/**
 * Validated paint order. Any finite number is allowed — negative puts a node
 * below the edge layer, which is how fragment frames sit behind messages.
 */
export const sanitizeZ = (raw: unknown): number | null => (isFiniteNumber(raw) ? raw : null);

/**
 * Storable destroy-marker y, or null. Deliberately height-blind, mirroring
 * `sanitizeActivations`: a marker that currently falls outside the line is kept
 * (just not drawn) so shrinking a lifeline and growing it back is lossless.
 * Range is judged where it can be acted on — at the render (`visibleDestroyY`)
 * and at input boundaries, which reject with a message.
 */
export const sanitizeDestroyY = (raw: unknown): number | null => (isFiniteNumber(raw) ? raw : null);

/**
 * The destroy-marker y actually drawn, or null when it falls outside the line.
 * Render rule — see `visibleActivation`. Input boundaries (bridge op, inspector)
 * reuse this to decide whether a requested value is usable.
 */
export const visibleDestroyY = (raw: unknown, height: number): number | null => {
  const y = sanitizeDestroyY(raw);
  return y !== null && y >= LIFELINE_HEADER_H && y <= height ? y : null;
};

/**
 * The span actually drawn for a bar, or null when nothing is drawn — a stored
 * activation may sit outside the line (the bridge's add_activation has no height
 * clamp, and resizing a lifeline shorter doesn't re-clamp).
 *
 * This is the *render* rule and is deliberately not `clampActivation`, which is
 * the *edit* rule: editing pulls an out-of-range value into the line, rendering
 * just omits what falls outside it. Both the bar and its drag grips read this,
 * so a grip never appears where there is no bar.
 */
export const visibleActivation = (
  a: LifelineActivation,
  height: number,
): LifelineActivation | null => {
  const y0 = Math.max(a.y0, LIFELINE_HEADER_H);
  const y1 = Math.min(a.y1, height);
  // NaN fails every comparison — guard explicitly, or NaN reaches the renderers
  if (!Number.isFinite(y0) || !Number.isFinite(y1) || y1 <= y0) return null;
  return { y0, y1 };
};

const EDGE_STYLE_KEYS = [
  "label",
  "labelStart",
  "labelEnd",
  "labelT",
  "variant",
  "arrow",
  "color",
  "width",
  "opacity",
  "animated",
  "pathStyle",
  "markerStart",
  "markerEnd",
  "markerSize",
  "waypoints",
] as const;

/**
 * The default line width before #204. A line carrying it was a default line —
 * one saved then, or sent by an agent that read it back — so every way in
 * (file load, set_diagram, add_edge, update_edge) treats it as unset.
 */
export const LEGACY_DEFAULT_EDGE_WIDTH = 1.6;

/** Validates edge style fields and returns [errors, sanitized-known-fields-only]. */
export const edgeStyleErrors = (raw: Record<string, unknown>): [string[], EdgeStylePatch] => {
  const errors: string[] = [];
  const patch: Record<string, unknown> = {};

  for (const key of EDGE_STYLE_KEYS) {
    if (raw[key] !== undefined) patch[key] = raw[key];
  }
  for (const field of ["label", "labelStart", "labelEnd"] as const) {
    const error = checkLabel(patch[field], field);
    if (error) errors.push(error);
  }
  if (patch.labelT !== undefined && !isFiniteNumber(patch.labelT))
    errors.push("labelT must be a finite number");
  if (patch.variant !== undefined && !isOneOf(patch.variant, EDGE_VARIANTS))
    errors.push(`variant must be one of ${EDGE_VARIANTS.join("|")}`);
  if (patch.arrow !== undefined && typeof patch.arrow !== "boolean")
    errors.push("arrow must be a boolean");
  if (patch.color !== undefined && !isOneOf(patch.color, PALETTE_COLORS))
    errors.push(`color must be one of ${PALETTE_COLORS.join("|")}`);
  if (patch.width !== undefined && (!isFiniteNumber(patch.width) || patch.width <= 0))
    errors.push("width must be a positive number");
  if (patch.width === LEGACY_DEFAULT_EDGE_WIDTH) patch.width = undefined;
  if (
    patch.opacity !== undefined &&
    (!isFiniteNumber(patch.opacity) || patch.opacity < 0 || patch.opacity > 1)
  )
    errors.push("opacity must be between 0 and 1");
  if (patch.animated !== undefined && typeof patch.animated !== "boolean")
    errors.push("animated must be a boolean");
  if (patch.pathStyle !== undefined && !isOneOf(patch.pathStyle, EDGE_PATH_STYLES))
    errors.push(`pathStyle must be one of ${EDGE_PATH_STYLES.join("|")}`);
  for (const field of ["markerStart", "markerEnd"] as const) {
    if (patch[field] !== undefined && !isOneOf(patch[field], MARKER_SHAPES))
      errors.push(`${field} must be one of ${MARKER_SHAPES.join("|")}`);
  }
  if (patch.markerSize !== undefined && !isOneOf(patch.markerSize, MARKER_SIZES))
    errors.push(`markerSize must be one of ${MARKER_SIZES.join("|")}`);
  if (patch.waypoints !== undefined) {
    const wp = patch.waypoints;
    if (
      !Array.isArray(wp) ||
      wp.length > MAX_WAYPOINTS ||
      !wp.every((p) => p && isFiniteNumber(p.x) && isFiniteNumber(p.y))
    )
      errors.push(`waypoints must be up to ${MAX_WAYPOINTS} {x,y} points with finite coordinates`);
  }
  return [errors, patch as EdgeStylePatch];
};

/**
 * Structural check for set_diagram/loadDoc input: every node needs an id and a
 * data object, every edge an id-able source/target — anything less crashes
 * normalizeNode/normalizeEdge downstream.
 */
export const diagramDocErrors = (doc: DiagramDoc): string[] => {
  const errors: string[] = [];
  for (const [i, node] of doc.nodes.entries()) {
    if (!node || typeof node.id !== "string" || typeof node.data !== "object" || node.data === null)
      errors.push(`nodes[${i}] must have string id and data object`);
    else if (!node.position || !isFiniteNumber(node.position.x) || !isFiniteNumber(node.position.y))
      errors.push(`nodes[${i}] must have finite position {x,y}`);
  }
  for (const [i, edge] of doc.edges.entries()) {
    if (!edge || typeof edge.source !== "string" || typeof edge.target !== "string")
      errors.push(`edges[${i}] must have string source/target`);
  }
  return errors;
};
