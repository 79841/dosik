import { describe, expect, it, vi } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";

/**
 * The Anthropic tool runner, played by hand: one tool call between two
 * responses — enough to see whether the loop goes on after the user has left
 * the diagram (#167).
 */
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = {
      messages: {
        toolRunner: (params: { tools: { name: string; run: (input: unknown) => unknown }[] }) =>
          (async function* () {
            yield { content: [], stop_reason: "tool_use" };
            await params.tools
              .find((t) => t.name === "apply_ops")!
              .run({
                ops: [{ op: "add_node", node: { label: "A", x: 0, y: 0 } }],
              });
            yield { content: [{ type: "text", text: "late" }], stop_reason: "end_turn" };
          })(),
      },
    };
  },
}));

const { sendWithApi } = await import("../apiProvider");
const { captureChatTarget } = await import("../chatTarget");

describe("stopping on the Anthropic path (#167)", () => {
  it("stops editing once the user leaves the diagram and does not emit the later answer", async () => {
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
    const target = captureChatTarget();
    useDiagramStore.getState().loadDoc(makeDoc([], [], "Other"), null);
    const callbacks = { onText: vi.fn(), onActivity: vi.fn() };
    await sendWithApi("k", "m", [], "draw", callbacks, target);
    expect(useDiagramStore.getState().nodes).toEqual([]);
    expect(target.stopped).toContain("you left the diagram");
    expect(callbacks.onActivity).toHaveBeenCalledWith(expect.stringContaining("Not applied"));
    expect(callbacks.onText).not.toHaveBeenCalled();
  });

  it("draws and answers as usual when the user stays", async () => {
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
    const callbacks = { onText: vi.fn(), onActivity: vi.fn() };
    await sendWithApi("k", "m", [], "draw", callbacks, captureChatTarget());
    expect(useDiagramStore.getState().nodes).toHaveLength(1);
    expect(callbacks.onText).toHaveBeenCalledWith("late");
  });
});
