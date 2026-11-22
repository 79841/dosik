/**
 * Image nodes keep their picture inside the document as a data URL (#8), so a
 * `.dosik` file carries its images wherever it goes. These are the rules for
 * what such a URL may be — shared by the canvas input, the bridge and file
 * loading, so an image one path accepts is never refused by another.
 */

/** raster formats only: an SVG image can carry script */
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * The ceiling for one image. Past it the document gets heavy for autosave, the
 * bridge's 2 MiB body limit and an MCP answer alike. The canvas downscales
 * before it gets here; the bridge, which cannot, refuses.
 *
 * The limits a picture meets once it is in a document (#155):
 * - this one, per image;
 * - the bridge's 2 MiB request body — why a document read by a model carries
 *   `elidedSrc` placeholders instead of the pictures (see `elideImages`);
 * - the undo history — snapshots share `src` strings rather than copying them
 *   (`cloneSnapshot`).
 */
export const IMAGE_MAX_BYTES = 1_500_000;

/** longest side a picture is stored at — larger ones are scaled down on the way in */
export const IMAGE_MAX_PIXELS = 1600;

/** longest side a new image node starts at, so a pasted screenshot does not cover the canvas */
export const IMAGE_NODE_MAX = 480;

/** shortest side a node may start at, so a thin strip can still be grabbed */
export const IMAGE_NODE_MIN = 16;

export const isImageDataUrl = (value: unknown): value is string =>
  typeof value === "string" && IMAGE_DATA_URL.test(value);

/** decoded size of a base64 data URL */
export const dataUrlBytes = (src: string): number => {
  const payload = src.slice(src.indexOf(",") + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return (payload.length * 3) / 4 - padding;
};

/**
 * What an image's `src` reads as in a document handed to a model: its format
 * and size, not its bytes. A few pasted screenshots are megabytes of base64 —
 * past any context window, and past the bridge's body limit on the way back.
 * What an agent needs is that a picture is there (#155).
 *
 * Sent back unchanged (set_diagram, update_node) it means "keep this node's
 * picture". The bridge (`bridge.rs`) writes the same text — keep them in step.
 */
export const elidedSrc = (src: string): string => {
  const type = src.slice("data:".length, src.indexOf(";"));
  return `elided:${type};${Math.round(dataUrlBytes(src) / 1024)}KB`;
};

const ELIDED_SRC = /^elided:image\/(png|jpeg|gif|webp);\d+KB$/;
export const isElidedSrc = (value: unknown): value is string =>
  typeof value === "string" && ELIDED_SRC.test(value);

interface ImageNodeLike {
  data: { shape?: string; src?: string };
}

const elideNodes = <N extends ImageNodeLike>(nodes: N[]): N[] =>
  nodes.map((node) =>
    node.data.shape === "image" && isImageDataUrl(node.data.src)
      ? { ...node, data: { ...node.data, src: elidedSrc(node.data.src) } }
      : node,
  );

/**
 * A copy of `doc` whose pictures are `elidedSrc` placeholders — its nodes'
 * (#7; a diagram is one canvas, #229). The original is untouched.
 */
export const elideImages = <D extends object>(doc: D): D => {
  const { nodes } = doc as { nodes?: unknown };
  return {
    ...doc,
    ...(Array.isArray(nodes) ? { nodes: elideNodes(nodes as ImageNodeLike[]) } : {}),
  };
};

/** why a `src` cannot be stored, or null when it can */
export const imageSrcError = (src: unknown): string | null => {
  if (isElidedSrc(src)) {
    return `src "${src}" stands for an image already in the diagram — send it back only on the node it came from, or send a data URL`;
  }
  if (!isImageDataUrl(src)) {
    return "src must be a base64 data URL of a png, jpeg, gif or webp image";
  }
  const bytes = dataUrlBytes(src);
  if (bytes > IMAGE_MAX_BYTES) {
    return `image is too large (${Math.round(bytes / 1024)} KB; the limit is ${Math.round(IMAGE_MAX_BYTES / 1024)} KB)`;
  }
  return null;
};

/** a new node's size: the picture's proportions, longest side at most IMAGE_NODE_MAX */
export const fitImageSize = (width: number, height: number): { width: number; height: number } => {
  const scale = Math.min(1, IMAGE_NODE_MAX / Math.max(width, height));
  return {
    width: Math.max(IMAGE_NODE_MIN, Math.round(width * scale)),
    height: Math.max(IMAGE_NODE_MIN, Math.round(height * scale)),
  };
};
