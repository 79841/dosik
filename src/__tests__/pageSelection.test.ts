import { describe, expect, it } from "vitest";

import { readRepo } from "../test/designTokens";

/**
 * No words on the page can be selected (fields keep their own, from the
 * webview's own styles). WebKit reads only the prefixed property, and the
 * build adds the prefix by itself while the dev server does not — so a drag
 * in a dev build would select the words it passes (a sidebar drag's preview).
 */
describe("the page selects no words", () => {
  it("in WebKit's dev build too — the body spells the prefix the build adds", () => {
    const body = readRepo("src", "App.css").match(/\nbody \{([^}]*)\}/)?.[1] ?? "";
    expect(body).toMatch(/\n\s*-webkit-user-select: none;/);
    expect(body).toMatch(/\n\s*user-select: none;/);
  });
});
