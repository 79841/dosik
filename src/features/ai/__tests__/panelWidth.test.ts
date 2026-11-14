import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AI_PANEL_WIDTH, CANVAS_BESIDE_PANEL } from "../../../shared/lib/editorLayout";
import { contentWidth, useSidebarStore } from "../../../shared/lib/sidebarLayout";
import { useChatStore } from "../chatStore";
import {
  clampChatWidth,
  DEFAULT_CHAT_WIDTH,
  loadChatWidth,
  MAX_CHAT_WIDTH,
  MIN_CHAT_WIDTH,
  saveChatWidth,
} from "../panelWidth";
import { useChatWidth } from "../useChatWidth";

describe("docked panel width (#129, #219 D12, T2)", () => {
  beforeEach(() => {
    localStorage.clear();
    // the window is the content while the library sidebar is hidden
    useSidebarStore.setState({ hidden: true });
  });

  it("defaults to the design's 300", () => {
    expect(DEFAULT_CHAT_WIDTH).toBe(AI_PANEL_WIDTH);
    expect(DEFAULT_CHAT_WIDTH).toBe(300);
  });

  it("clamps to min and max and rounds to an integer", () => {
    expect(clampChatWidth(10, 1440)).toBe(MIN_CHAT_WIDTH);
    expect(clampChatWidth(9999, 1440)).toBe(MAX_CHAT_WIDTH);
    expect(clampChatWidth(420.6, 1440)).toBe(421);
    expect(clampChatWidth(Number.NaN, 1440)).toBe(DEFAULT_CHAT_WIDTH);
  });

  it("leaves 412 for the canvas — content 712 → 300, 960 → 548, 1192 → 720", () => {
    expect(clampChatWidth(MAX_CHAT_WIDTH, 712)).toBe(300);
    expect(clampChatWidth(MAX_CHAT_WIDTH, 960)).toBe(548);
    expect(clampChatWidth(MAX_CHAT_WIDTH, 1192)).toBe(720);
    for (const content of [712, 800, 960, 1100]) {
      expect(content - clampChatWidth(MAX_CHAT_WIDTH, content)).toBeGreaterThanOrEqual(
        CANVAS_BESIDE_PANEL,
      );
    }
  });

  it("keeps the panel at its minimum width even when the content is narrower", () => {
    expect(clampChatWidth(MAX_CHAT_WIDTH, 400)).toBe(MIN_CHAT_WIDTH);
  });

  it("is based on the content width — a 960 window with a 248 docked sidebar gives the minimum 300 (#217 D24)", () => {
    const content = contentWidth({ hidden: false, width: 248 }, 960);
    expect(content).toBe(712);
    expect(clampChatWidth(MAX_CHAT_WIDTH, content)).toBe(300);
    // the saved width is read into the content that is there
    useSidebarStore.setState({ hidden: false, width: 248 });
    saveChatWidth(700);
    expect(loadChatWidth()).toBe(clampChatWidth(700, window.innerWidth - 248));
  });

  it("restores the chosen width when the window shrinks and grows back — only the visible width shrinks", () => {
    useChatStore.setState({ width: 600 });
    const width = vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440);
    try {
      const { result } = renderHook(() => useChatWidth());
      expect(result.current).toBe(600);
      width.mockReturnValue(800);
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(result.current).toBe(800 - CANVAS_BESIDE_PANEL);
      width.mockReturnValue(1440);
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(result.current).toBe(600);
      expect(useChatStore.getState().width).toBe(600);
    } finally {
      width.mockRestore();
    }
  });

  it("reads back the stored value, or the default when missing or broken", () => {
    expect(loadChatWidth()).toBe(DEFAULT_CHAT_WIDTH);
    saveChatWidth(460);
    expect(loadChatWidth()).toBe(460);
    localStorage.setItem("dosik.chat-panel-width", "not-a-number");
    expect(loadChatWidth()).toBe(DEFAULT_CHAT_WIDTH);
  });

  it("clamps a stored value that is out of range", () => {
    saveChatWidth(5000);
    expect(loadChatWidth()).toBe(clampChatWidth(5000, window.innerWidth));
  });

  it("does not throw when storage is blocked", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    try {
      expect(() => saveChatWidth(400)).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });
});
