import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import {
  copyMarkdown,
  copyPng,
  copySvg,
  exportFileBase,
  exportMarkdown,
  exportPng,
  exportSvg,
} from "../exportActions";

const saveBinaryFile = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => "/tmp/out");
const saveTextFile = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => "/tmp/out");
// valid base64 — the clipboard path actually decodes it
const renderPngBase64 = vi.fn<(...a: unknown[]) => Promise<string>>(async () => btoa("png"));
const renderSvgText = vi.fn<(...a: unknown[]) => Promise<string>>(async () => "<svg/>");

vi.mock("../file", () => ({
  saveBinaryFile: (...a: unknown[]) => saveBinaryFile(...a),
  saveTextFile: (...a: unknown[]) => saveTextFile(...a),
}));
vi.mock("../image", () => ({
  renderPngBase64: (...a: unknown[]) => renderPngBase64(...a),
  renderSvgText: (...a: unknown[]) => renderSvgText(...a),
}));

const writeImage = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const writeText = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeImage: (...a: unknown[]) => writeImage(...a),
  writeText: (...a: unknown[]) => writeText(...a),
}));

const select = (ids: string[]) =>
  useDiagramStore.setState((s) => ({
    nodes: s.nodes.map((n) => ({ ...n, selected: ids.includes(n.id) })),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  useDiagramStore
    .getState()
    .loadDoc(
      makeDoc(
        [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 }), makeNode({ id: "c", x: 900 })],
        [makeEdge({ id: "e", source: "a", target: "b" })],
      ),
      null,
    );
  useDiagramStore.getState().setTitle("My Diagram");
});

