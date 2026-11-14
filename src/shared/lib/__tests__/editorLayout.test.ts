import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DESIGN_TOKENS } from "../../../test/designTokens";
import {
  AI_PANEL_WIDTH,
  CANVAS_BESIDE_PANEL,
  EDITOR_TOAST_BOTTOM,
  ISLAND_GAP,
  ISLAND_HEIGHT,
  ISLAND_INSET,
  SHAPE_STRIP_WIDTH,
  TOAST_BOTTOM,
  TOOLBAR_HEIGHT,
  ZOOM_BUTTON,
  ZOOM_ISLAND_HEIGHT,
  ZOOM_ISLAND_WIDTH,
  ZOOM_READOUT_MIN,
} from "../editorLayout";
import { SIDEBAR_WIDTH } from "../sidebarLayout";

const layoutToken = (name: string): number => {
  const token = DESIGN_TOKENS.layout.tokens.find((t) => t.name === name);
  if (!token) throw new Error(`no layout token ${name}`);
  return Number.parseFloat(token.value);
};

const tauriMinWidth = (): number => {
  const conf = JSON.parse(
    readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
  ) as { app: { windows: { minWidth: number }[] } };
  return conf.app.windows[0]!.minWidth;
};

describe("Editor screen dimensions (#219 D19, T1)", () => {
  it("toolbar row, island, and panel constants match the design tokens", () => {
    expect(TOOLBAR_HEIGHT).toBe(layoutToken("toolbar-height"));
    expect(ISLAND_INSET).toBe(layoutToken("island-inset"));
    expect(ISLAND_HEIGHT).toBe(layoutToken("island-height"));
    expect(AI_PANEL_WIDTH).toBe(layoutToken("ai-panel-width"));
    // "the selection edit bar and the shape strip's width"
    expect(SHAPE_STRIP_WIDTH).toBe(layoutToken("island-height"));
    expect(ZOOM_BUTTON).toBe(layoutToken("control-height"));
  });

  it("minimum canvas width 412 = minimum window − default sidebar width − default panel width", () => {
    expect(tauriMinWidth()).toBe(960);
    expect(CANVAS_BESIDE_PANEL).toBe(tauriMinWidth() - SIDEBAR_WIDTH - AI_PANEL_WIDTH);
    expect(CANVAS_BESIDE_PANEL).toBe(412);
  });

  it("the zoom island is 36 tall; width 153 = three buttons + ratio + dividers + padding (SPEC.md)", () => {
    expect(ZOOM_ISLAND_HEIGHT).toBe(36);
    // padding 4 · − 28 · 2 · ratio 44 · 2 · + 28 · 2 · divider 1 + 2×4 · 2 · fit 28 · padding 4
    expect(ZOOM_ISLAND_WIDTH).toBe(4 + 28 + 2 + 44 + 2 + 28 + 2 + 9 + 2 + 28 + 4);
    expect(ZOOM_ISLAND_WIDTH).toBe(4 + 3 * ZOOM_BUTTON + ZOOM_READOUT_MIN + 4 * 2 + 9 + 4);
    expect(ZOOM_ISLAND_WIDTH).toBe(153);
  });
});

/**
 * Where the toasts rest (#231 D18): 16 above the bottom of Home's sheet; in
 * the editor on the row above the bottom islands — 8 over the edit bar's top
 * (canvas `TabsCollapse-Hidden`). That clears the shorter zoom island too,
 * so a narrow canvas, where a toast reaches over it, needs no lift of its
 * own any more (#219).
 */
describe("Where the toast rests (#231 D18)", () => {
  it("Home sheet 16, editor 60 = top of the edit bar (12 + 40) + 8", () => {
    expect(TOAST_BOTTOM).toBe(16);
    expect(EDITOR_TOAST_BOTTOM).toBe(60);
    expect(EDITOR_TOAST_BOTTOM).toBe(ISLAND_INSET + ISLAND_HEIGHT + ISLAND_GAP);
  });

  it("the editor's 60 also clears the zoom island (12 + 36) by at least 8 — even on a narrow canvas (#219)", () => {
    expect(EDITOR_TOAST_BOTTOM).toBeGreaterThanOrEqual(
      ISLAND_INSET + ZOOM_ISLAND_HEIGHT + ISLAND_GAP,
    );
  });
});
