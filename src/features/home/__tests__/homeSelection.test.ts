import { beforeEach, describe, expect, it } from "vitest";

import { type FolderMeta, itemKey } from "../../library/libraryApi";
import { selectedIn, useHomeSelection } from "../homeSelection";

const payments = (): FolderMeta => ({
  id: "pay",
  name: "Payments",
  updatedAt: 3,
  diagrams: [{ id: "led", title: "Ledger schema", updatedAt: 2, readable: true }],
  folders: [{ id: "chk", name: "Checkout", updatedAt: 3, diagrams: [], folders: [] }],
});

/** one card selected at a time, apart from the view and the tree (#231 D7, T17) */
describe("card selection (#231 D7, T17)", () => {
  beforeEach(() => useHomeSelection.getState().clear());

  it("select · clear — folder and item key", () => {
    useHomeSelection.getState().select("pay", itemKey("diagram", "led"));
    expect(useHomeSelection.getState()).toMatchObject({ folder: "pay", key: "diagram:led" });
    useHomeSelection.getState().select("pay", itemKey("folder", "chk"));
    expect(useHomeSelection.getState()).toMatchObject({ folder: "pay", key: "folder:chk" });
    useHomeSelection.getState().clear();
    expect(useHomeSelection.getState()).toMatchObject({ folder: null, key: null });
  });

  it("selectedIn — that key when the selection is in that folder and still in it", () => {
    useHomeSelection.getState().select("pay", itemKey("folder", "chk"));
    expect(selectedIn(useHomeSelection.getState(), payments())).toBe("folder:chk");
  });

  it("selectedIn — nothing when the selection belongs to another folder", () => {
    useHomeSelection.getState().select("chk", itemKey("diagram", "led"));
    expect(selectedIn(useHomeSelection.getState(), payments())).toBeNull();
  });

  it("selectedIn — nothing when the selected item left the list (deleted · moved)", () => {
    useHomeSelection.getState().select("pay", itemKey("diagram", "gone"));
    expect(selectedIn(useHomeSelection.getState(), payments())).toBeNull();
    useHomeSelection.getState().select("pay", itemKey("diagram", "led"));
    expect(selectedIn(useHomeSelection.getState(), { ...payments(), diagrams: [] })).toBeNull();
  });

  it("nothing when nothing is chosen", () => {
    expect(selectedIn(useHomeSelection.getState(), payments())).toBeNull();
  });
});
