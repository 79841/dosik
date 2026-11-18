import { describe, expect, it } from "vitest";

import { extensionId, mcpbManifest, SERVER_ENTRY } from "../build-mcp.mjs";

/**
 * The MCP server packaged with the app (#252): a self-contained folder, and
 * the same folder as a Claude Desktop extension (.mcpb, manifest spec 0.3).
 */
describe("build:mcp (#252)", () => {
  it("the extension's manifest runs the bundled server on Claude Desktop's Node", () => {
    const manifest = mcpbManifest({ version: "0.2.0" });
    expect(manifest).toMatchObject({
      manifest_version: "0.3",
      name: "dosik",
      display_name: "Dosik",
      version: "0.2.0",
      author: { name: "Dosik" },
      license: "MIT",
      server: {
        type: "node",
        entry_point: SERVER_ENTRY,
        mcp_config: { command: "node", args: [`\${__dirname}/${SERVER_ENTRY}`] },
      },
    });
    expect(manifest.description.length).toBeGreaterThan(10);
    expect(SERVER_ENTRY).toBe("server/server.mjs");
  });

  it("its id in Claude Desktop is local.mcpb.<author>.<name>, slugged as Claude does", () => {
    expect(extensionId(mcpbManifest({ version: "1.0.0" }))).toBe("local.mcpb.dosik.dosik");
    expect(extensionId({ name: "My Tool!", author: { name: "  Acme  Inc " } })).toBe(
      "local.mcpb.acme-inc.my-tool",
    );
  });
});
