import type { PaletteColor, ShapeKind } from "./types";

/**
 * A colour's roles in the Studio style (#210) — borderless tinted tiles, the
 * colour carried by the tile and its icon, the label in ink.
 *
 * Two roles carry the colour's deep tone, split by what is behind them (#216):
 * `glyph` sits on the tile, so it is the same in both themes, like the tile;
 * `stroke` sits on the bare canvas, so it brightens on the dark one.
 */
export interface ColorToken {
  /** the tile's face */
  fill: string;
  /**
   * the colour on the bare canvas: a coloured line and its label, a coloured
   * frame's title, an icon node, the text shape (through `canvasInk`)
   */
  stroke: string;
  /** a label on the tile — ink for every hue */
  text: string;
  /** one step deeper than the face: a cylinder's lid, a sticky's fold, a badge tag */
  cap: string;
  /** a coloured group's dashed outline */
  line: string;
  /**
   * a glyph drawn on the tile — a box's decorative icon (#216). `stroke` is
   * the colour on bare canvas, which stays bright in the dark theme; the
   * glyph sits on the pastel tile, so it keeps the light deep tone.
   */
  glyph: string;
}

/** the design system's `ink` (#216 D2): page text, default lines, tile labels */
const INK_LIGHT = "#1A1A1A";
const INK_DARK = "#EDEDED";

/** a tile whose glyph is its deep tone — the light theme's canvas colour too */
const tile = (fill: string, deep: string, cap: string, line: string): ColorToken => ({
  fill,
  stroke: deep,
  text: INK_LIGHT,
  cap,
  line,
  glyph: deep,
});

/**
 * Order is the colour picker's order. `mono` leads: it is the default for new
 * shapes (#158) — a warm grey tile — and the hues follow as choices. Values are
 * the confirmed Studio mockups (#210), the design system's `tile-*`, `tile-*-cap`
 * and `deep-*` tokens (#216; `designTokens.test.ts` holds them together).
 */
export const COLOR_TOKENS: Record<PaletteColor, ColorToken> = {
  mono: tile("#EAE8E4", "#4A4743", "#DEDBD6", "#A9A49D"),
  violet: tile("#EEE9F8", "#5B3DB5", "#E1D9F2", "#8E72DB"),
  blue: tile("#E6EEF9", "#2B66B8", "#D6E3F4", "#4A86D8"),
  teal: tile("#E1F1EE", "#0E766D", "#CDE6E1", "#2E9C91"),
  green: tile("#E6F1E3", "#2E7535", "#D3E6CD", "#4C9A54"),
  amber: tile("#FBEFD9", "#A65809", "#F3DFB8", "#E08A2C"),
  rose: tile("#F8E7E6", "#B0243F", "#EED2D1", "#D9566E"),
  gray: tile("#ECEBEE", "#55545A", "#DEDDE1", "#9C9BA2"),
  ink: {
    fill: "#1F1E1D",
    stroke: "#FFFFFF",
    text: "#FFFFFF",
    cap: "#3A3836",
    line: "#1F1E1D",
    glyph: "#FFFFFF",
  },
};

/** the light tile on the dark canvas: its colour where no tile sits, brightened */
const onDark = (color: PaletteColor, stroke: string, line: string): ColorToken => ({
  ...COLOR_TOKENS[color],
  stroke,
  line,
});

/**
 * Dark-theme variants (#216): the same pastel tiles with their ink labels and
 * deep glyphs — only what is drawn on the bare canvas changes, to a bright tone
 * that reads on it (`stroke`, AA on `SURFACE_DARK.canvasBg`) and a group outline
 * that shows there (`line`). `ink`, the inverted hero tile, flips whole.
 */
export const DARK_COLOR_TOKENS: Record<PaletteColor, ColorToken> = {
  mono: onDark("mono", "#CFCAC3", "#5A5650"),
  violet: onDark("violet", "#B9A6F5", "#8E78E0"),
  blue: onDark("blue", "#8DB2F6", "#5C8FD9"),
  teal: onDark("teal", "#62C6BB", "#3FA398"),
  green: onDark("green", "#86C78A", "#5BA562"),
  amber: onDark("amber", "#E8A75A", "#D98A36"),
  rose: onDark("rose", "#F28FA1", "#D9667C"),
  gray: onDark("gray", "#AEADB3", "#6E6D73"),
  ink: {
    fill: "#F2F0ED",
    stroke: "#141312",
    text: "#141312",
    cap: "#D9D6D1",
    line: "#F2F0ED",
    glyph: "#141312",
  },
};

