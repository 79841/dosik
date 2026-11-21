import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DESIGN_TOKENS } from "../test/designTokens";
import {
  BAND_BUTTON,
  BAND_BUTTON_TOP,
  bandLeading,
  CAPTION_BUTTON,
  CHROME_CENTER_Y,
  CHROME_HEIGHT,
  LIGHT_GAP,
  LIGHT_ORIGIN_Y,
  LIGHT_SIZE,
  LIGHTS_END,
  TAB_HEIGHT,
  TAB_PINNED_WIDTH,
  TAB_WIDTH,
  tabsLeft,
  TRAFFIC_LIGHT_INSET,
  TRAFFIC_LIGHT_POSITION,
} from "../shared/lib/windowChrome";

const json = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as Record<string, unknown>;

const windowsOf = (path: string): Record<string, unknown>[] =>
  (json(path).app as { windows?: Record<string, unknown>[] }).windows ?? [];

const mainWindow = (path: string): Record<string, unknown> => windowsOf(path)[0] ?? {};

/** a `layout` token of the design system, as a number of px */
const layoutToken = (name: string): number => {
  const token = DESIGN_TOKENS.layout.tokens.find((t) => t.name === name);
  if (!token) throw new Error(`no layout token ${name}`);
  return Number.parseFloat(token.value);
};

/**
 * The window setup lives outside the code (`tauri.conf.json` and the macOS
 * override), so nothing but a test looks at it — while the chrome band is drawn
 * around these exact values. Tauri merges `tauri.macos.conf.json` with RFC 7396
 * semantics, which **replaces** the whole `windows` array, so the macOS file
 * carries a full copy and every base field has to be repeated there.
 */
describe("Window config (#125, #127, #217)", () => {
  const base = mainWindow("src-tauri/tauri.conf.json");
  const mac = mainWindow("src-tauri/tauri.macos.conf.json");
  /** the only field the two are meant to disagree on */
  const PLATFORM_SPECIFIC = new Set(["decorations"]);

  it("macOS uses the native window and the app draws only the title bar area — Overlay · hiddenTitle", () => {
    // native decorations keep the rounded corners, the cached shadow, the real
    // traffic lights, native full screen and ⌘W (#127)
    expect(mac.decorations).toBe(true);
    expect(mac.titleBarStyle).toBe("Overlay");
    expect(mac.hiddenTitle).toBe(true);
  });

  /**
   * The band the app draws and the lights the window draws have to share one
   * centre line, and only one of the two can be computed — the config is JSON.
   * So the config is pinned to the band's geometry here: move the band and this
   * fails until `tauri.macos.conf.json` follows.
   */
  it("Traffic light position matches the value derived from the strip geometry — {x:20, y:26} (#217 T1)", () => {
    expect(TRAFFIC_LIGHT_POSITION).toEqual({ x: 20, y: 26 });
    expect(mac.trafficLightPosition).toEqual({ ...TRAFFIC_LIGHT_POSITION });
  });

  it("Traffic light dimensions are measured values — changing them breaks every strip calculation", () => {
    // macOS 26, probed with a real NSWindow: 14×14 buttons 23px apart, and tao
    // leaves the button's own origin.y (9) alone when it insets them
    expect([LIGHT_SIZE, LIGHT_GAP, LIGHT_ORIGIN_Y]).toEqual([14, 23, 9]);
  });

  it("Traffic lights sit on the strip's center line (y=24) and the first one is at x=20", () => {
    // the gap above the buttons is `y - 9`, not y (tao)
    const top = TRAFFIC_LIGHT_POSITION.y - LIGHT_ORIGIN_Y;
    expect(top + LIGHT_SIZE / 2).toBe(CHROME_CENTER_Y);
    expect(TRAFFIC_LIGHT_POSITION.x).toBe(TRAFFIC_LIGHT_INSET);
    expect(LIGHTS_END).toBe(20 + 2 * 23 + 14);
  });

  it("Strip constants match the design tokens — chrome-height·traffic-light-inset·traffic-light-center·tab-* (#217 T40)", () => {
    expect(CHROME_HEIGHT).toBe(layoutToken("chrome-height"));
    expect(TRAFFIC_LIGHT_INSET).toBe(layoutToken("traffic-light-inset"));
    expect(CHROME_CENTER_Y).toBe(layoutToken("traffic-light-center"));
    expect(TAB_HEIGHT).toBe(layoutToken("tab-height"));
    expect(TAB_WIDTH).toBe(layoutToken("tab-width"));
    expect(TAB_PINNED_WIDTH).toBe(layoutToken("tab-pinned-width"));
    expect(BAND_BUTTON).toBe(layoutToken("control-height-sm"));
  });

  it("A Windows caption button is the design token's width and as tall as the band — 46×40", () => {
    expect(CAPTION_BUTTON).toBe(layoutToken("caption-button"));
    expect(CAPTION_BUTTON).toBe(46);
    expect(CHROME_HEIGHT).toBe(40);
  });

  it("Strip buttons share the center line — a 24px button starts at top 12", () => {
    expect(BAND_BUTTON_TOP + BAND_BUTTON / 2).toBe(CHROME_CENTER_Y);
    // a tab is 32 tall, bottom flush with the band: its centre is on the line too
    expect(CHROME_HEIGHT - TAB_HEIGHT / 2).toBe(CHROME_CENTER_Y);
  });

  it("When hidden, Show sidebar sits at the traffic lights' end + 8 (macOS 88), otherwise 12 — tabs start at 124 / 48 (#217 T2)", () => {
    expect(bandLeading(true)).toBe(LIGHTS_END + 8);
    expect(bandLeading(true)).toBe(88);
    expect(bandLeading(false)).toBe(12);
    expect(tabsLeft(null, true)).toBe(124);
    expect(tabsLeft(null, false)).toBe(48);
  });

  it("When docked, tabs start at the sidebar width + 8", () => {
    expect(tabsLeft(248, true)).toBe(256);
    expect(tabsLeft(300, false)).toBe(308);
  });

  it("Other platforms use an undecorated window — no overlay style, so the app draws the controls", () => {
    expect(base.decorations).toBe(false);
    expect(base.titleBarStyle).toBeUndefined();
  });

  it("Every window setting in the base config is also in the macOS file with the same value", () => {
    // the array is replaced wholesale, so a second window added to the base
    // would vanish on macOS while a [0]-only comparison stayed green
    expect(windowsOf("src-tauri/tauri.macos.conf.json")).toHaveLength(
      windowsOf("src-tauri/tauri.conf.json").length,
    );
    // the array is replaced, not merged: a field added to the base only would
    // silently vanish on macOS, and CI runs no macOS job to notice
    for (const key of Object.keys(base)) {
      if (PLATFORM_SPECIFIC.has(key)) continue;
      expect(mac[key]).toEqual(base[key]);
    }
  });

  it("Has permissions for dragging and window controls", () => {
    const permissions = json("src-tauri/capabilities/default.json").permissions as string[];
    for (const p of [
      "core:window:allow-start-dragging",
      "core:window:allow-minimize",
      "core:window:allow-toggle-maximize",
      "core:window:allow-close",
      // ⌘W and the close button both end in destroy() after the guard runs
      "core:window:allow-destroy",
      // F11 off macOS
      "core:window:allow-set-fullscreen",
    ]) {
      expect(permissions).toContain(p);
    }
  });
});
