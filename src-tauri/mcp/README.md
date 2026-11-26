# Packaged MCP server

`pnpm build:mcp` fills this folder; release builds run it before bundling (`beforeBuildCommand`).

- `server/` — Dosik's MCP server as a self-contained folder: `server.mjs` and the headless renderer with their dependencies bundled in, the chat view, the op spec and `package-info.json`. Run it with `node server/server.mjs`.

The app copies `server/` into its app data when its version changes and registers that copy with Claude Code, Claude Desktop, ChatGPT and Codex from Settings ▸ Integrations, so moving or updating Dosik keeps them working.

The folder is a bundle resource, so it has to exist for every Rust build; this README is the only tracked file in it.