describe("Export actions (#139)", () => {
  it("Full Markdown holds the whole diagram — title + one mermaid block (#192, #229 D17)", async () => {
    select(["a"]);
    await expect(exportMarkdown()).resolves.toBe("Exported as Markdown");
    const [markdown, filters, name] = saveTextFile.mock.calls[0]!;
    expect(markdown).toContain("# My Diagram");
    // one canvas: one block, every shape — the selection does not narrow it
    expect(String(markdown).match(/```mermaid/g)).toHaveLength(1);
    expect(markdown).not.toContain("## ");
    expect(markdown).toMatch(/\bc\b/);
    expect(filters).toEqual([{ name: "Markdown", extensions: ["md"] }]);
    expect(name).toBe("My Diagram.md");
  });

  it("Selection Markdown holds only the chosen shapes and the lines between them (#192)", async () => {
    select(["a", "b"]);
    await exportMarkdown(true);
    const [markdown, , name] = saveTextFile.mock.calls[0]!;
    expect(markdown).toContain("```mermaid");
    expect(markdown).toMatch(/\ba\b[^\n]*-->[^\n]*\bb\b/);
    expect(markdown).not.toMatch(/\bc\b/);
    expect(name).toBe("My Diagram-selection.md");
  });

  it("Copy Markdown sends text to the clipboard and writes no file (#192)", async () => {
    // the toolbar copies the whole document even while something is picked (#139)
    select(["a"]);
    await expect(copyMarkdown()).resolves.toBe("Copied as Markdown");
    expect(String(writeText.mock.calls[0]?.[0])).toContain("```mermaid");
    expect(String(writeText.mock.calls[0]?.[0])).toMatch(/\bc\b/);
    select(["a"]);
    await expect(copyMarkdown(true)).resolves.toBe("Selection copied as Markdown");
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  it("Markdown fails when only free arrows are selected — Mermaid has no shapes to draw, so the block would be empty", async () => {
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [
            makeNode({ id: "p", shape: "anchor", width: 12, height: 12 }),
            makeNode({ id: "q", shape: "anchor", x: 200, width: 12, height: 12 }),
          ],
          [makeEdge({ id: "free", source: "p", target: "q" })],
        ),
        null,
      );
    select(["p", "q"]);
    await expect(copyMarkdown(true)).rejects.toThrow(/no shapes to write as Markdown/);
    await expect(exportMarkdown(true)).rejects.toThrow(/no shapes to write as Markdown/);
    expect(writeText).not.toHaveBeenCalled();
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  it("Markdown fails for a document with no drawable shapes — the same rule applies from the toolbar (full)", async () => {
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [
            makeNode({ id: "p", shape: "anchor", width: 12, height: 12 }),
            makeNode({ id: "q", shape: "anchor", x: 200, width: 12, height: 12 }),
          ],
          [makeEdge({ id: "free", source: "p", target: "q" })],
        ),
        null,
      );
    await expect(copyMarkdown()).rejects.toThrow(/The diagram has no shapes to write as Markdown/);
    await expect(exportMarkdown()).rejects.toThrow(/no shapes/);
    expect(writeText).not.toHaveBeenCalled();
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  it("Selection Markdown with nothing selected fails", async () => {
    select([]);
    await expect(copyMarkdown(true)).rejects.toThrow(/Nothing selected/);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("Selection export with nothing selected fails", async () => {
    select([]);
    await expect(exportPng(true)).rejects.toThrow(/Nothing selected/);
    // the point is that no file is written, not just that it throws
    expect(saveBinaryFile).not.toHaveBeenCalled();
  });

  it("The image viewport measures the live nodes for a full export", async () => {
    // `toDoc` strips the runtime fields the renderer measures from, so the
    // whole-document path must not hand it the serialised copy
    select(["a"]);
    await exportPng();
    expect(renderPngBase64.mock.calls[0]?.[0]).toBe(useDiagramStore.getState().nodes);
  });

  it("A selection measures only the chosen nodes", async () => {
    select(["a", "b"]);
    await exportSvg(true);
    const nodes = renderSvgText.mock.calls[0]?.[0] as unknown as { id: string }[];
    expect(nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("The file name marks a selection export", () => {
    expect(exportFileBase("My Diagram")).toBe("My Diagram");
    expect(exportFileBase("My Diagram", true)).toBe("My Diagram-selection");
    // a title becomes a file name, so the characters a path cannot hold go out
    expect(exportFileBase('a/b:c*d?e"f<g>h|i')).toBe("a_b_c_d_e_f_g_h_i");
    expect(exportFileBase("")).toBe("diagram");
  });

  it("Image copy goes out as bytes and writes no file", async () => {
    renderPngBase64.mockResolvedValueOnce(btoa("PNGDATA"));
    select(["a"]);
    await expect(copyPng()).resolves.toBe("Copied as PNG");
    const bytes = writeImage.mock.calls[0]?.[0] as Uint8Array;
    // Must be real bytes, not base64 — the pasteboard does not read a string
    // as an image
    expect(new TextDecoder().decode(bytes)).toBe("PNGDATA");
    expect(saveBinaryFile).not.toHaveBeenCalled();
  });

  it("SVG copy goes out as text", async () => {
    renderSvgText.mockResolvedValueOnce("<svg>x</svg>");
    select(["a", "b"]);
    await expect(copySvg(true)).resolves.toBe("Selection copied as SVG");
    expect(writeText).toHaveBeenCalledWith("<svg>x</svg>");
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  it("Copy respects the selection too", async () => {
    select(["a", "b"]);
    await copyPng(true);
    const nodes = renderPngBase64.mock.calls[0]?.[0] as unknown as { id: string }[];
    expect(nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("Copying with nothing selected leaves the clipboard untouched", async () => {
    select([]);
    await expect(copyPng(true)).rejects.toThrow(/Nothing selected/);
    expect(writeImage).not.toHaveBeenCalled();
  });

  it("Cancelling the save leaves nothing to report", async () => {
    saveBinaryFile.mockResolvedValueOnce(null);
    select(["a"]);
    await expect(exportPng()).resolves.toBeNull();
  });
});
