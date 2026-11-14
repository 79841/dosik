import { CHROME_DARK, CHROME_LIGHT, SURFACE_DARK, SURFACE_LIGHT } from "../../shared/lib/palette";
import { parseSafeSvg } from "./safeSvg";
import { type Box, fitView, keepInSight, panBy, type Size, scaleOf, zoomAt } from "./viewport";

/**
 * The diagram view that runs inside a chat (#202) — an MCP App the host puts
 * in a sandboxed frame when `render_diagram` is called.
 *
 * Plain DOM, no React: the bundle is inlined into the resource, and the view
 * is a picture with a few controls. It talks to the host only through
 * `ViewHost`, the part of the SDK's `App` it uses, so it can be tested with a
 * stand-in.
 */
type Theme = "light" | "dark";

export interface ToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ViewHost {
  callServerTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<ToolResult>;
  getHostContext(): { theme?: Theme } | undefined;
}

/** `render_diagram`'s `structuredContent` (scripts/mcp/tools.mjs) */
interface Drawing {
  svg: string;
  theme: Theme;
  title: string;
  target: { file?: string };
}

export interface DiagramView {
  /** a result pushed by the host — the model's own call */
  showResult(result: ToolResult): void;
  /** the host's context changed — its theme may have */
  hostContextChanged(): void;
}

/**
 * Tall enough that the column of controls (bottom-right) stays clear of the
 * host's own menu button (top-right).
 */
const MIN_HEIGHT = 248;
/** the strip along the right the controls float in — Fit keeps the drawing out of it */
const CONTROLS_ROOM = 44;
const MAX_HEIGHT = 520;
/** jsdom and a frame not laid out yet both measure 0 */
const FALLBACK_WIDTH = 640;
const WHEEL_STEP = 0.002;
const BUTTON_STEP = 1.25;
const KEY_PAN = 40;
const HINT_MS = 1500;
const NOTE_MS = 3000;

const textOf = (result: ToolResult): string =>
  result.content?.find((part) => part.type === "text")?.text ?? "Something went wrong.";

/**
 * The result as a drawing, or null when it carries no SVG. The rest is the
 * server's to fill; a missing piece gets a neutral default rather than a
 * throw inside the host's notification handler (#202). An older
 * server's `page` is ignored — a diagram is one canvas (#229 D17).
 */
const asDrawing = (value: Record<string, unknown> | undefined): Drawing | null => {
  if (!value || typeof value.svg !== "string") return null;
  const target = value.target as Drawing["target"] | undefined;
  return {
    svg: value.svg,
    theme: value.theme === "dark" ? "dark" : "light",
    title: typeof value.title === "string" ? value.title : "Diagram",
    target: typeof target?.file === "string" ? { file: target.file } : {},
  };
};

const isMac = (): boolean => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const STYLE_ID = "dsk-view-style";

/**
 * Chrome in the host's own look: the standard MCP Apps style variables
 * (`--color-background-primary`, `--border-radius-lg`, …) with the app's palette
 * as the fallback, so the controls match the host's own menus. No header: the drawing is the whole view. The controls float
 * over its bottom-right corner — the host keeps the top-right for its own
 * menu — one column, each button on its own like that menu button, shown
 * when the pointer is over it or focus is in it, always on a device without
 * hover. Buttons start from `all: unset`: a host may style every `button`. No backdrop of its own: the drawing sits on the chat's background,
 * like the rest of the conversation (#202) — the server draws the
 * SVG without one too. The exceptions: the zoom hint, which floats over the
 * drawing, and a host that names no theme (`data-backdrop`), whose page may
 * not match the drawing's colours.
 */
