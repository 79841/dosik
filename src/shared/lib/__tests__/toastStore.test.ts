import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_TOASTS, TOAST_DURATION, toastError, useToastStore } from "../toastStore";

describe("toastStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().dismissAll();
  });
  afterEach(() => vi.useRealTimers());

  it("an info toast disappears on its own after 2.5 seconds", () => {
    useToastStore.getState().pushToast("Saved");
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(["Saved"]);
    vi.advanceTimersByTime(TOAST_DURATION.info - 1);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("an error toast stays longer — it is a message to be read", () => {
    useToastStore.getState().pushToast("Error: boom", "error");
    vi.advanceTimersByTime(TOAST_DURATION.info);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(TOAST_DURATION.error - TOAST_DURATION.info);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("several stack in creation order and one can be closed alone", () => {
    const a = useToastStore.getState().pushToast("A");
    useToastStore.getState().pushToast("B");
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(["A", "B"]);
    useToastStore.getState().dismissToast(a);
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(["B"]);
  });

  it("the timer of a toast closed early does not touch the remaining ones", () => {
    const a = useToastStore.getState().pushToast("A");
    useToastStore.getState().dismissToast(a);
    useToastStore.getState().pushToast("B");
    vi.advanceTimersByTime(TOAST_DURATION.info - 1);
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(["B"]);
  });

  it("a closed toast's timer is cancelled", () => {
    const a = useToastStore.getState().pushToast("A");
    useToastStore.getState().dismissToast(a);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("past the limit, the oldest is pushed out first", () => {
    for (let i = 0; i < MAX_TOASTS + 2; i++) useToastStore.getState().pushToast(`T${i}`);
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(
      Array.from({ length: MAX_TOASTS }, (_, i) => `T${i + 2}`),
    );
    // the evicted ones took their timers with them
    expect(vi.getTimerCount()).toBe(MAX_TOASTS);
  });

  it("does not expire while held, and counts again from the start on release", () => {
    const a = useToastStore.getState().pushToast("A");
    vi.advanceTimersByTime(TOAST_DURATION.info - 100);
    useToastStore.getState().holdToast(a, "pointer");
    vi.advanceTimersByTime(TOAST_DURATION.info * 5);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    useToastStore.getState().releaseToast(a, "pointer");
    vi.advanceTimersByTime(TOAST_DURATION.info - 1);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("pointer and focus count separately — it stays alive while either one remains", () => {
    const a = useToastStore.getState().pushToast("A");
    useToastStore.getState().holdToast(a, "pointer");
    useToastStore.getState().holdToast(a, "focus");
    // focus leaves (Tab out of the × button) while the pointer is still on it
    useToastStore.getState().releaseToast(a, "focus");
    vi.advanceTimersByTime(TOAST_DURATION.info * 5);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    // the reverse: pointer leaves while × is still focused
    useToastStore.getState().holdToast(a, "focus");
    useToastStore.getState().releaseToast(a, "pointer");
    vi.advanceTimersByTime(TOAST_DURATION.info * 5);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    useToastStore.getState().releaseToast(a, "focus");
    vi.advanceTimersByTime(TOAST_DURATION.info);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("neither hold nor release creates a timer for an already closed toast", () => {
    const a = useToastStore.getState().pushToast("A");
    useToastStore.getState().dismissToast(a);
    useToastStore.getState().holdToast(a, "pointer");
    useToastStore.getState().releaseToast(a, "pointer");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a held toast is not pushed out even past the limit", () => {
    const held = useToastStore.getState().pushToast("Error: read me", "error");
    useToastStore.getState().holdToast(held, "pointer");
    for (let i = 0; i < MAX_TOASTS + 1; i++) useToastStore.getState().pushToast(`Saved ${i}`);
    const texts = useToastStore.getState().toasts.map((t) => t.text);
    expect(texts).toContain("Error: read me");
    expect(texts).toHaveLength(MAX_TOASTS);
  });

  it("past the limit, drops info before error", () => {
    useToastStore.getState().pushToast("Error: keep", "error");
    for (let i = 0; i < MAX_TOASTS; i++) useToastStore.getState().pushToast(`Saved ${i}`);
    const texts = useToastStore.getState().toasts.map((t) => t.text);
    expect(texts[0]).toBe("Error: keep");
    expect(texts).toEqual(["Error: keep", "Saved 1", "Saved 2", "Saved 3"]);
  });

  it("dismissAll closes everything and leaves no timers", () => {
    useToastStore.getState().pushToast("A");
    useToastStore.getState().pushToast("B", "error");
    useToastStore.getState().dismissAll();
    expect(useToastStore.getState().toasts).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the shortcut is carried separately — the text stays a full sentence, keys holds the shortcut in it (#231 D18)", () => {
    useToastStore.getState().pushToast("Sidebar hidden · ⌘\\ to show", "info", { keys: "⌘\\" });
    useToastStore.getState().pushToast("Saved");
    expect(useToastStore.getState().toasts.map((t) => [t.text, t.keys])).toEqual([
      ["Sidebar hidden · ⌘\\ to show", "⌘\\"],
      ["Saved", undefined],
    ]);
  });

  it("toastError gives both Errors and strings the 'Error: ' prefix — the text stays a readable sentence, the prefix is shown separately (#231 D18)", () => {
    toastError(new Error("boom"));
    toastError("plain");
    expect(useToastStore.getState().toasts.map((t) => [t.kind, t.text, t.prefix])).toEqual([
      ["error", "Error: boom", "Error: "],
      ["error", "Error: plain", "Error: "],
    ]);
  });

  it("the prefix is an option — undefined when absent", () => {
    useToastStore.getState().pushToast("Error: x", "error", { prefix: "Error: " });
    useToastStore.getState().pushToast("Saved");
    expect(useToastStore.getState().toasts.map((t) => t.prefix)).toEqual(["Error: ", undefined]);
  });
});
