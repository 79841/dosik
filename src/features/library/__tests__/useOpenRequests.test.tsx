import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { useAppStore } from "../appStore";
import { blankDoc } from "../libraryApi";
import { resetTabsForTests } from "../tabActions";
import { OPEN_REQUESTS_EVENT, useOpenRequests } from "../useOpenRequests";

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

/** a file to open, as Rust queues it: not a library diagram */
const file = (path: string) => ({ path });

/** what Rust has queued: `take_open_requests` hands it over once, then it is empty */
const queue = (paths: string[], title = "Queued") => {
  let pending = [...paths];
  mockedInvoke.mockImplementation(async (cmd) => {
    if (cmd === "take_open_requests") {
      const taken = pending.map(file);
      pending = [];
      return taken;
    }
    if (cmd === "read_text_file") return JSON.stringify({ ...blankDoc(), title });
    return undefined;
  });
  return (more: string[]) => {
    pending.push(...more);
  };
};

describe("useOpenRequests — opens files handed over by the OS (#149)", () => {
  beforeEach(() => resetTabsForTests());

  it("drains the queue on mount when the app was launched with a file — the event came before the window", async () => {
    queue(["/tmp/launch.dosik.json"]);
    renderHook(() => useOpenRequests());
    await waitFor(() => expect(useDiagramStore.getState().filePath).toBe("/tmp/launch.dosik.json"));
    expect(useAppStore.getState().view).toBe("editor");
  });

  it("several arriving at once each get a tab — the last is active, nothing is asked (#218 T34)", async () => {
    queue(["/tmp/a.dosik.json", "/tmp/b.dosik.json"]);
    renderHook(() => useOpenRequests());
    await waitFor(() => expect(useDiagramStore.getState().filePath).toBe("/tmp/b.dosik.json"));
    expect(useAppStore.getState().tabs.map((t) => t.filePath)).toEqual([
      "/tmp/a.dosik.json",
      "/tmp/b.dosik.json",
    ]);
    expect(mockedInvoke.mock.calls.filter(([c]) => c === "read_text_file")).toHaveLength(2);
    expect(vi.mocked(ask)).not.toHaveBeenCalled();
  });

  it("opens the rest even if one fails — that one gets a toast", async () => {
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "take_open_requests")
        return [file("/tmp/gone.dosik.json"), file("/tmp/ok.dosik.json")];
      if (cmd === "read_text_file") {
        if ((args as { path: string }).path.includes("gone")) throw new Error("No such file");
        return JSON.stringify({ ...blankDoc(), title: "OK" });
      }
      return undefined;
    });
    renderHook(() => useOpenRequests());
    await waitFor(() => expect(useDiagramStore.getState().filePath).toBe("/tmp/ok.dosik.json"));
    expect(useToastStore.getState().toasts.map((t) => t.text)).toContain("Error: No such file");
  });

  it("requests that arrive while running are taken from the queue on the event", async () => {
    const push = queue([]);
    renderHook(() => useOpenRequests());
    await waitFor(() => expect(mockedListen).toHaveBeenCalled());
    const [event, handler] = mockedListen.mock.calls[0] as unknown as [string, () => void];
    expect(event).toBe(OPEN_REQUESTS_EVENT);
    push(["/tmp/later.dosik.json"]);
    handler();
    await waitFor(() => expect(useDiagramStore.getState().filePath).toBe("/tmp/later.dosik.json"));
  });

  it("reports a failure with a toast — does not swallow it silently", async () => {
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "take_open_requests") return [file("/tmp/broken.dosik.json")];
      if (cmd === "read_text_file") throw new Error("/tmp/broken.dosik.json: No such file");
      return undefined;
    });
    const before = useToastStore.getState().toasts.length;
    renderHook(() => useOpenRequests());
    await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(before));
    expect(useAppStore.getState().view).toBe("home");
  });

  it("subscribes first — so a request arriving in between is not held until the next one (#151)", async () => {
    const order: string[] = [];
    // registration takes a moment — the request must not be taken before it completes
    mockedListen.mockImplementationOnce((async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("listen");
      return () => {};
    }) as never);
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "take_open_requests") order.push("take");
      return [];
    });
    renderHook(() => useOpenRequests());
    await waitFor(() => expect(order).toContain("take"));
    expect(order.indexOf("listen")).toBeLessThan(order.indexOf("take"));
  });

  describe("a file in a project of the library (#253 D16)", () => {
    it("opens as that library diagram, by the id Rust found — the rest as files", async () => {
      let pending: unknown = [
        { path: "/lib/Payments/Flow.dosik", diagram: "d1" },
        { path: "/tmp/mine.dosik" },
      ];
      mockedInvoke.mockImplementation(async (cmd, args) => {
        if (cmd === "take_open_requests") {
          const taken = pending;
          pending = [];
          return taken;
        }
        if (cmd === "load_project") {
          expect(args).toEqual({ id: "d1" });
          return { contents: JSON.stringify(blankDoc()), name: "Flow", stamp: "1-2-ab" };
        }
        if (cmd === "read_text_file") return JSON.stringify({ ...blankDoc(), title: "Mine" });
        if (cmd === "list_library") return [];
        return undefined;
      });
      renderHook(() => useOpenRequests());
      await waitFor(() => expect(useDiagramStore.getState().filePath).toBe("/tmp/mine.dosik"));
      const tabs = useAppStore.getState().tabs;
      expect(tabs.map((t) => [t.projectId, t.filePath, t.title])).toEqual([
        ["d1", null, "Flow"],
        [null, "/tmp/mine.dosik", "Mine"],
      ]);
      // the tree is listed again: the diagram may be new to it
      expect(mockedInvoke.mock.calls.some(([c]) => c === "list_library")).toBe(true);
      expect(mockedInvoke.mock.calls.filter(([c]) => c === "read_text_file")).toHaveLength(1);
    });

    it("what is no request at all is left out", async () => {
      mockedInvoke.mockImplementation(async (cmd) => {
        if (cmd === "take_open_requests")
          return [5, null, "/tmp/a bare path.dosik", { diagram: "x" }, { path: "/tmp/ok.dosik" }];
        if (cmd === "read_text_file") return JSON.stringify({ ...blankDoc(), title: "OK" });
        return undefined;
      });
      renderHook(() => useOpenRequests());
      await waitFor(() => expect(useDiagramStore.getState().filePath).toBe("/tmp/ok.dosik"));
      expect(useAppStore.getState().tabs).toHaveLength(1);
    });
  });
});
