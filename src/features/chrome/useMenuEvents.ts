import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { currentWindowOrNull } from "../../shared/lib/appWindow";
import { useAppStore } from "../library/appStore";
import { closeActiveDocumentTab } from "../library/navigation";
import { openSettings, useSettingsStore } from "../settings/settingsStore";

/** what Rust emits when File ▸ Close Tab (⌘W) is chosen — `app_menu.rs` has the same string */
export const CLOSE_TAB_EVENT = "menu:close-tab";
/** what Rust emits when Dosik ▸ Settings… (⌘,) is chosen — `app_menu.rs` has the same string (#252) */
export const SETTINGS_EVENT = "menu:settings";

/**
 * ⌘W on macOS (#218 D12): the active document tab closes; on Home, where
 * there is no tab to close, the window does — through close-requested, so the
 * unsaved-file question and the autosave flush still run (`useFlushOnClose`).
 */
const closeTabOrWindow = async (): Promise<void> => {
  // ⌘W with Settings up closes Settings, as a settings window would (#252);
  // with another dialog up (From Mermaid…) it waits — the menu's key never
  // passes the keymap's check for an open dialog, so it is made here
  if (useSettingsStore.getState().open) {
    useSettingsStore.getState().closeSettings();
    return;
  }
  if (document.querySelector("dialog[open]")) return;
  if (useAppStore.getState().activeTab !== null) {
    await closeActiveDocumentTab();
    return;
  }
  await currentWindowOrNull()
    ?.close()
    .catch(() => undefined);
};

/** listens for the macOS menu's items that the front end carries out; the Frame mounts it once */
export const useMenuEvents = (): void => {
  useEffect(() => {
    const unlisten = [
      listen(CLOSE_TAB_EVENT, () => {
        void closeTabOrWindow();
      }),
      listen(SETTINGS_EVENT, () => openSettings()),
    ];
    return () => {
      for (const off of unlisten) {
        void off.then(
          (fn) => fn(),
          () => {},
        );
      }
    };
  }, []);
};