const css = `
body { margin: 0; }
.dsk-view { --bg: ${SURFACE_LIGHT.canvasBg}; --panel: ${SURFACE_LIGHT.panelBg}; --ink: ${CHROME_LIGHT.ink};
  --muted: ${CHROME_LIGHT.muted}; --line: ${CHROME_LIGHT.line}; --hover: ${CHROME_LIGHT.hover}; color: var(--ink); }
.dsk-view[data-theme="dark"] { --bg: ${SURFACE_DARK.canvasBg}; --panel: ${SURFACE_DARK.panelBg};
  --ink: ${CHROME_DARK.ink}; --muted: ${CHROME_DARK.muted}; --line: ${CHROME_DARK.line}; --hover: ${CHROME_DARK.hover}; }
.dsk-view {
  --dsk-surface: var(--color-background-primary, var(--panel));
  --dsk-hover: var(--color-background-secondary, var(--hover));
  --dsk-border: var(--color-border-tertiary, var(--line));
  --dsk-fg: var(--color-text-secondary, var(--muted));
  --dsk-fg-strong: var(--color-text-primary, var(--ink));
  --dsk-radius: var(--border-radius-lg, 10px);
  --dsk-radius-sm: var(--border-radius-md, 8px);
  --dsk-button: var(--color-background-secondary, var(--hover));
  --dsk-shadow: var(--shadow-sm, 0 1px 2px rgb(0 0 0 / 0.06), 0 2px 8px rgb(0 0 0 / 0.06));
  font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif); }
.dsk-frame { position: relative; }
.dsk-panel { background: var(--dsk-surface); border: 1px solid var(--dsk-border); border-radius: var(--dsk-radius);
  box-shadow: var(--dsk-shadow); }
.dsk-controls { position: absolute; right: 8px; bottom: 8px; display: flex; flex-direction: column;
  align-items: center; gap: 4px; opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
.dsk-frame:hover .dsk-controls, .dsk-frame:focus-within .dsk-controls { opacity: 1; pointer-events: auto; }
@media (hover: none) { .dsk-controls { opacity: 1; pointer-events: auto; } }
.dsk-controls button { all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; aspect-ratio: 1; flex: none; padding: 0; border-radius: var(--dsk-radius-sm);
  background: var(--dsk-button); color: var(--dsk-fg); cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease; }
.dsk-controls button:hover:not(:disabled) { background: color-mix(in srgb, var(--dsk-button) 82%, #000);
  color: var(--dsk-fg-strong); }
.dsk-controls button:disabled { opacity: 0.4; cursor: default; }
.dsk-controls button[hidden] { display: none; }
.dsk-controls button svg { display: block; width: 14px; height: 14px; flex: none; }
.dsk-gap { height: 4px; }
.dsk-controls button:focus-visible { outline: 2px solid var(--color-ring-primary, var(--ink)); outline-offset: 1px; }
.dsk-stage:focus-visible { outline: 2px solid var(--color-ring-primary, var(--ink)); outline-offset: -2px; }
.dsk-status { position: absolute; left: 8px; bottom: 8px; padding: 4px 8px; font-size: 12px; color: var(--dsk-fg);
  pointer-events: none; }
.dsk-status:empty { display: none; }
.dsk-alert { position: absolute; left: 8px; right: 52px; bottom: 8px; padding: 8px 10px; font-size: 12px;
  color: var(--dsk-fg-strong); }
.dsk-alert[hidden] { display: none; }
.dsk-stage { position: relative; overflow: hidden; cursor: grab; touch-action: none;
  user-select: none; -webkit-user-select: none; }
.dsk-stage.dsk-dragging { cursor: grabbing; }
.dsk-view[data-backdrop] .dsk-stage { background: var(--bg); }
.dsk-stage > svg { display: block; }
.dsk-hint { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 8px 12px;
  font-size: 12px; color: var(--dsk-fg-strong); pointer-events: none; }
.dsk-hint[hidden] { display: none; }
`;

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = "",
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** Lucide glyphs (24×24, 1.75 stroke) — the icon set the app uses */
const ICONS = {
  minus: ["M5 12h14"],
  plus: ["M5 12h14", "M12 5v14"],
  fit: [
    "M8 3H5a2 2 0 0 0-2 2v3",
    "M21 8V5a2 2 0 0 0-2-2h-3",
    "M3 16v3a2 2 0 0 0 2 2h3",
    "M16 21h3a2 2 0 0 0 2-2v-3",
  ],
  refresh: ["M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5"],
  open: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
} as const;

const glyph = (paths: readonly string[]): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.75",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  })) {
    svg.setAttribute(name, value);
  }
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
};

/** an icon button — named for screen readers, and by a tooltip for the eye */
const button = (icon: keyof typeof ICONS, label: string): HTMLButtonElement => {
  const node = element("button", "");
  node.type = "button";
  node.setAttribute("aria-label", label);
  node.title = label;
  node.append(glyph(ICONS[icon]));
  return node;
};

