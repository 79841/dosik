import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    // the terminal entry point (#63) lives outside src — it must not be bundled
    // into the app, but its logic is tested like everything else
    include: ["src/**/__tests__/**/*.test.{ts,tsx}", "scripts/__tests__/**/*.test.{ts,tsx}"],
    // Tauri APIs never exist in jsdom — every test resolves them to deterministic mocks.
    alias: {
      "@tauri-apps/api/core": path.resolve(__dirname, "src/test/mocks/tauriCore.ts"),
      "@tauri-apps/api/event": path.resolve(__dirname, "src/test/mocks/tauriEvent.ts"),
      "@tauri-apps/plugin-dialog": path.resolve(__dirname, "src/test/mocks/tauriDialog.ts"),
      "@tauri-apps/api/window": path.resolve(__dirname, "src/test/mocks/tauriWindow.ts"),
    },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/**/__tests__/**", "src/test/**", "src/main.tsx", "src/vite-env.d.ts"],
      reporter: ["text", "json", "json-summary", "lcov"],
      // Ratchet floor — raise these as each refactor stage lands, never lower.
      thresholds: {
        lines: 65,
        statements: 63,
        functions: 50,
        branches: 51,
      },
    },
  },
});
