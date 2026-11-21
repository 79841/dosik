import { isAbsolute } from "node:path";

import { bridgeUrl, probeBridge, resolvePort, sendOps } from "../opsClient.mjs";
import { LIBRARY_TOOL_NAMES, libraryToolDefinitions, runLibraryTool } from "./library.mjs";
import { applyOpsSchema, loadSpec, opNames } from "./opSchema.mjs";
import { ToolError } from "./toolError.mjs";
import { LEGACY_URI_KEY, VIEW_URI, viewSummaryText } from "./view.mjs";

/**
 * The tools an agent sees, and what each one does (#2, #149, #148): six for
 * a diagram, here, and five for the library's projects and folders, in
 * `library.mjs` (#253).
 *
 * The bridge speaks eleven ops, but they are not eleven tools: `op` is already
 * one well-defined language with its schema in `docs/openapi.yaml`, and
 * flattening it would duplicate that spec in a second place. The surface is
 * thin on purpose — read, edit, ask what is possible, write a file, and hand a
 * file to the app.
 *
 * **The target is in the arguments.** Without `file` a tool works on the canvas
 * open in the app; with it, on that `.dosik` file, through the headless data
 * layer and with no app at all (draw.io's split, #149). A closed app is never a
 * reason to switch silently: the agent would believe it edited the canvas while
 * the user's screen stayed as it was.
 *
 * Everything here is pure except the injected `deps`, so the decisions can be
 * tested without a running app.
 */
export { ToolError };

/**
 * A result already in MCP's own shape (`content` + `structuredContent`), which
 * the server sends as it is. Everything else a tool returns is a value the
 * server wraps as text.
 */
export class McpResult {
  constructor(result) {
    this.result = result;
  }
}

/**
 * Formats the headless path can write, and the two it cannot.
 *
 * Copied values would drift the way a hand-written op schema would: the day
 * the CLI learns a format, this list would keep refusing it and the message
 * would blame the user's extension (#2). `scripts/__tests__` ties these
 * to `HEADLESS_FORMATS`/`WINDOWED_FORMATS` in the CLI.
 */
export const FILE_FORMATS = ["md", "mmd", "dosik", "dosik.json", "svg"];
export const WINDOWED = ["png"];

/**
 * Said up front, in the words `requireBridge` uses when it refuses: a model
 * that reads only `tools/list` would otherwise learn the precondition by
 * failing, and the user would see an attempt instead of a request (#2).
 */
const NEEDS_APP =
  " Without `file`, requires the Dosik app to be open — this server does not start it.";

/**
 * What `file` takes. The app reads a file again when it changes on disk, so
 * a file it has open may be edited here too — the tab follows.
 */
const FILE_PARAM = {
  type: "string",
  description:
    "Absolute path to a `.dosik` file (an older `.dosik.json` works too). " +
    "A `.dosik` file is JSON (the same document as get_diagram). With it, the tool works on " +
    "that file and needs no app; without it, on the diagram open in the app. A tab in the app " +
    "that has the file open reads it again after the change.",
};

const THEMES = ["auto", "light", "dark"];

const RENDER_THEME = {
  type: "string",
  enum: THEMES,
  description:
    "Colour scheme — auto (default): follows the page the SVG is shown on, light or dark; " +
    "or fixed light or dark.",
};

const RENDER_SCHEMA = {
  type: "object",
  properties: { file: FILE_PARAM, theme: RENDER_THEME },
};

/** a text host: the SVG comes back as the result, for the model to show (#148) */
const renderAsSvg = {
  name: "render_diagram",
  description:
    "Draw a diagram as SVG markup and return it — true vector, drawn from the document with " +
    "the app's own shapes and edge routing, so with `file` it needs no app at all. " +
    "To show the user the diagram, render the SVG (an inline widget or artifact that displays " +
    "SVG); pasted as text it is just markup. It is sized to fit its container and has no " +
    "background of its own; with the default `theme: auto` its colours follow the page it is " +
    "shown on, light or dark." +
    NEEDS_APP,
  inputSchema: RENDER_SCHEMA,
};

