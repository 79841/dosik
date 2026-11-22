import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * The release workflow runs only on a v* tag, so nothing tries it before a
 * release: what it must do is pinned here.
 */
const TEXT = readFileSync(join(process.cwd(), ".github/workflows/release.yml"), "utf8");
type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };
type Job = {
  "runs-on": string;
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  steps: Step[];
};
const WORKFLOW = parse(TEXT) as { jobs: Record<string, Job> };
const windows = WORKFLOW.jobs["bundle-windows"] as Job;
const runs = () => windows.steps.map((s) => s.run ?? "").join("\n");

describe("release: the Windows x64 installer", () => {
  it("is built on a Windows runner into the same draft, in this repository only", () => {
    expect(windows["runs-on"]).toBe("windows-latest");
    expect(windows.needs).toBe("create-release");
    expect(windows.if).toBe("github.repository == '79841/dosik'");
  });

  it("uses no cache — nothing another workflow wrote ends up in the installer", () => {
    for (const step of windows.steps) {
      expect(step.uses ?? "").not.toMatch(/cache/);
      expect(step.with?.cache).toBeUndefined();
    }
  });

  it("builds the NSIS installer — x64, unsigned", () => {
    expect(runs()).toMatch(/pnpm tauri build --bundles nsis/);
  });

  it("checks it before anything goes up: one installer, named for the version, no developer's home folder in the program", () => {
    const check = runs();
    expect(check).toMatch(/Dosik_\$\{version\}_x64-setup\.exe/);
    expect(check).toMatch(/expected one installer/);
    expect(check).toMatch(/\[Uu\]sers/);
    expect(check).toMatch(/USERNAME/);
  });

  it("attests the installer's provenance and uploads it, replacing an earlier run's", () => {
    const attest = windows.steps.find((s) => s.uses?.startsWith("actions/attest@"));
    expect(String(attest?.with?.["subject-path"])).toMatch(/bundle\/nsis\/\*-setup\.exe/);
    expect(windows.permissions).toMatchObject({ "id-token": "write", attestations: "write" });
    expect(runs()).toMatch(/-X DELETE/);
    expect(runs()).toMatch(/uploads\.github\.com/);
  });

  it("the header no longer says the release is macOS only", () => {
    expect(TEXT.split("\n").slice(0, 10).join("\n")).not.toMatch(/macOS only/);
  });
});
