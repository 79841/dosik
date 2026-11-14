/**
 * The diagram as an app inside the chat (#202) — MCP Apps (SEP-1865).
 *
 * A host that can draw `ui://` resources says so in `initialize`; for it,
 * `render_diagram` points at this view and sends the SVG to the view instead
 * of to the model. Every other host gets the tool exactly as before. That is
 * the extension's own server rule: check the client's capabilities, then
 * register the variant it can show — one tool, not a second "show" tool the
 * model would have to choose between, and that a text host would call to show
 * nothing at all.
 *
 * Pure: the bundle that runs inside the view is built and read in
 * `runtime.mjs`; this only decides and assembles.
 */
export const VIEW_URI = "ui://dosik/diagram-view";
export const VIEW_MIME = "text/html;profile=mcp-app";
const UI_EXTENSION = "io.modelcontextprotocol/ui";
/** the flat `_meta` key hosts read before `ui.resourceUri` (ext-apps `RESOURCE_URI_META_KEY`) */
export const LEGACY_URI_KEY = "ui/resourceUri";

/** @param {{ extensions?: Record<string, { mimeTypes?: unknown }> } | undefined} capabilities */
export const supportsView = (capabilities) => {
  const mimeTypes = capabilities?.extensions?.[UI_EXTENSION]?.mimeTypes;
  return Array.isArray(mimeTypes) && mimeTypes.includes(VIEW_MIME);
};

const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * What the model reads in place of the SVG: enough to talk about what the user
 * is looking at, and nothing it would try to draw again. A diagram is one
 * canvas (#229 D17) — an older headless's `page` is not read.
 *
 * @param {{ title: string; shapes: number; connectors: number }} view
 */
export const viewSummaryText = (view) =>
  `Showing "${view.title}" in the chat — ${count(view.shapes, "shape")}, ${count(view.connectors, "connector")}.`;

/**
 * One self-contained page: the host's sandbox runs inline scripts and nothing
 * from another origin unless the resource declares it, and the view works
 * offline. Inside a script element the HTML parser still watches for
 * `</script` (ends it early) and `<!--` (with a later `<script`, makes it miss
 * the real end), so both are rewritten into JavaScript that reads the same:
 * `<\/script`, and `<\x21--` — an escape valid in strings, template
 * literals and regular expressions alike (#202). Not in a raw string
 * (`String.raw`), where it stays four characters; the bundle has none.
 *
 * @param {string} bundle the view's script, an IIFE
 */
export const viewHtml = (bundle) =>
  [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    "<title>Dosik diagram</title></head>",
    '<body><div id="root"></div>',
    `<script>${bundle.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\x21--")}</script>`,
    "</body></html>",
  ].join("\n");

/** `resources/list`: the view is listed to a host that can show it, and to no one else */
export const viewResources = (view) =>
  view
    ? [
        {
          uri: VIEW_URI,
          name: "Dosik diagram view",
          description: "Interactive view of a diagram drawn by render_diagram",
          mimeType: VIEW_MIME,
        },
      ]
    : [];

/**
 * `resources/read`. The bundle is only read for the view's own URI — an
 * unknown one costs nothing, not a build.
 *
 * @param {string} uri
 * @param {() => Promise<string>} readBundle
 */
export const readViewResource = async (uri, readBundle) => {
  if (uri !== VIEW_URI) throw new Error(`Unknown resource: ${uri}`);
  return { contents: [{ uri, mimeType: VIEW_MIME, text: viewHtml(await readBundle()) }] };
};
