import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MCP_PATHS, PACKAGE_INFO, resolveMcpPaths } from "../mcp/paths.mjs";

/**
 * Where the MCP server finds its parts (#252): in the repository it builds
 * them as before; packaged with the app — a folder with `package-info.json`
 * beside the server — everything sits next to it and nothing is built.
 */
describe("MCP server paths (#252)", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("in the repository: the repo's bundles, spec and app identifier", () => {
    expect(MCP_PATHS.packaged).toBe(false);
    expect(MCP_PATHS.headlessBundle).toMatch(/dist-cli[/\\]dosik-headless\.mjs$/);
    expect(MCP_PATHS.viewBundle).toMatch(/dist-mcp-view[/\\]diagram-view\.js$/);
    expect(MCP_PATHS.openapi).toMatch(/docs[/\\]openapi\.yaml$/);
    expect(MCP_PATHS.bundleId).toBe("app.dosik.desktop");
    expect(MCP_PATHS.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("packaged: everything beside the server, identity from package-info.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "dosik-mcp-paths-"));
    made.push(dir);
    writeFileSync(
      join(dir, PACKAGE_INFO),
      JSON.stringify({ identifier: "app.dosik.desktop", version: "0.2.0" }),
    );
    const paths = resolveMcpPaths(dir);
    expect(paths).toEqual({
      packaged: true,
      root: dir,
      headlessBundle: join(dir, "dosik-headless.mjs"),
      viewBundle: join(dir, "diagram-view.js"),
      openapi: join(dir, "openapi.yaml"),
      bundleId: "app.dosik.desktop",
      version: "0.2.0",
    });
  });

  it("a folder without package-info.json is the repository layout", () => {
    const repo = mkdtempSync(join(tmpdir(), "dosik-mcp-repo-"));
    made.push(repo);
    const here = join(repo, "scripts", "mcp");
    mkdirSync(here, { recursive: true });
    mkdirSync(join(repo, "src-tauri"));
    writeFileSync(
      join(repo, "src-tauri", "tauri.conf.json"),
      JSON.stringify({ identifier: "x.y" }),
    );
    writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "9.9.9" }));
    const paths = resolveMcpPaths(here);
    expect(paths.packaged).toBe(false);
    expect(paths.root).toBe(repo);
    expect(paths.bundleId).toBe("x.y");
  });
});
