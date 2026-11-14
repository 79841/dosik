import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { McpResult, runTool, toolDefinitions } from "./tools.mjs";
import { readViewResource, supportsView, viewResources } from "./view.mjs";

/**
 * The MCP server's request handlers, apart from the stdio transport that
 * `server.mjs` connects — so they can be driven by an in-memory client in
 * tests, with and without the MCP Apps extension (#202).
 *
 * @param {{ deps: object; viewBundle: () => Promise<string> }} options
 */
export const createMcpServer = ({ deps, viewBundle }) => {
  const server = new Server(
    { name: "dosik", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  /**
   * Whether this client draws MCP Apps (#202) — it said so in `initialize`,
   * which comes before any of the requests below. The tool list, the shape of
   * `render_diagram`'s result and the resource list all follow it.
   */
  const host = () => ({ view: supportsView(server.getClientCapabilities()) });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions(undefined, host()),
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: viewResources(host().view),
  }));

  // declaring `resources` invites this question; the answer is that there are none
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
    readViewResource(request.params.uri, viewBundle),
  );

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await runTool(
        request.params.name,
        request.params.arguments ?? {},
        deps,
        host(),
      );
      if (result instanceof McpResult) return result.result;
      // an SVG goes out as itself — JSON-quoting it would hand the client an
      // escaped string it would have to unescape before it could draw anything
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (error) {
      // an agent can act on a message; a stack trace it cannot
      return { content: [{ type: "text", text: String(error.message ?? error) }], isError: true };
    }
  });

  return server;
};
