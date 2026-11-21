import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { create } from "zustand";

import { currentWindowOrNull } from "./appWindow";
import { useToastStore } from "./toastStore";
import { isMacPlatform } from "./windowChrome";

/**
 * The pointer on the native Maximize spot. Off macOS a window of the OS's own
 * sits over the Maximize button so Windows can offer Snap layouts there
 * (`window_frame.rs`); the pointer over it never reaches the page, so Rust
 * reports it and the button paints from this.
 */
export type MaxButtonState = "rest" | "hover" | "pressed";

/** what Rust emits as the pointer enters, presses or leaves that spot — `window_frame.rs` has the same string */
export const MAX_BUTTON_EVENT = "window-frame:max-button";

/** the toast the first time full screen is entered in a run — F11 drawn as a key */
export const FULLSCREEN_TOAST = "Full screen · F11 to exit";

interface WindowFrameState {
  /** Maximize shows Restore */
  maximized: boolean;
  /** the caption glyphs dim while another window has the focus */
  focused: boolean;
  /** F11: the band stays for the tabs, the caption buttons go */
  fullscreen: boolean;
  maxButton: MaxButtonState;
  /** the full screen toast has been shown in this run */
  fullscreenTold: boolean;
}

const INITIAL: WindowFrameState = {
  maximized: false,
  focused: true,
  fullscreen: false,
  maxButton: "rest",
  fullscreenTold: false,
};

/**
 * The window frame the app draws off macOS (the canvas's Win-Caption): the
 * caption buttons and the band follow it. On macOS the window is native and
 * nothing reads this.
 */
export const useWindowFrame = create<WindowFrameState>(() => ({ ...INITIAL }));

/** back to a window that has told nothing yet — for tests */
export const resetWindowFrame = (): void => useWindowFrame.setState({ ...INITIAL });

const maxButtonState = (payload: unknown): MaxButtonState =>
  payload === "hover" || payload === "pressed" ? payload : "rest";

/**
 * Follows the window: maximized and full screen are read again on every
 * resize, so a change the buttons did not make — a double-click on the band,
 * Win+↑, Snap, the window menu — shows too. Returns the cleanup.
 */
export const watchWindowFrame = (): (() => void) => {
  const win = currentWindowOrNull();
  if (!win) return () => {};
  let alive = true;
  let round = 0;
  const read = async (): Promise<void> => {
    const mine = ++round;
    try {
      const [maximized, fullscreen] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
      // a read that lands after a newer one says what the window was, not is
      if (alive && mine === round) useWindowFrame.setState({ maximized, fullscreen });
    } catch {
      // the window is going away, or the permission is missing: keep what is drawn
    }
  };
  void read();
  win.isFocused().then(
    (focused) => {
      if (alive) useWindowFrame.setState({ focused });
    },
    () => {},
  );
  const offs = [
    win.onResized(() => void read()),
    win.onFocusChanged(({ payload }) => useWindowFrame.setState({ focused: payload })),
    listen<unknown>(MAX_BUTTON_EVENT, ({ payload }) =>
      useWindowFrame.setState({ maxButton: maxButtonState(payload) }),
    ),
  ];
  return () => {
    alive = false;
    for (const off of offs) {
      off.then(
        (fn) => fn(),
        () => {},
      );
    }
  };
};

/**
 * Windows' window menu (Restore, Move, Size, Minimize, Maximize, Close) — at
 * the pointer for a right click on the band, under the band's left end for
 * Alt+Space, as a title bar has it. Windows draws it (`window_frame.rs`).
 */
export const showWindowMenu = (atPointer: boolean): void => {
  void invoke("show_window_menu", { atPointer }).catch(() => undefined);
};

/** the Frame follows the window off macOS, once */
export const useWindowFrameWatch = (mac: boolean = isMacPlatform()): void => {
  useEffect(() => (mac ? undefined : watchWindowFrame()), [mac]);
};

/**
 * F11 off macOS: full screen on or off — by what the window says, not the
 * store, so a full screen left some other way is not entered twice. The
 * first time in a run it says how to leave.
 */
/** a toggle under way — a second press waits for it instead of reading the same state */
let toggling: Promise<void> | null = null;

export const toggleFullscreen = (): Promise<void> => {
  const run = (toggling ?? Promise.resolve()).then(toggleOnce);
  toggling = run.finally(() => {
    if (toggling === run) toggling = null;
  });
  return run;
};

const toggleOnce = async (): Promise<void> => {
  const win = currentWindowOrNull();
  if (!win) return;
  try {
    const next = !(await win.isFullscreen());
    await win.setFullscreen(next);
    useWindowFrame.setState({ fullscreen: next });
    if (next && !useWindowFrame.getState().fullscreenTold) {
      useWindowFrame.setState({ fullscreenTold: true });
      useToastStore.getState().pushToast(FULLSCREEN_TOAST, "info", { keys: "F11" });
    }
  } catch {
    // refused (permission) or the window is going away: nothing changes
  }
};
