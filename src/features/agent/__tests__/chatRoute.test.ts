import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { captureChatTarget, closeChatTurn, openChatTurn } from "../../ai/chatTarget";
import { answerChatRequest } from "../useAgentBridge";

const store = () => useDiagramStore.getState();
const ask = (token: string, action: "diagram" | "ops", ops?: unknown) =>
  answerChatRequest({ requestId: "r", token, action, ops });

describe("bridge address for a chat turn (#167)", () => {
  beforeEach(() => store().loadDoc(makeDoc([makeNode({ id: "a" })], []), null));

  it("reads the turn's diagram and draws into it — one canvas without activePage (#229 D16)", () => {
    const token = openChatTurn(captureChatTarget());
    const read = ask(token, "diagram");
    expect(read.status).toBe(200);
    expect(read.body).not.toHaveProperty("activePage");
    expect((read.body as { nodes: { id: string }[] }).nodes.map((n) => n.id)).toEqual(["a"]);
    const edit = ask(token, "ops", [{ op: "add_node", node: { id: "c", label: "C", x: 0, y: 0 } }]);
    expect(edit).toEqual({ status: 200, body: { ok: true, applied: 1, errors: [] } });
    expect(store().nodes.map((n) => n.id)).toEqual(["a", "c"]);
    closeChatTurn(token);
  });

  it("rejects new_diagram in a chat turn — it edits only the diagram it was sent (#229 D16, T30)", () => {
    const token = openChatTurn(captureChatTarget());
    const edit = ask(token, "ops", [
      { op: "new_diagram", title: "Other" },
      { op: "add_node", node: { id: "c", label: "C", x: 0, y: 0 } },
    ]);
    expect(edit).toEqual({
      status: 200,
      body: {
        ok: false,
        applied: 0,
        errors: [
          "new_diagram: only POST /api/ops can start a new diagram — this edits one diagram",
          "new_diagram: the 1 op after it was not applied",
        ],
      },
    });
    expect(store().nodes.map((n) => n.id)).toEqual(["a"]);
    closeChatTurn(token);
  });

  it("returns 409 after leaving the diagram — never creates a new diagram, even from Home", () => {
    const token = openChatTurn(captureChatTarget());
    store().loadDoc(makeDoc([], []), null);
    const edit = ask(token, "ops", [{ op: "add_node", node: { label: "C", x: 0, y: 0 } }]);
    expect(edit.status).toBe(409);
    expect(store().nodes).toEqual([]);
    expect(ask(token, "diagram").status).toBe(409);
    closeChatTurn(token);
  });

  it("returns 404 for a finished turn or an unknown token", () => {
    const token = openChatTurn(captureChatTarget());
    closeChatTurn(token);
    expect(ask(token, "diagram").status).toBe(404);
    expect(ask("nope", "ops", []).status).toBe(404);
  });

  it("returns 400 when ops is not an array", () => {
    const token = openChatTurn(captureChatTarget());
    expect(ask(token, "ops", { op: "clear" }).status).toBe(400);
    closeChatTurn(token);
  });
});
