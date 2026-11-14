import { describe, expect, it } from "vitest";

import { IMAGE_MAX_BYTES, IMAGE_MAX_PIXELS } from "../../../shared/lib/imageData";
import { encodeWithin, planImage } from "../imageInput";

describe("how an incoming image is kept (#8)", () => {
  it("keeps small images in accepted formats as is — re-encoding only loses quality", () => {
    expect(planImage({ type: "image/png", bytes: 200_000, width: 800, height: 600 })).toEqual({
      action: "keep",
    });
  });

  it("scales down proportionally when the long side exceeds the limit", () => {
    const plan = planImage({ type: "image/png", bytes: 200_000, width: 3200, height: 1600 });
    expect(plan).toEqual({
      action: "scale",
      width: IMAGE_MAX_PIXELS,
      height: 800,
      type: "image/png",
    });
  });

  it("re-encodes a heavy file even with small dimensions — photos as JPEG", () => {
    const plan = planImage({
      type: "image/jpeg",
      bytes: IMAGE_MAX_BYTES + 1,
      width: 1200,
      height: 900,
    });
    expect(plan).toEqual({ action: "scale", width: 1200, height: 900, type: "image/jpeg" });
  });

  it("turns png and gif into PNG — screenshot text isn't smeared by JPEG", () => {
    expect(
      planImage({ type: "image/gif", bytes: IMAGE_MAX_BYTES * 2, width: 500, height: 500 }),
    ).toMatchObject({
      type: "image/png",
    });
  });

  it("moves unaccepted formats into PNG — e.g. decoded BMP or HEIC", () => {
    expect(planImage({ type: "image/bmp", bytes: 1000, width: 10, height: 10 })).toEqual({
      action: "scale",
      width: 10,
      height: 10,
      type: "image/png",
    });
  });

  it("does not keep webp as is — older PowerPoint and Keynote can't render it (#155)", () => {
    expect(planImage({ type: "image/webp", bytes: 1000, width: 10, height: 10 })).toEqual({
      action: "scale",
      width: 10,
      height: 10,
      type: "image/png",
    });
  });

  it("rejects non-images", () => {
    expect(planImage({ type: "text/plain", bytes: 10, width: 0, height: 0 })).toEqual({
      action: "reject",
      reason: "Not an image",
    });
  });
});

describe("when the redrawn image exceeds the limit (#155)", () => {
  const url = (type: string, bytes: number) =>
    `data:${type};base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;

  it("falls back to a same-size JPEG when PNG overflows — photographic screenshots aren't rejected", () => {
    const calls: string[] = [];
    const draw = (type: "image/png" | "image/jpeg") => {
      calls.push(type);
      return type === "image/png" ? url(type, IMAGE_MAX_BYTES * 3) : url(type, 300_000);
    };
    expect(encodeWithin(draw, "image/png")).toMatch(/^data:image\/jpeg;/);
    expect(calls).toEqual(["image/png", "image/jpeg"]);
  });

  it("keeps PNG when it's within the limit — so text isn't smeared", () => {
    const calls: string[] = [];
    const draw = (type: "image/png" | "image/jpeg") => {
      calls.push(type);
      return url(type, 200_000);
    };
    expect(encodeWithin(draw, "image/png")).toMatch(/^data:image\/png;/);
    expect(calls).toEqual(["image/png"]);
  });

  it("draws only once when it's JPEG from the start", () => {
    const calls: string[] = [];
    const draw = (type: "image/png" | "image/jpeg") => {
      calls.push(type);
      return url(type, IMAGE_MAX_BYTES * 2);
    };
    encodeWithin(draw, "image/jpeg");
    expect(calls).toEqual(["image/jpeg"]);
  });
});
