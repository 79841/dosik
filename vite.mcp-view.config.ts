import path from "node:path";
import { defineConfig } from "vite";

/**
 * Bundles the MCP chat view (#202) into one script, which the MCP server
 * inlines into its `ui://` resource: a host's sandbox runs inline scripts and
 * nothing from another origin. Its own folder, not `dist-cli/` — the headless
 * build empties that one.
 */
export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  // nothing from public/ — the view is one script
  publicDir: false,
  build: {
    outDir: "dist-mcp-view",
    emptyOutDir: true,
    target: "es2022",
    lib: {
      entry: path.resolve(__dirname, "src/features/mcp-view/main.ts"),
      formats: ["iife"],
      name: "DosikDiagramView",
      fileName: () => "diagram-view.js",
    },
  },
});
