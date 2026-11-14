import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc, makeNode } from "../../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../../shared/lib/store";
import { useToastStore } from "../../../../shared/lib/toastStore";
import { drewMessage, pasteMermaid } from "../pasteMermaid";

const toasts = () => useToastStore.getState().toasts.map((t) => [t.kind, t.text]);

describe("pasteMermaid — draws and reports with a toast (#200 D6)", () => {
  beforeEach(() => {
    useToastStore.getState().dismissAll();
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "a" })], []), null);
  });

  it("Reports the number of shapes drawn and puts them on the current page", async () => {
    await pasteMermaid({ code: "flowchart LR\n  x --> y", blocks: 1 }, { x: 0, y: 0 });
    expect(useDiagramStore.getState().nodes).toHaveLength(3);
    expect(toasts()).toEqual([["info", "Drew 2 shapes from Mermaid"]]);
  });

  it("Ignores ⌘V pressed again while drawing — the first ⌘V takes long because it loads mermaid", async () => {
    const source = { code: "flowchart LR\n  x --> y", blocks: 1 };
    await Promise.all([pasteMermaid(source, { x: 0, y: 0 }), pasteMermaid(source, { x: 0, y: 0 })]);
    expect(useDiagramStore.getState().nodes).toHaveLength(3);
    // the ignored one says so
    expect(toasts().map(([, text]) => text)).toContain(
      "Still drawing the previous Mermaid diagram — paste again when it is done",
    );
    // once it is done, a paste draws again
    await pasteMermaid(source, { x: 0, y: 0 });
    expect(useDiagramStore.getState().nodes).toHaveLength(5);
  });

  it("An unsupported kind gives an error toast and leaves the page unchanged", async () => {
    await pasteMermaid({ code: 'pie\n  "a": 1', blocks: 1 }, { x: 0, y: 0 });
    expect(useDiagramStore.getState().nodes).toHaveLength(1);
    expect(toasts()).toEqual([
      ["error", "Can't draw pie from Mermaid — only flowchart, sequence, class and ER diagrams"],
    ]);
  });

  it("A syntax error also gives an error toast and leaves no undo entry", async () => {
    const past = useDiagramStore.getState().past.length;
    await pasteMermaid({ code: "flowchart LR\n  a -->", blocks: 1 }, { x: 0, y: 0 });
    expect(toasts()[0]?.[0]).toBe("error");
    expect(toasts()[0]?.[1]).toMatch(/^Mermaid code has an error: /);
    expect(useDiagramStore.getState().past).toHaveLength(past);
  });
});

describe("pasteMermaid — when the document changes while drawing", () => {
  beforeEach(() => {
    useToastStore.getState().dismissAll();
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "a" })], []), null);
  });

  it("Does not draw and reports it if another document was opened — the first ⌘V takes long because it loads mermaid", async () => {
    const pending = pasteMermaid({ code: "flowchart LR\n  x --> y", blocks: 1 }, { x: 0, y: 0 });
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "other" })], []), null);
    await pending;
    expect(useDiagramStore.getState().nodes.map((n) => n.id)).toEqual(["other"]);
    expect(toasts()).toEqual([
      ["error", "The diagram changed before the Mermaid diagram was drawn — paste again"],
    ]);
  });
});

describe("drewMessage", () => {
  it("Singular for one", () => {
    expect(drewMessage(1, [], 1)).toBe("Drew 1 shape from Mermaid");
  });

  it("With several blocks, says only the first was drawn, and lists what was left out if anything", () => {
    expect(drewMessage(4, ["notes", "autonumber"], 3)).toBe(
      "Drew 4 shapes from Mermaid — the first of 3 Mermaid blocks — not drawn: notes, autonumber",
    );
  });
});
