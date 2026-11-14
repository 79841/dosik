# AI Agent Protocol (v1)

While it runs, Dosik opens a local HTTP server (`http://127.0.0.1:4517`) so any AI agent can read and edit diagrams. Edits an agent applies appear on the canvas immediately, and changed nodes and edges get a brief ink-colored ring that spreads and fades.

Change the port with the `DOSIK_PORT` environment variable. The server binds to 127.0.0.1 only and is not exposed to the network.

## Endpoints

### `GET /` — protocol self-description
Returns the supported endpoints, operations, shapes, and colors as JSON. Agents should call this first to learn the schema.

### `GET /api/diagram` — read the current diagram
Image nodes' `src` comes back as a placeholder such as `elided:image/png;1433KB` instead of the image — a few images are several MB of base64,
past the model's context and the request body limit (2 MiB). Send the placeholder back unchanged **on the same node** (`set_diagram`, `update_node`)
and the image is kept. To get the images themselves, use `?images=inline`.

**A diagram is one canvas.** The document always has the v1 shape below, and every edit op applies to that canvas.
To start another diagram, use `new_diagram`. A document with a top-level `pages` key (multiple pages, never released)
does not open anywhere. `project.path` lists the folders that hold the diagram (top project → containing folder, `[{id, name}]`) —
folders nest to any depth, so there can be several levels (e.g. Payments → Checkout → Flows). `new_diagram.folder` accepts
the id of any of these folders (any depth, but not the stray list "My Diagrams").
```json
{
  "version": 1,
  "title": "Untitled Diagram",
  "nodes": [ { "id": "a1", "type": "shape", "position": {"x": 0, "y": 0},
               "width": 160, "height": 56,
               "data": {"label": "Start", "shape": "rect", "color": "mono"} } ],
  "edges": [ { "id": "e1", "source": "a1", "target": "b2",
               "data": {"label": "Next", "variant": "solid", "arrow": true} } ]
}
```

### `POST /api/ops` — apply edit operations
Request body: `{ "ops": Op[] }`. Response: `{ "ok": true, "applied": n, "errors": [] }`.
A failed op puts its reason in `errors`, and the rest keep applying.

### In-app AI chat only — `/api/chat/<token>/diagram`, `/api/chat/<token>/ops`

Addresses that Dosik's chat (subscription CLI) accepts for a single turn. External agents use `/api/diagram` and `/api/ops` above.
A turn draws on **the diagram that was open when the message was sent** — if you leave for Home or another diagram, it stops with `409`
(it does not create a new diagram).
After the turn ends, the token returns `404`. The port is the one the app actually listens on — if another instance holds 4517, the CLI is not started.

## Operations

