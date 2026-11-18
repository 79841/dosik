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
/** what the user picked in Settings ▸ General (#252): a theme, or macOS's */
export type ThemePreference = ThemeMode | "system";

const STORAGE_KEY = "dosik.theme";

export const surfaceTokens = (theme: ThemeMode): SurfaceTokens =>
  theme === "dark" ? SURFACE_DARK : SURFACE_LIGHT;

const DARK_QUERY = "(prefers-color-scheme: dark)";

const systemTheme = (): ThemeMode => (window.matchMedia?.(DARK_QUERY)?.matches ? "dark" : "light");

/** nothing saved (or something unknown) is System — what the app did before #252 too */
const loadPreference = (): ThemePreference => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // storage unavailable — fall through to system preference
  }
  return "system";
};

const resolve = (preference: ThemePreference): ThemeMode =>
  preference === "system" ? systemTheme() : preference;

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
  /** what shows */
  theme: ThemeMode;
  /** what was picked — System follows macOS as it changes */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** picks a theme outright (leaves System) */
  setTheme: (theme: ThemeMode) => void;
  /** the quick switch (sidebar, ⋯ menu): the opposite of what shows */
  toggleTheme: () => void;
}

const initialPreference = loadPreference();

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: resolve(initialPreference),
  preference: initialPreference,
  setPreference: (preference) => {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // storage unavailable — theme still applies for this session
    }
    const theme = resolve(preference);
    applyThemeToDom(theme);
    set({ theme, preference });
  },
  setTheme: (theme) => get().setPreference(theme),
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));

/** macOS switched light/dark: System follows, a picked theme stays */
const onSystemChange = (): void => {
  const { preference, theme } = useThemeStore.getState();
  if (preference !== "system") return;
  const next = systemTheme();
  if (next === theme) return;
  applyThemeToDom(next);
  useThemeStore.setState({ theme: next });
};

/** Call once before first render so the initial paint uses the right theme. */
export const initTheme = (): void => {
  applyThemeToDom(useThemeStore.getState().theme);
  window.matchMedia?.(DARK_QUERY)?.addEventListener?.("change", onSystemChange);
};
