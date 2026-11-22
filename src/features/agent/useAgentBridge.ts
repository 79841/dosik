import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { useDiagramStore } from "../../shared/lib/store";
import { notAppliedAfter, REMOVED_PAGE_OPS } from "../../shared/lib/store/agentOps";
import { documentMayHaveChanged } from "../../shared/lib/store/document";
import { revealRequestFor } from "../../shared/lib/store/reveal";
import type { AgentOp, NewDiagramOp } from "../../shared/lib/types";
import { applyForChat, chatTurn, readForChat } from "../ai/chatTarget";
import { useAppStore } from "../library/appStore";
import { blankDoc } from "../library/libraryApi";
import { useLibraryStore } from "../library/libraryStore";
import { findDiagram, savableFolder } from "../library/libraryTree";
import { newDiagramTab } from "../library/tabActions";
import { cutAtRemovedOp, splitAtNewDiagram } from "./bridgeBatch";
import { bridgeSnapshot } from "./bridgeSnapshot";

interface AgentOpsPayload {
  requestId: string;
  ops: AgentOp[];
}

/** a subscription CLI's request on its own turn's URL (#167) — `/api/chat/<token>/…` */
interface AgentChatPayload {
  requestId: string;
  token: string;
  action: "diagram" | "ops";
  ops?: unknown;
}

const SYNC_DEBOUNCE_MS = 250;

/**
 * Which library diagram the bridge is acting on — null for an external file
 * or a blank. `path` is where the listing has it, from the top project down
 * to the folder it is in (#229 D15) — the ids `new_diagram.folder` takes;
 * `[]` while the listing does not have it yet.
 */
const currentProject = (): {
  id: string;
  title: string;
  path: { id: string; name: string }[];
} | null => {
  const { projectId, title } = useDiagramStore.getState();
  if (!projectId) return null;
  const { folders } = useLibraryStore.getState();
  const found = folders ? findDiagram(folders, projectId) : null;
  return { id: projectId, title, path: found?.path.map(({ id, name }) => ({ id, name })) ?? [] };
};

/**
 * Why `create` cannot start a diagram, or null (#229 D15). A folder is
 * checked against the listing — read first when there is none yet; a
 * listing that cannot be read leaves the check to Rust's save.
 */
const newDiagramError = async (create: NewDiagramOp): Promise<string | null> => {
  const { title, folder } = create as { title?: unknown; folder?: unknown };
  if (title !== undefined && typeof title !== "string") {
    return "new_diagram: title must be a string";
  }
  if (folder === undefined) return null;
  if (typeof folder !== "string") return `new_diagram: no folder '${String(folder)}'`;
  const folders =
    useLibraryStore.getState().folders ??
    (await useLibraryStore
      .getState()
      .refresh()
      .catch(() => null));
  // a listed folder at any depth, in a project that is there (#229 D15)
  return folders && !savableFolder(folders, folder) ? `new_diagram: no folder '${folder}'` : null;
};

/**
 * Answers a chat turn's request: it reads or edits the diagram the turn was sent
 * from, never Home's new-project path — a turn whose diagram is gone stops
 * (409) instead of drawing somewhere else. Exported for tests.
 */
export const answerChatRequest = (payload: AgentChatPayload): { status: number; body: unknown } => {
  const target = chatTurn(payload.token);
  if (!target) {
    return {
      status: 404,
      body: {
        ok: false,
        error: "This chat turn is over — use the URLs in your current instructions.",
      },
    };
  }
  if (payload.action === "diagram") {
    const read = readForChat(target);
    return read.ok
      ? { status: 200, body: JSON.parse(read.doc) }
      : { status: 409, body: { ok: false, error: read.error } };
  }
  if (!Array.isArray(payload.ops)) {
    return { status: 400, body: { ok: false, error: "'ops' array is required" } };
  }
  const result = applyForChat(target, payload.ops as AgentOp[]);
  return result.ok
    ? {
        status: 200,
        body: { ok: result.errors.length === 0, applied: result.applied, errors: result.errors },
      }
    : { status: 409, body: { ok: false, applied: 0, errors: result.errors } };
};

