import type { Edge, Node } from "@xyflow/react";

import type { IconId } from "./iconIds";

export type ShapeKind =
  | "rect"
  | "rounded"
  | "ellipse"
  | "diamond"
  | "parallelogram"
  | "cylinder"
  | "hexagon"
  | "sticky"
  | "text"
  /** sequence-diagram participant: header box + vertical dashed line */
  | "lifeline"
  /** invisible endpoint node used for free-standing arrows */
  | "anchor"
  /** sequence-diagram combined fragment: frame + kind tab (alt/loop/opt/...) */
  | "fragment"
  /** a titled area behind other shapes; dragging it carries what lies inside (#170) */
  | "frame"
  /** class-diagram classifier: name / attributes / methods compartments */
  | "class"
  /** architecture icon (database, server, …) with the label underneath — see iconIds.ts */
  | "icon"
  /** a picture carried in the document as a data URL (#8) — see imageData.ts */
  | "image"
  /** ERD table: the entity's name, then one row per column (#5) — see entityShape.ts */
  | "entity";

/** UML combined-fragment operator, set into the frame's top border */
export type FragmentKind = "alt" | "loop" | "opt" | "par" | "critical";

export const FRAGMENT_KINDS: FragmentKind[] = ["alt", "loop", "opt", "par", "critical"];

/** alt splits its frame into this many equal branches */
export const MIN_FRAGMENT_BRANCHES = 2;
export const MAX_FRAGMENT_BRANCHES = 5;

export type PaletteColor =
  | "mono"
  | "violet"
  | "blue"
  | "teal"
  | "green"
  | "amber"
  | "rose"
  | "gray"
  /** an inverted hero tile — near-black in light, near-white in dark (#210) */
  | "ink";

/** activation bar on a lifeline; y offsets are relative to the node top */
export interface LifelineActivation {
  y0: number;
  y1: number;
}

export interface ShapeNodeData extends Record<string, unknown> {
  label: string;
  shape: ShapeKind;
  color: PaletteColor;
  /** icon only: which glyph (#9). Kept as a string so a file from a newer build with an id this build lacks still loads */
  icon?: IconId | (string & {});
  /** lifeline only: activation bars along the vertical line */
  activations?: LifelineActivation[];
  /**
   * lifeline only: UML destroy marker (X) at this node-relative y. The dashed
   * line stops here — the object no longer exists below it.
   */
  destroyY?: number;
  /** fragment only: the operator set into the top border (default "alt") */
  fragmentKind?: FragmentKind;
  /** the group the shape belongs to (#171) — shared by its members, one level, no nesting */
  groupId?: string;
  /** fragment only, alt: number of equal branches split by dashed dividers */
  branches?: number;
  /** class only: «interface» and friends, stored without the guillemets */
  stereotype?: string;
  /** class only: draws the name in italic */
  isAbstract?: boolean;
  /** class only: one raw signature line per member, e.g. "+ name: string" */
  attributes?: string[];
  methods?: string[];
  /** image only: the picture, a base64 data URL (png/jpeg/gif/webp) — see imageData.ts */
  src?: string;
  /** entity only: one raw column line per row, e.g. "id uuid PK" — see entityShape.ts */
  columns?: string[];
  /** box shapes and frames: a short tag (top-left) or step number (top-right) — see nodeDecor.ts (#160, #210) */
  badge?: string;
  /** box shapes only: a smaller line (or lines) under the label (#160) */
  description?: string;
}

export type DiagramNode = Node<ShapeNodeData, "shape">;

export type EdgeVariant = "solid" | "dashed" | "dotted" | "dashdot";
export type EdgePathStyle = "orthogonal" | "straight" | "curved";
export type MarkerShape =
  | "none"
  | "arrow"
  | "open"
  | "circle"
  | "diamond"
  | "bar"
  | "many"
  /** UML generalization/realization: hollow closed triangle */
  | "triangle"
  /** UML aggregation: hollow diamond (composition reuses the filled "diamond") */
  | "diamond-open"
  /** crow's-foot ends for ERD relationships (#5): exactly one, zero or one, one or many, zero or many */
  | "one"
  | "zero-one"
  | "one-many"
  | "zero-many";
export type MarkerSize = "sm" | "md" | "lg";

export interface EdgeWaypoint {
  x: number;
  y: number;
}

export interface DiagramEdgeData extends Record<string, unknown> {
  /** center label */
  label?: string;
  /** label near the source endpoint (e.g. cardinality) */
  labelStart?: string;
  /** label near the target endpoint */
  labelEnd?: string;
  /** center label position along the path, 0..1 (default 0.5) */
  labelT?: number;
  variant: EdgeVariant;
  /** legacy end-arrow toggle; superseded by markerEnd when present */
  arrow: boolean;
  /** stroke color; undefined = default slate */
  color?: PaletteColor;
  /** stroke width in px (default `DEFAULT_EDGE_WIDTH`) */
  width?: number;
  /** 0..1 (default 1) */
  opacity?: number;
  /** marching-dash flow animation */
  animated?: boolean;
  /** routing style (default orthogonal) */
  pathStyle?: EdgePathStyle;
  markerStart?: MarkerShape;
  markerEnd?: MarkerShape;
  markerSize?: MarkerSize;
  /** manual bend points the path must pass through */
  waypoints?: EdgeWaypoint[];
  /**
   * How far a self-loop reaches out from its node, in px. Only self-messages
   * expose a handle for it; everything else falls back to the default that
   * spreads stacked loops apart (#99).
   */
  selfLoopWidth?: number;
}

