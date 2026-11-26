import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * The Windows build is dispatched by hand to test a branch on Windows. Its
 * smoke job installs what the build made on hosted Windows runners and walks
 * through the window frame (`scripts/windows-smoke.ps1`): what it must do is
 * pinned here, since nothing runs it before someone dispatches it.
 */
const TEXT = readFileSync(join(process.cwd(), ".github/workflows/windows-build.yml"), "utf8");
type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
};
type Job = {
  "runs-on": string;
  "timeout-minutes"?: number;
  needs?: string | string[];
  if?: string;
  strategy?: { "fail-fast"?: boolean; matrix?: { include?: Record<string, unknown>[] } };
  steps: Step[];
};
const WORKFLOW = parse(TEXT) as {
  on: { workflow_dispatch?: { inputs?: Record<string, { type?: string; default?: unknown }> } };
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
};
const build = WORKFLOW.jobs.build as Job;
const smoke = WORKFLOW.jobs.smoke as Job;
const SCRIPT_PATH = join(process.cwd(), "scripts/windows-smoke.ps1");

describe("Windows build: the smoke check of the installer", () => {
  it("is dispatched by hand, and the smoke run can be turned off", () => {
    expect(Object.keys(WORKFLOW.on)).toEqual(["workflow_dispatch"]);
    expect(WORKFLOW.on.workflow_dispatch?.inputs?.smoke).toMatchObject({
      type: "boolean",
      default: true,
    });
    expect(smoke.if).toMatch(/inputs\.smoke/);
    expect(smoke.if).toMatch(/github\.repository == '79841\/dosik'/);
  });

  it("only reads: it installs and looks, it changes nothing in the repository", () => {
    expect(WORKFLOW.permissions).toEqual({ contents: "read" });
  });

  it("runs on Windows 11 and Windows Server after the build, each to its end", () => {
    expect(smoke.needs).toBe("build");
    const include = smoke.strategy?.matrix?.include ?? [];
    expect(include.map((m) => m.os)).toEqual(["windows-11-arm", "windows-2025"]);
    // the server switches to 1920×1080: room for the first window in the middle
    expect(include[1]).toMatchObject({ width: 1920, height: 1080 });
    expect(smoke["timeout-minutes"]).toBeGreaterThan(0);
    expect(smoke.strategy?.["fail-fast"]).toBe(false);
    // the workflow's own expression, not a template string
    expect(smoke["runs-on"]).toMatch(/^\$\{\{ matrix\.os \}\}$/);
  });

  it("installs the installer this run built", () => {
    const upload = build.steps.find((s) => s.uses?.startsWith("actions/upload-artifact@"));
    const download = smoke.steps.find((s) => s.uses?.startsWith("actions/download-artifact@"));
    expect(download?.with?.name).toBe(upload?.with?.name);
    expect(download?.with?.["run-id"]).toBeUndefined();
  });

  it("runs the smoke script and keeps its log and screenshots even when a check fails", () => {
    const run = smoke.steps.map((s) => s.run ?? "").join("\n");
    expect(run).toMatch(/scripts\/windows-smoke\.ps1/);
    expect(run).toMatch(/-Installer/);
    expect(run).toMatch(/-Out/);
    const keep = smoke.steps.find((s) => s.uses?.startsWith("actions/upload-artifact@"));
    expect(keep?.if).toBe("always()");
    expect(keep?.with?.["retention-days"]).toBeLessThanOrEqual(7);
  });
});

describe("the smoke script", () => {
  const script = existsSync(SCRIPT_PATH) ? readFileSync(SCRIPT_PATH, "utf8") : "";

  it("is in the repository", () => {
    expect(script).not.toBe("");
  });

  it("is plain ASCII — the Korean label it draws is built from code points", () => {
    const outside = [...script].filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 0x7e || (code < 0x20 && ch !== "\t" && ch !== "\n" && ch !== "\r");
    });
    expect(outside).toEqual([]);
  });

  it("names no function after a built-in alias — PowerShell runs the alias instead", () => {
    // Windows PowerShell 5.1's default aliases a short function name could take
    const ALIASES = new Set(
      (
        "ac cat cd chdir clc clear cli clp cls clv compare copy cp cpi cpp curl cvpa del diff dir echo epal " +
        "erase fc fl foreach ft fw gal gc gci gcm gi gl gm gp gps group gsv gu gv h history icm iex ii " +
        "irm iwr kill ls man md measure mi mount move mp mv nal ni nv ogv oh popd ps pushd pwd r rd ren " +
        "ri rm rmdir rni rnp rp rv rvpa sajb sal saps sasv sc select set si sl sleep sls sort sp start " +
        "sv tee type wget where write"
      ).split(" "),
    );
    const names = [...script.matchAll(/^function ([A-Za-z-]+)/gm)].map((m) => m[1].toLowerCase());
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => ALIASES.has(name))).toEqual([]);
  });

  it("writes its checks to the job summary and fails the job when one fails", () => {
    expect(script).toMatch(/GITHUB_STEP_SUMMARY/);
    expect(script).toMatch(/exit 1/);
  });

  it("checks what a title bar does on Windows", () => {
    for (const name of [
      "first window placement",
      "Snap layouts spot over Maximize",
      "band right click opens one window menu",
      "Alt+Space opens one window menu",
      "F11 covers the screen",
      "F11 returns to the window",
      "Ctrl+W on Home quits",
    ]) {
      expect(script).toContain(name);
    }
  });

  it("measures the app icon and shows it beside other apps' wherever Windows draws it", () => {
    expect(script).toContain("app icon fills its square");
    for (const shot of [
      "00c-desktop-installed",
      "01-first",
      "08b-alt-tab",
      "11-start",
      "12-start-search",
    ]) {
      expect(script).toContain(`Shot "${shot}"`);
    }
  });
});
