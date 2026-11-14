import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { isSequenceMessage, nodeBounds } from "../../shared/lib/edgeUtils";
import type { Point } from "../../shared/lib/edgeGeometry";
import { IconGlyph } from "../../shared/lib/icons";
import { PILL, pillSize } from "../../shared/lib/labelPill";
import { DECOR } from "../../shared/lib/nodeDecor";
import {
  badgeBox,
  type DecorLayout,
  frameBadgeLayout,
  labelBox,
  nodeDecorLayout,
  nodeLabelLayout,
  type StepLayout,
  type TagLayout,
} from "../../shared/lib/nodeLayout";
import {
  COLOR_TOKENS,
  type ColorToken,
  DARK_COLOR_TOKENS,
  DEFAULT_NODE_SIZE,
  BORDER_TITLE,
  canvasInk,
  FONT_MONO,
  nodeLabelColor,
  onCanvasColor,
  SURFACE_DARK,
  SURFACE_LIGHT,
  type SurfaceTokens,
} from "../../shared/lib/palette";
import type { DiagramDoc, DiagramEdge, DiagramNode, PaletteColor } from "../../shared/lib/types";
import { ClassSvg } from "../canvas/ClassSvg";
import { type EdgeLayout, edgePaint, layoutEdge } from "../canvas/edgeLayout";
import { EdgeMarkerDef, MARKER_PX } from "../canvas/edgeMarkers";
import { EntitySvg } from "../canvas/EntitySvg";
import { IconNodeSvg } from "../canvas/IconNodeSvg";
import { FrameSvg } from "../canvas/FrameSvg";
import { FragmentSvg, LifelineSvg } from "../canvas/SequenceSvg";
import { ShapeSvg } from "../canvas/ShapeSvg";
import { mergeThemes } from "./adaptiveTheme";

/**
 * A diagram drawn as vector SVG from the document alone — no window, no DOM,
 * no `<foreignObject>` (#148).
 *
 * The app's own Export SVG captures the rendered canvas, HTML and all, wrapped
 * in `<foreignObject>`: it needs a window to make and a browser to read. This
 * draws the same picture with the same parts — the shape components the canvas
 * uses, the edge layout it uses (`layoutEdge`), the marker definitions — so it
 * runs in Node, in the headless CLI, and in an MCP answer a chat can show.
 *
 * What is new here is only what the canvas leaves to HTML: label layout. Those
 * rules copy CSS the canvas states in class names, and the constants below are
 * tied to those class names by a test, so a change to one breaks the other.
 */
export type VectorTheme = "light" | "dark";

export interface VectorSvgOptions {
  /** `auto`: light colours, with dark ones that follow the page it is shown on (`adaptiveTheme`) */
  theme?: VectorTheme | "auto";
  /** paint the canvas background (default true) — off for a transparent file */
  background?: boolean;
  /** `width="100%"` instead of fixed pixels, for showing inline in a chat */
  responsive?: boolean;
}

const PADDING = 24;

interface Colors {
  tokens: Record<PaletteColor, ColorToken>;
  surface: SurfaceTokens;
}

const COLORS: Record<VectorTheme, Colors> = {
  light: { tokens: COLOR_TOKENS, surface: SURFACE_LIGHT },
  dark: { tokens: DARK_COLOR_TOKENS, surface: SURFACE_DARK },
};

// ---------------------------------------------------------------- nodes

const Lines = ({
  lines,
  x,
  centerY,
  anchor,
  fontSize,
  fontWeight,
  lineHeight,
  fill,
}: {
  lines: string[];
  x: number;
  centerY: number;
  anchor: "start" | "middle";
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  fill: string;
}) => {
  if (lines.length === 0) return null;
  const top = centerY - (lines.length * lineHeight) / 2;
  return (
    <text textAnchor={anchor} fontSize={fontSize} fontWeight={fontWeight} fill={fill}>
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
        <tspan key={i} x={x} y={top + lineHeight * (i + 0.5)} dy="0.35em">
          {line}
        </tspan>
      ))}
    </text>
  );
};

// ---------------------------------------------------------------- box decorations

