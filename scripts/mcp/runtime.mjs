import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { MCP_PATHS } from "./paths.mjs";
import { ToolError } from "./tools.mjs";

/**
 * The side of the MCP server that starts processes and writes files (#2).
 *
 * Split out of `server.mjs` and given injected dependencies because this is
 * where the risk lives — re-entry, scratch files, argument quoting. It never
 * starts the app: that window is the user's (`requireBridge` in `tools.mjs`).
 * `tools.mjs` is the decisions; this is the effects, and both are testable
 * (#2).
 */
// the repository — or, packaged with the app, the server's own folder (#252, paths.mjs)
export const REPO = MCP_PATHS.root;
export const HEADLESS_BUNDLE = MCP_PATHS.headlessBundle;
const VITE_BIN = join(REPO, "node_modules/vite/bin/vite.js");

/**
 * The app's bundle identifier, read from the Tauri config rather than copied:
 * a rename there would otherwise leave `open_in_dosik` asking macOS for an app
 * that no longer exists under that name (#149).
 */
export const BUNDLE_ID = MCP_PATHS.bundleId;

/**
 * A bundle older than the source it was built from is not a cache, it is a
 * different program: an old one refuses `--report` and the file mode breaks
 * with a message about an unknown option (#149). `dist-cli/` is gitignored, so
 * a pull never refreshes it.
 */
export const isBundleFresh = ({ bundleMtime, newestSourceMtime }) =>
  bundleMtime !== null && bundleMtime >= newestSourceMtime;

const newestMtime = (dir) => {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(path));
    else if (/\.tsx?$/.test(entry.name)) newest = Math.max(newest, statSync(path).mtimeMs);
  }
  return newest;
};

/** whether `bundle` is newer than `src/` and the config that built it */
/**
 * Packaged with the app (#252): the bundle shipped beside the server. There
 * are no sources to build it from — present, or the install is broken.
 */
export const shippedBundle =
  (bundle, exists = existsSync) =>
  () => {
    if (!exists(bundle)) {
      throw new ToolError(
        `Dosik's MCP server is missing ${basename(bundle)}. Install it again from Dosik's Settings ▸ Integrations.`,
      );
    }
    return true;
  };

const freshness = (bundle, config) =>
  MCP_PATHS.packaged ? shippedBundle(bundle) : sourceFreshness(bundle, config);

const sourceFreshness = (bundle, config) => () =>
  isBundleFresh({
    bundleMtime: existsSync(bundle) ? statSync(bundle).mtimeMs : null,
    // the build config shapes the bundle as much as the sources do (#151)
    newestSourceMtime: Math.max(
      newestMtime(join(REPO, "src")),
      statSync(join(REPO, config)).mtimeMs,
    ),
  });

const HEADLESS_CONFIG = "vite.headless.config.ts";
const bundleIsFresh = freshness(HEADLESS_BUNDLE, HEADLESS_CONFIG);

/** the chat view's script (#202), inlined into the `ui://` resource */
export const VIEW_BUNDLE = MCP_PATHS.viewBundle;
const VIEW_CONFIG = "vite.mcp-view.config.ts";

/**
 * Runs work once, no matter how many callers ask while it is in flight.
 *
 * The headless build writes to one shared directory (`dist-cli/`), so a
 * second copy is not slow but broken.
 */
export const once = (task) => {
  let running = null;
  return (...args) => {
    if (!running) running = task(...args).finally(() => (running = null));
    return running;
  };
};

export const createRun =
  ({ spawn = nodeSpawn } = {}) =>
  (command, args, options = {}) =>
    new Promise((resolve, reject) => {
      // no `shell`: Node does not quote arguments for it, so a path with a
      // space would split and one with `&` would run on Windows (#2)
      const child = spawn(command, args, {
        cwd: REPO,
        stdio: ["ignore", "pipe", "pipe"],
        ...options,
      });
      let out = "";
      let err = "";
      // decode as text rather than concatenating Buffers, which cuts
      // multi-byte characters at chunk boundaries
      child.stdout?.setEncoding?.("utf8");
      child.stderr?.setEncoding?.("utf8");
      child.stdout?.on("data", (chunk) => (out += chunk));
      child.stderr?.on("data", (chunk) => (err += chunk));
      child.on("error", (error) =>
        reject(
          error.code === "ENOENT"
            ? new ToolError(
                `\`${command}\` is not on this server's PATH. An MCP client started it, and GUI clients pass a minimal PATH — run it from a terminal, or give the client the full path.`,
              )
            : error,
        ),
      );
      child.on("exit", (code) =>
        code === 0
          ? resolve(out)
          : reject(new ToolError(err.trim() || out.trim() || `${command} exited with ${code}`)),
      );
    });

/**
 * Runs the headless CLI (#64), building its bundle first when it is missing or
 * stale. Both the live export and the file mode go through here.
 */
