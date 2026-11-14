import { afterEach, describe, expect, it, vi } from "vitest";

import { BADGE_COLOURS, badgeColour, badgeLetter } from "../projectBadge";

describe("badgeColour — a project's colour comes from its id (#236 T1)", () => {
  it("names the six badge colours in order", () => {
    expect(BADGE_COLOURS).toEqual(["blue", "teal", "orange", "pink", "green", "violet"]);
  });

  it("gives the same id the same colour every time", () => {
    expect(badgeColour("payments-k2")).toBe(badgeColour("payments-k2"));
  });

  it("always answers one of the six, even for an empty id", () => {
    for (const id of ["", "a", "Ab3_x9", "결제", "🧾", "x".repeat(200)]) {
      expect(BADGE_COLOURS).toContain(badgeColour(id));
    }
  });

  it("is FNV-1a: a change of hash would recolour every library, so the values are pinned", () => {
    expect(badgeColour("")).toBe("teal");
    expect(badgeColour("a")).toBe("green");
    expect(badgeColour("checkout-service")).toBe("pink");
    expect(badgeColour("onboarding")).toBe("blue");
    expect(badgeColour("platform")).toBe("orange");
  });

  it("spreads ids over all six colours", () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => badgeColour(`project-${i}`)));
    expect(seen.size).toBe(6);
  });
});

describe("badgeLetter — the name's first character as it is seen, upper case (#236 T2)", () => {
  it.each([
    ["payments", "P"],
    ["  onboarding", "O"],
    ["Checkout Service", "C"],
    ["결제", "결"],
    ["éclair", "É"],
    ["🧾 Receipts", "🧾"],
    // one character on screen, several code points: a flag, a ZWJ sequence, a keycap, a variation
    ["🇰🇷 Seoul", "🇰🇷"],
    ["👩‍💻 Dev", "👩‍💻"],
    ["1️⃣ Q1", "1️⃣"],
    ["❤️ Love", "❤️"],
    // an accent typed as a combining mark stays on its letter
    ["e\u0301clair", "E\u0301"],
    ["", ""],
    ["   ", ""],
  ])("%j → %j", (name, letter) => {
    expect(badgeLetter(name)).toBe(letter);
  });
});

describe("badgeLetter without Intl.Segmenter (WebKit before macOS 11.3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("loads and falls back to the first code point — the app still starts", async () => {
    // Intl as it is, less Segmenter (its members are not enumerable: no spread)
    const withoutSegmenter = new Proxy(Intl, {
      has: (target, key) => key !== "Segmenter" && key in target,
      get: (target, key) => (key === "Segmenter" ? undefined : Reflect.get(target, key)),
    });
    vi.stubGlobal("Intl", withoutSegmenter);
    vi.resetModules();
    const fresh = await import("../projectBadge");
    expect(fresh.badgeLetter("payments")).toBe("P");
    expect(fresh.badgeLetter("결제")).toBe("결");
    expect(fresh.badgeLetter("")).toBe("");
  });
});
