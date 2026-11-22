import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { useDiagramStore } from "../../shared/lib/store";
import { toastError } from "../../shared/lib/toastStore";
import { useAppStore } from "./appStore";
import { takeLeftBehind } from "./libraryApi";
import { isListing, refreshLibraryQuietly, useLibraryStore } from "./libraryStore";
import { allDiagrams, heldDiagramIds } from "./libraryTree";
import {
  closeRemovedDiagrams,
  closeRemovedFile,
  externalPaths,
  readLibraryIds,
  reloadDiagram,
  reloadExternalFile,
  resumeReachable,
} from "./tabActions";
import { isKeptWhenGone, pausedProjects, writesLanded } from "./useAutosave";

/** what Rust emits when something changed in the library's folders outside the app */
export const LIBRARY_CHANGED_EVENT = "library-changed";
/** what Rust emits when an external file open in a tab was written to or removed */
export const FILES_CHANGED_EVENT = "files-changed";

/**
 * how often the library is listed again while a save waits for its diagram
 * to be reached — a file that could not be read for a moment changes
 * nothing a watch would see
 */
export const UNREACHED_RETRY_MS = 30_000;

/** a list of strings as the app trusts it */
const strings = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];

/**
 * What changed outside the app, caught up with (#253 D12, D13): the library
 * listed again — the tree and Home follow — then each read tab of `changed`
 * read again, or closed when the listing no longer has its diagram. A
 * listing that fails proves nothing: nothing is closed then; nor is a
 * diagram a project holds out of reach — its project not found, or a folder
 * of it that could not be read.
 */
export const catchUpWithLibrary = async (changed: readonly string[]): Promise<void> => {
  let listed: ReadonlySet<string> | null;
  let held: ReadonlySet<string> = new Set();
  try {
    const folders = await useLibraryStore.getState().refresh();
    listed = new Set(allDiagrams(folders).map((e) => e.diagram.id));
    held = heldDiagramIds(folders);
  } catch {
    listed = null;
  }
  const open = new Set(readLibraryIds());
  const ids = [...new Set(changed)].filter((id) => open.has(id));
  if (listed) {
    const there = listed;
    await closeRemovedDiagrams(new Set(ids.filter((id) => !there.has(id) && !held.has(id))));
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

/** what the move of the older library left behind, said once it is known (#253) */
const tellLeftBehind = async (): Promise<void> => {
  const left = await takeLeftBehind();
  if (left === 0) return;
  const what = left === 1 ? "1 diagram" : `${left} diagrams`;
  const stay = left === 1 ? "it stays" : "they stay";
  toastError(`${what} couldn't be moved — ${stay} in the old library folder`);
};

/**
 * Asks what the move left behind until Rust has said (#253): the question
 * fails while the move has failed, and a later listing may move it — so
 * every listing that lands asks again, until one answer comes back.
 */
const leftBehindAsker = (): (() => void) => {
  let told = false;
  let asking = false;
  return () => {
    if (told || asking) return;
    asking = true;
    tellLeftBehind().then(
      () => {
        told = true;
        asking = false;
      },
      () => {
        asking = false;
      },
    );
  };
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
    const askLeftBehind = leftBehindAsker();
    askLeftBehind();
    let chain = Promise.resolve();
    const queue = (job: () => Promise<void>) => {
      chain = chain.then(job).catch(() => undefined);
    };
    // `rescan`: the watch lost events — every read tab is looked at again
    const offLibrary = listen<{ changed?: unknown; rescan?: unknown }>(
      LIBRARY_CHANGED_EVENT,
      (event) =>
        queue(() =>
          catchUpWithLibrary(
            event.payload?.rescan === true ? readLibraryIds() : strings(event.payload?.changed),
          ),
        ),
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
        // a save on its way has written the file: read after its answer,
        // it is the app's own, not a change from outside
        await writesLanded();
        await catchUpWithLibrary(readLibraryIds());
        await catchUpWithFiles(externalPaths(), []);
      });
    window.addEventListener("focus", onFocus);
    // a save that waits for its diagram tries again with the next listing —
    // none asked while one is still on its way, nor for a tab kept when its
    // diagram went: no listing brings that back
    const retry = setInterval(() => {
      const waiting = pausedProjects().some((id) => !isKeptWhenGone(id));
      if (waiting && !isListing()) refreshLibraryQuietly();
    }, UNREACHED_RETRY_MS);
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
    // a diagram out of reach listed again — its project found — saves again
    const offListing = useLibraryStore.subscribe((state, prev) => {
      if (state.folders === prev.folders || state.readFailed || !state.folders) return;
      resumeReachable(new Set(allDiagrams(state.folders).map((e) => e.diagram.id)));
      // a listing tries a failed move of the older library again
      askLeftBehind();
    });
    return () => {
      clearInterval(retry);
      window.removeEventListener("focus", onFocus);
      offTabs();
      offPath();
      offListing();
      for (const off of [offLibrary, offFiles]) {
        void off.then(
          (fn) => fn(),
          () => {},
        );
      }
    };
  }, []);
};