export const PALETTE_COLORS = Object.keys(COLOR_TOKENS) as PaletteColor[];

/**
 * The colour to draw with where no tile sits behind it — a coloured line, an
 * icon node's glyph, a frame's title, a swatch's edge. That is the deep tone,
 * except for `ink`, whose deep tone is the white it puts on its own dark tile:
 * on the bare canvas that would vanish, so it takes its near-black `line`.
 */
export const canvasInk = (color: PaletteColor, tokens: Record<PaletteColor, ColorToken>): string =>
  color === "ink" ? tokens.ink.line : (tokens[color] ?? tokens.violet).stroke;

/**
 * Text a node draws straight on the canvas — a frame's title, a fragment's
 * operator, the text shape: `uncoloured` (an ink) for mono, else the colour as
 * it reads on the canvas.
 */
export const onCanvasColor = (
  color: PaletteColor,
  tokens: Record<PaletteColor, ColorToken>,
  uncoloured: string,
): string => (color === "mono" ? uncoloured : canvasInk(color, tokens));

/**
 * A node's label colour, for the canvas and every export alike. On a tile it is
 * the tile's label colour; a shape without one has the canvas behind its text —
 * an icon node labels in the page's ink (#210 D15), the text shape in its colour,
 * a frame titles in its border colour and a fragment's guard is quiet (#210).
 */
export const nodeLabelColor = (
  { shape, color }: { shape: ShapeKind; color: PaletteColor },
  tokens: Record<PaletteColor, ColorToken>,
  surface: Pick<SurfaceTokens, "ink" | "inkMuted">,
): string => {
  switch (shape) {
    case "frame":
      return onCanvasColor(color, tokens, surface.inkMuted);
    case "fragment":
      return surface.inkMuted;
    case "icon":
      return surface.ink;
    case "text":
      return onCanvasColor(color, tokens, surface.ink);
    default:
      return (tokens[color] ?? tokens.violet).text;
  }
};

/**
 * The diagram's face for what cannot read `--font-mono` — an SVG file, the
 * Mermaid renderer: the design system's mono stack (#216), in single quotes
 * for an SVG attribute. The interface is Manrope; the diagram never is, since
 * label sizes assume this monospaced face (`textLayout.ts`).
 */
export const FONT_MONO =
  "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Malgun Gothic', 'Segoe UI Emoji', monospace";

/** Default edge color when no palette color is set (light theme): the ink (#210). */
export const EDGE_STROKE = INK_LIGHT;

/**
 * Tailwind class tokens for the app's chrome (#131).
 *
 * The canvas renders from `COLOR_TOKENS`; everything drawn as DOM — panels,
 * buttons, labels — takes its colour from the design system's tokens (#216):
 * semantic utilities (`bg-surface`, `text-muted`…, App.css) that read the
 * token variables, so one class serves both themes. These are the ones with a
 * name in the app; `chromeTokens.test.ts` checks their contrast against
 * `tokens.json` (muted on `surface`: 5.33:1 light, 6.52:1 dark).
 */
export const TEXT_MUTED = "text-muted";
/** muted text that darkens on hover — icon buttons, dismiss controls */
export const TEXT_MUTED_HOVER = "hover:text-ink";
/**
 * Muted text on a *tinted* surface (a selected palette group, a hovered row).
 * `TEXT_MUTED` loses its margin on a fill, so anything that sits on one steps
 * up one notch.
 */
export const TEXT_MUTED_ON_FILL = "text-muted-strong";

/**
 * The app's accent (#158): the ink — near-black in the light theme, near-white
 * in the dark one — with the surface as its label. `primary`, `primary-hover`
 * and `primary-fg` are App.css names for those tokens, so one class works in
 * both themes (17.4:1 light, 14.6:1 dark).
 */
