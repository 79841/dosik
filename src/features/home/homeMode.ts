import { create } from "zustand";

import { useAppStore } from "../library/appStore";
import { CARD_SIZES, type CardSize, DEFAULT_CARD_SIZE } from "./homeGrid";

/**
 * Home's Cards / Canvas switch (#221 D1): the same selection (`homeView`)
 * shown as cards or as the library board — and the size the cards take
 * (#236 D5). App preferences, not library content, so they are kept in
 * `localStorage["dosik.home"]` — the sidebar's way (#217 D17) — and a broken
 * or blocked store just means Cards at the default size.
 */
export type HomeMode = "cards" | "canvas";

export const HOME_KEY = "dosik.home";

/** what `dosik.home` keeps: `size` is null until one is picked */
export interface HomeSaved {
  mode: HomeMode;
  size: CardSize | null;
}

const isMode = (value: unknown): value is HomeMode => value === "cards" || value === "canvas";
const isSize = (value: unknown): value is CardSize =>
  (CARD_SIZES as readonly unknown[]).includes(value);

/**
 * The saved choices; anything missing, broken or from another version is
 * Cards with no size picked. A value from before the size (#236) is
 * `{v: 1, mode}` and reads as it was; the first draft's `columns` is not read.
 */
export const loadHome = (): HomeSaved => {
  const none: HomeSaved = { mode: "cards", size: null };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HOME_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return none;
    const { v, mode, size } = raw as { v?: unknown; mode?: unknown; size?: unknown };
    if (v !== 1) return none;
    return { mode: isMode(mode) ? mode : "cards", size: isSize(size) ? size : null };
  } catch {
    return none;
  }
};

export const saveHome = ({ mode, size }: HomeSaved): void => {
  try {
    localStorage.setItem(
      HOME_KEY,
      JSON.stringify(size === null ? { v: 1, mode } : { v: 1, mode, size }),
    );
  } catch {
    // blocked storage: the choice lasts for this run only
  }
};

interface HomeModeState extends HomeSaved {
  setMode: (mode: HomeMode) => void;
  /** one size for every card grid (#236 D5) */
  setSize: (size: CardSize) => void;
}

/**
 * The switch sits in Home's header row, drawn once for every view and mode
 * (#231 D2, D4): the radio that was pressed stays, and so does its focus.
 * Saving one choice keeps the other.
 */
export const useHomeMode = create<HomeModeState>((set, get) => ({
  ...loadHome(),
  setMode: (mode) => {
    saveHome({ mode, size: get().size });
    set({ mode });
  },
  setSize: (size) => {
    saveHome({ mode: get().mode, size });
    set({ size });
  },
}));

/** the size every card grid lays out: the pick, else Medium (#236 D5) */
export const useCardSize = (): CardSize => useHomeMode((s) => s.size) ?? DEFAULT_CARD_SIZE;

// No dispose (idempotent under HMR). A new folder's name asked in one mode
// is not asked in the other (#231 C1): its card is another card there.
useHomeMode.subscribe((now, before) => {
  if (now.mode !== before.mode) useAppStore.getState().takeFolderRename();
});
