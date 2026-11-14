import { invoke } from "@tauri-apps/api/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { useAppStore } from "../../library/appStore";
import { blankDoc } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { resetTabsForTests } from "../../library/tabActions";
import { resetAutosaveForTests } from "../../library/useAutosave";
import { MermaidImportError } from "../../mermaid/import/plan";
import { diagramFromMermaid, startDiagram, useStartingStore } from "../newDiagram";
import { starterDoc } from "../starters";

vi.mock("../starters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../starters")>();
  return { ...actual, starterDoc: vi.fn(actual.starterDoc) };
});

const mockedInvoke = vi.mocked(invoke);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);
const saved = (i = 0) => calls("save_project")[i]![1] as { folder?: string; contents: string };

describe("new diagram from START (#220 D6·D7, T20)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    useStartingStore.setState({ starting: [] });
    useAppStore.setState({ newDiagramTarget: null });
    useLibraryStore.setState({
      folders: [
        { folders: [], id: "work", name: "Work", updatedAt: 2, diagrams: [] },
        { folders: [], id: "side", name: "Side", updatedAt: 1, diagrams: [] },
      ],
      readFailed: false,
    });
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
  });

  it("saves the template bytes to the target project, then opens it in a new tab", async () => {
    useAppStore.getState().setNewDiagramTarget("side");
    await startDiagram("flowchart");
    expect(saved().folder).toBe("side");
    expect(JSON.parse(saved().contents)).toEqual(starterDoc("flowchart"));
    expect(useAppStore.getState().view).toBe("editor");
    expect(useAppStore.getState().tabs).toHaveLength(1);
    expect(useDiagramStore.getState()).toMatchObject({ title: "Flowchart" });
    expect(useDiagramStore.getState().nodes).toHaveLength(4);
  });

  it("Blank — an empty diagram, in the project the caller chose", async () => {
    await startDiagram("blank", "work");
    expect(saved().folder).toBe("work");
    expect(JSON.parse(saved().contents)).toEqual(blankDoc());
    expect(useDiagramStore.getState().title).toBe("Untitled Diagram");
  });

  it("if saving fails, does not open, shows a toast and stays on Home", async () => {
    mockedInvoke.mockRejectedValue(new Error("disk full"));
    await startDiagram("sequence");
    expect(toasts()).toEqual(["Error: disk full"]);
    expect(useAppStore.getState()).toMatchObject({ view: "home", tabs: [] });
    expect(useStartingStore.getState().starting).toEqual([]);
  });

  it("a toast even if the starter template fails to build — Home without save·tab, the tile leaves busy (#220)", async () => {
    vi.mocked(starterDoc).mockImplementationOnce(() => {
      throw new Error("bad plan");
    });
    await expect(startDiagram("class")).resolves.toBeUndefined();
    expect(toasts()).toEqual(["Error: bad plan"]);
    expect(calls("save_project")).toHaveLength(0);
    expect(useAppStore.getState()).toMatchObject({ view: "home", tabs: [] });
    expect(useStartingStore.getState().starting).toEqual([]);
  });

  it("that kind is busy while creating — pressing again makes only one", async () => {
    let land: () => void = () => {};
    mockedInvoke.mockImplementation((cmd) =>
      cmd === "save_project"
        ? new Promise<undefined>((resolve) => (land = () => resolve(undefined)))
        : Promise.resolve(undefined),
    );
    const first = startDiagram("class");
    expect(useStartingStore.getState().starting).toEqual(["class"]);
    await startDiagram("class");
    expect(calls("save_project")).toHaveLength(1);
    land();
    await first;
    expect(useStartingStore.getState().starting).toEqual([]);
    expect(useAppStore.getState().tabs).toHaveLength(1);
  });
});

describe("document from Mermaid text (#220 D15, T21) — parsed with real mermaid", () => {
  beforeAll(() => {
    // jsdom has no CSS.supports; mermaid asks it about colours
    if (!window.CSS) Object.defineProperty(window, "CSS", { value: {}, configurable: true });
    Object.assign(window.CSS, { supports: () => true });
  });

  it.each([
    ["flowchart LR\n  A[Start] --> B{Ok?}\n  B -->|Yes| C[Done]", "Flowchart", 3],
    ["sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello", "Sequence diagram", 2],
    ["classDiagram\n  Animal <|-- Dog", "Class diagram", 2],
    ["erDiagram\n  CUSTOMER ||--o{ ORDER : places", "ER diagram", 2],
  ])("%s → document — title is the kind name", async (code, title, shapes) => {
    const { doc, message } = await diagramFromMermaid(code);
    expect(doc.title).toBe(title);
    expect(doc.nodes.filter((n) => n.data.shape !== "anchor")).toHaveLength(shapes);
    expect(message).toBe(`Drew ${shapes} shapes from Mermaid`);
  });

  it.each([
    [
      "not Mermaid",
      "Just a sentence about flowcharts.",
      "This doesn't look like Mermaid — it should start with flowchart, sequenceDiagram, classDiagram or erDiagram",
    ],
    [
      "unsupported kind",
      'pie\n  "a": 1',
      "Can't draw pie from Mermaid — only flowchart, sequence, class and ER diagrams",
    ],
    [
      "no shapes to draw",
      "sequenceDiagram\n  autonumber",
      "The Mermaid diagram has no shapes to draw",
    ],
  ])("%s → MermaidImportError with that message", async (_, code, text) => {
    const error = await diagramFromMermaid(code).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MermaidImportError);
    expect((error as Error).message).toBe(text);
  });

  it("syntax error → 'Mermaid code has an error: …'", async () => {
    const error = await diagramFromMermaid("flowchart LR\n  A --> (").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MermaidImportError);
    expect((error as Error).message).toMatch(/^Mermaid code has an error: /);
  });

  it("several blocks → the first block, and the toast message says so", async () => {
    const text = [
      "```mermaid",
      "flowchart LR\n  A --> B",
      "```",
      "and",
      "```mermaid",
      "classDiagram\n  A <|-- B",
      "```",
    ].join("\n");
    const { doc, message } = await diagramFromMermaid(text);
    expect(doc.title).toBe("Flowchart");
    expect(message).toBe("Drew 2 shapes from Mermaid — the first of 2 Mermaid blocks");
  });

  it("only builds the document, does not save it", async () => {
    mockedInvoke.mockClear();
    await diagramFromMermaid("flowchart LR\n  A --> B");
    expect(calls("save_project")).toHaveLength(0);
  });
});
