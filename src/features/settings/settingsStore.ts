import { create } from "zustand";

/**
 * The dialog's sections, in the order its side nav lists them (#252) — the
 * usual four. "AI assistant" is the chat's connection; Integrations is Dosik
 * in other AI apps. The bridge has no section: it keeps its fixed port, and
 * Integrations says so when another app holds it.
 */
export const SETTINGS_SECTIONS = ["General", "AI assistant", "Integrations", "About"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

interface SettingsState {
  open: boolean;
  section: SettingsSection;
  /** where it opens next time it is not told — the last section shown, this run */
  lastSection: SettingsSection;
  /** what gets focus back when it closes */
  returnTo: HTMLElement | null;
  /** an element the section should focus once it shows — an id, say `key-claude` */
  focus: string | null;

  openSettings: (
    section?: SettingsSection,
    options?: { returnTo?: HTMLElement | null; focus?: string },
  ) => void;
  closeSettings: () => void;
  showSection: (section: SettingsSection) => void;
  /** the section took the focus request */
  takeFocus: () => void;
}

const focused = (): HTMLElement | null =>
  document.activeElement instanceof HTMLElement ? document.activeElement : null;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  open: false,
  section: "General",
  lastSection: "General",
  returnTo: null,
  focus: null,

  openSettings: (section, options = {}) =>
    set((s) => {
      const target = section ?? (s.open ? s.section : s.lastSection);
      return {
        open: true,
        section: target,
        lastSection: target,
        // a second open while open keeps the first opener
        returnTo: s.open
          ? s.returnTo
          : options.returnTo !== undefined
            ? options.returnTo
            : focused(),
        focus: options.focus ?? null,
      };
    }),
  closeSettings: () => {
    if (!get().open) return;
    set({ open: false, focus: null });
  },
  showSection: (section) => set({ section, lastSection: section, focus: null }),
  takeFocus: () => set({ focus: null }),
}));

/** opens Settings — every way in calls this (Dosik ▸ Settings…, ⌘,, ⋯, the sidebar's gear) */
export const openSettings = (
  section?: SettingsSection,
  options?: { returnTo?: HTMLElement | null; focus?: string },
): void => useSettingsStore.getState().openSettings(section, options);