/** Pushes the current document to Rust, which serves it at GET /api/diagram. */
const pushSnapshot = async (): Promise<void> => {
  await invoke("sync_snapshot", {
    snapshot: JSON.stringify(bridgeSnapshot()),
    project: currentProject(),
  }).catch(() => undefined);
};

/**
 * Bridges the Rust-side agent HTTP server with the diagram store:
 * - applies incoming agent ops to the store (highlighted in the UI)
 * - keeps a JSON snapshot of the document synced to Rust for GET /api/diagram
 *
 * User edits sync on a debounce; agent ops sync *before* their POST is
 * answered, so read-after-write over the bridge is ordered; a document swap
 * syncs at once.
 */
export const useAgentBridge = (): void => {
  useEffect(() => {
    // Rust answers each POST on its own thread, so events can arrive
    // concurrently. Handling them one at a time keeps "create a project if
    // Home is up" atomic: two simultaneous requests would otherwise both see
    // Home, make two projects, and the second open would wipe the first's ops.
    // An event that finds nothing running starts at once (ops apply
    // synchronously in the editor); the rest queue behind it.
    let queue: Promise<void> = Promise.resolve();
    let busy = false;
    const handle = async (event: { payload: AgentOpsPayload }): Promise<void> => {
      const { requestId } = event.payload;
      // a removed page op stops the batch where it stands — nothing after it
      // lands anywhere, a new diagram's ops included (#229 D15)
      const { ops, cut } = cutAtRemovedOp(
        Array.isArray(event.payload.ops) ? event.payload.ops : [],
      );
      // each new_diagram starts a diagram the ops after it go to (#229 D15)
      const { lead, parts } = splitAtNewDiagram(ops);
      // ops arriving on the Home screen get a diagram of their own (#114), so
      // an agent's `clear` → `add_node` flow never stalls on the start screen.
      // It goes where `targetFolder` says — the project Home shows, else the
      // one picked with Change, else the most recent (#220 D8).
      // It opens in a new tab and the other tabs stay (#218 D16); a tab the
      // user goes to while it is being made is kept, not written over (D9).
      // A batch that starts with new_diagram makes its own instead
      let created = false;
      // where the last diagram this batch made went: a later new_diagram with
      // no folder goes there too — the listing may not name the new diagram
      // yet, so "the folder of the diagram on screen" would not find it
      // (#229)
      let madeIn: string | undefined;
      // A batch that starts with a removed page op stops at once — nothing
      // would be drawn, so nothing is made (#229)
      const stopsAtOnce = REMOVED_PAGE_OPS.has(
        (lead[0] as { op?: unknown } | undefined)?.op as string,
      );
      if (
        useAppStore.getState().view === "home" &&
        (lead.length > 0 || parts.length === 0) &&
        !stopsAtOnce
      ) {
        try {
          madeIn = (await newDiagramTab()).folder;
          created = true;
        } catch (error) {
          void invoke("agent_ops_result", {
            requestId,
            applied: 0,
            errors: [
              `could not create a project: ${error instanceof Error ? error.message : String(error)}`,
            ],
            project: null,
          }).catch(() => undefined);
          return;
        }
      }
      let applied = 0;
      const errors: string[] = [];
      /** applies a run of ops to the diagram on screen — a diagram made for them opens on what they drew */
      const apply = (run: AgentOp[], fresh: boolean) => {
        if (run.length > 0) {
          const result = useDiagramStore.getState().applyOps(run, true);
          applied += result.applied;
          errors.push(...result.errors);
        }
        // made empty (reveal: origin) and the editor may be mounting now:
        // let it open on whatever the ops drew instead
        if (fresh) {
          useDiagramStore.setState({
            revealRequest: revealRequestFor(useDiagramStore.getState().nodes),
          });
        }
      };
      apply(lead, created);
      // the ops the removed page op cut off: told once, by whatever stopped first
      let cutOff = cut?.dropped ?? 0;
      for (const [k, part] of parts.entries()) {
        // the ops a failure leaves unapplied: this part's, every later one's,
        // and those the cut took off after them — one stop line, for the op
        // that really stopped the batch (#229)
        const left =
          parts.slice(k + 1).reduce((n, p) => n + 1 + p.ops.length, part.ops.length) + cutOff;
        const stop = (error: string) => {
          errors.push(error);
          if (left > 0) errors.push(notAppliedAfter("new_diagram", left));
          cutOff = 0;
        };
        const refused = await newDiagramError(part.create);
        if (refused) {
          stop(refused);
          break;
        }
        try {
          const title = part.create.title?.trim() ? part.create.title : blankDoc().title;
          madeIn = (await newDiagramTab(part.create.folder ?? madeIn, { ...blankDoc(), title }))
            .folder;
        } catch (error) {
          stop(
            `new_diagram: could not create a diagram — ${error instanceof Error ? error.message : String(error)}`,
          );
          break;
        }
        applied += 1;
        apply(part.ops, true);
      }
      if (cut && cutOff > 0) errors.push(notAppliedAfter(cut.op, cutOff));
      // the diagram the batch ended on — read now: the user can switch tabs
      // while the snapshot below is on its way (#218)
      const project = currentProject();
      // Push the new document *before* answering. The reply is what POST
      // /api/ops returns, so an agent that reads GET /api/diagram right after
      // its POST would otherwise race the 250ms debounce below and be served
      // the pre-op document — which reads as "the ops silently did nothing".
      await pushSnapshot();
      void invoke("agent_ops_result", { requestId, applied, errors, project }).catch(
        () => undefined,
      );
    };
    /** runs `job` now if nothing is running, or after what is */
    const enqueue = (job: () => Promise<void>): void => {
      const step = (): Promise<void> => {
        busy = true;
        return job()
          .catch(() => undefined)
          .finally(() => {
            busy = false;
          });
      };
      queue = busy ? queue.then(step) : step();
    };
    const unlisten = listen<AgentOpsPayload>("agent:ops", (event) => {
      enqueue(() => handle(event));
    });
    // a chat turn's requests queue behind external ops, so the two never
    // interleave inside a batch
    const handleChat = async (payload: AgentChatPayload): Promise<void> => {
      let answer: { status: number; body: unknown };
      try {
        answer = answerChatRequest(payload);
      } catch (error) {
        // answer anyway: no reply reads as "queued" to the CLI after 3 s
        answer = {
          status: 500,
          body: { ok: false, error: error instanceof Error ? error.message : String(error) },
        };
      }
      const { status, body } = answer;
      // the new document reaches GET /api/diagram before the CLI hears back,
      // same order as POST /api/ops
      if (payload.action === "ops" && status === 200) await pushSnapshot();
      void invoke("agent_chat_result", { requestId: payload.requestId, status, body }).catch(
        () => undefined,
      );
    };
    const unlistenChat = listen<AgentChatPayload>("agent:chat", (event) => {
      enqueue(() => handleChat(event.payload));
    });
    return () => {
      void unlisten.then((fn) => fn());
      void unlistenChat.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const sync = () => {
      void pushSnapshot();
    };

    sync();
    const unsubscribe = useDiagramStore.subscribe((state, prev) => {
      // another document on screen (a tab switch, Home): pushed at once, so
      // GET /api/diagram never serves the one left — an agent that read it and
      // wrote back would edit this one with the other's node ids (#218)
      if (state.docSession !== prev.docSession) {
        if (timer) clearTimeout(timer);
        timer = null;
        sync();
        return;
      }
      if (!documentMayHaveChanged(state, prev)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(sync, SYNC_DEBOUNCE_MS);
    });

    // the listing names the folders the open diagram is in (`project.path`):
    // a new listing — a rename, a move, a diagram just saved — is sent at once
    const unsubscribeLibrary = useLibraryStore.subscribe((state, prev) => {
      if (state.folders !== prev.folders) sync();
    });

    const cleanup = setInterval(() => {
      useDiagramStore.getState().clearTouched(Date.now() - 2500);
    }, 2000);

    return () => {
      unsubscribe();
      unsubscribeLibrary();
      clearInterval(cleanup);
      if (timer) clearTimeout(timer);
    };
  }, []);
};