/** the host shows `ui://` apps (#202): the SVG goes to the view, the model reads a summary */
const renderInView = {
  name: "render_diagram",
  description:
    "Show a diagram to the user as an interactive view in the chat — zoom, pan, refresh — drawn " +
    "as true vector from the document with the app's own shapes and edge routing, so with " +
    "`file` it needs no app at all. The view draws the SVG; you get a one-line summary of what " +
    "is shown, not the markup. For the SVG itself, write it to a file with export_diagram " +
    "(path ending in .svg)." +
    NEEDS_APP,
  inputSchema: RENDER_SCHEMA,
  // both keys, as ext-apps' own `registerAppTool` writes them: a host that
  // reads only the older one would otherwise show nothing — and in this
  // variant the model holds no SVG to show instead (#202)
  _meta: { ui: { resourceUri: VIEW_URI }, [LEGACY_URI_KEY]: VIEW_URI },
};

/**
 * @param {{ view?: boolean }} [host] `view`: the client draws MCP Apps (#202) —
 *   `render_diagram` then points at the chat view. Without it every tool is as
 *   it was, byte for byte.
 */
export const toolDefinitions = (spec = loadSpec(), { view = false } = {}) => [
  {
    name: "get_diagram",
    description:
      "Read a diagram as the document a `.dosik` file holds — the one open in Dosik, or `file`. " +
      "An image node's `src` reads as an `elided:<type>;<KB>KB` placeholder; send it back unchanged on that node to keep the picture." +
      NEEDS_APP,
    inputSchema: { type: "object", properties: { file: FILE_PARAM } },
  },
  {
    name: "apply_ops",
    description:
      "Edit a diagram. Operations apply in order. On the open diagram the canvas updates as they " +
      "land, highlighting what changed; with `file` they apply to that file, which is created when " +
      "it does not exist yet (a new file is a `.dosik`), and nothing is written unless every " +
      "operation applies. " +
      "A diagram is one canvas; `new_diagram` starts another diagram in the app (not with `file`) " +
      "and the operations after it go to that one. " +
      `Available operations: ${opNames(spec).join(", ")}.` +
      NEEDS_APP,
    inputSchema: withFile(applyOpsSchema(spec)),
  },
  {
    name: "describe_ops",
    description:
      "What `apply_ops` accepts — operation names and their full schema (shapes, colours, " +
      "icons), plus the bridge's examples when the app is open. Works with the app closed. " +
      "Call this first when unsure what an operation may contain.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "export_diagram",
    description:
      `Write a diagram — the open one, or \`file\` — to \`path\`. The format comes from the extension: ${FILE_FORMATS.join(", ")}. ` +
      "A `.dosik` path gets the document itself, as the app saves it. " +
      "SVG is drawn from the document as true vector. PNG is not available here — it is " +
      "captured from the rendered canvas, so it needs the app's own Export menu." +
      NEEDS_APP,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to write to." },
        file: FILE_PARAM,
        theme: {
          type: "string",
          enum: THEMES,
          description:
            "For .svg only — colour scheme: light (default), dark, or auto (follows the page it is shown on).",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "open_in_dosik",
    description:
      "Open a `.dosik` file in the installed Dosik app, so the user can see and edit it there. " +
      "It opens in a new tab and becomes the active one (a file already open just comes to the " +
      "front; one inside a library project opens as that library diagram). Use it only when the " +
      "user asks to open or show the file in the app — the other tools never need it. " +
      "Afterwards edit without `file`: edits without `file` go to the active tab, which is this " +
      "document now, and the canvas highlights what changed. macOS only for now.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Absolute path to a `.dosik` file (an older `.dosik.json` works too).",
        },
      },
      required: ["file"],
    },
  },
  view ? renderInView : renderAsSvg,
  ...libraryToolDefinitions(),
];

/**
 * An SVG goes into the model's context whole. Past this it is a file's job —
 * a large diagram would crowd out the conversation it was meant to serve
 * (#152).
 */
export const RENDER_LIMIT_BYTES = 256 * 1024;

/**
 * In a chat view the SVG goes to the view alone, so the context limit above
 * does not apply — pictures easily pass it. This bounds what one message to
 * the view carries, both themes together (#202, #251).
 */
