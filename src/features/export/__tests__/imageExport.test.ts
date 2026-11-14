import { describe, expect, it } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import type { DiagramNode } from "../../../shared/lib/types";
import { toMermaid } from "../markdown";
import { renderVectorSvg } from "../vectorSvg";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const image = (id: string, label = "", src: string | null = PNG): DiagramNode => {
  const n = makeNode({ id, label, shape: "image", width: 200, height: 100 });
  return { ...n, data: { ...n.data, ...(src ? { src } : {}) } };
};

describe("Image node export (#8)", () => {
  it("Mermaid gets a box with the label (Image if there is none)", () => {
    const out = toMermaid(makeDoc([image("i"), image("j", "Login screen")], []));
    expect(out).toContain('i["Image"]');
    expect(out).toContain('j["Login screen"]');
  });

  it("Vector SVG gets an <image> and does not draw the label", () => {
    const svg = renderVectorSvg(makeDoc([image("i", "alt text")], []));
    expect(svg).toContain(`href="${PNG}"`);
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(svg).not.toContain(">alt text<");
  });
});
