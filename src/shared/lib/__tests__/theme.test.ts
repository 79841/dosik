import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COLOR_TOKENS,
  DARK_COLOR_TOKENS,
  PALETTE_COLORS,
  SURFACE_DARK,
  SURFACE_LIGHT,
  THEME_COLOR_TOKENS,
} from "../palette";
import * as palette from "../palette";
import { applyThemeToDom, surfaceTokens, useThemeStore } from "../theme";

const rootStyle = () => document.documentElement.style;

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState({ theme: "light", preference: "light" });
  applyThemeToDom("light");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("palette dark tokens", () => {
  it("every palette colour has a dark variant", () => {
    for (const color of PALETTE_COLORS) {
      const token = DARK_COLOR_TOKENS[color];
      expect(token.fill).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(token.stroke).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(token.text).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(token.glyph).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("in dark mode only the inverted ink tile changes its fill — the rest keep the same pastel (#216)", () => {
    const changed = PALETTE_COLORS.filter(
      (c) => DARK_COLOR_TOKENS[c].fill !== COLOR_TOKENS[c].fill,
    );
    expect(changed).toEqual(["ink"]);
  });

  it("THEME_COLOR_TOKENS point to CSS variables with light fallbacks", () => {
    expect(THEME_COLOR_TOKENS.violet.fill).toBe(
      `var(--dsk-violet-fill, ${COLOR_TOKENS.violet.fill})`,
    );
    expect(THEME_COLOR_TOKENS.gray.stroke).toBe(
      `var(--dsk-gray-stroke, ${COLOR_TOKENS.gray.stroke})`,
    );
  });
});

describe("applyThemeToDom", () => {
  it("writes data-theme and the CSS variables to <html>", () => {
    applyThemeToDom("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(rootStyle().getPropertyValue("--dsk-violet-fill")).toBe(DARK_COLOR_TOKENS.violet.fill);
    expect(rootStyle().getPropertyValue("--dsk-canvas-bg")).toBe(SURFACE_DARK.canvasBg);
    expect(rootStyle().getPropertyValue("--dsk-edge-stroke")).toBe(SURFACE_DARK.edgeStroke);
    expect(rootStyle().getPropertyValue("--dsk-blue-cap")).toBe(DARK_COLOR_TOKENS.blue.cap);
    expect(rootStyle().getPropertyValue("--dsk-blue-line")).toBe(DARK_COLOR_TOKENS.blue.line);
    expect(rootStyle().getPropertyValue("--dsk-blue-glyph")).toBe(DARK_COLOR_TOKENS.blue.glyph);
    expect(rootStyle().getPropertyValue("--dsk-blue-stroke")).toBe(DARK_COLOR_TOKENS.blue.stroke);
    expect(rootStyle().getPropertyValue("--dsk-ink")).toBe(SURFACE_DARK.ink);
    expect(rootStyle().getPropertyValue("--dsk-card-border")).toBe(SURFACE_DARK.cardBorder);

    applyThemeToDom("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(rootStyle().getPropertyValue("--dsk-violet-fill")).toBe(COLOR_TOKENS.violet.fill);
    expect(rootStyle().getPropertyValue("--dsk-canvas-bg")).toBe(SURFACE_LIGHT.canvasBg);
  });
});

describe("there is no minimap (#219 D11, T32)", () => {
  it("no minimap mask variable or constant remains", () => {
    applyThemeToDom("light");
    expect(rootStyle().getPropertyValue("--dsk-minimap-mask")).toBe("");
    applyThemeToDom("dark");
    expect(rootStyle().getPropertyValue("--dsk-minimap-mask")).toBe("");
    expect("THEME_MINIMAP_MASK" in palette).toBe(false);
  });
});

describe("useThemeStore", () => {
  it("setTheme updates state, DOM and localStorage together", () => {
    useThemeStore.getState().setTheme("dark");
    expect(useThemeStore.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("dosik.theme")).toBe("dark");
  });

  it("toggleTheme switches between light and dark", () => {
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("dark");
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("light");
  });

  it("the initial theme prefers the saved value", async () => {
    localStorage.setItem("dosik.theme", "dark");
    vi.resetModules();
    const fresh = await import("../theme");
    expect(fresh.useThemeStore.getState().theme).toBe("dark");
  });

  it("follows the system preference when nothing is saved", async () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal("matchMedia", matchMediaMock);
    vi.resetModules();
    const fresh = await import("../theme");
    expect(matchMediaMock).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    expect(fresh.useThemeStore.getState().theme).toBe("dark");
  });
});

describe("theme preference — Light / Dark / System (#252)", () => {
  /** a fake media query whose change listener the test can fire */
  const fakeSystem = (dark: boolean) => {
    const listeners: ((e: { matches: boolean }) => void)[] = [];
    const mql = {
      matches: dark,
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn),
      removeEventListener: () => {},
    };
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
    return {
      flip: (next: boolean) => {
        mql.matches = next;
        for (const fn of listeners) fn({ matches: next });
      },
    };
  };

  it("System follows macOS — now and when it changes", async () => {
    const system = fakeSystem(false);
    vi.resetModules();
    const fresh = await import("../theme");
    fresh.initTheme();
    fresh.useThemeStore.getState().setPreference("system");
    expect(fresh.useThemeStore.getState().theme).toBe("light");
    expect(localStorage.getItem("dosik.theme")).toBe("system");
    system.flip(true);
    expect(fresh.useThemeStore.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("a picked theme stays put when macOS changes", async () => {
    const system = fakeSystem(false);
    vi.resetModules();
    const fresh = await import("../theme");
    fresh.initTheme();
    fresh.useThemeStore.getState().setPreference("light");
    system.flip(true);
    expect(fresh.useThemeStore.getState().theme).toBe("light");
  });

  it("nothing saved, or System saved, starts on System", async () => {
    fakeSystem(true);
    vi.resetModules();
    let fresh = await import("../theme");
    expect(fresh.useThemeStore.getState().preference).toBe("system");
    expect(fresh.useThemeStore.getState().theme).toBe("dark");
    localStorage.setItem("dosik.theme", "system");
    vi.resetModules();
    fresh = await import("../theme");
    expect(fresh.useThemeStore.getState().preference).toBe("system");
  });

  it("the quick switch picks the opposite of what shows, leaving System", async () => {
    fakeSystem(true);
    vi.resetModules();
    const fresh = await import("../theme");
    fresh.useThemeStore.getState().setPreference("system");
    fresh.useThemeStore.getState().toggleTheme();
    expect(fresh.useThemeStore.getState().preference).toBe("light");
    expect(fresh.useThemeStore.getState().theme).toBe("light");
  });
});

describe("surfaceTokens", () => {
  it("returns the surface tokens for each theme", () => {
    expect(surfaceTokens("light")).toBe(SURFACE_LIGHT);
    expect(surfaceTokens("dark")).toBe(SURFACE_DARK);
  });
});