export const VIEW_LIMIT_BYTES = 4 * 1024 * 1024;

/**
 * Where a chat view's result carries the pictures: the result's `_meta`, meant
 * for the view — a host does not show it to the model (Claude Code doesn't).
 * Not `structuredContent` — some hosts show that to the model as data (Claude
 * Code does), and the SVG would fill its context or pass its cap on a tool
 * result (#251). The view reads the same key
 * (`src/features/mcp-view/diagramView.ts`).
 */
export const DRAWING_META_KEY = "app.dosik/drawing";

const IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+)(={0,2})$/;

/**
 * A copy of `doc` whose pictures read `elided:<type>;<KB>KB` — the same text
 * `elidedSrc` (src/shared/lib/imageData.ts) and the bridge write, so one sent
 * back is recognised as "keep this picture". A document goes into the model's
 * context whole; a few screenshots are megabytes of base64 (#155). The
 * live bridge elides on its own; this covers file mode.
 */
const elideNodes = (nodes) =>
  nodes.map((node) => {
    const match = node.data?.shape === "image" && IMAGE_DATA_URL.exec(node.data.src ?? "");
    if (!match) return node;
    const [, type, payload, padding] = match;
    const bytes = ((payload.length + padding.length) * 3) / 4 - padding.length;
    const src = `elided:image/${type};${Math.round(bytes / 1024)}KB`;
    return { ...node, data: { ...node.data, src } };
  });

export const elideImages = (doc) => ({
  ...doc,
  ...(Array.isArray(doc.nodes) ? { nodes: elideNodes(doc.nodes) } : {}),
});

const checkTheme = (theme) => {
  if (!THEMES.includes(theme)) {
    throw new ToolError('`theme` must be "auto", "light" or "dark".');
  }
  return theme;
};

/** adds the optional `file` target to a generated schema without touching the spec's own shape */
function withFile(schema) {
  return { ...schema, properties: { ...schema.properties, file: FILE_PARAM } };
}

/** a diagram's file: `.dosik`, or the older `.dosik.json` — either in any case */
export const isDiagramFile = (path) => /\.dosik(\.json)?$/i.test(path);

/**
 * `file` as the target: absolute (the CLI runs with the repo as its cwd, so a
 * relative path would land inside the checkout) and a `.dosik` — or an older
 * `.dosik.json` (anything else is not a document this app reads). That a new
 * file is a `.dosik` is the file mode's to say: only it knows what exists.
 */
export const checkFile = (file) => {
  if (typeof file !== "string" || file.length === 0) {
    throw new ToolError("`file` must be a string path to a `.dosik` file.");
  }
  if (!isAbsolute(file)) throw new ToolError(`\`file\` must be absolute (got: ${file}).`);
  if (!isDiagramFile(file)) {
    throw new ToolError(`\`file\` must be a \`.dosik\` file (got: ${file}).`);
  }
  return file;
};

// `null` too: some clients fill optional arguments with it (#151)
const hasFile = (args) => args?.file !== undefined && args?.file !== null;

/**
 * `open_in_dosik` only hands the path to the OS; the app decides whether it is
 * a diagram, and besides `.dosik` it also opens the legacy `.mdgram.json` and
 * plain `.json`. The editing tools stay on `.dosik` — they write, so they
 * choose the form.
 */
const checkOpenable = (file) => {
  if (typeof file !== "string" || file.length === 0) {
    throw new ToolError("`file` must be a string path to a diagram.");
  }
  if (!isAbsolute(file)) throw new ToolError(`\`file\` must be absolute (got: ${file}).`);
  if (!isDiagramFile(file) && !file.toLowerCase().endsWith(".json")) {
    throw new ToolError(
      `\`file\` must be a diagram — a \`.dosik\` file, or an older \`.json\` (got: ${file}).`,
    );
  }
  return file;
};

/** what an open window means for the other tools — said on the way in and on the way out */
const OPENED_NOTE =
  "The file is now open in the Dosik app, in its own tab and on screen. From here on, edit it " +
  "without `file` — that edits the active tab while it stays the active one, and the canvas " +
  "highlights what changed.";

