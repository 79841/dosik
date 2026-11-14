import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { createMcpServer } from "../mcp/mcpServer.mjs";
import { VIEW_MIME, VIEW_URI, viewHtml } from "../mcp/view.mjs";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
const VIEW = {
  title: "Flow",
  shapes: 1,
  connectors: 0,
};

/** a real client and server over an in-memory pipe — the stdio transport is the only thing left out */
const connect = async (ui: boolean) => {
  const deps = {
    resolvePort: () => 4517,
    probeBridge: vi.fn(async () => ({ state: "ready" })),
    renderSvg: vi.fn(async () => ({ svg: SVG, view: VIEW })),
  };
  const server = createMcpServer({ deps, viewBundle: async () => "window.view = 1;" });
  const client = new Client(
    { name: "test", version: "1" },
    {
      capabilities: ui
        ? { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [VIEW_MIME] } } }
        : {},
    },
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
};

describe("MCP server wiring — follows the capabilities the client declares (#202)", () => {
  it("client without UI: tools carry no app, results are SVG text, no resources", async () => {
    const client = await connect(false);
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "render_diagram")?._meta).toBeUndefined();
    const result = await client.callTool({ name: "render_diagram", arguments: {} });
    expect(result.content).toEqual([{ type: "text", text: SVG }]);
    expect(result.structuredContent).toBeUndefined();
    expect((await client.listResources()).resources).toEqual([]);
  });

  it("client with UI: tools point to the app, results are a summary + structuredContent, resources are readable", async () => {
    const client = await connect(true);
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "render_diagram")?._meta).toEqual({
      ui: { resourceUri: VIEW_URI },
      "ui/resourceUri": VIEW_URI,
    });
    const result = await client.callTool({ name: "render_diagram", arguments: {} });
    expect(result.content).toEqual([
      { type: "text", text: 'Showing "Flow" in the chat — 1 shape, 0 connectors.' },
    ]);
    expect(result.structuredContent).toMatchObject({ svg: SVG, target: {} });
    expect((await client.listResources()).resources.map((r) => r.uri)).toEqual([VIEW_URI]);
    const read = await client.readResource({ uri: VIEW_URI });
    expect(read.contents).toEqual([
      { uri: VIEW_URI, mimeType: VIEW_MIME, text: viewHtml("window.view = 1;") },
    ]);
  });

  it("returns tool errors as isError results — either way", async () => {
    const client = await connect(true);
    const result = await client.callTool({ name: "render_diagram", arguments: { theme: "sepia" } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: '`theme` must be "auto", "light" or "dark".' },
    ]);
  });

  it("answers the resource template list too — since it declares the resources capability", async () => {
    const client = await connect(false);
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual([]);
  });
});