export const ACCENT_SURFACE = "bg-primary text-primary-fg";
/** the same surface when it is a button */
export const ACCENT_BUTTON = `${ACCENT_SURFACE} transition-colors hover:bg-primary-hover`;
/**
 * The quiet accent — what is on or current (the active page, the open
 * palette group, the chosen menu item). A black tab is too heavy next to the
 * black buttons, so "selected" is a grey wash with strong text instead (where
 * a child sets its own text colour, only the wash applies) — the `selected`
 * tint, one step darker than `hover`, so the two never read the same.
 */
export const ACCENT_SOFT = "bg-selected text-ink";
/**
 * Keyboard focus on chrome controls: the design system's `focus` outline
 * (2px, 2px offset), not the webview's default blue ring (#178). An outline,
 * not a ring — cards already use `ring-*` for their edge.
 */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
/**
 * Keyboard focus on a menu item: the hover wash, no outline — an outline is
 * clipped by a scrolling menu and reads heavy in a list (#178).
 * `outline-hidden`, not `-none`: forced-colors mode drops the wash, and keeps
 * a transparent outline that the system then paints.
 */
export const FOCUS_ITEM = "focus-visible:outline-hidden focus-visible:bg-hover";
/**
 * Keyboard focus on a tree row (#217): the treeitem that takes focus also
 * holds its children, so the `focus` outline is drawn on its own row
 * (`[data-row]`) — inset, since the tree scrolls and would clip it.
 */
export const FOCUS_TREE_ROW =
  "outline-hidden focus-visible:[&>[data-row]]:outline-2 focus-visible:[&>[data-row]]:-outline-offset-2 focus-visible:[&>[data-row]]:outline-focus";
/** the accent as a raw colour, for SVG strokes and inline styles */
export const THEME_PRIMARY = `var(--ink, ${INK_LIGHT})`;

/** Non-node colors that flip with the theme (canvas chrome, edges). */
export interface SurfaceTokens {
  canvasBg: string;
  canvasDot: string;
  /** floating panel background (toolbar, inspector, palette, pills) */
  panelBg: string;
  edgeStroke: string;
  /** the darkest ink on the page — default lines, row text on a card (#210) */
  ink: string;
  /** quiet ink — keys, visibility marks, an uncoloured frame's title, guards */
  inkMuted: string;
  /** a lifeline's dashed line */
  lifeline: string;
  /** a lifeline's activation bar */
  act: string;
  /** a class or entity card's body, under the tinted header strip */
  cardBody: string;
  /** a class or entity card's 1px edge and its rules */
  cardBorder: string;
}

/**
 * The design system's values (`design/design-system`, #216) as hex — SVG, PNG,
 * the windowless CLI and the MCP view cannot read its CSS variables. Each role
 * is one token: canvas, panels and card bodies `surface`, the dots `dot`, ink
 * `ink`, quiet ink `muted`, lifelines `dash`, activation bars and card edges
 * `selected`. `designTokens.test.ts` fails if they drift from `tokens.json`.
 */
export const SURFACE_LIGHT: SurfaceTokens = {
  canvasBg: "#FFFFFF",
  canvasDot: "#E0E0E0",
  panelBg: "#FFFFFF",
  edgeStroke: EDGE_STROKE,
  ink: INK_LIGHT,
  inkMuted: "#6B6B6B",
  lifeline: "#B8B8B8",
  act: "#E6E6E6",
  cardBody: "#FFFFFF",
  cardBorder: "#E6E6E6",
};

export const SURFACE_DARK: SurfaceTokens = {
  canvasBg: "#1C1C1C",
  canvasDot: "#2A2A2A",
  panelBg: "#1C1C1C",
  edgeStroke: INK_DARK,
  ink: INK_DARK,
  inkMuted: "#A0A0A0",
  lifeline: "#555555",
  act: "#333333",
  cardBody: "#1C1C1C",
  cardBorder: "#333333",
};

/**
 * Chrome as raw colours, for UI that cannot use the Tailwind classes above —
 * the MCP chat view (#202) is plain CSS in someone else's frame. The design
 * system's tokens of the same names (#216).
 */
export interface ChromeColors {
  ink: string;
  muted: string;
  line: string;
  /** a hovered or resting button's wash */
  hover: string;
}