export const mountDiagramView = (root: HTMLElement, host: ViewHost): DiagramView => {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.append(style);
  }
  root.classList.add("dsk-view");

  const status = element("span", "dsk-status", "Drawing…");
  status.setAttribute("role", "status");
  const zoomOutButton = button("minus", "Zoom out");
  const zoomInButton = button("plus", "Zoom in");
  const fitButton = button("fit", "Fit to view");
  const refreshButton = button("refresh", "Refresh");
  const openButton = button("open", "Open in Dosik");
  openButton.hidden = true;
  // nothing to act on until the first drawing arrives
  const viewButtons = [zoomOutButton, zoomInButton, fitButton];
  for (const b of [...viewButtons, refreshButton]) b.disabled = true;
  // one column, each button on its own — the host's own menu button is the model
  const controls = element("div", "dsk-controls");
  controls.append(
    zoomInButton,
    zoomOutButton,
    fitButton,
    element("span", "dsk-gap"),
    refreshButton,
    openButton,
  );
  const alert = element("div", "dsk-alert dsk-panel");
  alert.setAttribute("role", "alert");
  alert.hidden = true;
  const stage = element("div", "dsk-stage");
  stage.tabIndex = 0;
  stage.setAttribute("role", "group");
  stage.setAttribute("aria-label", "Diagram");
  const hint = element(
    "div",
    "dsk-hint dsk-panel",
    `Use ${isMac() ? "⌘" : "Ctrl"} + scroll to zoom`,
  );
  hint.hidden = true;
  stage.append(hint);
  // one frame: the drawing, with its status, controls and alert laid over it
  const frameBox = element("div", "dsk-frame");
  frameBox.append(stage, status, controls, alert);
  root.replaceChildren(frameBox);

  let drawing: Drawing | null = null;
  /** a pushed result held back while it is drawn again in the host's theme */
  let pending: Drawing | null = null;
  /** the theme of the redraw in flight */
  let requested: Theme | null = null;
  let svg: SVGSVGElement | null = null;
  let content: Box = { x: 0, y: 0, width: 1, height: 1 };
  let frame: Size = { width: FALLBACK_WIDTH, height: MIN_HEIGHT };
  let viewBox: Box = content;
  /** the zoom at which the whole drawing fits — zooming out stops there at the latest */
  let fitScale = 1;
  // a reply to an older request must not replace a newer picture
  let latest = 0;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;

  const hostTheme = (): Theme | undefined => host.getHostContext()?.theme;
  /**
   * The chrome's colours, and the document's `color-scheme` — one scheme, the
   * host's. A frame whose scheme differs from the page around it gets an
   * opaque backdrop from the browser, so "light dark" painted a black box
   * into a light chat on a dark-mode system (#202).
   */
  const applyTheme = () => {
    const theme = hostTheme() ?? drawing?.theme ?? pending?.theme ?? "light";
    root.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    // a host that names no theme gives no promise its page matches the
    // drawing's — then the drawing brings its own backdrop (#202)
    root.toggleAttribute("data-backdrop", hostTheme() === undefined);
  };

  const showAlert = (message: string | null) => {
    alert.hidden = message === null;
    alert.textContent = message ?? "";
  };

  const note = (message: string) => {
    clearTimeout(noteTimer);
    status.textContent = message;
    noteTimer = setTimeout(() => {
      if (status.textContent === message) status.textContent = "";
    }, NOTE_MS);
  };

  const setView = (next: Box) => {
    viewBox = next;
    svg?.setAttribute("viewBox", `${next.x} ${next.y} ${next.width} ${next.height}`);
  };

  /** the frame follows the drawing's proportions, within limits a chat can hold */
  const measure = () => {
    const width = stage.clientWidth || FALLBACK_WIDTH;
    const height = Math.round(
      Math.min(
        MAX_HEIGHT,
        Math.max(MIN_HEIGHT, ((width - CONTROLS_ROOM) * content.height) / content.width),
      ),
    );
    stage.style.height = `${height}px`;
    frame = { width, height };
  };

  /** the whole drawing, left of the controls' strip */
  const fitToFrame = () => {
    measure();
    const left = { width: Math.max(1, frame.width - CONTROLS_ROOM), height: frame.height };
    const fitted = fitView(content, left);
    fitScale = scaleOf(fitted, left);
    // the same zoom over the whole frame: the strip on the right stays empty
    setView({ ...fitted, width: frame.width / fitScale });
  };

  const zoomBy = (point: { x: number; y: number }, factor: number) =>
    setView(keepInSight(zoomAt(viewBox, frame, point, factor, fitScale), content));

  const panTo = (dx: number, dy: number) =>
    setView(keepInSight(panBy(viewBox, frame, dx, dy), content));

  /** zooms around the middle of the drawing's area — left of the controls' strip */
  const zoomCentre = (factor: number) =>
    zoomBy({ x: (frame.width - CONTROLS_ROOM) / 2, y: frame.height / 2 }, factor);

  const draw = (next: Drawing) => {
    const parsed = parseSafeSvg(next.svg, document);
    // held or not, this one is settled now
    if (pending === next) pending = null;
    if (!parsed) {
      if (status.textContent === "Drawing…") status.textContent = "";
      showAlert(
        drawing
          ? "The diagram could not be read — showing the last drawing."
          : "The diagram could not be read.",
      );
      return false;
    }
    drawing = next;
    // whatever was held is answered by what is on screen now — keeping it would
    // make the next theme check judge by a drawing nobody sees (#202)
    pending = null;
    const [x = 0, y = 0, width = 1, height = 1] = (parsed.getAttribute("viewBox") ?? "")
      .split(/[\s,]+/)
      .map(Number);
    content = { x, y, width: width || 1, height: height || 1 };
    parsed.setAttribute("width", "100%");
    parsed.setAttribute("height", "100%");
    // the view's zoom owns the viewBox now; meet keeps it from stretching
    parsed.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg?.remove();
    svg = parsed;
    stage.prepend(svg);
    const name = next.title;
    // no title line on screen; the drawing carries its name for assistive tech and as a tooltip
    stage.setAttribute("aria-label", `Diagram: ${name}`);
    stage.title = name;
    openButton.hidden = next.target.file === undefined;
    for (const b of viewButtons) b.disabled = false;
    if (requested === null) refreshButton.disabled = false;
    if (status.textContent === "Drawing…") status.textContent = "";
    showAlert(null);
    applyTheme();
    fitToFrame();
    return true;
  };

  const call = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      return await host.callServerTool({ name, arguments: args });
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      };
    }
  };

  /** a redraw in flight stops counting: a newer request, a pushed result, the host's theme back */
  const abandonRedraw = () => {
    latest += 1;
    requested = null;
    refreshButton.disabled = drawing === null;
    if (status.textContent === "Drawing…" && (drawing || !pending)) status.textContent = "";
  };

  /**
   * Draws `target` again in `theme`. "failed": nothing to draw, the reason is
   * shown; "stale": something newer took over and will draw instead.
   */
  const redraw = async (
    target: Drawing["target"],
    theme: Theme,
  ): Promise<"shown" | "failed" | "stale"> => {
    const ticket = ++latest;
    requested = theme;
    refreshButton.disabled = true;
    status.textContent = "Drawing…";
    const { file } = target;
    const result = await call("render_diagram", { ...(file !== undefined ? { file } : {}), theme });
    if (ticket !== latest) return "stale";
    requested = null;
    refreshButton.disabled = false;
    status.textContent = "";
    const next = result.isError ? null : asDrawing(result.structuredContent);
    // drawn in the theme asked for — not matched again, or a server that
    // answered in another theme would be asked forever
    if (next && draw(next)) return "shown";
    if (!next) {
      const reason = textOf(result);
      showAlert(drawing ? `Couldn't refresh — showing the last drawing. ${reason}` : reason);
    }
    return "failed";
  };

  /** the host's theme wins over the one the model asked for (spec D8) */
  const matchHostTheme = () => {
    applyTheme();
    const theme = hostTheme();
    const subject = pending ?? drawing;
    if (!theme || !subject) return;
    if (theme === (requested ?? subject.theme)) return;
    if (theme === subject.theme) {
      // back to the theme already in hand: the redraw in flight is moot
      abandonRedraw();
      if (pending) draw(pending);
      return;
    }
    void redraw(subject.target, theme);
  };

  /**
   * A result the host pushed. One in the other theme is not shown first — a
   * light picture flashing in a dark chat; it is held, and shown if the
   * redraw fails.
   */
  const showResult = (result: ToolResult) => {
    // newer than any redraw in flight
    abandonRedraw();
    const next = result.isError ? null : asDrawing(result.structuredContent);
    const theme = hostTheme();
    if (!next) {
      // a picture held for the host's theme is still the newest one there is
      if (pending) draw(pending);
      if (status.textContent === "Drawing…") status.textContent = "";
      showAlert(textOf(result));
      return;
    }
    if (!theme || theme === next.theme) {
      draw(next);
      return;
    }
    pending = next;
    applyTheme();
    void redraw(next.target, theme).then((outcome) => {
      // the picture the model asked for, in the wrong theme, beats none or an older one
      if (outcome === "failed" && pending === next) draw(next);
    });
  };

  fitButton.addEventListener("click", fitToFrame);
  zoomInButton.addEventListener("click", () => zoomCentre(BUTTON_STEP));
  zoomOutButton.addEventListener("click", () => zoomCentre(1 / BUTTON_STEP));
  refreshButton.addEventListener("click", () => {
    if (drawing) void redraw(drawing.target, hostTheme() ?? drawing.theme);
  });
  openButton.addEventListener("click", async () => {
    const file = drawing?.target.file;
    if (file === undefined) return;
    openButton.disabled = true;
    const result = await call("open_in_dosik", { file });
    openButton.disabled = false;
    if (result.isError) showAlert(`Couldn't open in Dosik. ${textOf(result)}`);
    else note("Opened in Dosik");
  });

  // a plain wheel scrolls the chat, as everywhere else on the page; zooming
  // takes ⌘/Ctrl — a trackpad pinch arrives as a wheel with ctrlKey
  stage.addEventListener(
    "wheel",
    (event) => {
      if (!svg) return;
      if (!event.ctrlKey && !event.metaKey) {
        hint.hidden = false;
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => (hint.hidden = true), HINT_MS);
        return;
      }
      event.preventDefault();
      hint.hidden = true;
      const rect = stage.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      zoomBy(point, Math.exp(-event.deltaY * WHEEL_STEP));
    },
    { passive: false },
  );

  const KEYS: Record<string, () => void> = {
    "+": () => zoomCentre(BUTTON_STEP),
    "=": () => zoomCentre(BUTTON_STEP),
    "-": () => zoomCentre(1 / BUTTON_STEP),
    "0": fitToFrame,
    ArrowLeft: () => panTo(KEY_PAN, 0),
    ArrowRight: () => panTo(-KEY_PAN, 0),
    ArrowUp: () => panTo(0, KEY_PAN),
    ArrowDown: () => panTo(0, -KEY_PAN),
  };
  stage.addEventListener("keydown", (event) => {
    const action = KEYS[event.key];
    if (!svg || !action || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    action();
  });

  let dragFrom: { x: number; y: number } | null = null;
  stage.addEventListener("pointerdown", (event) => {
    if (!svg || event.button !== 0) return;
    // a drag moves the drawing — it does not select the labels it passes over
    event.preventDefault();
    stage.focus({ preventScroll: true });
    dragFrom = { x: event.clientX, y: event.clientY };
    stage.setPointerCapture?.(event.pointerId);
    stage.classList.add("dsk-dragging");
  });
  stage.addEventListener("pointermove", (event) => {
    if (!dragFrom) return;
    panTo(event.clientX - dragFrom.x, event.clientY - dragFrom.y);
    dragFrom = { x: event.clientX, y: event.clientY };
  });
  const endDrag = () => {
    dragFrom = null;
    stage.classList.remove("dsk-dragging");
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // a chat that resizes the frame gets the whole drawing again, not a cut-off corner
  if (typeof ResizeObserver !== "undefined") {
    let lastWidth = 0;
    new ResizeObserver(() => {
      if (svg && stage.clientWidth !== lastWidth) {
        lastWidth = stage.clientWidth;
        fitToFrame();
      }
    }).observe(stage);
  }

  applyTheme();
  return { showResult, hostContextChanged: matchHostTheme };
};
