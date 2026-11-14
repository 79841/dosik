import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { currentWindowOrNull } from "../../shared/lib/appWindow";
import { useAppStore } from "../library/appStore";
import { closeActiveDocumentTab } from "../library/navigation";

/** what Rust emits when File ▸ Close Tab (⌘W) is chosen — `app_menu.rs` has the same string */
export const CLOSE_TAB_EVENT = "menu:close-tab";

/**
 * ⌘W on macOS (#218 D12): the active document tab closes; on Home, where
 * there is no tab to close, the window does — through close-requested, so the
 * unsaved-file question and the autosave flush still run (`useFlushOnClose`).
 */
const closeTabOrWindow = async (): Promise<void> => {
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
    const unlisten = listen(CLOSE_TAB_EVENT, () => {
      void closeTabOrWindow();
    });
    return () => {
      void unlisten.then(
        (fn) => fn(),
        () => {},
      );
    };
  }, []);
};