export const CHROME_LIGHT: ChromeColors = {
  ink: INK_LIGHT,
  muted: "#6B6B6B",
  line: "#EBEBEB",
  hover: "#F0F0F0",
};
export const CHROME_DARK: ChromeColors = {
  ink: INK_DARK,
  muted: "#A0A0A0",
  line: "#2C2C2C",
  hover: "#2A2A2A",
};

/**
 * CSS-variable indirection for canvas rendering: the theme store writes the
 * active token values into these variables on <html>, so SVG/DOM colors flip
 * without every consumer subscribing to the theme. Light values are baked in
 * as fallbacks so renders outside initTheme() (unit tests, embeds) stay light
 * instead of falling to invalid colors.
 */
export const COLOR_ROLES = [
  "fill",
  "stroke",
  "text",
  "cap",
  "line",
  "glyph",
] as const satisfies readonly (keyof ColorToken)[];

const themeToken = (color: PaletteColor): ColorToken =>
  Object.fromEntries(
    COLOR_ROLES.map((role) => [role, `var(--dsk-${color}-${role}, ${COLOR_TOKENS[color][role]})`]),
  ) as unknown as ColorToken;

export const THEME_COLOR_TOKENS = Object.fromEntries(
  PALETTE_COLORS.map((color) => [color, themeToken(color)]),
) as Record<PaletteColor, ColorToken>;

/**
 * A shape thumbnail on a panel — the palette rail, the drop menu: mono a step
 * darker than its canvas tile, which would all but vanish on white at that
 * size (#210).
 */
export const THUMBNAIL_PAINT = {
  fill: THEME_COLOR_TOKENS.mono.line,
  cap: THEME_COLOR_TOKENS.mono.stroke,
  stroke: THEME_COLOR_TOKENS.mono.stroke,
} as const;

/** the surface roles written to CSS variables, as `--dsk-<kebab-name>` */
export const SURFACE_VARS = {
  canvasBg: "--dsk-canvas-bg",
  canvasDot: "--dsk-canvas-dot",
  panelBg: "--dsk-panel-bg",
  edgeStroke: "--dsk-edge-stroke",
  ink: "--dsk-ink",
  inkMuted: "--dsk-ink-muted",
  lifeline: "--dsk-lifeline",
  act: "--dsk-act",
  cardBody: "--dsk-card-body",
  cardBorder: "--dsk-card-border",
} as const satisfies Record<keyof SurfaceTokens, string>;

const themeSurface = (key: keyof SurfaceTokens) =>
  `var(${SURFACE_VARS[key]}, ${SURFACE_LIGHT[key]})`;

export const THEME_EDGE_STROKE = themeSurface("edgeStroke");
export const THEME_CANVAS_BG = themeSurface("canvasBg");
export const THEME_CANVAS_DOT = themeSurface("canvasDot");
export const THEME_INK = themeSurface("ink");
export const THEME_INK_MUTED = themeSurface("inkMuted");
export const THEME_LIFELINE = themeSurface("lifeline");
export const THEME_ACT = themeSurface("act");
export const THEME_CARD_BODY = themeSurface("cardBody");
export const THEME_CARD_BORDER = themeSurface("cardBorder");

/**
 * A colour swatch's look — the edit bar, the node and edge context menus
 * (#210 D17): the tile, a 2px edge in the colour as it reads on bare canvas, a
 * ring when it is the one picked. `undefined` is a line's default colour, the
 * ink it is drawn in.
 */
export const swatchStyle = (
  color: PaletteColor | undefined,
  selected: boolean,
  ring = 4,
): { backgroundColor: string; border: string; boxShadow?: string } => {
  const edge = color ? canvasInk(color, THEME_COLOR_TOKENS) : THEME_EDGE_STROKE;
  return {
    backgroundColor: color ? THEME_COLOR_TOKENS[color].fill : "var(--dsk-panel-bg)",
    border: `2px solid ${edge}`,
    ...(selected ? { boxShadow: `0 0 0 2px var(--dsk-panel-bg), 0 0 0 ${ring}px ${edge}` } : {}),
  };
};

export type ShapeGroupId =
  | "flow"
  | "sequence"
  | "class"
  | "data"
  | "icons"
  | "note"
  | "image"
  | "frame";

