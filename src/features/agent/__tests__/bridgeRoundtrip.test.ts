import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import type { DiagramDoc } from "../../../shared/lib/types";
import { openDocument, resetTabsForTests } from "../../library/tabActions";
import { useAgentBridge } from "../useAgentBridge";

type ListenHandler = (event: { payload: unknown }) => void;

const mockedListen = vi.mocked(listen);
const mockedInvoke = vi.mocked(invoke);

/**
 * Bridge round-trip integration test: checks that the whole path except the
 * HTTP layer (Rust) — agent:ops event → applyOps → result reply → snapshot
 * sync → reloading the snapshot as a document — fits together in one cycle.
 */
describe("bridge roundtrip (ops → store → snapshot → reload)", () => {
  let handlers: Record<string, ListenHandler>;
  let snapshots: string[];

  beforeEach(() => {
    resetTabsForTests();
    // an open editor — on Home the bridge would first create a project (#114)
    openDocument(
      { version: 1, title: "Untitled Diagram", nodes: [], edges: [] },
      { filePath: "/tmp/roundtrip.dosik.json" },
    );
    handlers = {};
    snapshots = [];
    mockedListen.mockImplementation(async (eventName: string, handler: unknown) => {
      handlers[eventName] = handler as ListenHandler;
      return () => {};
    });
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "sync_snapshot") {
        snapshots.push((args as { snapshot: string }).snapshot);
      }
      return undefined;
    });
  });

  it("sends the document with agent ops applied as a snapshot, and reloading that snapshot gives the same document", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useAgentBridge());
      handlers["agent:ops"]!({
        payload: {
          requestId: "req-rt",
          ops: [
            { op: "add_node", node: { id: "a", label: "Client", shape: "rounded", x: 0, y: 0 } },
            { op: "add_node", node: { id: "b", label: "API", shape: "hexagon", x: 300, y: 0 } },
            {
              op: "add_edge",
              edge: { id: "e1", source: "a", target: "b", label: "req", markerEnd: "diamond" },
            },
            { op: "set_title", title: "Roundtrip" },
          ],
        },
      });
      // snapshot sync after the debounce (250ms)
      vi.advanceTimersByTime(400);

      const last = snapshots.at(-1);
      expect(last).toBeDefined();
      const doc = JSON.parse(last!) as DiagramDoc;
      expect(doc.title).toBe("Roundtrip");
      expect(doc.nodes).toHaveLength(2);
      expect(doc.edges[0]?.data?.markerEnd).toBe("diamond");

      // the JSON that GET /api/diagram returns must reload safely, like opening a file
      useDiagramStore.getState().loadDoc(doc, null);
      const reloaded = useDiagramStore.getState().toDoc();
      expect(reloaded.title).toBe("Roundtrip");
      expect(reloaded.nodes.map((n) => n.id)).toEqual(["a", "b"]);
      expect(reloaded.edges[0]?.sourceHandle).toBe("right");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves sequence ops (lifeline, add_message, add_activation) across the round trip", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useAgentBridge());
      handlers["agent:ops"]!({
        payload: {
          requestId: "req-seq",
          ops: [
            { op: "add_node", node: { id: "u", label: "User", shape: "lifeline", x: 0, y: 0 } },
            { op: "add_node", node: { id: "s", label: "Server", shape: "lifeline", x: 300, y: 0 } },
            {
              op: "add_message",
              message: { id: "m1", from: "u", to: "s", y: 120, label: "login()" },
            },
            { op: "add_message", message: { id: "m2", from: "s", to: "s", y: 160 } },
            { op: "add_activation", lifeline: "s", y0: 120, y1: 220 },
          ],
        },
      });
      vi.advanceTimersByTime(400);

      const doc = JSON.parse(snapshots.at(-1)!) as DiagramDoc;
      useDiagramStore.getState().loadDoc(doc, null);
      const reloaded = useDiagramStore.getState().toDoc();
      const lifeline = reloaded.nodes.find((n) => n.id === "s");
      expect(lifeline?.data.shape).toBe("lifeline");
      expect(lifeline?.data.activations).toEqual([{ y0: 120, y1: 220 }]);
      const m1 = reloaded.edges.find((e) => e.id === "m1");
      expect(m1?.sourceHandle).toMatch(/^right-/);
      expect(m1?.targetHandle).toMatch(/^left-/);
      expect(m1?.data?.pathStyle).toBe("straight");
      const m2 = reloaded.edges.find((e) => e.id === "m2");
      expect(m2?.source).toBe("s");
      expect(m2?.target).toBe("s");
    } finally {
      vi.useRealTimers();
    }
  });

  it("replies with an error for an op that fails validation and leaves the document untouched", async () => {
    renderHook(() => useAgentBridge());
    await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());

    handlers["agent:ops"]!({
      payload: {
        requestId: "req-bad",
        ops: [
          { op: "add_node", node: { label: "ok", x: 0, y: 0 } },
          { op: "add_node", node: { label: "bad", shape: "pentagon", x: 0, y: 0 } },
        ],
      },
    });

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "agent_ops_result",
        expect.objectContaining({
          requestId: "req-bad",
          applied: 1,
          errors: [expect.stringMatching(/shape must be one of/)],
        }),
      ),
    );
    expect(useDiagramStore.getState().nodes).toHaveLength(1);
  });
});
