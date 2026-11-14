import { isImageDataUrl } from "../../shared/lib/imageData";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * What the vector SVG is made of (`vectorSvg.tsx`, the shape components,
 * Lucide icons) — and no element that runs, animates or styles the page:
 * `script`, `foreignObject`, `style`, `set`/`animate*`, `a` are not here.
 */
const ALLOWED = new Set([
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "symbol",
  "use",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "image",
  "marker",
  "clipPath",
  "mask",
  "pattern",
  "linearGradient",
  "radialGradient",
  "stop",
  "filter",
  "feDropShadow",
  "feGaussianBlur",
  "feOffset",
  "feFlood",
  "feComposite",
  "feMerge",
  "feMergeNode",
  "feBlend",
  "feColorMatrix",
]);

/** a link may point inside the drawing, or carry a picture — by the image nodes' own rule */
const isSafeLink = (value: string): boolean => /^#[\w-]+$/.test(value) || isImageDataUrl(value);

/**
 * Attributes that would reach past the drawing: handlers, links that leave
 * it, inline `style` (the renderer writes none, and `position: fixed` would
 * cover the view's toolbar), and the view's own `dsk-` classes.
 */
const isUnsafeAttribute = (attribute: Attr): boolean => {
  const name = attribute.localName.toLowerCase();
  if (name.startsWith("on") || name === "style") return true;
  if (name === "href") return !isSafeLink(attribute.value);
  return name === "class" && /(^|\s)dsk-/.test(attribute.value);
};

/**
 * The SVG a tool result carries, as a node of `doc` with nothing in it that
 * runs (#202). The server's own SVG has none of this, but the view lives in
 * someone else's host, and markup that arrives by message is not to be
 * trusted for being ours.
 *
 * An allow-list, by namespace and local name: a deny-list missed a prefixed
 * `<h:iframe>`, an `<animate>` that rewrites a link, and a scheme split by a
 * tab (#202). Links keep only the two shapes the drawing uses.
 */
export const parseSafeSvg = (markup: string, doc: Document): SVGSVGElement | null => {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = parsed.documentElement;
  if (
    svg.namespaceURI !== SVG_NS ||
    svg.localName !== "svg" ||
    parsed.getElementsByTagName("parsererror").length > 0
  ) {
    return null;
  }
  for (const element of [...svg.querySelectorAll("*")]) {
    if (element.namespaceURI !== SVG_NS || !ALLOWED.has(element.localName)) element.remove();
  }
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      if (isUnsafeAttribute(attribute)) element.removeAttributeNode(attribute);
    }
  }
  return doc.importNode(svg, true) as unknown as SVGSVGElement;
};