const NodeDecor = ({
  decor,
  token,
  surface,
}: {
  decor: DecorLayout;
  token: ColorToken;
  surface: SurfaceTokens;
}) => (
  <>
    {decor.icon ? (
      <IconGlyph
        icon={decor.icon.id}
        size={decor.icon.size}
        color={token.glyph}
        x={decor.icon.x}
        y={decor.icon.y}
        strokePx={DECOR.iconStrokePx}
      />
    ) : null}
    {decor.label ? (
      <Lines
        lines={decor.label.lines}
        x={decor.label.x}
        centerY={decor.label.centerY}
        anchor={decor.label.anchor}
        fontSize={decor.label.fontSize}
        fontWeight={decor.label.fontWeight}
        lineHeight={decor.label.lineHeight}
        fill={token.text}
      />
    ) : null}
    {decor.description ? (
      <g opacity={DECOR.descriptionOpacity}>
        <Lines
          lines={decor.description.lines}
          x={decor.description.x}
          centerY={decor.description.centerY}
          anchor={decor.description.anchor}
          fontSize={decor.description.fontSize}
          fontWeight={decor.description.fontWeight}
          lineHeight={decor.description.lineHeight}
          fill={token.text}
        />
      </g>
    ) : null}
    {decor.badge ? <Badge badge={decor.badge} token={token} surface={surface} /> : null}
  </>
);

/** a badge: a tag in the node's deeper tone, or a step circle in ink (#210) */
export const Badge = ({
  badge,
  token,
  surface,
}: {
  badge: TagLayout | StepLayout;
  token: ColorToken;
  surface: SurfaceTokens;
}) =>
  badge.kind === "step" ? (
    <g>
      {/* a ring of canvas round the circle: it reads on an ink tile as on the page */}
      <circle cx={badge.cx} cy={badge.cy} r={badge.r + DECOR.stepRing} fill={surface.canvasBg} />
      <circle cx={badge.cx} cy={badge.cy} r={badge.r} fill={surface.ink} />
      <text
        x={badge.cx}
        y={badge.cy}
        dy="0.35em"
        textAnchor="middle"
        fontSize={DECOR.stepFontSize}
        fontWeight={700}
        fill={surface.canvasBg}
      >
        {badge.text}
      </text>
    </g>
  ) : (
    <g>
      <rect
        x={badge.x}
        y={badge.y}
        width={badge.width}
        height={badge.height}
        rx={DECOR.tagRadius}
        fill={token.cap}
      />
      <text
        x={badge.x + badge.width / 2}
        y={badge.y + badge.height / 2}
        dy="0.35em"
        textAnchor="middle"
        fontSize={DECOR.tagFontSize}
        fontWeight={600}
        fill={token.text}
      >
        {badge.text}
      </text>
    </g>
  );

const NodeLabel = ({
  node,
  w,
  h,
  color,
  patch,
}: {
  node: DiagramNode;
  w: number;
  h: number;
  color: string;
  /** a frame's title sits on a canvas-coloured patch over its dashed border (#210 D10) */
  patch?: string;
}) => {
  const label = nodeLabelLayout(node, w, h);
  if (!label) return null;
  const box = patch ? labelBox(label) : null;
  return (
    <>
      {box ? (
        <rect
          x={box.x - BORDER_TITLE.padX}
          y={-BORDER_TITLE.height / 2}
          width={box.width + BORDER_TITLE.padX * 2}
          height={BORDER_TITLE.height}
          fill={patch}
        />
      ) : null}
      <Lines
        lines={label.lines}
        x={label.x}
        centerY={label.centerY}
        anchor={label.anchor}
        fontSize={label.fontSize}
        fontWeight={label.fontWeight}
        lineHeight={label.lineHeight}
        fill={color}
      />
    </>
  );
};