/**
 * Palette grouping — SSOT for both the shape rail and the flat SHAPE_KINDS list.
 *
 * Grouped by **which diagram the shape belongs to**, not by how it looks. That
 * is the axis every comparable tool organizes on: Eraser splits its editor into
 * flowchart / sequence / ERD / cloud architecture / BPMN, and draw.io,
 * Lucidchart and Miro all ship one shape library per diagram type. Geometry
 * ("rounded things here, angular things there") is not an axis any of them use.
 */
export const SHAPE_GROUPS: {
  id: ShapeGroupId;
  /** the group's name: the strip button's tooltip and accessible name (#219 D8) */
  label: string;
  /** shape drawn as the strip icon — the group's most recognizable member */
  icon: ShapeKind;
  /** ordered by role in a flow: terminal → process → branch → data */
  shapes: ShapeKind[];
}[] = [
  {
    id: "flow",
    label: "Flowchart",
    icon: "diamond",
    shapes: ["ellipse", "rect", "rounded", "diamond", "hexagon", "parallelogram", "cylinder"],
  },
  {
    id: "sequence",
    label: "Sequence diagram",
    icon: "lifeline",
    shapes: ["lifeline", "fragment"],
  },
  {
    id: "class",
    label: "Class diagram",
    icon: "class",
    shapes: ["class"],
  },
  {
    id: "data",
    label: "Entity relationship",
    icon: "entity",
    shapes: ["entity"],
  },
  {
    id: "icons",
    label: "Architecture icons",
    icon: "icon",
    // one shape kind; the flyout offers the icon set instead of a shape list
    shapes: ["icon"],
  },
  {
    id: "note",
    label: "Notes & text",
    icon: "sticky",
    shapes: ["sticky", "text"],
  },
  // a picture and an area are neither notes nor text — each is its own tool (#180)
  {
    id: "image",
    label: "Images",
    icon: "image",
    shapes: ["image"],
  },
  {
    id: "frame",
    label: "Frames",
    icon: "frame",
    shapes: ["frame"],
  },
];

export const SHAPE_KINDS: ShapeKind[] = SHAPE_GROUPS.flatMap((g) => g.shapes);

/**
 * What a shape *means* in a diagram, as opposed to what it looks like.
 * Follows the ISO 5807 flowchart vocabulary and Mermaid's "Process (Rectangle)"
 * convention — Miro likewise shows the role ("Predefined Process") on hover
 * rather than the geometry. Used in the palette, where the user is picking by
 * intent; SHAPE_LABELS stays geometric for the inspector and the bridge API.
 */
export const SHAPE_ROLES: Record<ShapeKind, string> = {
  class: "Class",
  anchor: "Anchor",
  ellipse: "Start / End",
  rect: "Process",
  rounded: "Event",
  diamond: "Decision",
  hexagon: "Preparation",
  parallelogram: "Input / Output",
  cylinder: "Database",
  lifeline: "Lifeline",
  fragment: "Fragment",
  frame: "Frame",
  sticky: "Sticky note",
  text: "Text",
  icon: "Icon",
  image: "Image",
  entity: "Entity",
};

/**
 * Outline width of every shape — boxes, class and entity tables, frames,
 * lifelines and fragments. Thinner than it was (1.5); edges keep their own
 * width.
 */
export const SHAPE_STROKE_WIDTH = 1;

/** fixed header height of a lifeline node; the dashed line spans the rest */
export const LIFELINE_HEADER_H = 40;
/** width of an activation bar drawn on a lifeline */
export const LIFELINE_ACTIVATION_W = 10;

/** half-size of the UML destroy marker (X) drawn on a lifeline */
export const DESTROY_MARK_R = 7;

/**
 * A title set into a dashed border (#210 D10): a frame's title and a
 * fragment's operator sit on the top edge, `inset` from the left, on a
 * canvas-coloured patch `padX` wider than the text each side that cuts the
 * dashes — Cloudflare's group labels.
 */
export const BORDER_TITLE = {
  inset: 14,
  padX: 6,
  height: 16,
  fontSize: 12,
  fontWeight: 600,
} as const;

/** a fragment's guard — its label — sits inside, at the top-left (#210 D11) */
export const FRAGMENT_GUARD = { left: 14, right: 12, top: 10, height: 18, fontSize: 11 } as const;

