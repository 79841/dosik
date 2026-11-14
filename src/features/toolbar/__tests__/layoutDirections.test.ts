import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadReversed, saveReversed } from "../layoutDirections";

describe("saving flip state (#206)", () => {
  beforeEach(() => localStorage.clear());

  it("starts with neither flipped", () => {
    expect(loadReversed()).toEqual({ vertical: false, horizontal: false });
  });

  it("reads what was saved", () => {
    saveReversed({ vertical: true, horizontal: false });
    expect(loadReversed()).toEqual({ vertical: true, horizontal: false });
  });

  it("falls back to the default for broken values or other shapes", () => {
    localStorage.setItem("dosik.layout.reversed", "{oops");
    expect(loadReversed()).toEqual({ vertical: false, horizontal: false });
    localStorage.setItem("dosik.layout.reversed", JSON.stringify({ vertical: "yes" }));
    expect(loadReversed()).toEqual({ vertical: false, horizontal: false });
  });

  it("does not throw when storage is blocked", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadReversed()).toEqual({ vertical: false, horizontal: false });
    expect(() => saveReversed({ vertical: true, horizontal: true })).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});
