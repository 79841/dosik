import { describe, expect, it } from "vitest";

import {
  dataUrlBytes,
  elidedSrc,
  elideImages,
  fitImageSize,
  IMAGE_MAX_BYTES,
  imageSrcError,
  isElidedSrc,
  isImageDataUrl,
} from "../imageData";

const png = "data:image/png;base64,iVBORw0KGgo=";

describe("Image data (#8)", () => {
  it("only png·jpeg·gif·webp data URLs are images — SVG can carry scripts", () => {
    expect(isImageDataUrl(png)).toBe(true);
    expect(isImageDataUrl("data:image/jpeg;base64,/9j/4AAQ")).toBe(true);
    expect(isImageDataUrl("data:image/webp;base64,UklGR")).toBe(true);
    expect(isImageDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isImageDataUrl("https://example.com/a.png")).toBe(false);
    expect(isImageDataUrl("data:image/png;base64,<script>")).toBe(false);
    expect(isImageDataUrl(42)).toBe(false);
  });

  it("measures bytes from the base64 length", () => {
    expect(dataUrlBytes(`data:image/png;base64,${"A".repeat(400)}`)).toBe(300);
    expect(dataUrlBytes(`data:image/png;base64,${"A".repeat(398)}==`)).toBe(298);
  });

  it("an oversized image says why", () => {
    const big = `data:image/png;base64,${"A".repeat(Math.ceil((IMAGE_MAX_BYTES + 10) / 3) * 4)}`;
    expect(imageSrcError(big)).toMatch(/too large/);
    expect(imageSrcError(png)).toBeNull();
    expect(imageSrcError("nope")).toMatch(/data URL/);
  });

  it("initial size keeps the aspect ratio, long side at most 480", () => {
    expect(fitImageSize(1920, 1080)).toEqual({ width: 480, height: 270 });
    expect(fitImageSize(300, 600)).toEqual({ width: 240, height: 480 });
    expect(fitImageSize(100, 50)).toEqual({ width: 100, height: 50 });
  });

  it("even a very thin image keeps a grabbable size", () => {
    expect(fitImageSize(2000, 5)).toEqual({ width: 480, height: 16 });
  });
});

describe("Images in documents sent to the model become placeholders (#155)", () => {
  const big = `data:image/jpeg;base64,${"A".repeat(1_400_000)}`;
  const doc = {
    title: "t",
    nodes: [
      { id: "i", position: { x: 0, y: 0 }, data: { label: "shot", shape: "image", src: big } },
      { id: "r", position: { x: 0, y: 0 }, data: { label: "box", shape: "rect" } },
    ],
    edges: [],
  };

  it("keeps only the format and size — the agent just needs to know an image is there", () => {
    expect(elidedSrc(big)).toBe("elided:image/jpeg;1025KB");
    expect(isElidedSrc(elidedSrc(big))).toBe(true);
    expect(isElidedSrc(big)).toBe(false);
  });

  it("replaces only the images and leaves the original untouched", () => {
    const elided = elideImages(doc);
    expect(elided.nodes[0].data.src).toBe("elided:image/jpeg;1025KB");
    expect(elided.nodes[1]).toBe(doc.nodes[1]);
    expect(doc.nodes[0].data.src).toBe(big);
    expect(JSON.stringify(elided).length).toBeLessThan(1000);
  });

  it("shrinks only the one canvas — there is no pages branch (#229 D17)", () => {
    const book = { version: 2, pages: [{ id: "p", nodes: doc.nodes, edges: [] }] };
    expect(elideImages(book)).toEqual(book);
  });

  it("a placeholder is not a saveable image — and says so", () => {
    expect(imageSrcError(elidedSrc(big))).toMatch(/stands for an image already in the diagram/);
  });
});
