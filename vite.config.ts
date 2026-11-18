import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`, and local folders that hold
      //    other checkouts and notes (.worktrees, .workbench). Anchored to this
      //    checkout: a `**/.worktrees/**` glob also matches every file of a
      //    checkout that itself lives in `.worktrees/`, and hot reload stops there
      ignored: ["src-tauri", ".worktrees", ".workbench"].map(
        (dir) => `${path.resolve(__dirname, dir)}/**`,
      ),
    },
  },
  // scan only this checkout's page for dependencies, not the copies in .worktrees
  optimizeDeps: {
    entries: ["index.html"],
  },
}));
