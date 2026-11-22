# Development

Notes for building Dosik from source and for connecting tools to it. For what the app does, see the [README](../README.md).

Built with Tauri 2, React 19, React Flow, zustand, and Tailwind CSS 4.

## Run

```bash
pnpm install
pnpm tauri dev     # development run
pnpm tauri build   # build installers — src-tauri/target/release/bundle/ (macOS: .app, .dmg; Windows: NSIS setup .exe)
pnpm test          # vitest unit tests
```

Requirements: Node 22.13+ (pnpm 11 engines), Rust (stable), macOS/Windows/Linux.

A development run keeps its library apart from the installed app's: in `Documents/Dosik Dev` (or the folder picked in its own Settings), or in the folder `DOSIK_LIBRARY_DIR` names (an absolute path), which wins over both for that run only.

- The installed app's agent bridge listens on `127.0.0.1:4517`, the same port as a development run — if both run at once, the second cannot take the port. Give development runs another port with `DOSIK_PORT`
- Subscription connections in AI chat look for an installed Claude Code or Codex CLI. If the app cannot find one, set the path with `CLAUDE_CLI_PATH` / `CODEX_CLI_PATH`

## Agent bridge

While Dosik runs, a local REST API at `http://127.0.0.1:4517` lets any agent read and edit the open diagram; edits appear on the canvas immediately, with highlights. Protocol: [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md); schema: [openapi.yaml](openapi.yaml) (served at `GET /api/openapi.yaml`, with a reference UI at `GET /api/docs`).

## MCP server

Open **Settings ▸ Integrations** (⌘,) and install Dosik into:

- **Claude Code** — registered with `claude mcp add --scope user`, for every project
- **Claude Desktop** — a Dosik extension; Claude Desktop asks you to confirm
- **ChatGPT and Codex** — one entry in `~/.codex/config.toml`, which the ChatGPT desktop app and the Codex CLI share

