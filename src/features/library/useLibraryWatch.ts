import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { useDiagramStore } from "../../shared/lib/store";
import { useAppStore } from "./appStore";
import { useLibraryStore } from "./libraryStore";
import { allDiagrams } from "./libraryTree";
import {
  closeRemovedDiagrams,
  closeRemovedFile,
  externalPaths,
  readLibraryIds,
  reloadDiagram,
  reloadExternalFile,
} from "./tabActions";

/** what Rust emits when something changed in the library's folders outside the app */
export const LIBRARY_CHANGED_EVENT = "library-changed";
/** what Rust emits when an external file open in a tab was written to or removed */
export const FILES_CHANGED_EVENT = "files-changed";

/** a list of strings as the app trusts it */
const strings = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];

/**
 * What changed outside the app, caught up with (#253 D12, D13): the library
 * listed again — the tree and Home follow — then each read tab of `changed`
 * read again, or closed when the listing no longer has its diagram. A
 * listing that fails proves nothing: nothing is closed then.
 */
export const catchUpWithLibrary = async (changed: readonly string[]): Promise<void> => {
  let listed: ReadonlySet<string> | null;
  try {
    const folders = await useLibraryStore.getState().refresh();
    listed = new Set(allDiagrams(folders).map((e) => e.diagram.id));
  } catch {
    listed = null;
  }
  const open = new Set(readLibraryIds());
  const ids = [...new Set(changed)].filter((id) => open.has(id));
  if (listed) {
    const gone = listed;
    closeRemovedDiagrams(new Set(ids.filter((id) => !gone.has(id))));
  }
  for (const id of ids) {
    if (!listed || listed.has(id)) await reloadDiagram(id);
  }
};

/** the external files written to read again, the removed ones closed */
export const catchUpWithFiles = async (
  changed: readonly string[],
  removed: readonly string[],
): Promise<void> => {
  for (const path of removed) closeRemovedFile(path);
  for (const path of changed) await reloadExternalFile(path);
};

/**
 * Keeps the app in step with the disk (#253 R5, D12, D13): Rust watches the
 * library's folders and the external files open in tabs, and says what
 * changed; this lists the library again and reads the tabs again. Coming
 * back to the window looks again — a watch can miss events — at every read
 * tab and the library. One catch-up at a time, in the order they came.
 */
export const useLibraryWatch = (): void => {
  useEffect(() => {
    let chain = Promise.resolve();
    const queue = (job: () => Promise<void>) => {
      chain = chain.then(job).catch(() => undefined);
    };
    const offLibrary = listen<{ changed?: unknown }>(LIBRARY_CHANGED_EVENT, (event) =>
      queue(() => catchUpWithLibrary(strings(event.payload?.changed))),
    );
    const offFiles = listen<{ changed?: unknown; removed?: unknown }>(
      FILES_CHANGED_EVENT,
      (event) =>
        queue(() =>
          catchUpWithFiles(strings(event.payload?.changed), strings(event.payload?.removed)),
        ),
    );
    const onFocus = () =>
      queue(async () => {
        await catchUpWithLibrary(readLibraryIds());
        await catchUpWithFiles(externalPaths(), []);
      });
    window.addEventListener("focus", onFocus);
    // the external files open in tabs go to the watch as the strip changes —
    // looked at once a switch is over: halfway, the store and the strip disagree
    let watched = "";
    let looking = false;
    const lookAtFiles = () => {
      looking = false;
      const paths = externalPaths().sort();
      const key = JSON.stringify(paths);
      if (key === watched) return;
      watched = key;
      void invoke("watch_files", { paths }).catch(() => undefined);
    };
    const watchFiles = () => {
      if (looking) return;
      looking = true;
      queueMicrotask(lookAtFiles);
    };
    lookAtFiles();
    const offTabs = useAppStore.subscribe((state, prev) => {
      if (state.tabs !== prev.tabs || state.activeTab !== prev.activeTab) watchFiles();
    });
    const offPath = useDiagramStore.subscribe((state, prev) => {
      if (state.filePath !== prev.filePath) watchFiles();
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      offTabs();
      offPath();
      for (const off of [offLibrary, offFiles]) {
        void off.then(
          (fn) => fn(),
          () => {},
        );
      }
    };
  }, []);
};
