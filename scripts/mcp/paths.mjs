import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
