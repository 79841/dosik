import { AI_PANEL_WIDTH, CANVAS_BESIDE_PANEL } from "../../shared/lib/editorLayout";
import { contentWidth, useSidebarStore } from "../../shared/lib/sidebarLayout";

/**
 * The side panel's width, dragged by its left edge and remembered across runs
 * (#129). Stored the same way as the AI settings — a small localStorage key
 * read once at store creation. Since #219 the panel is docked: it takes its
 * width from the canvas instead of floating over it.
 */
const STORAGE_KEY = "dosik.chat-panel-width";

/** the design's docked panel (`ai-panel-width`, #219 D12) — 320 before */
export const DEFAULT_CHAT_WIDTH = AI_PANEL_WIDTH;
export const MIN_CHAT_WIDTH = 300;
export const MAX_CHAT_WIDTH = 720;

/**
 * Keeps the width inside its bounds and inside the content — the window less
 * the docked library sidebar (#217 D24) — leaving the canvas beside it at
 * least `CANVAS_BESIDE_PANEL` (#219 D12). At the window's own `minWidth` of
 * 960 with the sidebar docked (712 of content) that is the panel's minimum,
 * 300; with it hidden, 548.
 */
export const clampChatWidth = (width: number, contentWidth: number): number => {
  const room = contentWidth - CANVAS_BESIDE_PANEL;
  const ceiling = Math.max(MIN_CHAT_WIDTH, Math.min(MAX_CHAT_WIDTH, room));
  // a bad number still has to come back inside the window
  const wanted = Number.isFinite(width) ? width : DEFAULT_CHAT_WIDTH;
  return Math.round(Math.min(Math.max(wanted, MIN_CHAT_WIDTH), ceiling));
};

export const loadChatWidth = (): number => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    // clampChatWidth turns a missing or broken value into the default, inside
    // the window — there is no path that returns an unclamped number
    return clampChatWidth(parsed, chatRoom());
  } catch {
    return DEFAULT_CHAT_WIDTH;
  }
};

/** the content the panel and the canvas share, right now */
export const chatRoom = (): number => contentWidth(useSidebarStore.getState(), window.innerWidth);

export const saveChatWidth = (width: number): void => {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // a full or blocked store must not break resizing
  }
};
