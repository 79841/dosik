import type { PanelView } from "./chatStore";

/**
 * Whether the side panel is open and which view it shows, across runs
 * (#219 D14). Closed on the first run; whoever opens it keeps using it, so
 * the next run, a trip to Home and a tab switch find it as it was left. One
 * panel for the whole app — not one per tab (#218 D17).
 */
const STORAGE_KEY = "dosik.side-panel";

export interface PanelPrefs {
  open: boolean;
  view: PanelView;
}

const DEFAULT_PREFS: PanelPrefs = { open: false, view: "chat" };

const isView = (value: unknown): value is PanelView => value === "chat" || value === "mermaid";

/** the saved state; a part that is missing or broken is the default */
export const loadPanelPrefs = (): PanelPrefs => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_PREFS };
    const { open, view } = value as Record<string, unknown>;
    return {
      open: typeof open === "boolean" ? open : DEFAULT_PREFS.open,
      view: isView(view) ? view : DEFAULT_PREFS.view,
    };
  } catch {
    // blocked storage or a broken value — the panel still works, closed
    return { ...DEFAULT_PREFS };
  }
};

export const savePanelPrefs = (prefs: PanelPrefs): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // a full or blocked store must not break opening the panel
  }
};
