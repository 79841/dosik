import { beforeEach, describe, expect, it, vi } from "vitest";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string, _code: string) => ({ svg: `<svg id="${id}"></svg>` })),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

const { renderMermaid } = await import("../renderMermaid");

beforeEach(() => vi.clearAllMocks());

describe("renderMermaid (#194)", () => {
  it("Follows the app theme — default for light, dark for dark (the same themes as GitHub)", async () => {
    await renderMermaid("flowchart TD", "light");
    expect(mermaid.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "default" }),
    );
    await renderMermaid("flowchart TD", "dark");
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" }));
  });

  it("Draws with the diagram font (IBM Plex Mono) — not the screen font (#216)", async () => {
    const { FONT_MONO } = await import("../../../shared/lib/palette");
    await renderMermaid("flowchart TD", "light");
    expect(mermaid.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ fontFamily: FONT_MONO }),
    );
  });

  it("Blocks scripts and HTML in labels, and does not scan the page on its own", async () => {
    await renderMermaid("flowchart TD", "light");
    expect(mermaid.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ securityLevel: "strict", startOnLoad: false }),
    );
  });

  it("A different id per render — the SVG and styles of an earlier render don't mix in", async () => {
    const a = await renderMermaid("flowchart TD", "light");
    const b = await renderMermaid("flowchart TD", "light");
    expect(a).not.toBe(b);
    expect(mermaid.render.mock.calls[0]?.[1]).toBe("flowchart TD");
  });

  it("On failure, throws the reason and cleans up the temporary elements mermaid left behind", async () => {
    mermaid.render.mockImplementationOnce(async (id: string) => {
      const leftover = document.createElement("div");
      leftover.id = `d${id}`;
      document.body.append(leftover);
      throw new Error("Parse error on line 2");
    });
    await expect(renderMermaid("flowchart TD\n  ???", "light")).rejects.toThrow(/Parse error/);
    expect(document.body.querySelector("[id^='ddsk-mermaid-']")).toBeNull();
  });
});
