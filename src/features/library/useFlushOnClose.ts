import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

import { flushKeySaves } from "../ai/keychain";
import { confirmDiscardTabs } from "./tabActions";
import { flushAutosave } from "./useAutosave";

/**
 * Writes a pending autosave before the window closes. External files with
 * unsaved edits — in any tab, on screen or not — are asked about first, in
 * one question (#123, #218 D8): the only thing that holds the window open is
 * the user's own Cancel. Nothing else blocks the close: at worst the last
 * half-second of autosave is lost, and a failed write must not trap the user
 * in the app.
 */
export const useFlushOnClose = (): void => {
  useEffect(() => {
    // Cmd+Q can end the process without a close request; a key typed in the
    // last moment would otherwise be gone — localStorage no longer has it (#153)
    const onPageHide = (): void => {
      void flushKeySaves();
    };
    window.addEventListener("pagehide", onPageHide);
    let unlisten: (() => void) | null = null;
    let disposed = false;
    let current: ReturnType<typeof getCurrentWindow>;
    try {
      // throws synchronously outside Tauri (`npm run dev`) — then there is no
      // window to watch, and the app must still render
      current = getCurrentWindow();
    } catch {
      return () => window.removeEventListener("pagehide", onPageHide);
    }
    void current
      .onCloseRequested(async (event) => {
        if (!(await confirmDiscardTabs())) {
          event.preventDefault();
          return;
        }
        await flushAutosave();
        // an API key typed in the last moment before closing (#17)
        await flushKeySaves();
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      disposed = true;
      unlisten?.();
    };
  }, []);
};
