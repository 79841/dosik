/**
 * The editor's geometry (#219 D19): the toolbar row under the tabs, the
 * islands that float on the canvas, the docked side panel. One place, so the
 * edit bar's placement, the zoom island and the panel's width agree — and
 * `editorLayout.test` pins the numbers to the design system's tokens
 * (`tokens.json` `layout`) and to the window's minimum width.
 */

/** the row of the diagram's path and actions at the top of the sheet (`toolbar-height`) */
export const TOOLBAR_HEIGHT = 36;

/** islands sit this far from the canvas's edges (`island-inset`) */
export const ISLAND_INSET = 12;

/** the selection edit bar's height (`island-height`) */
export const ISLAND_HEIGHT = 40;

/** the shape strip on the canvas's left: as wide as the edit bar is tall (`island-height`) */
export const SHAPE_STRIP_WIDTH = 40;

/** a zoom island button (`control-height`) */
export const ZOOM_BUTTON = 28;

/** the zoom ratio readout's least width (SPEC.md "readout min-width 44") */
export const ZOOM_READOUT_MIN = 44;

/** the zoom island at the canvas's bottom right (SPEC.md "Zoom island: 36 tall") */
export const ZOOM_ISLAND_HEIGHT = 36;

/** the room kept between two islands — the edit bar and the zoom island, the bar and the shape strip */
export const ISLAND_GAP = 8;

/**
 * The zoom island's width: padding 4 on each side, − · ratio · + │ Fit with
 * 2px between them, the divider 1px with 4px either side.
 */
export const ZOOM_ISLAND_WIDTH = 4 + 3 * ZOOM_BUTTON + ZOOM_READOUT_MIN + 4 * 2 + (1 + 2 * 4) + 4;

/** the docked AI / Mermaid panel's default width (`ai-panel-width`) */
export const AI_PANEL_WIDTH = 300;

/**
 * The canvas a docked panel always leaves beside it: what the smallest window
 * (960) has left once the docked sidebar (248) and the panel (300) are in.
 * The panel grows only as far as the canvas keeps this much.
 */
export const CANVAS_BESIDE_PANEL = 412;

/**
 * The toast stack's resting height above the sheet's bottom (#231 D18): 16 on
 * Home's sheet, the canvas's `HomeCollapse-Hidden` hint. Lifts are counted
 * from here (`Toaster`'s `NOTICE_BOTTOM`).
 */
export const TOAST_BOTTOM = 16;

/**
 * In the editor the toasts rest on the row above the bottom islands (#231
 * D18, the canvas's `TabsCollapse-Hidden`): 8 over the edit bar's top, with
 * or without a selection. The zoom island is shorter, so this clears it too —
 * a narrow canvas, where a toast reaches over it, needs nothing more (#219).
 */
export const EDITOR_TOAST_BOTTOM = ISLAND_INSET + ISLAND_HEIGHT + ISLAND_GAP;
