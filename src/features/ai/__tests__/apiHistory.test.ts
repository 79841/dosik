import { describe, expect, it } from "vitest";

import { historyToParams } from "../apiProvider";
import type { ChatMessage } from "../chatStore";

const msg = (role: ChatMessage["role"], text: string, payload?: string): ChatMessage => ({
  id: `${role}-${text}`,
  role,
  text,
  ...(payload ? { payload } : {}),
});

describe("historyToParams (#55)", () => {
  it("rebuilds user turns from the sent payload — not the raw text", () => {
    // with only the raw text the model cannot tell what "it" referred to
    const params = historyToParams([
      msg("user", "make this blue", "[Selection] node n1\n\nmake this blue"),
    ]);

    expect(params[0]!.content).toBe("[Selection] node n1\n\nmake this blue");
  });

  it("falls back to the raw text without a payload (assistant turn)", () => {
    const params = historyToParams([msg("assistant", "Done.")]);

    expect(params[0]!.content).toBe("Done.");
  });

  it("keeps activity and error messages out of the history", () => {
    const params = historyToParams([
      msg("user", "hi", "[Selection] none\n\nhi"),
      msg("activity", "Editing…"),
      msg("error", "network failed"),
      msg("assistant", "ok"),
    ]);

    expect(params.map((p) => p.role)).toEqual(["user", "assistant"]);
  });

  it("uses the raw text for assistant even with a payload — narrowed by role", () => {
    const params = historyToParams([msg("assistant", "Done.", "[S] something")]);

    expect(params[0]!.content).toBe("Done.");
  });

  it("preserves order", () => {
    const params = historyToParams([
      msg("user", "one", "[S] one"),
      msg("assistant", "a"),
      msg("user", "two", "[S] two"),
    ]);

    expect(params.map((p) => p.content)).toEqual(["[S] one", "a", "[S] two"]);
  });
});
