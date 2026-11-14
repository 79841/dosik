import { useContentWidth } from "../../shared/lib/sidebarLayout";
import { useChatStore } from "./chatStore";
import { clampChatWidth } from "./panelWidth";

/**
 * The width the chat panel renders at (#129).
 *
 * The store holds what the *user* chose; this squeezes it into the content
 * that exists right now — the window less the docked sidebar (#217 D24).
 * Shrinking either narrows the panel — otherwise a panel widened on a big
 * screen squeezes the edit bar off the canvas — while the chosen width
 * survives in the store and comes back when there is room again.
 */
export const useChatWidth = (): number => {
  const preferred = useChatStore((s) => s.width);
  return clampChatWidth(preferred, useContentWidth());
};