const NodeView = ({
  node,
  isEndpoint,
  colors,
}: {
  node: DiagramNode;
  isEndpoint: boolean;
  colors: Colors;
}) => {
  const b = nodeBounds(node);
  const { shape } = node.data;
  const w = b.width;
  const h = b.height;
  const token = colors.tokens[node.data.color] ?? colors.tokens.violet;
  const transform = `translate(${b.x} ${b.y})`;
  const decor = nodeDecorLayout(node, w, h);
  const frameBadge = frameBadgeLayout(node, w, h);

  if (shape === "anchor") {
    // invisible unless it is the off-diagram end of a found/lost message
    return (
      <g data-node={node.id} transform={transform}>
        {isEndpoint ? (
          <circle
            cx={w / 2}
            cy={h / 2}
            r={Math.max(0, w / 2 - 3)}
            fill={colors.surface.edgeStroke}
          />
        ) : null}
      </g>
    );
  }

  let drawing: ReactNode = null;
  if (shape === "class") {
    drawing = (
      <ClassSvg
        width={w}
        height={h}
        fill={token.fill}
        body={colors.surface.cardBody}
        border={colors.surface.cardBorder}
        text={token.text}
        ink={colors.surface.ink}
        muted={colors.surface.inkMuted}
        name={node.data.label}
        stereotype={node.data.stereotype}
        isAbstract={node.data.isAbstract}
        attributes={node.data.attributes}
        methods={node.data.methods}
      />
    );
  } else if (shape === "frame") {
    drawing = <FrameSvg interactive={false} width={w} height={h} line={token.line} />;
  } else if (shape === "fragment") {
    drawing = (
      <FragmentSvg
        interactive={false}
        width={w}
        height={h}
        line={token.line}
        text={onCanvasColor(node.data.color, colors.tokens, colors.surface.inkMuted)}
        patch={colors.surface.canvasBg}
        kind={node.data.fragmentKind ?? "alt"}
        branches={node.data.branches}
      />
    );
  } else if (shape === "lifeline") {
    drawing = (
      <LifelineSvg
        width={w}
        height={h}
        fill={token.fill}
        line={colors.surface.lifeline}
        act={colors.surface.act}
        ink={colors.surface.ink}
        activations={node.data.activations}
        destroyY={node.data.destroyY}
      />
    );
  } else if (shape === "entity") {
    drawing = (
      <EntitySvg
        width={w}
        height={h}
        fill={token.fill}
        body={colors.surface.cardBody}
        border={colors.surface.cardBorder}
        text={token.text}
        ink={colors.surface.ink}
        muted={colors.surface.inkMuted}
        name={node.data.label}
        columns={node.data.columns}
      />
    );
  } else if (shape === "image") {
    drawing = node.data.src ? (
      <image href={node.data.src} width={w} height={h} preserveAspectRatio="xMidYMid meet" />
    ) : (
      // lost its picture: an empty frame, as on the canvas
      <rect
        x={0.75}
        y={0.75}
        width={w - 1.5}
        height={h - 1.5}
        rx={4}
        fill="none"
        stroke={canvasInk(node.data.color, colors.tokens)}
        strokeDasharray="6 4"
      />
    );
  } else if (shape === "icon") {
    drawing = (
      <IconNodeSvg
        icon={String(node.data.icon ?? "")}
        width={w}
        height={h}
        stroke={canvasInk(node.data.color, colors.tokens)}
      />
    );
  } else if (shape !== "text") {
    drawing = (
      <ShapeSvg
        shape={shape}
        width={w}
        height={h}
        fill={token.fill}
        cap={token.cap}
        stroke={token.glyph}
      />
    );
  }

  return (
    <g data-node={node.id} transform={transform}>
      {/* Studio tiles sit flat on the page, as on the canvas (#210 D4) */}
      {drawing}
      {decor ? (
        <NodeDecor decor={decor} token={token} surface={colors.surface} />
      ) : (
        <NodeLabel
          node={node}
          w={w}
          h={h}
          color={nodeLabelColor(node.data, colors.tokens, colors.surface)}
          patch={shape === "frame" ? colors.surface.canvasBg : undefined}
        />
      )}
      {frameBadge ? <Badge badge={frameBadge} token={token} surface={colors.surface} /> : null}
    </g>
  );
};

// ---------------------------------------------------------------- edges

interface PlacedEdge {
  edge: DiagramEdge;
  layout: EdgeLayout;
  lifted: boolean;
  /** position in the document — names the edge's marker definitions */
  index: number;
}

const labelSlots = (edge: DiagramEdge, layout: EdgeLayout) =>
  [
    { text: edge.data?.label, point: layout.labelPoints.center },
    { text: edge.data?.labelStart, point: layout.labelPoints.start },
    { text: edge.data?.labelEnd, point: layout.labelPoints.end },
  ].filter((slot): slot is { text: string; point: Point } => Boolean(slot.text));

