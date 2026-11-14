import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { useAppStore } from "../appStore";
import { DASHBOARD } from "../homeView";
import { screenStamp, stillOnScreen } from "../screenStamp";
import { openDocument, resetTabsForTests, showHomeTab } from "../tabActions";

/** a slow action ends where it may still act only on the screen it was asked from (#218 D15, #229) */
describe("screenStamp · stillOnScreen", () => {
  beforeEach(() => resetTabsForTests());
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("true on the same screen — false for another tab or another Home view (even with focus on body)", () => {
    showHomeTab({ kind: "folder", folder: "a" });
    const asked = screenStamp();
    expect(stillOnScreen(asked)).toBe(true);
    act(() => showHomeTab({ kind: "folder", folder: "b" }));
    expect(stillOnScreen(asked)).toBe(false);
    act(() => showHomeTab({ kind: "folder", folder: "a" }));
    act(() => {
      openDocument(makeDoc([], [], "Other"), { projectId: "other" });
    });
    expect(document.activeElement).toBe(document.body);
    expect(stillOnScreen(asked)).toBe(false);
  });

  it("homeView: compares against the view the action moved to itself; with null, the Home view is not compared", () => {
    showHomeTab({ kind: "folder", folder: "gone" });
    const asked = screenStamp();
    useAppStore.getState().setHomeView(DASHBOARD);
    expect(stillOnScreen(asked)).toBe(false);
    expect(stillOnScreen(asked, { homeView: DASHBOARD })).toBe(true);
    expect(stillOnScreen(asked, { homeView: null })).toBe(true);
  });

  it("where: only when focus is on body or inside it", () => {
    const asked = screenStamp();
    const box = document.createElement("div");
    const other = document.createElement("input");
    document.body.append(box, other);
    expect(stillOnScreen(asked, { where: [box] })).toBe(true);
    other.focus();
    expect(stillOnScreen(asked, { where: [box] })).toBe(false);
    expect(stillOnScreen(asked)).toBe(true);
  });
});
