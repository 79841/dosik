import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadPanelPrefs, savePanelPrefs } from "../panelPrefs";

const KEY = "dosik.side-panel";

describe("remembering panel open state and view (#219 D14, T3)", () => {
  beforeEach(() => localStorage.clear());

  it("starts closed on the chat view", () => {
    expect(loadPanelPrefs()).toEqual({ open: false, view: "chat" });
  });

  it("reads the stored value", () => {
    savePanelPrefs({ open: true, view: "mermaid" });
    expect(JSON.parse(localStorage.getItem(KEY) ?? "null")).toEqual({
      open: true,
      view: "mermaid",
    });
    expect(loadPanelPrefs()).toEqual({ open: true, view: "mermaid" });
  });

  it("falls back to defaults for broken JSON, unknown views and wrong types — keeping the valid fields", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadPanelPrefs()).toEqual({ open: false, view: "chat" });
    localStorage.setItem(KEY, JSON.stringify({ open: true, view: "terminal" }));
    expect(loadPanelPrefs()).toEqual({ open: true, view: "chat" });
    localStorage.setItem(KEY, JSON.stringify({ open: "yes", view: "mermaid" }));
    expect(loadPanelPrefs()).toEqual({ open: false, view: "mermaid" });
    localStorage.setItem(KEY, JSON.stringify([true, "mermaid"]));
    expect(loadPanelPrefs()).toEqual({ open: false, view: "chat" });
  });

  it("does not throw when storage is blocked", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(loadPanelPrefs()).toEqual({ open: false, view: "chat" });
      expect(() => savePanelPrefs({ open: true, view: "chat" })).not.toThrow();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
