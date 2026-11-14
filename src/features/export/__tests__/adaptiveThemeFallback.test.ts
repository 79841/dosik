import { describe, expect, it, vi } from "vitest";

import { renderVectorSvg } from "../vectorSvg";
import { allShapesDoc } from "./fixtures/allShapes";

vi.mock("../adaptiveTheme", () => ({
  mergeThemes: () => {
    throw new Error("the light and dark drawings differ in shape");
  },
}));

describe("When theme auto cannot pair the drawings (#202)", () => {
  it("outputs the light drawing — better than no drawing at all", () => {
    const doc = allShapesDoc();
    expect(renderVectorSvg(doc, { theme: "auto" })).toBe(renderVectorSvg(doc, { theme: "light" }));
  });
});
