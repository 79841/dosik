#!/usr/bin/env node
/**
 * `pnpm build:mcp` — Dosik's MCP server packaged with the app (#252).
 *
 *   src-tauri/mcp/server/      the server, self-contained: one node file per
 *                              entry (dependencies bundled in), the chat view,
 *                              the op spec and package-info.json — run with
 *                              `node server/server.mjs`, no repository needed
 *
 * The app copies `server/` into its app data at launch and registers that
 * copy with Claude Code, Claude Desktop and Codex (Settings ▸ Integrations).
 * `src-tauri/mcp/` is a bundle resource, so it must exist for any Rust
 * build — its README is tracked, the rest is built.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO, "src-tauri/mcp");
const SERVER = join(OUT, "server");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** every file under `dir`, as paths relative to it */
const walk = (dir, base = dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path, base) : [relative(base, path)];
  });

/** one node file for `entry`, its dependencies bundled in */
const bundleForNode = async (build, entry, fileName) =>
  build({
    configFile: false,
    root: REPO,
    publicDir: false,
    logLevel: "warn",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    ssr: { noExternal: true, target: "node" },
    build: {
      ssr: entry,
      target: "node18",
      outDir: SERVER,
      emptyOutDir: false,
      rollupOptions: {
        output: { entryFileNames: fileName, format: "es", inlineDynamicImports: true },
      },
    },
  });

const main = async () => {
  const { build } = await import("vite");
  const { identifier } = readJson(join(REPO, "src-tauri/tauri.conf.json"));
  const { version } = readJson(join(REPO, "package.json"));

  rmSync(SERVER, { recursive: true, force: true });
  mkdirSync(SERVER, { recursive: true });

  await bundleForNode(build, "scripts/mcp/server.mjs", "server.mjs");
  await bundleForNode(build, "src/features/headless/main.ts", "dosik-headless.mjs");
  // the chat view is a browser script the server reads as text — its own build, as in the repo
  await build({ configFile: join(REPO, "vite.mcp-view.config.ts"), logLevel: "warn" });
  copyFileSync(join(REPO, "dist-mcp-view/diagram-view.js"), join(SERVER, "diagram-view.js"));
  copyFileSync(join(REPO, "docs/openapi.yaml"), join(SERVER, "openapi.yaml"));
  // the bundles carry other projects' code: the licence and the notices go with every copy
  copyFileSync(join(REPO, "LICENSE"), join(SERVER, "LICENSE"));
  copyFileSync(join(REPO, "THIRD_PARTY_NOTICES.txt"), join(SERVER, "THIRD_PARTY_NOTICES.txt"));
  // the marker that puts the server in packaged mode (scripts/mcp/paths.mjs); `build` tells the
  // app a rebuilt server from the copy it made (src-tauri/src/mcp_install.rs)
  const hash = createHash("sha256");
  for (const file of walk(SERVER).sort())
    hash.update(file).update(readFileSync(join(SERVER, file)));
  const buildId = hash.digest("hex").slice(0, 16);
  writeFileSync(
    join(SERVER, "package-info.json"),
    `${JSON.stringify({ identifier, version, build: buildId }, null, 2)}\n`,
  );

  process.stdout.write(`build:mcp — ${relative(REPO, SERVER)} (${version})\n`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
