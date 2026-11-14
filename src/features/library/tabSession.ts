import { useEffect } from "react";

import { useDiagramStore } from "../../shared/lib/store";
import { toastError } from "../../shared/lib/toastStore";
import { startupSession, useAppStore } from "./appStore";
import { useLibraryStore } from "./libraryStore";
import { allDiagrams } from "./libraryTree";
import { pruneUnlisted, restoreActiveTab } from "./tabActions";
import { SESSION_KEY, serializeSession } from "./tabModel";

const saveSession = (): void => {
  const { tabs, activeTab } = useAppStore.getState();
  try {
    localStorage.setItem(
      SESSION_KEY,
      serializeSession(tabs, activeTab, { title: useDiagramStore.getState().title }),
    );
  } catch {
    // a full or blocked store must not break opening or closing a tab
  }
};

/**
 * The tabs across restarts (#218 D15): the library tabs and the active one
 * are written whenever the strip changes; on start the session's tabs are
 * already in the strip (`appStore`), and this reads and shows the one that
 * was active. A listing that no longer has a diagram takes its tab away — a
 * failed listing proves nothing.
 */
export const useTabSession = (): void => {
  useEffect(() => {
    restoreActiveTab(startupSession.active).catch(toastError);
    const offTabs = useAppStore.subscribe((state, prev) => {
      if (state.tabs !== prev.tabs || state.activeTab !== prev.activeTab) saveSession();
    });
    const offListing = useLibraryStore.subscribe((state, prev) => {
      if (state.folders === prev.folders || state.readFailed || !state.folders) return;
      // every diagram at any depth is listed (#229 D8)
      pruneUnlisted(new Set(allDiagrams(state.folders).map((e) => e.diagram.id)));
    });
    return () => {
      offTabs();
      offListing();
    };
  }, []);
};
