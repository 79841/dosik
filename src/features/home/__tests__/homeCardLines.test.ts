import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Home's cards are told apart by a 1px line, not a shadow (card C, #265): the
 * folder and diagram cards, the Recent cards, the START tiles and the Continue
 * card. The library board (`board/`) keeps its own look for now, and floating
 * panels (menus, the path card, toasts) are not cards — none of them is in
 * this folder's top level, where the cards live.
 *
 * Comments are stripped first, so a note about the old look is no offender.
 */
const HOME = join(__dirname, "..");

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const sources = readdirSync(HOME)
  .filter((name) => /\.tsx?$/.test(name))
  .map((name) => ({ name, code: stripComments(readFileSync(join(HOME, name), "utf8")) }));

describe("Home cards wear lines, not shadows (#265)", () => {
  it("reads the card files", () => {
    const names = sources.map((s) => s.name);
    for (const card of ["CardFrame.tsx", "RecentCard.tsx", "StartTiles.tsx", "ContinueCard.tsx"]) {
      expect(names).toContain(card);
    }
  });

  it.each(sources.map((s) => [s.name, s.code] as const))(
    "%s — no shadow-raised·shadow-lifted",
    (_, code) => {
      expect(code).not.toMatch(/shadow-(raised|lifted)/);
    },
  );

  it("arbitrary values read the tokens themselves — the --color-* names do not exist at run time (@theme inline reference)", () => {
    for (const { code } of sources) expect(code).not.toMatch(/var\(--color-/);
  });

  it("no card selection left — the selection store is gone", () => {
    const names = sources.map((s) => s.name);
    expect(names).not.toContain("homeSelection.ts");
    for (const { code } of sources) expect(code).not.toMatch(/useHomeSelection|ring-\[1\.5px\]/);
  });
});
