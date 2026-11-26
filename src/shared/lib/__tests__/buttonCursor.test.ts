import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Pointing at a button shows the hand (#265). Tailwind 4's preflight leaves
 * buttons on the arrow, so the app's base layer gives every enabled button —
 * and every element that plays one — the pointer. A utility on the element
 * (`cursor-progress` while busy, `disabled:cursor-default`, `cursor-grab`)
 * still wins: it is in the utilities layer, after the base.
 */
const css = readFileSync(join(__dirname, "../../../App.css"), "utf8");

describe("buttons show the hand (#265)", () => {
  it("the base layer gives enabled buttons and role=button the pointer", () => {
    const base = css.match(/@layer base\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(base).toMatch(
      /button:not\(:disabled\),\s*\[role="button"\]:not\(\[aria-disabled="true"\]\)\s*\{\s*cursor:\s*pointer;\s*\}/,
    );
  });

  it("a drag that holds the cursor on <body> (a resize edge) keeps it over buttons too", () => {
    const base = css.match(/@layer base\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(base).toMatch(
      /body\[style\*="cursor"\] :is\(button, \[role="button"\]\)\s*\{\s*cursor:\s*inherit;\s*\}/,
    );
  });
});
