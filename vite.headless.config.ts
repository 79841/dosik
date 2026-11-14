import path from "node:path";
import { defineConfig } from "vite";

/**
 * Bundles the headless CLI (#64) for Node. The app's export and store modules
 * are TypeScript that Node cannot run directly, and re-implementing them would
 * put the same rules in two places — so they are bundled as they are.
 */
export default defineConfig({
  build: {
    ssr: true,
    target: "node22",
    outDir: "dist-cli",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "src/features/headless/main.ts"),
      output: { entryFileNames: "dosik-headless.mjs", format: "es" },
    },
  },
});
