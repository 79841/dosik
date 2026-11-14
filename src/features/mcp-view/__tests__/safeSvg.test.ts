import { describe, expect, it } from "vitest";

import { parseSafeSvg } from "../safeSvg";

describe("SVG placed in the in-chat app (#202)", () => {
  it("Returns the SVG as a node of that document", () => {
    const svg = parseSafeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="4" height="4"/></svg>',
      document,
    );
    expect(svg?.tagName).toBe("svg");
    expect(svg?.ownerDocument).toBe(document);
    expect(svg?.querySelector("rect")).not.toBeNull();
  });

  it("Strips scripts, event attributes, javascript: links and foreignObject — keeps the drawing data", () => {
    const svg = parseSafeSvg(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="x()">',
        "<script>alert(1)</script>",
        '<rect onclick="x()" width="1" height="1"/>',
        '<a href="javascript:x()"><text>a</text></a>',
        '<a xlink:href="javascript:x()"><text>b</text></a>',
        '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>',
        '<image href="data:image/png;base64,AAAA" width="1" height="1"/>',
        "</svg>",
      ].join(""),
      document,
    ) as SVGSVGElement;
    expect(svg.querySelector("script")).toBeNull();
    expect(svg.querySelector("foreignObject")).toBeNull();
    expect(svg.hasAttribute("onload")).toBe(false);
    expect(svg.querySelector("rect")?.hasAttribute("onclick")).toBe(false);
    for (const a of svg.querySelectorAll("a")) {
      expect(a.getAttribute("href")).toBeNull();
      expect(a.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBeNull();
    }
    expect(svg.querySelector("image")?.getAttribute("href")).toBe("data:image/png;base64,AAAA");
  });

  it("null when it is not SVG or is broken", () => {
    expect(parseSafeSvg("<svg", document)).toBeNull();
    expect(parseSafeSvg("<html></html>", document)).toBeNull();
  });

  const clean = (body: string) =>
    parseSafeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${body}</svg>`,
      document,
    ) as SVGSVGElement;

  it("Blocks changing links through animation — set and animate are not kept (#202)", () => {
    const svg = clean(
      '<a><set attributeName="href" to="javascript:alert(1)"/><text>x</text></a>' +
        '<rect><animate attributeName="href" values="javascript:alert(1)"/></rect>',
    );
    expect(svg.querySelector("set")).toBeNull();
    expect(svg.querySelector("animate")).toBeNull();
    expect(svg.querySelector("a")).toBeNull();
  });

  it("A tab inside the scheme does not survive as a link — only allowed forms are kept", () => {
    const svg = clean('<use href="java&#9;script:alert(1)"/><use href="#ok"/>');
    const uses = svg.querySelectorAll("use");
    expect(uses[0]?.getAttribute("href")).toBeNull();
    expect(uses[1]?.getAttribute("href")).toBe("#ok");
  });

  it("Strips prefixed HTML and foreignObject too — judged by namespace, not by name", () => {
    const svg = clean(
      '<h:iframe xmlns:h="http://www.w3.org/1999/xhtml" srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"/>' +
        '<s:foreignObject xmlns:s="http://www.w3.org/2000/svg"><div>x</div></s:foreignObject>',
    );
    expect(svg.children).toHaveLength(0);
  });

  it("Strips style elements — they could hide the app's toolbar", () => {
    expect(clean("<style>.dsk-bar{display:none}</style>").querySelector("style")).toBeNull();
  });

  it("Removes use and image links that point outside", () => {
    const svg = clean(
      '<use href="https://example.com/x.svg#a"/><image href="https://example.com/a.png"/>' +
        '<image xlink:href="data:image/svg+xml;base64,PHN2Zy8+"/>',
    );
    expect(svg.querySelector("use")?.getAttribute("href")).toBeNull();
    for (const image of svg.querySelectorAll("image")) {
      expect(image.getAttribute("href")).toBeNull();
      expect(image.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBeNull();
    }
  });

  it("Leaves the elements the app draws as they are", () => {
    const body =
      '<defs><marker id="m"><path d="M0 0"/></marker><filter id="f"><feDropShadow dx="1"/></filter></defs>' +
      '<g filter="url(#f)"><rect/><circle/><ellipse/><line/><polyline/><polygon/>' +
      '<text>a<tspan>b</tspan></text><title>t</title><path marker-end="url(#m)"/></g>';
    const svg = clean(body);
    for (const tag of [
      "marker",
      "feDropShadow",
      "rect",
      "circle",
      "ellipse",
      "line",
      "polyline",
      "polygon",
      "tspan",
      "title",
      "path",
    ]) {
      expect(svg.getElementsByTagName(tag).length, tag).toBeGreaterThan(0);
    }
    expect(svg.querySelector("g")?.getAttribute("filter")).toBe("url(#f)");
  });

  it("Strips style attributes and the app's dsk- classes — so the drawing can't cover the toolbar (#202)", () => {
    const svg = parseSafeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" style="position:fixed;inset:0" class="dsk-bar"><rect class="edge" style="fill:red"/></svg>',
      document,
    ) as SVGSVGElement;
    expect(svg.hasAttribute("style")).toBe(false);
    expect(svg.hasAttribute("class")).toBe(false);
    const rect = svg.querySelector("rect") as SVGRectElement;
    expect(rect.hasAttribute("style")).toBe(false);
    // The classes the renderer uses remain
    expect(rect.getAttribute("class")).toBe("edge");
  });
});
