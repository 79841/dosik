import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { bridgeSnapshot } from "../bridgeSnapshot";

describe("document served by the bridge (#229 D15)", () => {
  beforeEach(() => useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "a" })], []), null));

  it("matches the file — one canvas, no activePage", () => {
    expect(bridgeSnapshot()).toEqual(useDiagramStore.getState().toDoc());
    expect(bridgeSnapshot().version).toBe(1);
    expect("activePage" in bridgeSnapshot()).toBe(false);
    expect("pages" in bridgeSnapshot()).toBe(false);
  });
});
