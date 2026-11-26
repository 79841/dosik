import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

/**
 * The app icon is one drawing in two framings. macOS wants the tile inside its
 * icon grid — 824 on a 1024 canvas, a margin all round — while Windows draws
 * app icons edge to edge: the same margin there makes Dosik look smaller than
 * the apps beside it on the taskbar, in Start and on the desktop.
 */
const ICONS = join(process.cwd(), "src-tauri/icons");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Bitmap = { width: number; height: number; rgba: Buffer };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** An 8-bit RGBA PNG without interlacing — what rsvg-convert and iconutil write. */
function decodePng(png: Buffer): Bitmap {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      // bit depth 8, colour type 6 (RGBA), no interlacing
      expect([body[8], body[9], body[12]]).toEqual([8, 6, 0]);
    } else if (type === "IDAT") {
      data.push(body);
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    expect(filter).toBeLessThanOrEqual(4);
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const upLeft = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      rgba[y * stride + x] = (line[x] + predictor) & 0xff;
    }
  }
  return { width, height, rgba };
}

/** How much of the canvas the drawing spans: its at-least-half-opaque box over the canvas side. */
function span({ width, height, rgba }: Bitmap): number {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] >= 128) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return Math.min((right - left + 1) / width, (bottom - top + 1) / height);
}

/** The images of an .ico, in its own order (all PNG-encoded). */
function icoImages(ico: Buffer): { size: number; image: Bitmap }[] {
  expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const entry = 6 + 16 * i;
    // colour planes 0 or 1, 32 bits per pixel
    expect([0, 1]).toContain(ico.readUInt16LE(entry + 4));
    expect(ico.readUInt16LE(entry + 6)).toBe(32);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    return {
      size: ico[entry] || 256,
      image: decodePng(ico.subarray(offset, offset + length)),
    };
  });
}

/** The PNG-encoded images of an .icns (the small ARGB ones are left out). */
function icnsImages(icns: Buffer): { type: string; image: Bitmap }[] {
  expect(icns.toString("ascii", 0, 4)).toBe("icns");
  const images: { type: string; image: Bitmap }[] = [];
  for (let at = 8; at < icns.length; ) {
    const type = icns.toString("ascii", at, at + 4);
    const length = icns.readUInt32BE(at + 4);
    expect(length).toBeGreaterThanOrEqual(8);
    const body = icns.subarray(at + 8, at + length);
    if (body.subarray(0, 8).equals(PNG_SIGNATURE)) images.push({ type, image: decodePng(body) });
    at += length;
  }
  return images;
}

describe("app icon: sources", () => {
  const read = (name: string) => readFileSync(join(ICONS, "source", name), "utf8");
  // what is drawn: all after the root element's opening tag and the comment that follows it
  const drawing = (svg: string) => svg.replace(/^<svg[^>]*>\s*<!--[\s\S]*?-->\s*/, "");

  it("frames the same drawing for Windows, cropped to the tile", () => {
    const mac = read("app-icon.svg");
    const windows = read("app-icon-windows.svg");
    expect(drawing(windows)).toBe(drawing(mac));
    expect(drawing(mac)).not.toBe(mac);
    // the first rect is the tile
    const tile = mac.match(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/);
    expect(tile).not.toBeNull();
    expect(windows).toContain(`viewBox="${tile?.slice(1).join(" ")}"`);
  });
});

describe("app icon: Windows", () => {
  const images = () => icoImages(readFileSync(join(ICONS, "icon.ico")));

  it("holds the sizes Windows asks for, 32 px first — Tauri makes the window icon of the first", () => {
    const all = images();
    expect(all.map((i) => i.size)).toEqual([32, 16, 24, 48, 64, 256]);
    for (const { size, image } of all) expect([image.width, image.height]).toEqual([size, size]);
  });

  it("fills its canvas at every size, as other Windows apps' icons do", () => {
    const spans = images().map(({ size, image }) => ({ size, span: span(image) }));
    expect(spans.filter((s) => s.span < 0.95)).toEqual([]);
  });
});

describe("app icon: macOS", () => {
  it("keeps the tile inside the macOS icon grid at every size", () => {
    const images = icnsImages(readFileSync(join(ICONS, "icon.icns")));
    expect(images.length).toBeGreaterThan(0);
    // 824 / 1024 — a pixel either way for rounding at the small sizes
    const outside = images
      .map(({ type, image }) => ({ type, span: span(image) }))
      .filter((s) => Math.abs(s.span - 824 / 1024) > 0.04);
    expect(outside).toEqual([]);
  });
});
