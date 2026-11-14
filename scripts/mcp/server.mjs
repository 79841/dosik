#!/usr/bin/env node
/**
 * Dosik as an MCP server (#2).
 *
 *   claude mcp add dosik -- node /path/to/dosik/scripts/mcp/server.mjs
 *
 * stdio only: a local agent talking to a local app. Nothing here listens on a
 * socket — the bridge already does that, on loopback, and this process is a
 * client of it.
 *
 * **Nothing may be written to stdout except protocol frames.** stdio transport
 * shares the stream, so progress notes go to stderr. Spawned children never
 * inherit it either (`runtime.mjs`).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "./mcpServer.mjs";
import {
  createExportFile,
  createFileMode,
  createHeadless,
  createOpenInApp,
  createRenderSvg,
  createViewBundle,
} from "./runtime.mjs";
import { liveDeps } from "./tools.mjs";

const note = (message) => process.stderr.write(`[dosik-mcp] ${message}\n`);

const base = liveDeps();
// one runner for both paths, so one build guard covers them
const headless = createHeadless({ note });
const deps = {
  ...base,
  exportFile: createExportFile({ readDiagram: base.readInlineDiagram, headless }),
  fileMode: createFileMode({ headless }),
  openInApp: createOpenInApp(),
  renderSvg: createRenderSvg({ headless, readDiagram: base.readInlineDiagram }),
};

const server = createMcpServer({ deps, viewBundle: createViewBundle({ note }) });
await server.connect(new StdioServerTransport());
note("ready");