const EdgePath = ({ placed, colors }: { placed: PlacedEdge; colors: Colors }) => {
  const { edge, layout, index } = placed;
  const paint = edgePaint(edge.data, {
    tokens: colors.tokens,
    stroke: colors.surface.edgeStroke,
  });
  // by position, not by id: an id is whatever the agent sent, and a `)` in it
  // would close `url(#…)` early and lose the arrowhead (#152)
  const ms = `m${index}s`;
  const me = `m${index}e`;
  return (
    <g data-edge={edge.id}>
      <defs>
        <EdgeMarkerDef
          id={ms}
          shape={paint.markerStart}
          color={paint.stroke}
          size={paint.markerSize}
          hollow={colors.surface.canvasBg}
        />
        <EdgeMarkerDef
          id={me}
          shape={paint.markerEnd}
          color={paint.stroke}
          size={paint.markerSize}
          hollow={colors.surface.canvasBg}
        />
      </defs>
      <path
        className="edge"
        d={layout.d}
        fill="none"
        stroke={paint.stroke}
        strokeWidth={paint.strokeWidth}
        strokeDasharray={paint.dasharray}
        strokeLinecap={paint.linecap}
        opacity={paint.opacity === 1 ? undefined : paint.opacity}
        markerStart={paint.markerStart !== "none" ? `url(#${ms})` : undefined}
        markerEnd={paint.markerEnd !== "none" ? `url(#${me})` : undefined}
      />
    </g>
  );
};

const EdgeLabels = ({ placed, colors }: { placed: PlacedEdge; colors: Colors }) => {
  const slots = labelSlots(placed.edge, placed.layout);
  if (slots.length === 0) return null;
  const { labelColor } = edgePaint(placed.edge.data, {
    tokens: colors.tokens,
    stroke: colors.surface.edgeStroke,
  });
  return (
    <g data-edge-labels={placed.edge.id}>
      {slots.map((slot, i) => {
        const { width, height } = pillSize(slot.text);
        const x = slot.point.x - width / 2;
        const y = slot.point.y - height / 2;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: center/start/end are positional
          <g key={i}>
            {/* a canvas-coloured patch cuts the line under the label — no box (#210 D7) */}
            <rect
              className="pill"
              x={x}
              y={y}
              width={width}
              height={height}
              rx={PILL.radius}
              fill={colors.surface.canvasBg}
            />
            <text
              x={slot.point.x}
              y={slot.point.y}
              dy="0.35em"
              textAnchor="middle"
              fontSize={PILL.fontSize}
              fontWeight={PILL.fontWeight}
              fill={labelColor}
            >
              {slot.text}
            </text>
          </g>
        );
      })}
    </g>
  );
};

// ---------------------------------------------------------------- document

const boundsOf = (nodes: DiagramNode[], edges: PlacedEdge[]) => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const add = (x: number, y: number, w = 0, h = 0) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const n of nodes) {
    const b = nodeBounds(n);
    add(b.x, b.y, b.width, b.height);
    const decor = nodeDecorLayout(n, b.width, b.height);
    const texts = decor
      ? [decor.label, decor.description]
      : [nodeLabelLayout(n, b.width, b.height)];
    for (const label of texts) {
      if (!label) continue;
      const box = labelBox(label);
      add(b.x + box.x, b.y + box.y, box.width, box.height);
    }
    // a step badge hangs past the corner — the file must not cut it off
    const badge = decor?.badge ?? frameBadgeLayout(n, b.width, b.height);
    if (badge) {
      const box = badgeBox(badge);
      add(b.x + box.x, b.y + box.y, box.width, box.height);
    }
  }
  for (const { edge, layout } of edges) {
    const reach = MARKER_PX[edge.data?.markerSize ?? "md"];
    for (const p of layout.points) add(p.x - reach, p.y - reach, reach * 2, reach * 2);
    for (const slot of labelSlots(edge, layout)) {
      const { width, height } = pillSize(slot.text);
      add(slot.point.x - width / 2, slot.point.y - height / 2, width, height);
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 200, height: 120 };
  return {
    x: Math.floor(minX - PADDING),
    y: Math.floor(minY - PADDING),
    width: Math.ceil(maxX - minX + PADDING * 2),
    height: Math.ceil(maxY - minY + PADDING * 2),
  };
};

