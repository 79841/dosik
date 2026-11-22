import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "../toastStore";
import {
  FULLSCREEN_TOAST,
  MAX_BUTTON_EVENT,
  resetWindowFrame,
  toggleFullscreen,
  useWindowFrame,
  useWindowFrameWatch,
  watchWindowFrame,
} from "../windowFrame";

const mockedWindow = vi.mocked(getCurrentWindow);
const mockedListen = vi.mocked(listen);
const mockedInvoke = vi.mocked(invoke);

/** a window whose state the test drives, and the handlers the watcher gave it */
const fakeWindow = (
  init: { maximized?: boolean; fullscreen?: boolean; focused?: boolean } = {},
) => {
  const state = { maximized: false, fullscreen: false, focused: true, ...init };
  const handlers: { resized?: () => void; focus?: (e: { payload: boolean }) => void } = {};
  const off = vi.fn();
  const win = {
    isMaximized: vi.fn(async () => state.maximized),
    isFullscreen: vi.fn(async () => state.fullscreen),
    isFocused: vi.fn(async () => state.focused),
    onResized: vi.fn(async (cb: () => void) => {
      handlers.resized = cb;
      return off;
    }),
    onFocusChanged: vi.fn(async (cb: (e: { payload: boolean }) => void) => {
      handlers.focus = cb;
      return off;
    }),
  };
  mockedWindow.mockReturnValue(win as never);
  // full screen goes through Rust, which takes a maximized window through restored
  mockedInvoke.mockReset();
  mockedInvoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "set_window_fullscreen") {
      state.fullscreen = (args as { fullscreen: boolean }).fullscreen;
    }
    return undefined;
  });
  return { state, handlers, win, off };
};

const frame = () => useWindowFrame.getState();