| op | Fields | Description |
|----|------|------|
| `add_node` | `node: {id?, label, shape?, color?, icon?, badge?, description?, src?, columns?, x, y, width?, height?}` | Add a node (id is generated when omitted) |
| `update_node` | `id`, `set: {label?, shape?, color?, icon?, badge?, description?, src?, columns?, x?, y?, width?, height?}` | Edit, move, or resize a node (`""` for `icon`, `badge`, or `description` clears it) |
| `delete_node` | `id` | Delete a node (and its connected edges) |
| `add_edge` | `edge: {id?, source, target, ...style}` | Add an edge (style fields below) |
| `update_edge` | `id`, `set: {...style}` | Edit an edge |
| `delete_edge` | `id` | Delete an edge |
| `add_message` | `message: {id?, from, to, y, label?, variant?, markerEnd?}` | Horizontal sequence message between lifelines (`y` is an absolute canvas coordinate, clamped to the lines' range; `from` == `to` makes a self-message loop). **One** of `from`/`to` may be a point `{x}` — a ● dot appears there (found/lost message) |
| `add_activation` | `lifeline`, `y0`, `y1` | Add an activation bar to a lifeline (y relative to the node's top, `y0 < y1`) |
| `update_node` `set.fragmentKind` | `alt\|loop\|opt\|par\|critical` | Kind of a fragment frame (shown on its top border) |
| `update_node` `set.branches` | `2..5` | Number of branches in an alt fragment — dashed dividers that split the frame evenly |
| `update_node` `set.z` | `number` | Drawing order. Lower is further back; negative is behind edges (new fragments default to -1, new frames to -2) |

> **Background shapes (fragment, frame) cannot be edge endpoints.** They have no connection handles; edges that touch them stay in the document but disappear from the canvas. `add_edge` rejects either endpoint, and a node with edges cannot become `shape: "fragment"`. A `frame` can neither change shape nor be made from another shape.
| `update_node` `set.destroyY` | `number \| null` | Lifeline destroy marker (X). y relative to the node's top, within the line (40..height); the dashed line ends here. `null` removes it |
| `set_title` | `title` | Change the diagram title |
| `group` | `ids` (2 or more), `id?` | Group shapes — in the app, clicking one selects all of them and they move together (double-click selects one). No nesting: groups the members already belong to merge into this one. Members record the group id in `data.groupId`. Anchors cannot be grouped |
| `ungroup` | `id` | Ungroup (shapes stay in place) |
| `clear` | — | Delete every node and edge. The viewport follows the document as it stands after the batch — the origin if empty, or fit to the content if the same batch added shapes |
| `set_diagram` | `doc: DiagramDoc` | Replace the whole diagram (title, nodes, edges); one ⌘Z in the app brings the previous document back. Documents with `pages` are rejected. The viewport follows the document after the batch (never zooms past 100%; the origin if empty) |
| `new_diagram` | `title?`, `folder?` | Create a library diagram, open it in a new tab, and make it active — **later ops in the same batch go to the new diagram**, earlier ones stay on the original. An empty or missing `title` becomes `Untitled Diagram`. Without `folder` (an id from `project.path`): the current diagram's folder, else the folder Home is showing → the project picked on Home → the most recent project. Counts as `applied` 1. If it fails (`title` not a string, unknown folder, save failure), the ops after it are not applied. Only on `POST /api/ops` — in-app chat and MCP `file` mode reject it |

> **There are no page ops.** `add_page`, `switch_page`, `rename_page`, and `delete_page` are rejected with "pages were removed — a diagram is one canvas.
> Use new_diagram to start another diagram.", and to avoid drawing in the wrong place **the rest of that batch is not applied**
> ("…: the N ops after it were not applied").

> **Diagrams and projects.** The app's start screen (Home) shows projects (folders that hold diagrams).
> Several diagrams open as tabs, and ops and `GET /api/diagram` act on the **active tab**'s document —
> other tabs are out of the bridge's reach. If `POST /api/ops` arrives while the Home tab is active, the app creates a new diagram,
> opens it in a new tab, and applies the ops there (other tabs are untouched) — in the folder Home is showing (project or folder view),
> skipping the stray list that has no folder on disk; otherwise in the project picked on Home (Change on the dashboard); otherwise
> in the most recently edited project. A batch that starts with `new_diagram` creates only that one.
> A batch that starts with a removed page op (`add_page` etc.) stops immediately, so **nothing is created** (the response's `project` is `null`).
> `project: {id, title, path}` in the response and in `GET /api/diagram` is **that diagram's** (`null` for an external file or the Home tab's empty document). Library diagrams autosave.

- `shape`: `rect` `rounded` `ellipse` `diamond` `parallelogram` `cylinder` `hexagon` `sticky` `text` `lifeline` (sequence participant — header box + vertical dashed line, default 120×360) `anchor` (an invisible point for free-floating arrow ends — two anchors + an edge make a free arrow) `fragment` (sequence frame — alt/loop etc.) `frame` (titled region — the label is the title; drawn behind other shapes; dragging it in the app moves the shapes fully inside it. Cannot be an edge endpoint or change shape. Default 480×300) `class` (UML class box) `icon` (architecture icon; the `icon` field picks the glyph) `entity` (ERD table — `columns`: an array of lines like `"id uuid PK"`: name, type, key (PK/FK/UK)) `image` (an image stored in the document — `src` must be a png, jpeg, gif, or webp base64 data URL, at most 1.5 MB decoded. The label is not drawn; it becomes the alt text)
- `color`: `mono` `violet` `blue` `teal` `green` `amber` `rose` `gray` `ink` — shapes are borderless tinted tiles; color goes only into the tile and icon, and labels stay ink. Defaults to `mono` (warm gray tile). `ink` is a near-black tile with white text (inverted in dark mode) — for a single hero node only. `shape` defaults to `rect`
- `icon`: `database` `server` `cloud` `user` `queue` `cache` `storage` `function` `api` `browser` `mobile` `lock` `mail` `scheduler` `container` `balancer` `service` `document` `search` `internet` `users` `gateway` `firewall` `shield` `key` `certificate` `network` `dns` `iot` `stream` `pipeline` `backup` `disk` `cpu` `cluster` `laptop` `desktop` `robot` `code` `terminal` `git` `bug` `config` `log` `folder` `table` `graph` `chart` `metrics` `bell` `chat` `calendar` `card` `bank` `cart` `location` `image` `video`
  - On shape `icon`, it is the node's **glyph** — icon + label below (default 96×96; defaults to `server`)
  - On **box shapes** (`rect` `rounded` `ellipse` `diamond` `parallelogram` `cylinder` `hexagon` `sticky`), it is an icon above the label (in the color's deep tone). On boxes shorter than 64 it sits left of the label — use a height of 70–90 to stack it above
  - Rejected on other shapes
- `badge` (box shapes and `frame`): a short tag inside the top-left corner (16 characters or fewer, e.g. `v2` `NEW`) — on frames it sits on the right of the top border. A 1–3 digit number (`1` `12`) becomes a numbered circle in the top-right corner (step number)
- `description` (box shapes only): small text below the label (300 characters or fewer, line breaks kept). Boxes do not grow on their own — give a box with a description a height of 80–100
- Edge style fields: `label`/`labelStart`/`labelEnd` (center and end labels), `variant`: `solid|dashed|dotted|dashdot`, `color` (same palette as nodes; ink when omitted — labels take the line's color), `width` (px), `opacity` (0–1), `animated` (flow animation), `pathStyle`: `orthogonal|straight|curved`, `markerStart`/`markerEnd`: `none|arrow|open|circle|diamond|bar|many|triangle|diamond-open|one|zero-one|one-many|zero-many` — `triangle` (hollow triangle) and `diamond-open` (hollow diamond) are for UML class diagrams; `one|zero-one|one-many|zero-many` are ERD crow's-foot (exactly one, zero or one, one or more, zero or more). `many` is an older notation that converges at the line end, so do not use it for ERDs. `markerSize`: `sm|md|lg`, `waypoints`: `[{x,y}]` (via points). When `add_edge` omits `markerEnd`, it gets an open chevron (`open`); `add_message` and an `add_edge` between two lifelines get a filled arrowhead (`arrow`)
- For a two-way arrow, set both markerStart and markerEnd. Self-loops (source == target) and multiple edges between the same pair of nodes are supported

## Examples (curl)

```bash
# Read the current state
curl -s http://127.0.0.1:4517/api/diagram | jq

# Draw a simple flowchart
curl -s -X POST http://127.0.0.1:4517/api/ops \
  -H 'Content-Type: application/json' \
  -d '{
    "ops": [
      {"op": "set_title", "title": "Deploy pipeline"},
      {"op": "add_node", "node": {"id": "start", "label": "Push commit", "shape": "rect", "x": 0, "y": 0}},
      {"op": "add_node", "node": {"id": "ci", "label": "CI tests", "shape": "rect", "color": "blue", "x": 240, "y": 0}},
      {"op": "add_node", "node": {"id": "ok", "label": "Passed?", "shape": "diamond", "color": "amber", "x": 480, "y": -20}},
      {"op": "add_node", "node": {"id": "deploy", "label": "Deploy", "shape": "rect", "color": "green", "x": 720, "y": 0}},
      {"op": "add_edge", "edge": {"source": "start", "target": "ci"}},
      {"op": "add_edge", "edge": {"source": "ci", "target": "ok"}},
      {"op": "add_edge", "edge": {"source": "ok", "target": "deploy", "label": "Yes"}},
      {"op": "add_edge", "edge": {"source": "ok", "target": "ci", "label": "No", "variant": "dashed"}}
    ]
  }'
```

```bash
# Draw a sequence diagram
curl -s -X POST http://127.0.0.1:4517/api/ops \
  -H 'Content-Type: application/json' \
  -d '{
    "ops": [
      {"op": "set_title", "title": "Login sequence"},
      {"op": "add_node", "node": {"id": "user", "label": "User", "shape": "lifeline", "x": 100, "y": 80}},
      {"op": "add_node", "node": {"id": "api", "label": "API", "shape": "lifeline", "color": "blue", "x": 340, "y": 80}},
      {"op": "add_node", "node": {"id": "db", "label": "DB", "shape": "lifeline", "color": "teal", "x": 580, "y": 80}},
      {"op": "add_message", "message": {"from": "user", "to": "api", "y": 180, "label": "login()"}},
      {"op": "add_message", "message": {"from": "api", "to": "db", "y": 230, "label": "SELECT user"}},
      {"op": "add_message", "message": {"from": "db", "to": "api", "y": 280, "label": "row", "variant": "dashed", "markerEnd": "open"}},
      {"op": "add_message", "message": {"from": "api", "to": "api", "y": 310, "label": "sign(jwt)"}},
      {"op": "add_message", "message": {"from": "api", "to": "user", "y": 380, "label": "token", "variant": "dashed", "markerEnd": "open"}},
      {"op": "add_activation", "lifeline": "api", "y0": 100, "y1": 310},
      {"op": "update_node", "id": "api", "set": {"destroyY": 330}}
    ]
  }'
```

## Using it from an AI agent

Give an agent that can use a shell or HTTP tool an instruction like this:

> The Dosik app is running at 127.0.0.1:4517. Read the current diagram with `GET /api/diagram`, then draw this system's architecture diagram with `POST /api/ops`. The protocol is described at `GET /`.

Each edit appears on the canvas as soon as it is applied, so splitting the drawing across several `POST /api/ops` calls shows it being drawn live.