export type DiagramEdge = Edge<DiagramEdgeData, "labeled">;

/**
 * What a `.dosik` file holds: a diagram is one canvas (#229 D1). A document
 * with pages (v2, #7) was never shipped and no longer opens (D2).
 */
export interface DiagramDoc {
  version: 1;
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

/** Style fields an agent (or the inspector) may set on an edge. */
export type EdgeStylePatch = Partial<{
  label: string;
  labelStart: string;
  labelEnd: string;
  labelT: number;
  variant: EdgeVariant;
  arrow: boolean;
  color: PaletteColor;
  width: number;
  opacity: number;
  animated: boolean;
  pathStyle: EdgePathStyle;
  markerStart: MarkerShape;
  markerEnd: MarkerShape;
  markerSize: MarkerSize;
  waypoints: EdgeWaypoint[];
}>;

export type AgentOp =
  | {
      op: "add_node";
      node: {
        id?: string;
        label: string;
        shape?: ShapeKind;
        color?: PaletteColor;
        /** shape "icon" (its glyph, default server) or a box shape (above its label) — one of ICON_IDS */
        icon?: IconId;
        /** box shapes and frames — a short tag (top-left) or step number (top-right) (#160, #210) */
        badge?: string;
        /** box shapes only — smaller text under the label (#160) */
        description?: string;
        /** shape "image" only, and required there — a base64 data URL */
        src?: string;
        /** shape "entity" only — one raw column line per row, e.g. "id uuid PK" */
        columns?: string[];
        x: number;
        y: number;
        width?: number;
        height?: number;
      };
    }
  | {
      op: "update_node";
      id: string;
      set: Partial<{
        label: string;
        shape: ShapeKind;
        color: PaletteColor;
        /** icon nodes and box shapes — one of ICON_IDS ("" removes a box's icon) */
        icon: IconId | "";
        /** box shapes only — "" removes it */
        badge: string;
        /** box shapes only — "" removes it */
        description: string;
        /** image only — a base64 data URL */
        src: string;
        /** entity only — one raw column line per row */
        columns: string[];
        x: number;
        y: number;
        width: number;
        height: number;
        activations: LifelineActivation[];
        /** null clears the destroy marker */
        destroyY: number | null;
        fragmentKind: FragmentKind;
        branches: number;
        /** paint order; lower is further back (fragments default below edges) */
        z: number;
        /** class only — «stereotype» body, without guillemets */
        stereotype: string;
        isAbstract: boolean;
        /** class only — one raw signature line per member */
        attributes: string[];
        methods: string[];
      }>;
    }
  | { op: "delete_node"; id: string }
  | {
      op: "add_edge";
      edge: {
        id?: string;
        source: string;
        target: string;
      } & EdgeStylePatch;
    }
  | {
      op: "update_edge";
      id: string;
      set: EdgeStylePatch;
    }
  | { op: "delete_edge"; id: string }
  | {
      /**
       * Horizontal sequence-diagram message between two lifelines (self-message
       * when from === to). One of from/to may be a point `{x}` instead of a
       * lifeline id — an anchor is created there (found/lost message).
       */
      op: "add_message";
      message: {
        id?: string;
        from: string | { x: number };
        to: string | { x: number };
        /** absolute canvas y of the message */
        y: number;
        label?: string;
        variant?: EdgeVariant;
        markerEnd?: MarkerShape;
      };
    }
  | {
      /** appends an activation bar to a lifeline (y0/y1 relative to node top) */
      op: "add_activation";
      lifeline: string;
      y0: number;
      y1: number;
    }
  | { op: "set_title"; title: string }
  | { op: "layout"; direction?: "TB" | "BT" | "LR" | "RL"; ids?: string[] }
  /** binds shapes into one group (#171); groups they already belong to are folded in */
  | { op: "group"; ids: string[]; id?: string }
  /** releases a group (#171) */
  | { op: "ungroup"; id: string }
  | { op: "clear" }
  | { op: "set_diagram"; doc: DiagramDoc }
  /**
   * Starts another diagram in the app and sends the rest of the batch to it
   * (#229 D15). Only the bridge's `POST /api/ops` does it; the store's
   * `applyOps` (a chat turn, the headless CLI) refuses it.
   */
  | NewDiagramOp;

export interface NewDiagramOp {
  op: "new_diagram";
  /** blank or left out: "Untitled Diagram" */
  title?: string;
  /** the folder id to save it in — left out, where a new diagram goes (`targetFolder`) */
  folder?: string;
}