/**
 * Default paint order for a new fragment. Negative so the frame lands *below*
 * the edge layer — React Flow gives `.react-flow__edges` no z-index inside the
 * viewport stacking context, so only a negative node z gets behind messages.
 */
export const FRAGMENT_DEFAULT_Z = -1;

/** a frame (#170) sits further back still — behind fragments and every edge */
export const FRAME_DEFAULT_Z = -2;

/** a frame's title strip along its top edge — the title and the grab area (#170) */
export const FRAME_TITLE_H = 30;

/**
 * Shapes that are a backdrop rather than a box (#170 D2): their body lets
 * clicks through to the canvas, only the drawn parts can be grabbed, and they
 * take no connections, sit out of routing and auto-layout.
 */
export const isBackdrop = (shape: ShapeKind): boolean => shape === "fragment" || shape === "frame";

/**
 * Applied to a backdrop's (fragment, frame) React Flow wrapper via `node.style`.
 *
 * The wrapper spans the whole node and NodeWrapper writes
 * `pointerEvents: 'all'` **inline**, which a plain class can't override —
 * but it spreads `...node.style` right after, so this is the override point
 * the library actually leaves open. Turning it off on our own root inside the
 * wrapper does nothing: the wrapper is the element that receives the click.
 */
export const BACKDROP_STYLE = { pointerEvents: "none" } as const;

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  class: "Class box",
  anchor: "Anchor",
  fragment: "Fragment frame",
  frame: "Frame",
  rounded: "Rounded box",
  rect: "Rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
  parallelogram: "Parallelogram",
  cylinder: "Database",
  hexagon: "Hexagon",
  sticky: "Sticky note",
  text: "Text",
  lifeline: "Lifeline",
  icon: "Icon",
  image: "Image",
  entity: "Entity",
};

/** icon nodes: the label line under the glyph, in node pixels (#9) */
export const ICON_LABEL_H = 22;
/** icon nodes: the glyph area never shrinks below this, so the label cannot overlap it */
export const ICON_MIN_GLYPH_H = 24;
/**
 * icon nodes: how much of the area above the label the glyph fills. There is
 * no box around it, so the glyph itself is the node — the
 * remaining margin only keeps the strokes off the resize band.
 */
export const ICON_GLYPH_RATIO = 0.8;

export const DEFAULT_NODE_SIZE: Record<ShapeKind, { width: number; height: number }> = {
  anchor: { width: 12, height: 12 },
  rounded: { width: 160, height: 56 },
  rect: { width: 160, height: 56 },
  ellipse: { width: 150, height: 70 },
  diamond: { width: 140, height: 90 },
  parallelogram: { width: 170, height: 60 },
  cylinder: { width: 130, height: 90 },
  hexagon: { width: 160, height: 70 },
  sticky: { width: 170, height: 120 },
  text: { width: 140, height: 36 },
  lifeline: { width: 120, height: 360 },
  fragment: { width: 420, height: 200 },
  frame: { width: 480, height: 300 },
  class: { width: 200, height: 36 },
  // 96 wide; the glyph takes the height above the label line (IconNodeSvg)
  icon: { width: 96, height: 96 },
  image: { width: 240, height: 160 },
  // header only; a column row adds to it (entityNodeHeight)
  entity: { width: 200, height: 32 },
};

/**
 * A tree row a drag would drop into (#230 D9, canvas v39 `Sidebar-States` ④):
 * the selected fill and a 1.5px ink inset ring ({@link DROP_RING}). The ring is
 * what tells the target from the selected row, so it shows on the selected row
 * too (2026-11-07). `--row-bg` is the fill a row's sticky tail
 * fades into.
 */
export const DROP_TARGET = "bg-selected [--row-bg:var(--selected)]";
/**
 * The drop target's 1.5px ink inset ring, on its own layer over the row: a
 * row's own inset shadow paints under its children, and the sticky tail's
 * fill (count, `…`) would cover the ring's right end.
 */
export const DROP_RING =
  "pointer-events-none absolute inset-0 z-10 rounded-[inherit] shadow-[inset_0_0_0_1.5px_var(--ink)]";