export const createHeadless = ({
  run = createRun(),
  bundleFresh = bundleIsFresh,
  note = () => {},
} = {}) => {
  // one build even if two calls arrive together — they share `dist-cli/`
  const build = once(async () => {
    note("building the headless bundle");
    // vite through this very node, not `pnpm build:headless`: an MCP client
    // hands its server a minimal PATH with no pnpm on it, and a stale bundle is
    // the normal state after any source edit — so the file mode died on every
    // first call after a change (#149, measured). It also needs no shell on
    // Windows, where pnpm is a .cmd shim. Under a second either way.
    await run(process.execPath, [VITE_BIN, "build", "--config", HEADLESS_CONFIG]);
  });
  return async (args) => {
    if (!bundleFresh()) await build();
    return run(process.execPath, [HEADLESS_BUNDLE, ...args]);
  };
};

/**
 * The chat view's bundle (#202), built the way the headless one is — through
 * this node, when missing or older than its sources — and read as text.
 */
export const createViewBundle = ({
  run = createRun(),
  bundleFresh = freshness(VIEW_BUNDLE, VIEW_CONFIG),
  read = (path) => readFile(path, "utf8"),
  note = () => {},
} = {}) => {
  const build = once(async () => {
    note("building the chat view");
    await run(process.execPath, [VITE_BIN, "build", "--config", VIEW_CONFIG]);
  });
  return async () => {
    if (!bundleFresh()) await build();
    return read(VIEW_BUNDLE);
  };
};

export const createExportFile = ({
  run = createRun(),
  /**
   * How the live document is fetched. The caller owns it — this default only
   * exists so the shape is part of the signature.
   * @type {(port: number) => Promise<unknown>}
   */
  readDiagram = async () => {
    throw new ToolError("export needs a way to read the open diagram");
  },
  bundleFresh = bundleIsFresh,
  headless = createHeadless({ run, bundleFresh }),
  makeTempDir = () => mkdtemp(join(tmpdir(), "dosik-mcp-")),
  write = writeFile,
  remove = rm,
} = {}) => {
  return async (port, path, { theme } = {}) => {
    // the CLI reads a document from disk and the document worth exporting is
    // the one on screen, so the live canvas goes through a scratch file. Its
    // own directory: a name two concurrent exports could share would have one
    // deleting the other's file mid-read (#2)
    const doc = await readDiagram(port);
    const dir = await makeTempDir();
    try {
      const scratch = join(dir, "diagram.dosik.json");
      await write(scratch, JSON.stringify(doc));
      await headless(["--in", scratch, "--export", path, ...(theme ? ["--theme", theme] : [])]);
      return { written: path };
    } finally {
      await remove(dir, { recursive: true, force: true });
    }
  };
};

/**
 * The file mode (#149): the same three moves as the live canvas, on a
 * `.dosik.json` and with no app, through the headless CLI — the data layer the
 * app itself uses, so a file edited here is the file the app would write.
 */
export const createFileMode = ({
  headless = createHeadless(),
  exists = existsSync,
  read = (path) => readFile(path, "utf8"),
  write = writeFile,
  remove = rm,
  makeTempDir = () => mkdtemp(join(tmpdir(), "dosik-mcp-")),
} = {}) => {
  const requireExisting = (file) => {
    if (!exists(file)) throw new ToolError(`No such file: ${file}`);
  };
  // the CLI speaks Korean to people at a terminal (#64); what reaches an agent
  // leads with an English line, like every other message here (#151)
  const wrapped = (file, task) =>
    task().catch((error) => {
      throw new ToolError(`Could not work on ${file}: ${error?.message ?? error}`);
    });
  // Two edits to one file at once would both read the old contents and the
  // second write would drop the first — an agent is free to call tools in
  // parallel. Edits to the same path queue; different paths do not wait.
  const queues = new Map();
  const serialized = (file, task) => {
    const run = (queues.get(file) ?? Promise.resolve()).then(task, task);
    const tail = run.catch(() => {});
    queues.set(file, tail);
    void tail.then(() => {
      if (queues.get(file) === tail) queues.delete(file);
    });
    return run;
  };
  const inScratch = async (task) => {
    const dir = await makeTempDir();
    try {
      return await task(dir);
    } finally {
      await remove(dir, { recursive: true, force: true });
    }
  };

  return {
    // through the CLI rather than a bare JSON.parse: what comes back is the
    // document after the loader's normalisation, the same shape `get_diagram`
    // returns for the live canvas
    read: async (file) => {
      requireExisting(file);
      return wrapped(file, () =>
        inScratch(async (dir) => {
          const out = join(dir, "out.dosik.json");
          await headless(["--in", file, "--out", out]);
          return JSON.parse(await read(out));
        }),
      );
    },

    apply: (file, ops) =>
      serialized(file, () =>
        inScratch(async (dir) => {
          const opsPath = join(dir, "ops.json");
          const reportPath = join(dir, "report.json");
          await write(opsPath, JSON.stringify({ ops }));
          const args = [
            // a file that does not exist yet starts empty — this is how a
            // diagram gets made without the app
            ...(exists(file) ? ["--in", file] : []),
            "--ops",
            opsPath,
            "--out",
            file,
            "--report",
            reportPath,
          ];
          try {
            await headless(args);
          } catch (error) {
            // a batch that did not fully apply exits 1 and writes nothing; its
            // report says why, and that is what the agent needs to hear
            let report;
            try {
              report = JSON.parse(await read(reportPath));
            } catch {
              throw new ToolError(`Could not work on ${file}: ${error?.message ?? error}`);
            }
            return report;
          }
          return JSON.parse(await read(reportPath));
        }),
      ),

    exportTo: async (file, path, { theme } = {}) => {
      requireExisting(file);
      // the failure worth naming is usually the output — a missing folder, a
      // locked file — so the message leads with where it was going (#151)
      await headless(["--in", file, "--export", path, ...(theme ? ["--theme", theme] : [])]).catch(
        (error) => {
          throw new ToolError(`Could not export ${file} to ${path}: ${error?.message ?? error}`);
        },
      );
      return { written: path };
    },
  };
};

