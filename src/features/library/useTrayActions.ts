import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { newDiagram } from "./navigation";

/** what the menu-bar icon's New Diagram sends (Rust `tray::NEW_DIAGRAM_EVENT`) */
export const TRAY_NEW_DIAGRAM_EVENT = "tray:new-diagram";

/**
 * The menu-bar menu's New Diagram (#213) does what the tab strip's + and ⌘T
 * do: a new library diagram in a new tab. What was on screen stays in its own
 * tab, so nothing asks first. Mounted above the Home/editor switch, so it works
 * from either.
 */
export const useTrayActions = (): void => {
  useEffect(() => {
    const unlisten = listen(TRAY_NEW_DIAGRAM_EVENT, () => {
      void newDiagram();
    });
    return () => {
      void unlisten.then(
        (fn) => fn(),
        () => {},
      );
    };
  }, []);
};
