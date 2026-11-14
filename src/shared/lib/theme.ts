import { create } from "zustand";

import {
  COLOR_ROLES,
  COLOR_TOKENS,
  DARK_COLOR_TOKENS,
  PALETTE_COLORS,
  SURFACE_DARK,
  SURFACE_LIGHT,
  SURFACE_VARS,
  type SurfaceTokens,
} from "./palette";

export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "dosik.theme";

export const surfaceTokens = (theme: ThemeMode): SurfaceTokens =>
  theme === "dark" ? SURFACE_DARK : SURFACE_LIGHT;

const systemTheme = (): ThemeMode =>
  window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";

const loadInitialTheme = (): ThemeMode => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // storage unavailable — fall through to system preference
  }
  return systemTheme();
};

/** Writes `data-theme` and the --dsk-* CSS variables to <html>. */
export const applyThemeToDom = (theme: ThemeMode): void => {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const tokens = theme === "dark" ? DARK_COLOR_TOKENS : COLOR_TOKENS;
  for (const color of PALETTE_COLORS) {
    for (const role of COLOR_ROLES) {
      root.style.setProperty(`--dsk-${color}-${role}`, tokens[color][role]);
    }
  }
  const surface = surfaceTokens(theme);
  for (const [key, name] of Object.entries(SURFACE_VARS)) {
    root.style.setProperty(name, surface[key as keyof SurfaceTokens]);
  }
};

interface ThemeState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: loadInitialTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // storage unavailable — theme still applies for this session
    }
    applyThemeToDom(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));

/** Call once before first render so the initial paint uses the right theme. */
export const initTheme = (): void => {
  applyThemeToDom(useThemeStore.getState().theme);
};
