import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { useAppStore } from "../../library/appStore";
import type { FolderMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import {
  activateTab,
  openDocument,
  resetTabsForTests,
  showHomeTab,
} from "../../library/tabActions";
import { resetAutosaveForTests } from "../../library/useAutosave";
import { captureChatTarget, closeChatTurn, openChatTurn } from "../../ai/chatTarget";
import { useAgentBridge } from "../useAgentBridge";

type ListenHandler = (event: { payload: unknown }) => void;

const mockedListen = vi.mocked(listen);
const mockedInvoke = vi.mocked(invoke);

const BLANK = { version: 1 as const, title: "Untitled Diagram", nodes: [], edges: [] };

const resetStore = () => {
  resetAutosaveForTests();
  resetTabsForTests();
  useLibraryStore.setState({ folders: null, readFailed: false });
  useAppStore.setState({ newDiagramTarget: null });
  // most of these tests are about an open editor — an external file, so no
  // project; the Home cases opt in
  openDocument(BLANK, { filePath: "/tmp/bridge.dosik.json" });
};

describe("useAgentBridge", () => {
  let handlers: Record<string, ListenHandler>;

  beforeEach(() => {
    resetStore();
    handlers = {};
    mockedListen.mockImplementation(async (eventName: string, handler: unknown) => {
      handlers[eventName] = handler as ListenHandler;
      return () => {};
    });
    mockedInvoke.mockResolvedValue(undefined);
  });

  it("applies agent:ops events to the store and replies to Rust with the result", async () => {
    renderHook(() => useAgentBridge());
    await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());

    handlers["agent:ops"]!({
      payload: {
        requestId: "req-1",
        ops: [{ op: "add_node", node: { id: "n1", label: "A", x: 0, y: 0 } }],
      },
    });

    expect(useDiagramStore.getState().nodes).toHaveLength(1);
    // fromAgent=true → highlight recorded
    expect(useDiagramStore.getState().touched.n1).toBeDefined();
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("agent_ops_result", {
        requestId: "req-1",
        applied: 1,
        errors: [],
        project: null,
      }),
    );
  });

  it("pushes the snapshot before replying with the ops result", async () => {
    const calls: string[] = [];
    mockedInvoke.mockImplementation(async (cmd: string) => {
      calls.push(cmd);
      return undefined;
    });
    renderHook(() => useAgentBridge());
    await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
    calls.length = 0;

    handlers["agent:ops"]!({
      payload: {
        requestId: "req-3",
        ops: [{ op: "add_node", node: { id: "n9", label: "A", x: 0, y: 0 } }],
      },
    });

    await waitFor(() => expect(calls).toContain("agent_ops_result"));
    // the POST /api/ops response is built from this reply — the document must be
    // up before it so an agent reading GET /api/diagram right away does not see the previous one
    expect(calls.indexOf("sync_snapshot")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("sync_snapshot")).toBeLessThan(calls.indexOf("agent_ops_result"));
    const pushes = mockedInvoke.mock.calls.filter(([cmd]) => cmd === "sync_snapshot");
    const pushed = pushes[pushes.length - 1]?.[1] as { snapshot: string };
    expect(pushed.snapshot).toContain("n9");
  });

  it("treats non-array ops as an empty array instead of crashing", async () => {
    renderHook(() => useAgentBridge());
    await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());

    handlers["agent:ops"]!({ payload: { requestId: "req-2", ops: "garbage" } });

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("agent_ops_result", {
        requestId: "req-2",
        applied: 0,
        errors: [],
        project: null,
      }),
    );
  });

  it("syncs the snapshot on mount and re-syncs document changes with a debounce", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useAgentBridge());
      expect(mockedInvoke).toHaveBeenCalledWith(
        "sync_snapshot",
        expect.objectContaining({ snapshot: expect.stringContaining("Untitled Diagram") }),
      );

      mockedInvoke.mockClear();
      useDiagramStore.getState().setTitle("Changed");
      expect(mockedInvoke).not.toHaveBeenCalledWith("sync_snapshot", expect.anything());
      vi.advanceTimersByTime(300);
      expect(mockedInvoke).toHaveBeenCalledWith(
        "sync_snapshot",
        expect.objectContaining({ snapshot: expect.stringContaining("Changed") }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("pushes the new document right away without debounce on tab switch — so GET /api/diagram never serves the tab left behind (#218)", () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useAgentBridge());
      // an edit in the tab being left, still inside its debounce
      useDiagramStore.getState().setTitle("Left behind");
      mockedInvoke.mockClear();
      openDocument({ version: 1, title: "Arrived", nodes: [], edges: [] }, { projectId: "p2" });
      const pushes = () => mockedInvoke.mock.calls.filter(([cmd]) => cmd === "sync_snapshot");
      expect(pushes()).toHaveLength(1);
      expect(pushes()[0]![1]).toMatchObject({
        snapshot: expect.stringContaining("Arrived"),
        project: { id: "p2", title: "Arrived", path: [] },
      });
      // the left tab's pending push is dropped, not sent 250ms later
      vi.advanceTimersByTime(500);
      expect(pushes()).toHaveLength(1);
      // Home's blank too
      showHomeTab();
      expect(pushes()).toHaveLength(2);
      expect(pushes()[1]![1]).toMatchObject({ project: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not sync changes other than nodes, edges and title, such as selection", () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useAgentBridge());
      mockedInvoke.mockClear();
      useDiagramStore.getState().requestEditLabel("x");
      vi.advanceTimersByTime(500);
      expect(mockedInvoke).not.toHaveBeenCalledWith("sync_snapshot", expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });
  it("creates a project and enters the editor before applying when Home is showing (#114)", async () => {
    showHomeTab();
    renderHook(() => useAgentBridge());
    await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());

    handlers["agent:ops"]!({
      payload: {
        requestId: "req-h",
        ops: [{ op: "add_node", node: { id: "n1", label: "A", x: 0, y: 0 } }],
      },
    });

    await waitFor(() => expect(useAppStore.getState().view).toBe("editor"));
    const projectId = useDiagramStore.getState().projectId;
    expect(projectId).not.toBeNull();
    expect(useDiagramStore.getState().nodes).toHaveLength(1);
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("agent_ops_result", {
        requestId: "req-h",
        applied: 1,
        errors: [],
        project: { id: projectId, title: "Untitled Diagram", path: [] },
      }),
    );
    // the editor mounts on what the first batch drew, not on the empty project's origin
    expect(useDiagramStore.getState().revealRequest?.mode).toBe("fit");
    // the snapshot Rust serves carries the project too
    expect(mockedInvoke).toHaveBeenCalledWith(
      "sync_snapshot",
      expect.objectContaining({ project: { id: projectId, title: "Untitled Diagram", path: [] } }),
    );
  });

  it("puts ops from Home into a new tab — open tabs stay as they are (#218 T33)", async () => {
    showHomeTab();
    renderHook(() => useAgentBridge());
    await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
    handlers["agent:ops"]!({
      payload: {
        requestId: "t1",
        ops: [{ op: "add_node", node: { id: "n1", label: "A", x: 0, y: 0 } }],
      },
    });
    await waitFor(() => expect(useAppStore.getState().view).toBe("editor"));
    const { tabs, activeTab } = useAppStore.getState();
    expect(tabs).toHaveLength(2);
    expect(tabs[0]!.filePath).toBe("/tmp/bridge.dosik.json");
    expect(tabs[0]!.doc?.nodes).toEqual([]);
    expect(activeTab).toBe(tabs[1]!.id);
    expect(useDiagramStore.getState().nodes.map((n) => n.id)).toEqual(["n1"]);
  });

  it("does not overwrite a tab the user switches to while the new diagram is being created (#218 T33)", async () => {
    showHomeTab();
    let saved!: () => void;
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "save_project") await new Promise<void>((resolve) => (saved = resolve));
      return undefined;
    });
    renderHook(() => useAgentBridge());
    await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
    handlers["agent:ops"]!({
      payload: {
        requestId: "t2",
        ops: [{ op: "add_node", node: { id: "n1", label: "A", x: 0, y: 0 } }],
      },
    });
    await waitFor(() => expect(saved).toBeDefined());
    // the user goes back to the file while the project is being written
    const fileTab = useAppStore.getState().tabs[0]!.id;
    await activateTab(fileTab);
    expect(useDiagramStore.getState().filePath).toBe("/tmp/bridge.dosik.json");
    saved();
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "agent_ops_result",
        expect.objectContaining({ requestId: "t2", applied: 1 }),
      ),
    );
    const file = useAppStore.getState().tabs.find((t) => t.id === fileTab)!;
    expect(file.doc?.nodes).toEqual([]);
    expect(useDiagramStore.getState().projectId).not.toBeNull();
    expect(useDiagramStore.getState().nodes.map((n) => n.id)).toEqual(["n1"]);
  });

  it("replies with an error and applies no ops when project creation fails from Home", async () => {
    showHomeTab();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "save_project") throw new Error("disk full");
      return undefined;
    });
    renderHook(() => useAgentBridge());
    await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());

    handlers["agent:ops"]!({
      payload: {
        requestId: "req-f",
        ops: [{ op: "add_node", node: { id: "n1", label: "A", x: 0, y: 0 } }],
      },
    });

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("agent_ops_result", {
        requestId: "req-f",
        applied: 0,
        errors: ["could not create a project: disk full"],
        project: null,
      }),
    );
    expect(useAppStore.getState().view).toBe("home");
    expect(useDiagramStore.getState().nodes).toHaveLength(0);
  });

  it("creates no project when the editor is open and puts the open project in the response", async () => {
    openDocument({ version: 1, title: "Mine", nodes: [], edges: [] }, { projectId: "p1" });
    renderHook(() => useAgentBridge());
    await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());

    handlers["agent:ops"]!({ payload: { requestId: "req-e", ops: [{ op: "clear" }] } });

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("agent_ops_result", {
        requestId: "req-e",
        applied: 1,
        errors: [],
        project: { id: "p1", title: "Mine", path: [] },
      }),
    );
    expect(mockedInvoke).not.toHaveBeenCalledWith("save_project", expect.anything());
  });

  it("reports the project the ops were applied to — even if the tab changes while the snapshot is pushed (#218)", async () => {
    openDocument({ version: 1, title: "Mine", nodes: [], edges: [] }, { projectId: "p1" });
    // every push waits until `land` — the swap's own push (S4) included
    const onTheirWay: (() => void)[] = [];
    const land = () => {
      for (const resolve of onTheirWay.splice(0)) resolve();
    };
    mockedInvoke.mockImplementation((cmd: string) =>
      cmd === "sync_snapshot"
        ? new Promise<undefined>((resolve) => {
            onTheirWay.push(() => resolve(undefined));
          })
        : Promise.resolve(undefined),
    );
    renderHook(() => useAgentBridge());
    await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
    land();
    handlers["agent:ops"]!({
      payload: { requestId: "req-s", ops: [{ op: "add_node", node: { label: "A", x: 0, y: 0 } }] },
    });
    // the mount's push, then the one before this request's answer
    await waitFor(() =>
      expect(mockedInvoke.mock.calls.filter(([c]) => c === "sync_snapshot")).toHaveLength(2),
    );
    // the user opens another diagram while the snapshot is on its way
    openDocument({ version: 1, title: "Other", nodes: [], edges: [] }, { projectId: "p2" });
    land();
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "agent_ops_result",
        expect.objectContaining({
          requestId: "req-s",
          project: { id: "p1", title: "Mine", path: [] },
        }),
      ),
    );
  });

  it("creates the new diagram in the project open on Home when ops arrive (#161 D4)", async () => {
    useLibraryStore.setState({
      folders: [{ folders: [], id: "work", name: "Work", updatedAt: 1, diagrams: [] }],
    });
    showHomeTab({ kind: "folder", folder: "work" });
    renderHook(() => useAgentBridge());
    await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
    handlers["agent:ops"]!({
      payload: { requestId: "r1", ops: [{ op: "add_node", node: { label: "A", x: 0, y: 0 } }] },
    });
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "save_project",
        expect.objectContaining({ folder: "work" }),
      ),
    );
  });

  it("ops after picking B with Change on the Home dashboard — new diagram in B, new tab, applied (#220 T6)", async () => {
    useLibraryStore.setState({
      folders: [
        { folders: [], id: "a", name: "A", updatedAt: 2, diagrams: [] },
        { folders: [], id: "b", name: "B", updatedAt: 1, diagrams: [] },
      ],
    });
    showHomeTab({ kind: "dashboard" });
    useAppStore.getState().setNewDiagramTarget("b");
    const before = useAppStore.getState().tabs.length;
    renderHook(() => useAgentBridge());
    await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
    handlers["agent:ops"]!({
      payload: { requestId: "r6", ops: [{ op: "add_node", node: { label: "A", x: 0, y: 0 } }] },
    });
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "agent_ops_result",
        expect.objectContaining({ requestId: "r6", applied: 1 }),
      ),
    );
    expect(mockedInvoke).toHaveBeenCalledWith(
      "save_project",
      expect.objectContaining({ folder: "b" }),
    );
    expect(useAppStore.getState().tabs).toHaveLength(before + 1);
    expect(useAppStore.getState().view).toBe("editor");
    expect(useDiagramStore.getState().nodes).toHaveLength(1);
  });

  it("attaches two concurrent requests from Home to one project in order (handler serialization)", async () => {
    showHomeTab();
    renderHook(() => useAgentBridge());
    await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());

    handlers["agent:ops"]!({
      payload: {
        requestId: "c1",
        ops: [{ op: "add_node", node: { id: "n1", label: "A", x: 0, y: 0 } }],
      },
    });
    handlers["agent:ops"]!({
      payload: {
        requestId: "c2",
        ops: [{ op: "add_node", node: { id: "n2", label: "B", x: 0, y: 0 } }],
      },
    });

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "agent_ops_result",
        expect.objectContaining({ requestId: "c2" }),
      ),
    );
    const projectId = useDiagramStore.getState().projectId;
    expect(useDiagramStore.getState().nodes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(mockedInvoke.mock.calls.filter(([c]) => c === "save_project")).toHaveLength(1);
    for (const requestId of ["c1", "c2"]) {
      expect(mockedInvoke).toHaveBeenCalledWith("agent_ops_result", {
        requestId,
        applied: 1,
        errors: [],
        project: { id: projectId, title: "Untitled Diagram", path: [] },
      });
    }
  });

  describe("chat turn requests (#167)", () => {
    it("applies, pushes the snapshot first, then replies with the result", async () => {
      renderHook(() => useAgentBridge());
      await waitFor(() => expect(handlers["agent:chat"]).toBeDefined());
      const token = openChatTurn(captureChatTarget());
      mockedInvoke.mockClear();
      handlers["agent:chat"]!({
        payload: {
          requestId: "c-1",
          token,
          action: "ops",
          ops: [{ op: "add_node", node: { id: "n1", label: "A", x: 0, y: 0 } }],
        },
      });
      await waitFor(() =>
        expect(mockedInvoke).toHaveBeenCalledWith("agent_chat_result", {
          requestId: "c-1",
          status: 200,
          body: { ok: true, applied: 1, errors: [] },
        }),
      );
      const order = mockedInvoke.mock.calls.map((c) => c[0]);
      expect(order.indexOf("sync_snapshot")).toBeLessThan(order.indexOf("agent_chat_result"));
      closeChatTurn(token);
    });

    it("queues behind external ops — never cuts in while a project is being created from Home", async () => {
      showHomeTab();
      renderHook(() => useAgentBridge());
      await waitFor(() => expect(handlers["agent:chat"]).toBeDefined());
      const token = openChatTurn(captureChatTarget());
      mockedInvoke.mockClear();
      handlers["agent:ops"]!({ payload: { requestId: "o-1", ops: [] } });
      handlers["agent:chat"]!({ payload: { requestId: "c-2", token, action: "diagram" } });
      await waitFor(() =>
        expect(mockedInvoke).toHaveBeenCalledWith(
          "agent_chat_result",
          expect.objectContaining({ requestId: "c-2" }),
        ),
      );
      const order = mockedInvoke.mock.calls.map((c) => c[0]);
      expect(order.indexOf("agent_ops_result")).toBeLessThan(order.indexOf("agent_chat_result"));
      closeChatTurn(token);
    });
  });

  /** a batch that starts another diagram (#229 D15, T26–T30) */
  describe("new_diagram (#229 D15)", () => {
    const LIB = (): FolderMeta[] => [
      {
        id: "pay",
        name: "Payments",
        updatedAt: 2,
        diagrams: [{ id: "p1", title: "Mine", updatedAt: 2, readable: true }],
        folders: [],
      },
      { id: "side", name: "Side", updatedAt: 1, diagrams: [], folders: [] },
      {
        id: "my-diagrams",
        name: "My Diagrams",
        updatedAt: 0,
        stray: true,
        diagrams: [],
        folders: [],
      },
    ];
    const result = (requestId: string) =>
      mockedInvoke.mock.calls.find(
        ([cmd, args]) =>
          cmd === "agent_ops_result" && (args as { requestId: string }).requestId === requestId,
      )?.[1] as { applied: number; errors: string[]; project: unknown } | undefined;
    const saves = () =>
      mockedInvoke.mock.calls
        .filter(([cmd]) => cmd === "save_project")
        .map(([, args]) => args as { id: string; contents: string; folder?: string });
    const send = async (requestId: string, ops: unknown[]) => {
      handlers["agent:ops"]!({ payload: { requestId, ops } });
      await waitFor(() => expect(result(requestId)).toBeDefined());
      return result(requestId)!;
    };
    const node = (id: string) => ({ op: "add_node", node: { id, label: id, x: 0, y: 0 } });
    const nodeIds = () => useDiagramStore.getState().nodes.map((n) => n.id);

    beforeEach(() => {
      useLibraryStore.setState({ folders: LIB(), readFailed: false });
      mockedInvoke.mockImplementation(async (cmd: string) =>
        cmd === "list_library" ? LIB() : undefined,
      );
      resetTabsForTests();
      openDocument({ ...BLANK, title: "Mine", nodes: [] }, { projectId: "p1" });
    });

    it("creates the new diagram in that folder in a new tab — later ops go to the new one, earlier ops to the old (T26)", async () => {
      renderHook(() => useAgentBridge());
      await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
      const oldTab = useAppStore.getState().activeTab;
      const answer = await send("n1", [
        node("before"),
        { op: "new_diagram", title: "Order flow", folder: "side" },
        node("a"),
        node("b"),
      ]);
      expect(answer.errors).toEqual([]);
      expect(answer.applied).toBe(4);
      expect(saves()).toHaveLength(1);
      expect(saves()[0]).toMatchObject({ folder: "side" });
      expect(JSON.parse(saves()[0]!.contents).title).toBe("Order flow");
      // the new tab is the active one, with the ops after new_diagram
      const { activeTab, tabs } = useAppStore.getState();
      expect(activeTab).not.toBe(oldTab);
      expect(tabs).toHaveLength(2);
      expect(useDiagramStore.getState().title).toBe("Order flow");
      expect(nodeIds()).toEqual(["a", "b"]);
      // one undo step on the new diagram
      expect(useDiagramStore.getState().past).toHaveLength(1);
      // the op before it stayed in the old tab
      const old = tabs.find((t) => t.id === oldTab)!;
      expect(old.doc?.nodes.map((n) => n.id)).toEqual(["before"]);
      // the response names the diagram the batch ended on
      const id = useDiagramStore.getState().projectId;
      expect(answer.project).toEqual({ id, title: "Order flow", path: [] });
    });

    it("creates in a nested folder when folder is its id (#229 D15, T26 nested)", async () => {
      const nested = (): FolderMeta[] =>
        LIB().map((f) =>
          f.id === "side"
            ? {
                ...f,
                folders: [
                  {
                    id: "chk",
                    name: "Checkout",
                    updatedAt: 1,
                    diagrams: [],
                    folders: [
                      { id: "flw", name: "Flows", updatedAt: 1, diagrams: [], folders: [] },
                    ],
                  },
                ],
              }
            : f,
        );
      useLibraryStore.setState({ folders: nested() });
      mockedInvoke.mockImplementation(async (cmd: string) =>
        cmd === "list_library" ? nested() : undefined,
      );
      renderHook(() => useAgentBridge());
      await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
      const answer = await send("n-deep", [
        { op: "new_diagram", title: "Order flow", folder: "flw" },
        node("a"),
      ]);
      expect(answer.errors).toEqual([]);
      expect(saves()[0]).toMatchObject({ folder: "flw" });
    });

    it("diagram in a nested folder — snapshot project.path spans every level from the top down to its folder (T30 nested)", async () => {
      const nested = (): FolderMeta[] => [
        {
          id: "pay",
          name: "Payments",
          updatedAt: 2,
          diagrams: [],
          folders: [
            {
              id: "chk",
              name: "Checkout",
              updatedAt: 2,
              diagrams: [{ id: "p1", title: "Mine", updatedAt: 2, readable: true }],
              folders: [],
            },
          ],
        },
      ];
      useLibraryStore.setState({ folders: nested() });
      renderHook(() => useAgentBridge());
      const pushes = () => mockedInvoke.mock.calls.filter(([cmd]) => cmd === "sync_snapshot");
      await waitFor(() =>
        expect(pushes().at(-1)?.[1]).toMatchObject({
          project: {
            id: "p1",
            path: [
              { id: "pay", name: "Payments" },
              { id: "chk", name: "Checkout" },
            ],
          },
        }),
      );
    });

    /**
     * the diagram on screen sits in Payments › Checkout, and Payments is the
     * most recent project — ② (its folder, `chk`) and ⑤ (`pay`) differ. The
     * listing answers a little late, as the real IPC and disk read do
     */
    const nestedLib = (): FolderMeta[] =>
      LIB().map((f) =>
        f.id === "pay"
          ? {
              ...f,
              diagrams: [],
              folders: [
                { id: "chk", name: "Checkout", updatedAt: 2, diagrams: f.diagrams, folders: [] },
              ],
            }
          : f,
      );
    const serveNested = () => {
      useLibraryStore.setState({ folders: nestedLib() });
      mockedInvoke.mockImplementation(async (cmd: string) =>
        cmd === "list_library"
          ? new Promise((resolve) => setTimeout(() => resolve(nestedLib()), 20))
          : undefined,
      );
    };

    it("uses the current diagram's (nested) folder without folder, and Untitled Diagram for a missing or empty title (T27)", async () => {
      serveNested();
      renderHook(() => useAgentBridge());
      await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
      await send("n2", [{ op: "new_diagram", title: "  " }]);
      expect(saves()[0]).toMatchObject({ folder: "chk" });
      expect(useDiagramStore.getState().title).toBe("Untitled Diagram");
    });

    it("creates only one diagram when Home is active and the first op is new_diagram (T27)", async () => {
      showHomeTab();
      renderHook(() => useAgentBridge());
      await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
      const answer = await send("n3", [{ op: "new_diagram", title: "Only" }, node("x")]);
      expect(answer.errors).toEqual([]);
      expect(saves()).toHaveLength(1);
      expect(useDiagramStore.getState().title).toBe("Only");
      expect(nodeIds()).toEqual(["x"]);
    });

    it("creates one by the Home rule and another for the later new_diagram when Home is active and the first op is something else (T27)", async () => {
      showHomeTab();
      renderHook(() => useAgentBridge());
      await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
      const answer = await send("n4", [node("first"), { op: "new_diagram" }, node("second")]);
      expect(answer.errors).toEqual([]);
      expect(saves()).toHaveLength(2);
      expect(nodeIds()).toEqual(["second"]);
      expect(useAppStore.getState().tabs).toHaveLength(3);
    });

    it.each<[string, Record<string, unknown>, string]>([
      ["title type", { title: 3 }, "new_diagram: title must be a string"],
      ["missing folder", { folder: "gone" }, "new_diagram: no folder 'gone'"],
      ["stray list", { folder: "my-diagrams" }, "new_diagram: no folder 'my-diagrams'"],
      ["non-string folder", { folder: 7 }, "new_diagram: no folder '7'"],
    ])(
      "failure (%s) → error, later ops not applied, no new tab (T28)",
      async (_, fields, error) => {
        renderHook(() => useAgentBridge());
        await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
        const answer = await send("n5", [
          node("kept"),
          { op: "new_diagram", ...fields },
          node("x"),
          node("y"),
        ]);
        expect(answer.errors).toEqual([error, "new_diagram: the 2 ops after it were not applied"]);
        expect(answer.applied).toBe(1);
        expect(saves()).toHaveLength(0);
        expect(useAppStore.getState().tabs).toHaveLength(1);
        expect(nodeIds()).toEqual(["kept"]);
      },
    );

    it("reports the reason when the save is refused and leaves later ops unapplied (T28)", async () => {
      mockedInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "save_project") throw new Error("disk full");
        return cmd === "list_library" ? LIB() : undefined;
      });
      renderHook(() => useAgentBridge());
      await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
      const answer = await send("n6", [{ op: "new_diagram" }, node("x")]);
      expect(answer.errors).toEqual([
        "new_diagram: could not create a diagram — disk full",
        "new_diagram: the 1 op after it was not applied",
      ]);
      expect(answer.applied).toBe(0);
      expect(useAppStore.getState().tabs).toHaveLength(1);
    });

    it("two new_diagram ops without folder — the second goes to the first one's folder, even if the list lags (#229, T29)", async () => {
      serveNested();
      renderHook(() => useAgentBridge());
      await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
      const answer = await send("n7b", [
        { op: "new_diagram", title: "One" },
        node("a"),
        { op: "new_diagram", title: "Two" },
        node("b"),
      ]);
      expect(answer.errors).toEqual([]);
      expect(saves().map((s) => s.folder)).toEqual(["chk", "chk"]);
    });

    it("uses the second's folder when it names one, and a third without folder follows the second (W1)", async () => {
      serveNested();
      renderHook(() => useAgentBridge());
      await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
      await send("n7c", [
        { op: "new_diagram", title: "One" },
        { op: "new_diagram", title: "Two", folder: "side" },
        { op: "new_diagram", title: "Three" },
      ]);
      expect(saves().map((s) => s.folder)).toEqual(["chk", "side", "side"]);
    });

    it("creates several in order with ops in place, and the response project is the last (T29)", async () => {
      serveNested();
      renderHook(() => useAgentBridge());
      await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
      const answer = await send("n7", [
        { op: "new_diagram", title: "One" },
        node("a"),
        { op: "new_diagram", title: "Two" },
        node("b"),
      ]);
      expect(answer.errors).toEqual([]);
      expect(answer.applied).toBe(4);
      const { tabs } = useAppStore.getState();
      expect(tabs.map((t) => t.title)).toEqual(["Mine", "One", "Two"]);
      expect(tabs[1]!.doc?.nodes.map((n) => n.id)).toEqual(["a"]);
      expect(nodeIds()).toEqual(["b"]);
      expect(answer.project).toMatchObject({ title: "Two" });
    });

    it("reports one stop line for the op that stopped, even with a page op cut after a failed new_diagram (#229)", async () => {
      renderHook(() => useAgentBridge());
      await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
      const answer = await send("n8s", [
        { op: "new_diagram", folder: "nope" },
        node("a"),
        { op: "add_page" },
        node("b"),
        node("c"),
      ]);
      expect(answer.errors).toEqual([
        "new_diagram: no folder 'nope'",
        "new_diagram: the 4 ops after it were not applied",
      ]);
      expect(answer.applied).toBe(0);
    });

    it("leaves no empty diagram for a batch from Home that starts with a page op (#229)", async () => {
      showHomeTab();
      renderHook(() => useAgentBridge());
      await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
      const answer = await send("n8h", [{ op: "add_page" }, node("x")]);
      expect(answer.errors).toEqual([
        "add_page: pages were removed — a diagram is one canvas. Use new_diagram to start another diagram.",
        "add_page: the 1 op after it was not applied",
      ]);
      expect(answer.applied).toBe(0);
      expect(saves()).toHaveLength(0);
      expect(useAppStore.getState().view).toBe("home");
      expect(useAppStore.getState().tabs).toHaveLength(1);
    });

    it("stops at a page op — the later new_diagram is not created either", async () => {
      renderHook(() => useAgentBridge());
      await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
      const answer = await send("n8", [
        node("a"),
        { op: "add_page" },
        { op: "new_diagram" },
        node("b"),
      ]);
      expect(answer.errors).toEqual([
        "add_page: pages were removed — a diagram is one canvas. Use new_diagram to start another diagram.",
        "add_page: the 2 ops after it were not applied",
      ]);
      expect(answer.applied).toBe(1);
      expect(saves()).toHaveLength(0);
      expect(nodeIds()).toEqual(["a"]);
    });

    it("includes path in the snapshot project — from the top project down to its folder, re-sent when the list changes (T30)", async () => {
      renderHook(() => useAgentBridge());
      const pushes = () => mockedInvoke.mock.calls.filter(([cmd]) => cmd === "sync_snapshot");
      await waitFor(() =>
        expect(pushes().at(-1)?.[1]).toMatchObject({
          project: { id: "p1", title: "Mine", path: [{ id: "pay", name: "Payments" }] },
        }),
      );
      const snapshot = JSON.parse((pushes().at(-1)![1] as { snapshot: string }).snapshot);
      expect(snapshot).not.toHaveProperty("activePage");
      const before = pushes().length;
      useLibraryStore.setState({
        folders: LIB().map((f) => (f.id === "pay" ? { ...f, name: "Billing" } : f)),
      });
      expect(pushes().length).toBe(before + 1);
      expect(pushes().at(-1)?.[1]).toMatchObject({
        project: { path: [{ id: "pay", name: "Billing" }] },
      });
    });
  });
});
