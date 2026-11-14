import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * The Tauri window, or null outside Tauri (`npm run dev` in a browser) —
 * `getCurrentWindow` throws there, and the UI must still render.
 */
export const currentWindowOrNull = (): ReturnType<typeof getCurrentWindow> | null => {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
};