The app carries its MCP server and keeps a copy in its app data, refreshed when Dosik updates, so moving or updating Dosik keeps the AI apps working. Claude Code and Codex start it with Node.js 18 or later (the Claude Desktop extension uses Claude's own). Restart the AI app after a change. Dosik writes to `~/.codex/config.toml` and registers with Claude Code's user scope; a `CODEX_HOME` or `CLAUDE_CONFIG_DIR` set only in a shell profile is not seen by an app opened from Finder or the Start menu.

From a checkout, for development:

```bash
claude mcp add dosik -- node /absolute/path/to/dosik/scripts/mcp/server.mjs
```

`pnpm build:mcp` builds the packaged server into `src-tauri/mcp/` (release builds run it).

This adds eleven tools: six for diagrams and five for the library.

| Tool | What it does |
|---|---|
| `get_diagram` | Reads a document |
| `apply_ops` | Applies edit ops — in the app, the canvas updates immediately |
| `describe_ops` | Lists the available ops, shapes, and colors — answers from the spec even without the app |
| `export_diagram` | Exports to a file (`md`, `mmd`, `dosik`, `svg`) |
| `open_in_dosik` | Opens a `.dosik` file in the installed app (macOS and Windows) |
| `render_diagram` | Draws a diagram — as an in-conversation app on hosts that render apps, otherwise as SVG |
| `list_projects` | Lists the library's projects — their names, folders, and whether the app can find them |
| `add_project` | Adds a folder to the library as a project, making it when it does not exist yet |
| `list_project` | Lists the folders and diagrams of a project, with their paths |
| `create_folder` | Makes a folder in a project |
| `create_diagram` | Makes an empty diagram (`<title>.dosik`) in a project or one of its folders |

**Arguments choose the target.** Read, edit, and export take `file` (an absolute path to a `.dosik` file — a `.dosik` file is JSON, the same document `get_diagram` returns).

- Without `file`, the tools work on **the canvas open in the app**. If the app is not running, they ask you to open it
- With `file`, they work on **that file without the app**, through the same data layer as the app (the headless CLI). Editing a missing file creates it, and if any op fails the file is left untouched. A tab that has the file open in the app reloads it. An older `.dosik.json` is edited where it is; new files are always `.dosik`
- They never silently fall back to a file when the app is closed — otherwise an agent would believe it edited the canvas while the screen stays unchanged (the same split draw.io's MCP server makes)

- **No tool per op.** Ops are already one language, and `docs/openapi.yaml` is the source of truth for their schema. `apply_ops`'s input schema is generated from that file, so the tool follows the spec when it changes
- **The server never launches the app.** It is a helper process the client starts and stops per conversation, and the window belongs to the user. Only when the user asks to see a diagram does `open_in_dosik` hand the file to the **installed app** (it never starts a development build)
- **SVG is drawn without a window.** Real vectors are built from the document with the same shape components and edge layout function (`layoutEdge`) as the canvas — no `<foreignObject>`. This is a different path from the app's Export SVG (a canvas capture)
- **In-conversation app.** When the client says it can render MCP Apps (`ui://`), `render_diagram` opens the `ui://dosik/diagram-view` app.
  - It supports zoom and pan, Fit, Refresh, and Open in Dosik (for `file` targets); light and dark follow the host.
  - The SVG, in both themes, goes only to the app (in the result's `_meta`); the model gets a one-line summary and its facts (title, shape and connector counts).
  - Other clients (such as the Claude Code CLI) get the SVG text as before.
  - Verified client: the Claude Desktop chat tab (registered in `claude_desktop_config.json`).
  - The app bundle builds itself into `dist-mcp-view/` on first use (or when its sources change).
- PNG is not available here: it captures the rendered canvas, which needs a window — use the app's Export menu
- Port: `DOSIK_PORT` (default 4517)

**Library tools.** The five library tools work on folders and need no app. An agent can keep a conversation's diagrams together with `add_project` — on a new folder such as `diagrams` in its working directory, or on the working directory itself — then fill it with `create_folder`, `create_diagram`, and `apply_ops` with `file`.

- Names follow the app's rules: characters that file systems do not allow become `-`, and a folder name already taken gets ` 2`. A diagram name already taken is refused instead, so nothing is drawn into the wrong file
- Refused as projects: relative paths, a root or home folder, the library folder or a folder holding it, and folders inside a project or holding one
- What the tools make reaches the app through a small inbox in its data folder: an open app shows it in the sidebar within seconds, a closed one the next time it starts
- To work with another instance's library: `DOSIK_APP_DATA` (that instance's app data folder), `DOSIK_DEV=1` (a development run's library), `DOSIK_LIBRARY_DIR` (its library folder)

## Structure

- `src/features/` — chrome (title strip, document tabs), settings (the Settings dialog), sidebar (library tree), home (dashboard, folder views, Canvas board), library (library model, tabs, autosave), canvas (editor), toolbar, palette (shape bar), editbar (selection edit bar), inspector (selection editing hook), export (md/png/svg), mermaid (paste, preview), agent (bridge hook), ai (chat panel and providers), headless, mcp-view
- `src/shared/lib/` — types, color tokens, zustand store (op application and history), edge geometry
- `src-tauri/` — agent HTTP bridge, library and file I/O, AI CLI spawning and keychain
- `design/design-system/project/` — design tokens (`tokens.css`, `tokens.json`; generated)
- Bridge protocol: [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md); spec: [openapi.yaml](openapi.yaml)

## Create diagrams from the terminal

The same command sends bridge ops whether or not the app is running. If it is not, the command starts a development build
and waits for the bridge to respond — the first build takes a few minutes, so it reports progress.

```bash
pnpm ops '{"ops":[{"op":"add_node","node":{"label":"Hi","x":100,"y":100}}]}'
pnpm ops --file ops.json
cat ops.json | pnpm --silent ops
```

Only the response goes to stdout, so you can pipe it: `pnpm --silent ops … | jq`.
Port: `DOSIK_PORT` (default 4517).

