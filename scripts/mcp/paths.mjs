import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the MCP server finds its parts (#252).
 *
 * In the repository (`pnpm mcp`, `node scripts/mcp/server.mjs`) the headless
 * and chat-view bundles are built from the sources on demand, the op spec is
 * `docs/openapi.yaml` and the app's identity comes from the Tauri config.
 *
 * Packaged with the app (`pnpm build:mcp` → `src-tauri/mcp/server/`, copied
 * into Dosik's app data at launch) the server is one bundled file with
 * `package-info.json`, the two bundles and the spec beside it: nothing can be
 * built there — there are no sources.
 */
export const PACKAGE_INFO = "package-info.json";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** @param {string} here the folder the server's code runs from */
export const resolveMcpPaths = (here) => {
  const info = join(here, PACKAGE_INFO);
  if (existsSync(info)) {
    const { identifier, version } = readJson(info);
    return {
      packaged: true,
      root: here,
      headlessBundle: join(here, "dosik-headless.mjs"),
      viewBundle: join(here, "diagram-view.js"),
      openapi: join(here, "openapi.yaml"),
      bundleId: identifier,
      version,
    };
  }
  const repo = resolve(here, "../..");
  return {
    packaged: false,
    root: repo,
    headlessBundle: join(repo, "dist-cli/dosik-headless.mjs"),
    viewBundle: join(repo, "dist-mcp-view/diagram-view.js"),
    openapi: join(repo, "docs/openapi.yaml"),
    bundleId: readJson(join(repo, "src-tauri/tauri.conf.json")).identifier,
    version: readJson(join(repo, "package.json")).version,
  };
};

/** this server's own paths — bundled into one file, `import.meta.url` is that file */
export const MCP_PATHS = resolveMcpPaths(dirname(fileURLToPath(import.meta.url)));

/** the path rules of `platform` — Windows paths can be worked out on any machine, for tests */
const pathsOf = (platform) => (platform === "win32" ? win32 : posix);

/** `value` when it is a whole path on `platform` */
const absolute = (value, platform) =>
  typeof value === "string" && value !== "" && pathsOf(platform).isAbsolute(value)
    ? value
    : undefined;

/**
 * The app's data folder, where it keeps its library record — Tauri's app
 * data folder for the bundle identifier: `~/Library/Application Support/<id>`
 * on macOS, `%APPDATA%\<id>` on Windows, `$XDG_DATA_HOME/<id>` (else
 * `~/.local/share/<id>`) on Linux. `DOSIK_APP_DATA` names another one — a
 * test instance built with an identifier of its own (#253).
 */
export const appDataDir = (bundleId, platform, env, home) => {
  const told = absolute(env.DOSIK_APP_DATA, platform);
  if (told) return told;
  const paths = pathsOf(platform);
  if (platform === "darwin") return paths.join(home, "Library", "Application Support", bundleId);
  if (platform === "win32") {
    return paths.join(
      absolute(env.APPDATA, platform) ?? paths.join(home, "AppData", "Roaming"),
      bundleId,
    );
  }
  return paths.join(
    absolute(env.XDG_DATA_HOME, platform) ?? paths.join(home, ".local", "share"),
    bundleId,
  );
};

/**
 * Whether to work with a development run's library — `DOSIK_DEV=1`. A
 * development run of the app keeps its record in `library-dev` and its
 * projects in `Documents/Dosik Dev`, apart from the real ones; this is how
 * the MCP server is pointed at the same two.
 */
export const isDevRun = (env) => /^(1|true|yes)$/i.test(env.DOSIK_DEV ?? "");

/** where in the app data the library's record and inbox are: `library`, or `library-dev` */
export const libraryRecordDir = (appData, dev, platform) =>
  pathsOf(platform).join(appData, dev ? "library-dev" : "library");

/**
 * The library folder by the app's own rule, for when its record does not
 * name it yet: the folder `DOSIK_LIBRARY_DIR` names, when whole; else `Dosik`
 * in Documents — `Dosik Dev` for a development run. The app asks the OS for
 * Documents: `documents` is that answer where the server has it
 * (Windows, `windowsDocuments`), else the one in the home folder, which it is
 * unless moved.
 */
export const libraryLocation = (env, dev, home, platform, documents) => {
  const told = absolute(env.DOSIK_LIBRARY_DIR, platform);
  if (told) return told;
  const paths = pathsOf(platform);
  const docs = absolute(documents, platform) ?? paths.join(home, "Documents");
  return paths.join(docs, dev ? "Dosik Dev" : "Dosik");
};

/**
 * Windows' own Documents folder, as `ask` answers it — the server asks the
 * same API the app does (`ask` runs PowerShell; tests pass their own) — or
 * undefined when the answer is not a whole path whose letters came through,
 * or the asking fails.
 */
export const windowsDocuments = (ask) => {
  try {
    const answer = String(ask()).trim();
    if (answer.includes("\uFFFD")) return undefined;
    return absolute(answer, "win32") ?? undefined;
  } catch {
    return undefined;
  }
};
