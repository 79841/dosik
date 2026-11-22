import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { toastError } from "../../shared/lib/toastStore";
import { refreshLibraryQuietly } from "./libraryStore";
import { openLibraryDiagram, openPathInTab } from "./tabActions";

/** what Rust emits when a path arrives while the window is up */
export const OPEN_REQUESTS_EVENT = "open-requests";

/** one file to open: its path, and its id when it is a diagram of the library (#253 D16) */
export interface OpenRequest {
  path: string;
  diagram?: string;
}

/** Rust's queue as the app trusts it: `{path, diagram?}` each — anything else is left out */
const cleanRequests = (raw: unknown): OpenRequest[] =>
  (Array.isArray(raw) ? raw : []).flatMap((item: unknown): OpenRequest[] => {
    if (typeof item !== "object" || item === null) return [];
    const { path, diagram } = item as Record<string, unknown>;
    if (typeof path !== "string") return [];
    return [typeof diagram === "string" ? { path, diagram } : { path }];
  });

/**
 * Files the OS asks the app to open (#149): `open -b` from the MCP server's
 * `open_in_dosik`, Finder, a second launch with a path.
 *
 * Rust keeps them in a queue and this drains it, rather than Rust emitting the
 * paths themselves: a launch *with* a file delivers the path before this
 * window has a listener, and an event nobody hears is gone. The event only
 * says "there is something to take". Several at once each get a tab, in
 * order, the last one active (#218 D18); one that cannot be read is a toast
 * and the rest still open. A file in a project of the library opens as that
 * library diagram, by the id Rust found (#253 D16) — autosaved, in the tree.
 */
export const useOpenRequests = (): void => {
  useEffect(() => {
    let chain = Promise.resolve();
    const drain = (): void => {
      // one drain at a time, so tabs open in the order the paths came
      chain = chain.then(async () => {
        let requests: OpenRequest[];
        try {
          requests = cleanRequests(await invoke<unknown>("take_open_requests"));
        } catch (error) {
          toastError(error);
          return;
        }
        for (const { path, diagram } of requests) {
          try {
            if (diagram === undefined) await openPathInTab(path);
            else {
              await openLibraryDiagram(diagram);
              // made just now, maybe: the tree shows it
              refreshLibraryQuietly();
            }
          } catch (error) {
            toastError(error);
          }
        }
      });
    };
    // listen first, then take: a request that lands between the two would
    // otherwise sit in the queue until the next one arrives (#151)
    const unlisten = listen(OPEN_REQUESTS_EVENT, drain);
    void unlisten.then(drain, drain);
    return () => {
      void unlisten.then(
        (fn) => fn(),
        () => {},
      );
    };
  }, []);
};