describe("the window's frame state, off macOS (the canvas's Win-Caption)", () => {
  beforeEach(() => {
    resetWindowFrame();
    useToastStore.setState({ toasts: [] });
    mockedListen.mockReset();
    mockedListen.mockResolvedValue(() => {});
  });

  it("reads maximized, full screen and focus when it starts", async () => {
    fakeWindow({ maximized: true, focused: false });
    watchWindowFrame();
    await waitFor(() => expect(frame().maximized).toBe(true));
    expect(frame().focused).toBe(false);
    expect(frame().fullscreen).toBe(false);
  });

  it("follows a resize — a double-click on the band, Win+↑, Snap or the window menu maximizes without the button", async () => {
    const { state, handlers } = fakeWindow();
    watchWindowFrame();
    await waitFor(() => expect(handlers.resized).toBeDefined());
    state.maximized = true;
    handlers.resized?.();
    await waitFor(() => expect(frame().maximized).toBe(true));
    state.maximized = false;
    state.fullscreen = true;
    handlers.resized?.();
    await waitFor(() => expect(frame().fullscreen).toBe(true));
    expect(frame().maximized).toBe(false);
  });

  it("follows focus", async () => {
    const { handlers } = fakeWindow();
    watchWindowFrame();
    await waitFor(() => expect(handlers.focus).toBeDefined());
    handlers.focus?.({ payload: false });
    expect(frame().focused).toBe(false);
    handlers.focus?.({ payload: true });
    expect(frame().focused).toBe(true);
  });

  it("follows the native Maximize spot's pointer state, which Rust reports", async () => {
    fakeWindow();
    watchWindowFrame();
    await waitFor(() =>
      expect(mockedListen).toHaveBeenCalledWith(MAX_BUTTON_EVENT, expect.any(Function)),
    );
    const handler = mockedListen.mock.calls.find(([name]) => name === MAX_BUTTON_EVENT)![1] as (e: {
      payload: unknown;
    }) => void;
    handler({ payload: "hover" });
    expect(frame().maxButton).toBe("hover");
    handler({ payload: "pressed" });
    expect(frame().maxButton).toBe("pressed");
    // anything else is the rest state
    handler({ payload: "sideways" });
    expect(frame().maxButton).toBe("rest");
  });

  it("an older read that lands after a newer one is dropped", async () => {
    const { state, handlers, win } = fakeWindow();
    let release: (v: boolean) => void = () => {};
    watchWindowFrame();
    await waitFor(() => expect(handlers.resized).toBeDefined());
    await waitFor(() => expect(win.isMaximized).toHaveBeenCalledTimes(1));
    // the next read hangs; the one after it answers at once
    win.isMaximized.mockImplementationOnce(() => new Promise<boolean>((r) => (release = r)));
    handlers.resized?.();
    state.maximized = true;
    handlers.resized?.();
    await waitFor(() => expect(frame().maximized).toBe(true));
    release(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(frame().maximized).toBe(true);
  });

  it("stops listening when cleaned up", async () => {
    const { off } = fakeWindow();
    const stop = watchWindowFrame();
    await waitFor(() => expect(mockedListen).toHaveBeenCalled());
    stop();
    await waitFor(() => expect(off).toHaveBeenCalledTimes(2));
  });

  it("a focus that cannot be read leaves the glyphs as they are", async () => {
    const { win } = fakeWindow();
    win.isFocused.mockRejectedValue(new Error("window is going away"));
    watchWindowFrame();
    await waitFor(() => expect(win.isFocused).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(frame().focused).toBe(true);
  });

  it("the Frame follows the window off macOS only — on macOS the native window has its frame", async () => {
    const { win } = fakeWindow();
    const mac = renderHook(() => useWindowFrameWatch(true));
    await new Promise((r) => setTimeout(r, 0));
    expect(win.onResized).not.toHaveBeenCalled();
    mac.unmount();
    const other = renderHook(() => useWindowFrameWatch(false));
    await waitFor(() => expect(win.onResized).toHaveBeenCalledTimes(1));
    other.unmount();
  });

  it("does nothing outside Tauri", () => {
    mockedWindow.mockImplementation(() => {
      throw new TypeError("no __TAURI_INTERNALS__");
    });
    expect(() => watchWindowFrame()()).not.toThrow();
    expect(frame().maximized).toBe(false);
  });
});

describe("F11: full screen", () => {
  beforeEach(() => {
    resetWindowFrame();
    useToastStore.setState({ toasts: [] });
  });

  /** what the toggles asked Rust for, in order */
  const fullscreenCalls = () =>
    mockedInvoke.mock.calls
      .filter(([command]) => command === "set_window_fullscreen")
      .map(([, args]) => (args as { fullscreen: boolean }).fullscreen);

  it("enters full screen and says how to leave the first time, with F11 as a key", async () => {
    fakeWindow();
    await toggleFullscreen();
    expect(mockedInvoke).toHaveBeenCalledWith("set_window_fullscreen", { fullscreen: true });
    expect(frame().fullscreen).toBe(true);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ text: FULLSCREEN_TOAST, keys: "F11", kind: "info" });
    expect(FULLSCREEN_TOAST).toBe("Full screen · F11 to exit");
  });

  it("leaves it on the next press, and the toast does not come back in the same run", async () => {
    fakeWindow();
    await toggleFullscreen();
    await toggleFullscreen();
    expect(fullscreenCalls()).toEqual([true, false]);
    expect(frame().fullscreen).toBe(false);
    await toggleFullscreen();
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("asks the window, not the store — full screen left some other way is not entered twice", async () => {
    const { state } = fakeWindow({ fullscreen: true });
    useWindowFrame.setState({ fullscreen: false });
    await toggleFullscreen();
    expect(fullscreenCalls()).toEqual([false]);
    expect(state.fullscreen).toBe(false);
  });

  it("two quick presses: the second waits for the first and leaves — not both entering", async () => {
    fakeWindow();
    await Promise.all([toggleFullscreen(), toggleFullscreen()]);
    expect(fullscreenCalls()).toEqual([true, false]);
    expect(frame().fullscreen).toBe(false);
  });

  it("moves on silently when the window refuses, and outside Tauri", async () => {
    fakeWindow();
    mockedInvoke.mockRejectedValue(new Error("not allowed"));
    await expect(toggleFullscreen()).resolves.toBeUndefined();
    expect(frame().fullscreen).toBe(false);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    mockedWindow.mockImplementation(() => {
      throw new TypeError("no __TAURI_INTERNALS__");
    });
    await expect(toggleFullscreen()).resolves.toBeUndefined();
  });
});