/**
 * Reaching the live canvas — and only reaching it.
 *
 * This server is a helper the client starts per conversation and reaps when it
 * ends; the window is the user's. So a closed app is reported, never opened:
 * Figma's desktop server, Blender's add-on and draw.io's tool server all leave
 * the editor to the user. Starting it from here also meant `pnpm tauri dev` —
 * a source checkout, pnpm on a GUI client's PATH, a free Vite port and minutes
 * of Rust — none of which a person drawing a diagram has.
 */
export const requireBridge = async (deps) => {
  const port = deps.resolvePort();
  const probe = await deps.probeBridge(port);
  if (probe.state === "ready") return port;
  if (probe.state === "foreign") {
    throw new ToolError(
      `Port ${port} is held by something else (${probe.detail}). Set DOSIK_PORT to move the bridge.`,
    );
  }
  throw new ToolError(
    `Dosik is not running (nothing answers on port ${port}). Open the Dosik app, then call this again — this server does not start it. ` +
      "To work without the app, pass `file` with a `.dosik` path instead.",
  );
};

/**
 * @param {{ view?: boolean }} [host] as for `toolDefinitions` — the result's
 *   shape follows the variant the client was given
 */
export const runTool = async (name, args, deps, { view = false } = {}) => {
  // the library is folders on disk: no app, no bridge (#253)
  if (LIBRARY_TOOL_NAMES.includes(name)) return runLibraryTool(name, args, deps.library);
  switch (name) {
    case "get_diagram": {
      if (hasFile(args)) return elideImages(await deps.fileMode.read(checkFile(args.file)));
      const port = await requireBridge(deps);
      return deps.readDiagram(port);
    }
    case "describe_ops": {
      // the answer is the spec, which this server already holds — asking the
      // user to open a window to learn what a window would accept is backwards.
      // A running app adds its examples; a closed one costs nothing (#2)
      const spec = deps.spec ?? loadSpec();
      const answer = { ops: opNames(spec), schema: applyOpsSchema(spec) };
      const port = deps.resolvePort();
      const probe = await deps.probeBridge(port);
      if (probe.state !== "ready") return answer;
      return { ...answer, bridge: await deps.readApi(port) };
    }
    case "apply_ops": {
      const ops = args?.ops;
      if (!Array.isArray(ops) || ops.length === 0) {
        throw new ToolError("`ops` must be a non-empty array of operations.");
      }
      if (hasFile(args)) {
        const file = checkFile(args.file);
        const report = await deps.fileMode.apply(file, ops);
        if (!report.ok) {
          throw new ToolError(`Rejected: ${report.errors.join("; ")} — the file was not changed.`);
        }
        return { ok: true, applied: report.applied, errors: report.errors, file };
      }
      const port = await requireBridge(deps);
      const { status, body } = await deps.sendOps(port, { ops });
      if (status === 202 || body?.queued === true) {
        // The bridge answers `ok: true` here: it handed the edit to the window
        // and stopped waiting for confirmation after 3s. Telling an agent to
        // retry would apply the same edit twice — an `add_node` without an id
        // lands a second shape on top of the first (#2).
        return {
          queued: true,
          confirmed: false,
          // not `ok: true` from the bridge: an agent that reads only that field
          // would report "applied" for something undecided (#2)
          bridgeNote: body?.note,
          note: "The window took the edit but did not confirm within 3s. Call get_diagram to see whether it landed — do not re-send, it may apply twice.",
        };
      }
      if (body?.ok === false) {
        throw new ToolError(`Rejected: ${(body.errors ?? []).join("; ")}`);
      }
      return body;
    }
    case "export_diagram": {
      const path = args?.path;
      if (typeof path !== "string" || path.length === 0) {
        throw new ToolError("`path` is required.");
      }
      // the schema says absolute, and the CLI runs with the repo as its cwd —
      // a relative path would quietly drop a file inside the checkout
      if (!isAbsolute(path)) {
        throw new ToolError(`\`path\` must be absolute (got: ${path}).`);
      }
      const format = path.toLowerCase().endsWith(".dosik.json")
        ? "dosik.json"
        : path.slice(path.lastIndexOf(".") + 1).toLowerCase();
      if (WINDOWED.includes(format)) {
        throw new ToolError(
          `${format.toUpperCase()} is captured from the rendered canvas, so it cannot be written here. ` +
            `Use the app's Export menu, or pick one of: ${FILE_FORMATS.join(", ")}.`,
        );
      }
      if (!FILE_FORMATS.includes(format)) {
        throw new ToolError(`Unknown format: .${format} (available: ${FILE_FORMATS.join(", ")})`);
      }
      // a theme is an SVG's; anything else would silently ignore it
      if (args?.theme !== undefined && format !== "svg") {
        throw new ToolError("`theme` is only for .svg exports.");
      }
      const extra = args?.theme !== undefined ? [{ theme: checkTheme(args.theme) }] : [];
      if (hasFile(args)) return deps.fileMode.exportTo(checkFile(args.file), path, ...extra);
      // the document is whatever is open, so the live canvas is the source
      const port = await requireBridge(deps);
      return deps.exportFile(port, path, ...extra);
    }
    case "render_diagram": {
      // the chat view shows the host's theme: it gets the drawing in both, so
      // it never has to call back for one — some hosts don't pass its calls
      // on (#251). A lone SVG follows its page (`auto`)
      const asked = checkTheme(args?.theme ?? "auto");
      const theme = view && asked === "auto" ? "light" : asked;
      const alternate = view ? { alternate: theme === "dark" ? "light" : "dark" } : {};
      const file = hasFile(args) ? checkFile(args.file) : undefined;
      const drawn =
        file !== undefined
          ? await deps.renderSvg({ file, theme, ...alternate })
          : await deps.renderSvg({ port: await requireBridge(deps), theme, ...alternate });
      const bytes = Buffer.byteLength(drawn.svg, "utf8");
      if (bytes > (view ? VIEW_LIMIT_BYTES : RENDER_LIMIT_BYTES)) {
        throw new ToolError(
          `The SVG is ${Math.round(bytes / 1024)} KB — ` +
            (view ? "too large to send to the chat view. " : "too large to return inline. ") +
            "Write it to a file with export_diagram (path ending in .svg) instead.",
        );
      }
      if (!view) return drawn.svg;
      if (!drawn.view) {
        throw new ToolError(
          "The renderer did not report what it drew. Rebuild it (delete dist-cli/) and call this again.",
        );
      }
      // both pictures past the limit: the other theme stays home, and the view
      // asks for it when it needs it — or lays this one's own backdrop
      const carriesAlternate =
        drawn.alternate !== undefined &&
        bytes + Buffer.byteLength(drawn.alternate.svg, "utf8") <= VIEW_LIMIT_BYTES;
      return new McpResult({
        content: [{ type: "text", text: viewSummaryText(drawn.view) }],
        // what a model may read: the summary's facts, never the picture
        structuredContent: {
          theme,
          ...drawn.view,
          // the view's "Open in Dosik" is for a file; the open canvas is already open
          target: file !== undefined ? { file } : {},
        },
        _meta: {
          [DRAWING_META_KEY]: {
            svg: drawn.svg,
            theme,
            ...(carriesAlternate ? { alternate: drawn.alternate } : {}),
          },
        },
      });
    }
    case "open_in_dosik": {
      if (!hasFile(args)) throw new ToolError("`file` is required.");
      const opened = await deps.openInApp(checkOpenable(args.file));
      return { ...opened, note: OPENED_NOTE };
    }
    default:
      throw new ToolError(`Unknown tool: ${name}`);
  }
};

/** the live bridge, for the server to hand to `runTool` */
export const liveDeps = (overrides = {}) => ({
  resolvePort,
  probeBridge,
  sendOps,
  // what a model reads: pictures as placeholders (#155)
  readDiagram: async (port) => {
    const response = await fetch(`${bridgeUrl(port)}/api/diagram`);
    return response.json();
  },
  // what gets drawn (export, render): pictures included
  readInlineDiagram: async (port) => {
    const response = await fetch(`${bridgeUrl(port)}/api/diagram?images=inline`);
    return response.json();
  },
  readApi: async (port) => {
    const response = await fetch(`${bridgeUrl(port)}/api`);
    return response.json();
  },
  ...overrides,
});