/**
 * Draws a diagram as vector SVG through the headless CLI (#148) — the open
 * canvas (via a scratch copy, like the live export) or a `.dosik.json`. Sized
 * to fit its container, because the reader is a chat, not a file browser.
 *
 * Returns the SVG with the run's own account of what it drew (`view`: title
 * and counts — #202). With `alternate`, the same input is also drawn in that
 * theme (`alternate: { theme, svg }`) — the chat view switches themes without
 * calling back, which some hosts never pass on (#251).
 */
export const createRenderSvg = ({
  headless = createHeadless(),
  readDiagram = async () => {
    throw new ToolError("render needs a way to read the open diagram");
  },
  exists = existsSync,
  read = (path) => readFile(path, "utf8"),
  write = writeFile,
  remove = rm,
  makeTempDir = () => mkdtemp(join(tmpdir(), "dosik-mcp-")),
} = {}) => {
  /** @param {{ port?: number; file?: string; theme: string; alternate?: string }} request */
  return async ({ port, file, theme, alternate }) => {
    if (file !== undefined && !exists(file)) throw new ToolError(`No such file: ${file}`);
    const dir = await makeTempDir();
    try {
      let input = file;
      if (input === undefined) {
        input = join(dir, "diagram.dosik.json");
        await write(input, JSON.stringify(await readDiagram(port)));
      }
      const out = join(dir, "diagram.svg");
      const report = join(dir, "report.json");
      const alternateOut = join(dir, "alternate.svg");
      const draw = (/** @type {string} */ to, /** @type {string} */ inTheme, extra = []) =>
        headless([
          "--in",
          input,
          "--export",
          to,
          ...extra,
          "--theme",
          inTheme,
          "--size",
          "fit",
          // a chat draws it on its own background, light or dark (#202)
          "--background",
          "none",
        ]);
      // one input for both, so the two pictures are of the same diagram. Both
      // runs end before the folder goes; the other theme is extra — if its run
      // fails, the drawing goes without it
      const [main, other] = await Promise.allSettled([
        draw(out, theme, ["--report", report]),
        alternate === undefined
          ? Promise.resolve(undefined)
          : draw(alternateOut, alternate).then(() => read(alternateOut)),
      ]);
      if (main.status === "rejected") throw main.reason;
      return {
        svg: await read(out),
        view: JSON.parse(await read(report)).view,
        ...(other.status === "fulfilled" && other.value !== undefined
          ? { alternate: { theme: alternate, svg: other.value } }
          : {}),
      };
    } finally {
      await remove(dir, { recursive: true, force: true });
    }
  };
};

/**
 * Hands a file to the installed app (#149) — the explicit way to put a diagram
 * in front of the user, like draw.io's `open_drawio_*`. By bundle id and not
 * `pnpm tauri dev`: the reason the server stopped starting the app (#2) holds
 * here too.
 */
export const createOpenInApp = ({
  run = createRun(),
  platform = process.platform,
  exists = existsSync,
  bundleId = BUNDLE_ID,
} = {}) => {
  return async (file) => {
    if (platform !== "darwin") {
      throw new ToolError(
        "open_in_dosik is macOS only for now. Open the file from the Dosik app's Open… button.",
      );
    }
    if (!exists(file)) throw new ToolError(`No such file: ${file}`);
    try {
      await run("open", ["-b", bundleId, file]);
    } catch (error) {
      if (/Unable to find application|-10814/.test(String(error?.message ?? error))) {
        throw new ToolError(
          `Dosik is not installed (no app with the identifier ${bundleId}). Install the app, or work on the file with the other tools' \`file\` argument.`,
        );
      }
      throw error;
    }
    return { opened: file };
  };
};
