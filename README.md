# Dosik

A modern diagramming desktop app, named after the Korean word *dosik* (圖式) — a picture of how things are structured and related. Built with Tauri 2, React 19, and React Flow.

Draw flowcharts, sequence, class, and ER diagrams with a clean look — borderless tinted tiles, ink-colored orthogonal connectors, and a dot-grid canvas. Diagrams autosave to a library of ordinary folders and `.dosik` files, and export to Markdown (Mermaid) or images (PNG/SVG), as files or to the clipboard. A local HTTP bridge lets AI agents read and edit diagrams directly; their edits show up on the canvas live, with highlights.

## Features

- **Editing** — nine shapes (rectangle, rounded box, ellipse, diamond, parallelogram, database cylinder, hexagon, sticky note, text), 58 architecture icons, images (paste or drop), frames (titled regions), and groups (⌘G). A nine-color tint palette (including ink for hero nodes); tags, number badges, and description lines on shapes; orthogonal connectors that route around obstacles, with solid/dashed lines, arrowheads, and labels; auto-layout in four directions; copy, cut, and duplicate (⌘C, ⌘X, ⌘D); undo/redo (⌘Z / ⇧⌘Z). Edit a selection from the bottom edit bar or the context menu
- **Diagram types** — flowchart and architecture, sequence (lifelines, messages, activation bars, alt/loop/opt), class (UML compartments and relations), ERD (entity tables, crow's-foot relations). One diagram is one canvas
- **Library** — projects → folders (nestable) → diagrams, with autosave. A sidebar tree on the left (drag to reorder or move into folders, context menu, ⌘\ to hide) and Home (dashboard with Start, Continue, and Recent; folder views as Cards or a Canvas board). Reveal a folder or diagram in Finder (File Explorer on Windows) or copy its path
- **Your files, in your folders** — a project is a real folder and a diagram is a `<name>.dosik` file in it, named after the diagram. The library lives in `Documents/Dosik` in your home folder; every folder there is a project, and AI agents can add folders from elsewhere (see the MCP tools below). Files added, renamed, or removed in Finder or by other tools show up in the app, and an open tab reloads when its file changes on disk (⌘Z brings back what was on screen). Delete moves items to the Trash; a project from elsewhere is removed from the library instead, its files left where they are. A project folder that cannot be found stays in its place as Not found, with Locate… and Remove from Library
- **Tabs** — a pinned Library tab (Home) plus a tab per diagram. ⌘T new diagram · ⌘W close tab · ⌘1 Library · ⌘2–8 diagram tabs · ⌘9 last tab · ⌃Tab next tab · ⌘O Open file… · ⌘S save (Ctrl instead of ⌘ on Windows)
- **AI chat** — the right panel. Ask in plain language to create or edit a diagram and it is drawn on the canvas with live highlights; selected shapes go along as context. Two vendors (Claude, GPT) × two connections:
  - **Subscription** — uses the login of an installed Claude Code CLI or Codex CLI; no API key needed. GPT via subscription does not work on Windows yet (Codex sandbox)
  - **API key** — stores an Anthropic or OpenAI key in the OS keychain and calls the API directly
- **Files** — `.dosik` files outside the library open with Open file… or a double-click in Finder, and save with Save. Older `.dosik.json` files still open
- **Export** — Markdown (Mermaid: flowchart, sequenceDiagram, classDiagram, erDiagram) and PNG/SVG images. Export ▾ in the toolbar exports the whole document; right-clicking shapes exports just the selection. Each format can be saved to a file or copied (Copy as Markdown, Copy image, Copy as SVG)
- **Mermaid** — press ⌘V on the canvas with Mermaid code on the clipboard (bare code or a ` ```mermaid ` block) and it becomes editable shapes (also Home → New ▾ → From Mermaid…). Supports flowchart, sequenceDiagram, classDiagram, and erDiagram, with automatic layout. The right panel previews the current diagram as Mermaid
- **Light and dark themes** — Light, Dark or System in Settings ▸ General (⌘,), or the switch at the bottom of the sidebar
- **AI agent bridge** — a REST API at `http://127.0.0.1:4517` for external agents to read and edit; edits appear on the canvas immediately, with highlights. Protocol: [docs/AGENT_PROTOCOL.md](docs/AGENT_PROTOCOL.md); MCP setup below

## Install

Download the file for your Mac from [Releases](https://github.com/79841/dosik/releases).

| Mac | File |
|---|---|
| Apple Silicon | `Dosik_<version>_aarch64.dmg` |
| Intel | `Dosik_<version>_x64.dmg` |

Each release also includes `Dosik_<arch>.app.tar.gz` (`aarch64`, `x64`) for when you only need the app — extract it into Applications.
Windows and Linux builds are not available yet.

- **macOS**: open the dmg and drag Dosik to Applications. Builds are signed with Developer ID and notarized by Apple,
  so they open normally (macOS only asks once to confirm an app downloaded from the internet)
- Requires macOS 11 or later
- Dosik registers `.dosik` as its document type, so these files open in Dosik from Finder (double-click or Open With).
  A file inside a library project opens as that library diagram. The MCP tool `open_in_dosik` hands files to the installed app
- The first time this version runs, it brings the library from earlier versions into `Documents/Dosik`, with names you can read
  and `.dosik` files; the original in the app's data folder is left untouched as a backup. macOS may ask once to let Dosik use the Documents folder
- The installed app's agent bridge listens on `127.0.0.1:4517`, the same port as a development run — if both run at once, the second cannot take the port. Give development runs another port with `DOSIK_PORT`
- Subscription connections in AI chat look for an installed Claude Code or Codex CLI. If the app cannot find one, set the path with `CLAUDE_CLI_PATH` / `CODEX_CLI_PATH`

## Run

```bash
pnpm install
pnpm tauri dev     # development run
pnpm tauri build   # build installers — src-tauri/target/release/bundle/ (macOS: .app, .dmg)
pnpm test          # vitest unit tests
```

Requirements: Node 22.13+ (pnpm 11 engines), Rust (stable), macOS/Windows/Linux.

A development run keeps its library apart from the installed app's: in `Documents/Dosik Dev`, or in the folder `DOSIK_LIBRARY_DIR` names (an absolute path).

## Connect AI agents (MCP)

Open **Settings ▸ Integrations** (⌘,) and install Dosik into:

- **Claude Code** — registered with `claude mcp add --scope user`, for every project
- **Claude Desktop** — a Dosik extension; Claude Desktop asks you to confirm
- **ChatGPT and Codex** — one entry in `~/.codex/config.toml`, which the ChatGPT desktop app and the Codex CLI share

The app carries its MCP server and keeps a copy in its app data, refreshed when Dosik updates, so moving or updating Dosik keeps the AI apps working. Claude Code and Codex start it with Node.js 18 or later (the Claude Desktop extension uses Claude's own). Restart the AI app after a change. Dosik writes to `~/.codex/config.toml` and registers with Claude Code's user scope; a `CODEX_HOME` or `CLAUDE_CONFIG_DIR` set only in a shell profile is not seen by an app opened from Finder.

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
| `open_in_dosik` | Opens a `.dosik` file in the installed app (macOS) |
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
- Bridge protocol: [docs/AGENT_PROTOCOL.md](docs/AGENT_PROTOCOL.md); spec: [docs/openapi.yaml](docs/openapi.yaml)

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

## Contributing and license

Development happens in this repository, but it does not accept issues or pull requests. Licensed under [MIT](LICENSE).
