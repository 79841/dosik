import { ask } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { takeDocument } from "../../../shared/lib/store/tabs";
import {
  askDiscard,
  externalBaseline,
  fileNameOf,
  hasUnsavedExternalChanges,
  isUnsavedSnapshot,
  markExternalSaved,
  resetUnsavedGuardForTests,
  setExternalBaseline,
} from "../unsavedGuard";

const mockedAsk = vi.mocked(ask);
const doc = makeDoc([], []);
const edit = () => useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });

describe("unsaved external-file guard (#123)", () => {
  beforeEach(() => {
    resetUnsavedGuardForTests();
    useDiagramStore.getState().loadDoc(doc, null);
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
  });

  it("no changes right after opening an external file — editing creates them, undoing back removes them again", () => {
    useDiagramStore.getState().loadDoc(doc, "/tmp/a.dosik.json");
    expect(hasUnsavedExternalChanges()).toBe(false);
    edit();
    expect(hasUnsavedExternalChanges()).toBe(true);
    useDiagramStore.getState().undo();
    expect(hasUnsavedExternalChanges()).toBe(false);
  });

  it("a document swapped in by bridge set_diagram is a change relative to the file — the baseline is not overwritten", () => {
    useDiagramStore.getState().loadDoc(doc, "/tmp/a.dosik.json");
    const r = useDiagramStore
      .getState()
      .applyOps([{ op: "set_diagram", doc: { ...doc, title: "From agent" } }]);
    expect(r.errors).toEqual([]);
    expect(hasUnsavedExternalChanges()).toBe(true);
  });

  it("reopening the same path (filePath unchanged) sets the baseline with an explicit call", () => {
    useDiagramStore.getState().loadDoc(doc, "/tmp/a.dosik.json");
    edit();
    useDiagramStore.getState().loadDoc({ ...doc, title: "Reloaded" }, "/tmp/a.dosik.json");
    expect(hasUnsavedExternalChanges()).toBe(true);
    markExternalSaved();
    expect(hasUnsavedExternalChanges()).toBe(false);
  });

  it("no changes after markExternalSaved; when the written bytes are passed, later edits are changes", () => {
    useDiagramStore.getState().loadDoc(doc, "/tmp/a.dosik.json");
    edit();
    markExternalSaved();
    expect(hasUnsavedExternalChanges()).toBe(false);
    const written = JSON.stringify(useDiagramStore.getState().toDoc(), null, 2);
    edit();
    markExternalSaved(written);
    expect(hasUnsavedExternalChanges()).toBe(true);
  });

  it("a selection-only change is not a change", () => {
    useDiagramStore.getState().loadDoc(doc, "/tmp/a.dosik.json");
    const id = edit();
    markExternalSaved();
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, selected: true } : n)),
    }));
    expect(hasUnsavedExternalChanges()).toBe(false);
  });

  it("library projects and fileless documents do not apply even when edited", () => {
    useDiagramStore.getState().openProject("p1", doc);
    edit();
    expect(hasUnsavedExternalChanges()).toBe(false);
    useDiagramStore.getState().loadDoc(doc, null);
    edit();
    expect(hasUnsavedExternalChanges()).toBe(false);
  });
});

describe("per-tab baselines (#218 D8)", () => {
  beforeEach(() => {
    resetUnsavedGuardForTests();
    useDiagramStore.getState().loadDoc(doc, null);
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
  });

  it("takes out and restores the baseline — fixing a baseline overwritten by opening another file (T16)", () => {
    useDiagramStore.getState().loadDoc(doc, "/tmp/a.dosik.json");
    edit();
    const a = takeDocument(useDiagramStore.getState());
    const aBaseline = externalBaseline();
    // B opens: the filePath subscription moves the baseline to B
    useDiagramStore.getState().loadDoc(makeDoc([], [], "B"), "/tmp/b.dosik.json");
    expect(externalBaseline()).not.toBe(aBaseline);
    expect(hasUnsavedExternalChanges()).toBe(false);
    // back to A, as a tab switch does: the snapshot in, then its baseline
    useDiagramStore.setState(a);
    setExternalBaseline(aBaseline);
    expect(hasUnsavedExternalChanges()).toBe(true);
  });

  it("an inactive external tab is dirty when its snapshot differs from its baseline (T16)", () => {
    useDiagramStore.getState().loadDoc(doc, "/tmp/a.dosik.json");
    const clean = takeDocument(useDiagramStore.getState());
    const baseline = externalBaseline();
    expect(isUnsavedSnapshot(clean, baseline)).toBe(false);
    edit();
    expect(isUnsavedSnapshot(takeDocument(useDiagramStore.getState()), baseline)).toBe(true);
    // a library diagram, or a document that lives nowhere, never is
    useDiagramStore.getState().openProject("p1", doc);
    edit();
    expect(isUnsavedSnapshot(takeDocument(useDiagramStore.getState()), null)).toBe(false);
    useDiagramStore.getState().loadDoc(doc, null);
    edit();
    expect(isUnsavedSnapshot(takeDocument(useDiagramStore.getState()), null)).toBe(false);
  });

  it("askDiscard: no prompt when none, the existing wording for one, a single combined wording for several (T17)", async () => {
    expect(await askDiscard([])).toBe(true);
    expect(mockedAsk).not.toHaveBeenCalled();

    expect(await askDiscard(["orders.dosik.json"])).toBe(false);
    expect(mockedAsk).toHaveBeenLastCalledWith(
      "“orders.dosik.json” has unsaved changes. Discard them?",
      expect.objectContaining({
        title: "Unsaved changes",
        okLabel: "Discard",
        cancelLabel: "Cancel",
      }),
    );

    mockedAsk.mockResolvedValue(true);
    expect(await askDiscard(["a.dosik.json", "Flow"])).toBe(true);
    expect(mockedAsk).toHaveBeenCalledTimes(2);
    expect(mockedAsk).toHaveBeenLastCalledWith(
      "2 files have unsaved changes — “a.dosik.json”, “Flow”. Discard them?",
      expect.objectContaining({ okLabel: "Discard", cancelLabel: "Cancel" }),
    );
    // a file is asked about by its name, either separator
    expect(fileNameOf("/tmp/a.dosik.json")).toBe("a.dosik.json");
    expect(fileNameOf("C:\\work\\b.dosik.json")).toBe("b.dosik.json");
  });
});