/**
 * Renders the document. The paint order is the canvas's own (see
 * `canvasLifts` and the fragment/z-order reference): nodes below zero (frames),
 * every edge, the label layer, the remaining nodes by z, and last the
 * self-messages, which the canvas lifts over their lifeline.
 */
export const renderVectorSvg = (doc: DiagramDoc, options: VectorSvgOptions = {}): string => {
  if (options.theme !== "auto") {
    return renderThemed(doc, { ...options, theme: options.theme ?? "light" });
  }
  const light = renderThemed(doc, { ...options, theme: "light" });
  try {
    return mergeThemes(light, renderThemed(doc, { ...options, theme: "dark" }), {
      backdrop: COLORS.dark.surface.canvasBg,
    });
  } catch {
    // the two renders should always pair; if one day they don't, a light
    // drawing still beats no drawing (#202)
    return light;
  }
};

const renderThemed = (
  doc: DiagramDoc,
  options: VectorSvgOptions & { theme: VectorTheme },
): string => renderToStaticMarkup(<VectorDiagram doc={doc} {...options} />);

/**
 * The drawing as a React tree — what `renderVectorSvg` serializes (#220 D13);
 * React escapes every label. Mounted inline, the bundled IBM Plex Mono would
 * apply, which an `<img>` cannot load (Home's live preview did, until #231
 * D11). `auto` is the string renderer's alone; a mounted drawing takes the
 * theme it is given.
 */
export const VectorDiagram = ({
  doc,
  theme = "light",
  background,
  responsive,
}: { doc: DiagramDoc; theme?: VectorTheme } & Omit<VectorSvgOptions, "theme">) => {
  const colors = COLORS[theme];
  const nodes = doc.nodes.filter((n) => DEFAULT_NODE_SIZE[n.data.shape] !== undefined);

  const placed: PlacedEdge[] = [];
  for (const edge of doc.edges) {
    const layout = layoutEdge(edge, nodes, { edges: doc.edges });
    if (!layout) continue;
    placed.push({
      edge,
      layout,
      lifted: layout.isSelfLoop && layout.isMessage,
      index: placed.length,
    });
  }

  const endpointAnchors = new Set(
    doc.edges
      .filter((e) => isSequenceMessage(e, nodes))
      .flatMap((e) => [e.source, e.target])
      .filter((id) => nodes.find((n) => n.id === id)?.data.shape === "anchor"),
  );

  // stable by z: equal z keeps document order, as React Flow does
  const byZ = nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => (a.node.zIndex ?? 0) - (b.node.zIndex ?? 0) || a.index - b.index)
    .map(({ node }) => node);
  const below = byZ.filter((n) => (n.zIndex ?? 0) < 0);
  const above = byZ.filter((n) => (n.zIndex ?? 0) >= 0);
  const flat = placed.filter((p) => !p.lifted);
  const lifted = placed.filter((p) => p.lifted);

  const box = boundsOf(nodes, placed);
  const node = (n: DiagramNode) => (
    <NodeView key={n.id} node={n} isEndpoint={endpointAnchors.has(n.id)} colors={colors} />
  );

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      width={responsive ? "100%" : box.width}
      height={responsive ? undefined : box.height}
      fontFamily={FONT_MONO}
      role="img"
    >
      <title>{doc.title}</title>
      {background === false ? null : (
        <rect
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          fill={colors.surface.canvasBg}
        />
      )}
      {below.map(node)}
      {flat.map((p) => (
        <EdgePath key={p.edge.id} placed={p} colors={colors} />
      ))}
      {flat.map((p) => (
        <EdgeLabels key={p.edge.id} placed={p} colors={colors} />
      ))}
      {above.map(node)}
      {lifted.map((p) => (
        <g key={p.edge.id}>
          <EdgePath placed={p} colors={colors} />
          <EdgeLabels placed={p} colors={colors} />
        </g>
      ))}
    </svg>
  );
};
