import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Nothing drawn inside the export capture may outline or lift itself with a
 * box-shadow.
 *
 * `renderPngBase64`/`renderSvgText` hand `.react-flow__viewport` to
 * `html-to-image`, which clones the subtree into an SVG `<foreignObject>`.
 * **WKWebView drops the border radius from box-shadows there**, so a rounded
 * element exports a square block behind itself (#138). Chromium renders it
 * correctly, which is why the browser never showed the bug.
 *
 * Tailwind's `ring` and `shadow` are both box-shadows, and the edge label wore
 * both. Measured on the light canvas (250,250,250) after each was removed:
 * the ring left a solid zinc-700 square, and `shadow-sm`'s two 10%-black
 * layers left one at 224 and 201. With both gone the strongest pixel outside
 * the pill deviates from the background by 0.
 *
 * Use `border` for outlines — it follows the radius. For lift, there is no
 * captured-safe equivalent; don't reach for one.
 *
 * What this guard cannot see (nothing violates these today):
 * - components outside `src/features/canvas`. `ViewportPortal` works anywhere
 *   inside `ReactFlowProvider`, so another feature could draw into the
 *   viewport without passing through here.
 * - CSS files and `style={{ boxShadow }}`. `App.css`'s `agent-flash` does use
 *   a box-shadow; `image.ts` drops that element from the capture by class.
 */

const CANVAS = join(process.cwd(), "src/features/canvas");

/**
 * Everything under `src/features/canvas` is treated as captured; these are the
 * exceptions, each of which draws outside `.react-flow__viewport`.
 *
 * The list points this way round on purpose. A new component that renders into
 * the viewport is guarded by default, so the list going stale is safe; an
 * allowlist of captured files goes stale the dangerous way (#138).
 */
const NOT_CAPTURED = [
  // `fixed` popups, siblings of the flow — never in the viewport subtree
  "DropNodeMenu.tsx",
  "EdgeContextMenu.tsx",
  "NodeContextMenu.tsx",
  "CanvasContextMenu.tsx",
  // the items and submenus of those popups (#281)
  "menuParts.tsx",
  // the flow container itself and an overlay pinned to it, not to the canvas
  "DiagramCanvas.tsx",
  "ArrowDrawOverlay.tsx",
  // alive only while a connection is being dragged, and an export cannot start
  // mid-drag
  "ConnectionLine.tsx",
  // imperative viewport moves; renders nothing
  "ViewportReveal.tsx",
  // an island in the canvas column, a sibling of `.react-flow` — never in the
  // viewport subtree. It draws the shared `shared/ui/ZoomIsland` (#221), whose
  // shadow-raised this guard cannot see from here: moving it into a
  // `ViewportPortal` would put that shadow into PNG exports as a square block
  // (#219)
  "ZoomIsland.tsx",
];

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "__tests__" ? [] : sources(path);
    // `.ts` too: Tailwind class strings live in plain modules here as well
    // (`shared/lib/palette.ts` keeps the colour tokens that way), and a
    // `const LIFT = "shadow-md"` would otherwise walk past the guard as an
    // identifier.
    return path.endsWith(".tsx") || path.endsWith(".ts") ? [path] : [];
  });

/**
 * Comments are prose, not markup — and this file's own subject matter makes
 * "ring" show up in them. Scanning the raw text flagged three files that draw
 * no ring at all.
 *
 * This is an approximation, not a tokenizer: a `//` or `/*` inside a string
 * literal swallows the rest of the line (or up to the next `*` + `/`). That
 * direction hides code from the guard rather than inventing offenders, so a
 * false pass is possible — no canvas file has such a literal today.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const read = (path: string) => stripComments(readFileSync(path, "utf8"));

/**
 * Any Tailwind ring utility, whatever it is wearing: `ring`, `ring-2`,
 * `ring-inset`, `ring-zinc-200`, any variant chain in front of it
 * (`dark:group-hover:ring-2`), an `!important` flag, and a token that ends at
 * a template interpolation rather than whitespace. Enumerating variants misses
 * the ones nobody thought of, so this matches on token boundaries instead.
 */
const RING = /(?<![\w-])!?ring(?:-[\w[\]/.-]+)?(?![\w-])/;

/**
 * The one shadow that is allowed inside the capture, and only as this exact
 * pair of classes: the snap dot that `SnapPointsOverlay` draws while a
 * connection is being dragged. A drag and an export cannot overlap — the
 * export is started from the toolbar, which ends the drag — so it never
 * reaches a capture.
 *
 * Excusing the whole file would be the same mistake `NOT_CAPTURED` was just
 * turned around to avoid: `ShapeNode.tsx` is the most-edited file here, and a
 * `shadow-lg` added to the always-on node body would inherit the exemption
 * (#138, mutation M4). The allowance is the string, not the file.
 */
/**
 * The exemption is one named constant in ShapeNode, not its class string — a
 * `shadow-raised` is the app's ordinary lift (#158, the design system's token
 * since #216), so the string alone would excuse it anywhere in the file
 * (#158).
 */
const DRAG_ONLY_SHADOW_DECL = 'const SNAP_DOT_LIFT = "shadow-raised";';

/** Same shape as RING: any variant chain, `!important`, interpolation. */
const SHADOW = /(?<![\w-])!?shadow(?:-[\w[\]/.-]+)?(?![\w-])/;

const captured = () =>
  sources(CANVAS)
    .map((path) => path.slice(CANVAS.length + 1))
    .filter((name) => !NOT_CAPTURED.includes(name));

describe("Chrome that shows up in exports (#138)", () => {
  it("Draws no borders with ring inside the capture area", () => {
    const offenders = captured().filter((name) => RING.test(read(join(CANVAS, name))));
    expect(offenders).toEqual([]);
  });

  it("Uses no shadows inside the capture area", () => {
    const offenders = captured().filter((name) =>
      SHADOW.test(read(join(CANVAS, name)).split(DRAG_ONLY_SHADOW_DECL).join(" ")),
    );
    expect(offenders).toEqual([]);
  });

  it("The shadow exception is a single named constant (#158)", () => {
    const source = read(join(CANVAS, "ShapeNode.tsx"));
    expect(source.split(DRAG_ONLY_SHADOW_DECL)).toHaveLength(2);
    // the class string appears nowhere else in the file — only through the name
    expect(source.split("shadow-raised")).toHaveLength(2);
  });

  it("The exception list contains only files that exist", () => {
    // A renamed or deleted file would otherwise leave a hole that silently
    // excuses whatever takes its place.
    const present = sources(CANVAS).map((path) => path.slice(CANVAS.length + 1));
    expect(NOT_CAPTURED.filter((name) => !present.includes(name))).toEqual([]);
  });
});
