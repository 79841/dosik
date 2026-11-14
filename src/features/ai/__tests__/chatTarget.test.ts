import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import {
  applyForChat,
  captureChatTarget,
  chatTurn,
  closeChatTurn,
  describeApply,
  openChatTurn,
  readForChat,
  STOPPED_FOR_MODEL,
} from "../chatTarget";

const store = () => useDiagramStore.getState();
const add = (id: string) => ({ op: "add_node" as const, node: { id, label: id, x: 0, y: 0 } });

describe("chat turn target (#167)", () => {
  beforeEach(() => store().loadDoc(makeDoc([makeNode({ id: "a" })], []), null));

  it("targets the diagram at send time — there are no pages (#229 D16)", () => {
    const target = captureChatTarget();
    expect(target).toEqual({ session: store().docSession, stopped: null });
    expect(target).not.toHaveProperty("pageId");
  });

  it("applies to the live store — one undo step", () => {
    const target = captureChatTarget();
    const result = applyForChat(target, [add("c"), add("d")]);
    expect(result).toEqual({ ok: true, applied: 2, errors: [] });
    expect(store().nodes.map((n) => n.id)).toEqual(["a", "c", "d"]);
    store().undo();
    expect(store().nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("stops and draws nowhere after leaving for Home or another diagram", () => {
    const target = captureChatTarget();
    store().loadDoc(makeDoc([], []), null); // what Home and opening a diagram both do
    const result = applyForChat(target, [add("c")]);
    expect(result).toEqual({ ok: false, applied: 0, errors: [STOPPED_FOR_MODEL] });
    expect(store().nodes).toEqual([]);
    expect(target.stopped).toContain("you left the diagram");
    // stays stopped, even if the user comes back to a document
    expect(readForChat(target).ok).toBe(false);
  });

  it("read: the diagram as is — no activePage", () => {
    const read = readForChat(captureChatTarget());
    const doc = JSON.parse(read.ok ? read.doc : "{}");
    expect(doc.nodes.map((n: { id: string }) => n.id)).toEqual(["a"]);
    expect(doc).not.toHaveProperty("activePage");
    expect(doc).not.toHaveProperty("pages");
  });

  it("read: images become placeholders", () => {
    store().applyOps([
      {
        op: "add_node",
        node: {
          id: "img",
          label: "",
          shape: "image",
          x: 0,
          y: 0,
          src: `data:image/png;base64,${"A".repeat(400)}`,
        },
      },
    ]);
    const read = readForChat(captureChatTarget());
    expect(read.ok && read.doc).not.toContain("A".repeat(400));
  });

  it("activity line", () => {
    expect(describeApply({ ok: true, applied: 1, errors: [] })).toBe(
      "Edited diagram — 1 operation applied",
    );
    expect(describeApply({ ok: true, applied: 2, errors: ["x"] })).toBe(
      "Edited diagram — 2 operations applied, 1 failed",
    );
    expect(describeApply({ ok: false, applied: 0, errors: [STOPPED_FOR_MODEL] })).toContain(
      "Not applied",
    );
  });

  it("activity line — counts the stop notice as not applied, not as a failure (#229)", () => {
    expect(
      describeApply({
        ok: true,
        applied: 1,
        errors: [
          "add_page: pages were removed — a diagram is one canvas. Use new_diagram to start another diagram.",
          "add_page: the 2 ops after it were not applied",
        ],
      }),
    ).toBe("Edited diagram — 1 operation applied, 1 failed, 2 not applied after it");
    expect(
      describeApply({
        ok: true,
        applied: 0,
        errors: ["x", "new_diagram: the 1 op after it was not applied"],
      }),
    ).toBe("Edited diagram — 0 operations applied, 1 failed, 1 not applied after it");
  });

  it("drops the CLI turn token when the turn ends", () => {
    const target = captureChatTarget();
    const token = openChatTurn(target);
    expect(chatTurn(token)).toBe(target);
    expect(openChatTurn(target)).not.toBe(token);
    closeChatTurn(token);
    expect(chatTurn(token)).toBeUndefined();
  });
});
