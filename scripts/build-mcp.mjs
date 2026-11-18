#!/usr/bin/env node
/**
 * `pnpm build:mcp` — Dosik's MCP server packaged with the app (#252).
 *
 *   src-tauri/mcp/server/      the server, self-contained: one node file per
 *                              entry (dependencies bundled in), the chat view,
 *                              the op spec and package-info.json — run with
 *                              `node server/server.mjs`, no repository needed
 *   src-tauri/mcp/dosik.mcpb   the same folder as a Claude Desktop extension
 *
 * The app copies `server/` into its app data at launch and registers that
 * copy with Claude Code and Codex; Settings ▸ Integrations hands the .mcpb to
 * Claude Desktop. `src-tauri/mcp/` is a bundle resource, so it must exist
 * for any Rust build — its README is tracked, the rest is built.
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
export const SERVER_ENTRY = "server/server.mjs";
export const MCPB = "dosik.mcpb";

/** the extension's manifest (MCPB manifest spec 0.3) */
export const mcpbManifest = ({ version }) => ({
  manifest_version: "0.3",
  name: "dosik",
  display_name: "Dosik",
  version,
  description: "Read, edit, export and draw your Dosik diagrams from Claude.",
  author: { name: "Dosik" },
  license: "MIT",
  repository: { type: "git", url: "https://github.com/79841/dosik" },
  server: {
    type: "node",
    entry_point: SERVER_ENTRY,
    mcp_config: { command: "node", args: [`\${__dirname}/${SERVER_ENTRY}`] },
  },
  compatibility: { platforms: ["darwin"], runtimes: { node: ">=18.0.0" } },
});

/**
 * Claude Desktop's id for a .mcpb it installed: `local.mcpb.` + its slug of
 * the author's name + `.` + its slug of the name (the id scheme Claude Desktop
 * uses for local .mcpb installs, observed in 5.11492.0). Settings ▸ Integrations
 * looks the extension up by it.
 */
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_.]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
export const extensionId = (manifest) =>
  `local.mcpb.${slug(manifest.author?.name ?? "")}.${slug(manifest.name)}`;

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
  const { zipSync } = await import("fflate");
  const { identifier } = readJson(join(REPO, "src-tauri/tauri.conf.json"));
  const { version } = readJson(join(REPO, "package.json"));

  rmSync(SERVER, { recursive: true, force: true });
  rmSync(join(OUT, MCPB), { force: true });
  mkdirSync(SERVER, { recursive: true });

  await bundleForNode(build, "scripts/mcp/server.mjs", "server.mjs");
  await bundleForNode(build, "src/features/headless/main.ts", "dosik-headless.mjs");
  // the chat view is a browser script the server reads as text — its own build, as in the repo
  await build({ configFile: join(REPO, "vite.mcp-view.config.ts"), logLevel: "warn" });
  copyFileSync(join(REPO, "dist-mcp-view/diagram-view.js"), join(SERVER, "diagram-view.js"));
  copyFileSync(join(REPO, "docs/openapi.yaml"), join(SERVER, "openapi.yaml"));
  // the bundles carry other projects' code: the licence and the notices go with every copy
  // (the extension Claude Desktop installs, the app data copy)
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

  const files = {
    "manifest.json": new TextEncoder().encode(
      `${JSON.stringify(mcpbManifest({ version }), null, 2)}\n`,
    ),
  };
  for (const file of walk(SERVER)) {
    files[`server/${file.split("\\").join("/")}`] = new Uint8Array(
      readFileSync(join(SERVER, file)),
    );
  }
  writeFileSync(join(OUT, MCPB), zipSync(files, { level: 9 }));
  process.stdout.write(
    `build:mcp — ${relative(REPO, SERVER)} and ${relative(REPO, join(OUT, MCPB))} (${version})\n`,
  );
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
