import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BUNDLE_ID,
  createExportFile,
  createFileMode,
  createHeadless,
  createOpenInApp,
  createRenderSvg,
  createRun,
  createViewBundle,
  HEADLESS_BUNDLE,
  isBundleFresh,
  once,
  REPO,
  VIEW_BUNDLE,
} from "../mcp/runtime.mjs";

/**
 * A child-process stand-in: nothing runs, but the spawn options are
 * observable. The casts are because these modules are plain `.mjs` — the
 * injected seams are typed from Node's real signatures, which a stub cannot
 * satisfy.
 */
const fakeChild = () => {
  const child = new EventEmitter() as EventEmitter & { unref: () => void };
  child.unref = vi.fn();
  return child;
};

type SpawnCall = [string, string[], Record<string, unknown>];
const spawnStub = (impl: () => unknown) => vi.fn(impl) as never;
const callsOf = (fn: unknown) => (fn as { mock: { calls: unknown[][] } }).mock.calls;
const spawnOptions = (fn: unknown, at = 0) => (callsOf(fn)[at] as unknown as SpawnCall)[2];

describe("MCP server runtime (#2)", () => {
  it("joins a job already in progress — never runs it twice", async () => {
    // the headless build writes to a single dist-cli/ directory. A second copy
    // is not slow, it is broken
    let calls = 0;
    let release = (_v?: unknown) => {};
    const guarded = once(() => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const first = guarded();
    const second = guarded();
    expect(calls).toBe(1);
    release("done");
    await expect(Promise.all([first, second])).resolves.toEqual(["done", "done"]);
    // once it finishes it can run again
    guarded();
    expect(calls).toBe(2);
  });

  it("keeps temp files apart for concurrent exports, and each removes only its own", async () => {
    const dirs: string[] = [];
    const removed: string[] = [];
    let n = 0;
    const exportFile = createExportFile({
      run: vi.fn(async () => "") as never,
      readDiagram: vi.fn(async () => ({ nodes: [], edges: [] })) as never,
      bundleFresh: () => true,
      makeTempDir: vi.fn(async () => {
        n += 1;
        const dir = `/tmp/dosik-mcp-${n}`;
        dirs.push(dir);
        return dir;
      }),
      write: vi.fn(async () => {}),
      remove: vi.fn(async (dir: unknown) => {
        removed.push(String(dir));
      }),
    });
    await Promise.all([exportFile(4517, "/tmp/a.mmd"), exportFile(4517, "/tmp/b.svg")]);
    expect(new Set(dirs).size).toBe(2);
    expect(removed.sort()).toEqual(dirs.sort());
  });

  it("runs the headless bundle with this node — does not look it up on PATH", async () => {
    const run = vi.fn(async () => "");
    await createExportFile({
      run: run as never,
      readDiagram: (async () => ({})) as never,
      bundleFresh: () => true,
      makeTempDir: async () => "/tmp/x",
      write: async () => {},
      remove: async () => {},
    })(4517, "/tmp/a.mmd");
    // GUI clients pass down a minimal PATH. A node installed with nvm is not on it
    expect(callsOf(run)[0]?.[0]).toBe(process.execPath);
  });

  it("bypasses the shell — a path with spaces or & must not be split or executed", async () => {
    const child = fakeChild();
    const spawn = spawnStub(() => child);
    const run = createRun({ spawn });
    const promise = run("node", ["/tmp/My Diagrams/a.mmd"]);
    child.emit("exit", 0);
    await promise;
    expect(spawnOptions(spawn).shell).toBeUndefined();
  });

  it("mentions PATH when the command is not found", async () => {
    const child = fakeChild();
    const run = createRun({ spawn: spawnStub(() => child) });
    const promise = run("pnpm", ["build:headless"]);
    const error = Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" });
    child.emit("error", error);
    await expect(promise).rejects.toThrow(/minimal PATH/);
  });

  it("rebuilds a bundle older than its sources — never runs an old bundle that lacks new options (#149)", async () => {
    const run = vi.fn(async () => "");
    const fresh = vi.fn(() => false);
    const headless = createHeadless({ run: run as never, bundleFresh: fresh });
    await headless(["--in", "/tmp/a.dosik.json", "--out", "/tmp/b.dosik.json"]);
    // pnpm is not on the MCP client's PATH — the build also runs vite directly with this node
    expect(callsOf(run)[0]?.[0]).toBe(process.execPath);
    expect(callsOf(run)[0]?.[1]).toEqual([
      join(REPO, "node_modules/vite/bin/vite.js"),
      "build",
      "--config",
      "vite.headless.config.ts",
    ]);
    expect(callsOf(run)[1]?.[0]).toBe(process.execPath);
    expect(callsOf(run)[1]?.[1]).toEqual([
      HEADLESS_BUNDLE,
      "--in",
      "/tmp/a.dosik.json",
      "--out",
      "/tmp/b.dosik.json",
    ]);
  });

  it("rebuilds a stale in-chat app bundle with this node and reads it — only once (#202)", async () => {
    const run = vi.fn(async () => "");
    const read = vi.fn(async () => "(function(){})();");
    const bundle = createViewBundle({ run: run as never, bundleFresh: () => false, read });
    const [a, b] = await Promise.all([bundle(), bundle()]);
    expect(a).toBe("(function(){})();");
    expect(b).toBe(a);
    expect(callsOf(run)).toHaveLength(1);
    expect(callsOf(run)[0]?.[0]).toBe(process.execPath);
    expect(callsOf(run)[0]?.[1]).toEqual([
      join(REPO, "node_modules/vite/bin/vite.js"),
      "build",
      "--config",
      "vite.mcp-view.config.ts",
    ]);
    expect(read).toHaveBeenCalledWith(VIEW_BUNDLE);
    // not placed in the folder the headless build empties
    expect(VIEW_BUNDLE.startsWith(join(REPO, "dist-cli"))).toBe(false);
  });

  it("skips the build when the bundle is fresh", async () => {
    const run = vi.fn(async () => "");
    const bundle = createViewBundle({
      run: run as never,
      bundleFresh: () => true,
      read: async () => "x",
    });
    await bundle();
    expect(run).not.toHaveBeenCalled();
  });

  it("judges bundle freshness by mtime", () => {
    expect(isBundleFresh({ bundleMtime: null, newestSourceMtime: 5 })).toBe(false);
    expect(isBundleFresh({ bundleMtime: 4, newestSourceMtime: 5 })).toBe(false);
    expect(isBundleFresh({ bundleMtime: 5, newestSourceMtime: 5 })).toBe(true);
  });

  describe("file mode (#149)", () => {
    const fs = (files: Record<string, string>) => ({
      exists: (p: string) => p in files,
      read: vi.fn(async (p: string) => {
        if (!(p in files)) throw new Error(`ENOENT ${p}`);
        return files[p] as string;
      }),
      write: vi.fn(async (p: string, data: string) => {
        files[p] = data;
      }),
      remove: vi.fn(async () => {}),
      makeTempDir: async () => "/tmp/scratch",
    });
    // plain .mjs seams typed from Node's own signatures — a stub cannot satisfy them
    const modeWith = (headless: unknown, files: Record<string, string>) =>
      createFileMode({ headless, ...fs(files) } as never);

    it("says so when asked to read a missing file", async () => {
      const mode = modeWith(vi.fn(), {});
      await expect(mode.read("/tmp/none.dosik.json")).rejects.toThrow(/No such file/);
    });

    it("reads through headless and returns the normalized document", async () => {
      const files: Record<string, string> = { "/tmp/a.dosik.json": "{}" };
      const headless = vi.fn(async (args: string[]) => {
        files[args[3] as string] = '{"nodes":[],"edges":[],"title":"T"}';
        return "";
      });
      const mode = modeWith(headless, files);
      await expect(mode.read("/tmp/a.dosik.json")).resolves.toEqual({
        nodes: [],
        edges: [],
        title: "T",
      });
      expect(callsOf(headless)[0]?.[0]).toEqual([
        "--in",
        "/tmp/a.dosik.json",
        "--out",
        "/tmp/scratch/out.dosik.json",
      ]);
    });

    it("creates a missing file on edit — without --in", async () => {
      const files: Record<string, string> = {};
      const headless = vi.fn(async () => {
        files["/tmp/scratch/report.json"] = '{"ok":true,"applied":1,"errors":[],"written":true}';
        return "";
      });
      const mode = modeWith(headless, files);
      await expect(mode.apply("/tmp/new.dosik.json", [{ op: "clear" }])).resolves.toMatchObject({
        ok: true,
      });
      const args = callsOf(headless)[0]?.[0] as string[];
      expect(args).not.toContain("--in");
      expect(args).toEqual(
        expect.arrayContaining(["--ops", "/tmp/scratch/ops.json", "--out", "/tmp/new.dosik.json"]),
      );
      expect(JSON.parse(files["/tmp/scratch/ops.json"] as string)).toEqual({
        ops: [{ op: "clear" }],
      });
    });

    it("reads an existing file and applies on top of it", async () => {
      const files: Record<string, string> = { "/tmp/a.dosik.json": "{}" };
      const headless = vi.fn(async () => {
        files["/tmp/scratch/report.json"] = '{"ok":true,"applied":1,"errors":[],"written":true}';
        return "";
      });
      const mode = modeWith(headless, files);
      await mode.apply("/tmp/a.dosik.json", [{ op: "clear" }]);
      expect(callsOf(headless)[0]?.[0]).toEqual(
        expect.arrayContaining(["--in", "/tmp/a.dosik.json", "--out", "/tmp/a.dosik.json"]),
      );
    });

    it("treats an apply failure (exit code 1) as a report, not an error — it must say what went wrong", async () => {
      const files: Record<string, string> = { "/tmp/a.dosik.json": "{}" };
      const headless = vi.fn(async () => {
        files["/tmp/scratch/report.json"] =
          '{"ok":false,"applied":0,"errors":["bad color"],"written":false}';
        throw new Error("! bad color");
      });
      const mode = modeWith(headless, files);
      await expect(mode.apply("/tmp/a.dosik.json", [{ op: "clear" }])).resolves.toEqual({
        ok: false,
        applied: 0,
        errors: ["bad color"],
        written: false,
      });
    });

    it("serializes concurrent edits to the same file — so neither reads stale content and one is lost", async () => {
      const files: Record<string, string> = { "/tmp/a.dosik.json": "{}" };
      const order: string[] = [];
      let release = () => {};
      const headless = vi.fn(async (args: string[]) => {
        const ops = args[args.indexOf("--ops") + 1] as string;
        order.push(`start ${files[ops]}`);
        if (order.length === 1) await new Promise<void>((r) => (release = r));
        order.push(`end ${files[ops]}`);
        files["/tmp/scratch/report.json"] = '{"ok":true,"applied":1,"errors":[],"written":true}';
        return "";
      });
      const mode = modeWith(headless, files);
      const first = mode.apply("/tmp/a.dosik.json", [{ op: "set_title", title: "1" }]);
      const second = mode.apply("/tmp/a.dosik.json", [{ op: "set_title", title: "2" }]);
      await vi.waitFor(() => expect(order).toHaveLength(1));
      release();
      await Promise.all([first, second]);
      expect(order.map((o) => o.split(" ")[0])).toEqual(["start", "end", "start", "end"]);
    });

    it("wraps a failure without a report in one English line around the original error — MCP speaks English", async () => {
      const headless = vi.fn(async () => {
        throw new Error("✗ cannot write");
      });
      const mode = modeWith(headless, {});
      await expect(mode.apply("/tmp/a.dosik.json", [{ op: "clear" }])).rejects.toThrow(
        /^Could not work on \/tmp\/a\.dosik\.json: ✗ cannot write/,
      );
    });

    it("exports hand over the file as is — no temp file needed", async () => {
      const headless = vi.fn(async () => "");
      const mode = modeWith(headless, { "/tmp/a.dosik.json": "{}" });
      await expect(mode.exportTo("/tmp/a.dosik.json", "/tmp/a.md")).resolves.toEqual({
        written: "/tmp/a.md",
      });
      expect(callsOf(headless)[0]?.[0]).toEqual([
        "--in",
        "/tmp/a.dosik.json",
        "--export",
        "/tmp/a.md",
      ]);
    });
  });

  describe("open_in_dosik (#149)", () => {
    it("takes the bundle id from tauri.conf.json — never copies it", () => {
      const conf = JSON.parse(readFileSync(join(REPO, "src-tauri/tauri.conf.json"), "utf8"));
      expect(BUNDLE_ID).toBe(conf.identifier);
    });

    it("on macOS hands the file to the installed app by bundle id — never launches the dev build", async () => {
      const run = vi.fn(async () => "");
      const open = createOpenInApp({ run: run as never, platform: "darwin", exists: () => true });
      await expect(open("/tmp/a.dosik.json")).resolves.toEqual({ opened: "/tmp/a.dosik.json" });
      expect(callsOf(run)[0]).toEqual(["open", ["-b", BUNDLE_ID, "/tmp/a.dosik.json"]]);
    });

    it("says so when the app is not installed", async () => {
      const run = vi.fn(async () => {
        throw new Error("Unable to find application with identifier app.dosik.desktop");
      });
      const open = createOpenInApp({ run: run as never, platform: "darwin", exists: () => true });
      await expect(open("/tmp/a.dosik.json")).rejects.toThrow(/not installed/);
    });

    it("does not hand over a missing file", async () => {
      const run = vi.fn(async () => "");
      const open = createOpenInApp({ run: run as never, platform: "darwin", exists: () => false });
      await expect(open("/tmp/a.dosik.json")).rejects.toThrow(/No such file/);
      expect(run).not.toHaveBeenCalled();
    });

    it("says it is not supported yet outside macOS", async () => {
      const run = vi.fn(async () => "");
      const open = createOpenInApp({ run: run as never, platform: "win32", exists: () => true });
      await expect(open("/tmp/a.dosik.json")).rejects.toThrow(/macOS only/);
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe("renderSvg (#148)", () => {
    const VIEW = {
      title: "Flow",
      shapes: 2,
      connectors: 1,
    };
    const setup = (files: Record<string, string>) => {
      const headless = vi.fn(async (args: string[]) => {
        const out = args[args.indexOf("--export") + 1] as string;
        files[out] = "<svg/>";
        const report = args[args.indexOf("--report") + 1] as string;
        files[report] = JSON.stringify({ ok: true, view: VIEW });
        return "";
      });
      const render = createRenderSvg({
        headless: headless as never,
        readDiagram: (async () => ({ nodes: [], edges: [] })) as never,
        exists: (p: string) => p in files,
        read: async (p: string) => files[p] as string,
        write: async (p: string, data: string) => {
          files[p] = data;
        },
        remove: async () => {},
        makeTempDir: async () => "/tmp/r",
      } as never);
      return { headless, render };
    };

    const createRenderSvgFor = (files: Record<string, string>) => {
      const headless = vi.fn(async (args: string[]) => {
        if (args.includes("--report")) {
          files[args[args.indexOf("--export") + 1] as string] = "<svg/>";
          files[args[args.indexOf("--report") + 1] as string] = JSON.stringify({ view: VIEW });
        }
        return "";
      });
      const render = createRenderSvg({
        headless: headless as never,
        readDiagram: (async () => ({ nodes: [], edges: [] })) as never,
        exists: (p: string) => p in files,
        read: async (p: string) => {
          if (!(p in files)) throw new Error(`ENOENT: ${p}`);
          return files[p] as string;
        },
        write: async () => {},
        remove: async () => {},
        makeTempDir: async () => "/tmp/r",
      } as never);
      return { headless, render };
    };

    it("renders the file as SVG fitted to the width", async () => {
      const { headless, render } = setup({ "/tmp/a.dosik.json": "{}" });
      await expect(render({ file: "/tmp/a.dosik.json", theme: "dark" })).resolves.toEqual({
        svg: "<svg/>",
        // headless reports what it drew itself — the in-chat app's summary (#202)
        view: VIEW,
      });
      expect(callsOf(headless)[0]?.[0]).toEqual([
        "--in",
        "/tmp/a.dosik.json",
        "--export",
        "/tmp/r/diagram.svg",
        "--report",
        "/tmp/r/report.json",
        "--theme",
        "dark",
        "--size",
        "fit",
        // images drawn into the chat have no background — they sit right on the chat (#202)
        "--background",
        "none",
      ]);
    });

    it("renders the app canvas through a temp file", async () => {
      const { headless, render } = setup({});
      await render({ port: 4517, theme: "light" });
      expect(callsOf(headless)[0]?.[0]).toEqual(
        expect.arrayContaining([
          "--in",
          "/tmp/r/diagram.dosik.json",
          "--export",
          "/tmp/r/diagram.svg",
        ]),
      );
    });

    it("says so for a missing file", async () => {
      const { render } = setup({});
      await expect(render({ file: "/tmp/none.dosik.json", theme: "light" })).rejects.toThrow(
        /No such file/,
      );
    });

    it("draws the same input in the other theme too when asked — the chat view's alternate (#251)", async () => {
      const files: Record<string, string> = {};
      const { headless, render } = setup(files);
      headless.mockImplementation(async (args: string[]) => {
        const out = args[args.indexOf("--export") + 1] as string;
        files[out] = `<svg>${args[args.indexOf("--theme") + 1]}</svg>`;
        if (args.includes("--report")) {
          files[args[args.indexOf("--report") + 1] as string] = JSON.stringify({ view: VIEW });
        }
        return "";
      });
      await expect(render({ port: 4517, theme: "light", alternate: "dark" })).resolves.toEqual({
        svg: "<svg>light</svg>",
        view: VIEW,
        alternate: { theme: "dark", svg: "<svg>dark</svg>" },
      });
      const [main, other] = callsOf(headless).map((call) => call[0] as string[]);
      // the open canvas is written once and both pictures are drawn from that copy
      expect(main?.[1]).toBe("/tmp/r/diagram.dosik.json");
      expect(other?.slice(0, 4)).toEqual([
        "--in",
        "/tmp/r/diagram.dosik.json",
        "--export",
        "/tmp/r/alternate.svg",
      ]);
      expect(other).toEqual(expect.arrayContaining(["--theme", "dark", "--background", "none"]));
      // the summary comes from one run
      expect(other).not.toContain("--report");
    });

    it("still returns the drawing when only the other theme's run fails — that picture is extra (#251)", async () => {
      const files: Record<string, string> = { "/tmp/a.dosik.json": "{}" };
      const { headless, render } = setup(files);
      headless.mockImplementation(async (args: string[]) => {
        if (!args.includes("--report")) throw new Error("spawn EAGAIN");
        files[args[args.indexOf("--export") + 1] as string] = "<svg/>";
        files[args[args.indexOf("--report") + 1] as string] = JSON.stringify({ view: VIEW });
        return "";
      });
      await expect(
        render({ file: "/tmp/a.dosik.json", theme: "light", alternate: "dark" }),
      ).resolves.toEqual({ svg: "<svg/>", view: VIEW });
    });

    it("still returns the drawing when the other theme's file can't be read — that picture is extra (#251)", async () => {
      const files: Record<string, string> = { "/tmp/a.dosik.json": "{}" };
      const { headless, render } = createRenderSvgFor(files);
      await expect(
        render({ file: "/tmp/a.dosik.json", theme: "light", alternate: "dark" }),
      ).resolves.toEqual({ svg: "<svg/>", view: VIEW });
      expect(callsOf(headless)).toHaveLength(2);
    });

    it("lets both runs end before the temp folder goes, and fails with the drawing's own error (#251)", async () => {
      const order: string[] = [];
      let finishOther: () => void = () => {};
      const render = createRenderSvg({
        headless: (async (args: string[]) => {
          if (args.includes("--report")) throw new Error("render failed");
          await new Promise<void>((resolve) => (finishOther = resolve));
          order.push("other done");
          return "";
        }) as never,
        readDiagram: (async () => ({ nodes: [], edges: [] })) as never,
        exists: () => true,
        read: async () => "",
        write: async () => {},
        remove: (async () => {
          order.push("removed");
        }) as never,
        makeTempDir: async () => "/tmp/r",
      } as never);
      const rendering = render({ file: "/tmp/a.dosik.json", theme: "light", alternate: "dark" });
      await new Promise((r) => setTimeout(r, 0));
      expect(order).toEqual([]);
      finishOther();
      await expect(rendering).rejects.toThrow("render failed");
      expect(order).toEqual(["other done", "removed"]);
    });
  });
});
