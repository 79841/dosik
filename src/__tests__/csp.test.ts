import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { OPENAI_RESPONSES_URL } from "../features/ai/openaiProvider";

/**
 * The packaged app runs under the CSP in tauri.conf.json; `pnpm tauri dev` does
 * not (`devCsp: null`). A provider whose host is missing from `connect-src`
 * works in development and fails in every installed copy — so the list is
 * checked here rather than found out after a release.
 */
const security = (
  JSON.parse(readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")) as {
    app: { security: { csp: string; devCsp: unknown } };
  }
).app.security;

const connectSrc = (): string[] => {
  const directive = security.csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("connect-src "));
  return directive ? directive.split(/\s+/).slice(1) : [];
};

describe("the packaged app's CSP lets every AI provider reach its API", () => {
  it.each([
    ["OpenAI (API key)", new URL(OPENAI_RESPONSES_URL).origin],
    // @anthropic-ai/sdk's default base URL, used as is by apiProvider.ts
    ["Anthropic (API key)", "https://api.anthropic.com"],
  ])("%s → %s", (_provider, origin) => {
    expect(connectSrc()).toContain(origin);
  });

  it("keeps the bridge to the app's own commands", () => {
    expect(connectSrc()).toEqual(expect.arrayContaining(["ipc:", "http://ipc.localhost"]));
  });
});
