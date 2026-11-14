import { afterEach, describe, expect, it } from "vitest";

import { focusStillWith } from "../focusGuard";

/** a slow action places the focus only where it still may (#218 D15, #229) */
describe("focusStillWith", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("is true when focus is nowhere (body) or inside where it started, false elsewhere", () => {
    const home = document.createElement("div");
    const inside = document.createElement("button");
    home.append(inside);
    const other = document.createElement("input");
    document.body.append(home, other);
    expect(focusStillWith(home)).toBe(true);
    inside.focus();
    expect(focusStillWith(home)).toBe(true);
    other.focus();
    expect(focusStillWith(home)).toBe(false);
    expect(focusStillWith(null, other)).toBe(true);
    expect(focusStillWith()).toBe(false);
  });
});
