import { describe, expect, it } from "vitest";

import {
  readViewResource,
  supportsView,
  VIEW_MIME,
  VIEW_URI,
  viewHtml,
  viewResources,
  viewSummaryText,
} from "../mcp/view.mjs";

const VIEW = {
  title: "Flow",
  shapes: 1,
  connectors: 1,
};

describe("in-chat app definition (#202)", () => {
  it("has a single ui:// resource with the MCP Apps MIME type", () => {
    expect(VIEW_URI).toBe("ui://dosik/diagram-view");
    expect(VIEW_MIME).toBe("text/html;profile=mcp-app");
  });

  it("treats a host as a UI host only when it advertises the MCP Apps extension and its MIME type", () => {
    const ext = (mimeTypes: unknown) => ({
      extensions: { "io.modelcontextprotocol/ui": { mimeTypes } },
    });
    expect(supportsView(ext([VIEW_MIME]))).toBe(true);
    expect(supportsView(ext(["text/html"]))).toBe(false);
    expect(supportsView(ext(undefined))).toBe(false);
    expect(supportsView({ extensions: {} })).toBe(false);
    expect(supportsView({})).toBe(false);
    expect(supportsView(undefined)).toBe(false);
  });

  it("summarizes what is shown in one line — there are no pages (#229 D17, T24)", () => {
    expect(viewSummaryText(VIEW)).toBe('Showing "Flow" in the chat — 1 shape, 1 connector.');
    expect(viewSummaryText({ ...VIEW, shapes: 0, connectors: 4 })).toBe(
      'Showing "Flow" in the chat — 0 shapes, 4 connectors.',
    );
    // an older headless still reports a page: it is not read
    expect(
      viewSummaryText({ ...VIEW, page: { index: 2, count: 3, name: "Detail" } } as typeof VIEW),
    ).toBe('Showing "Flow" in the chat — 1 shape, 1 connector.');
  });

  it("builds the HTML as one file — the bundle is inlined and there are no external origins", () => {
    const html = viewHtml("window.__bundle = 1;");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<script>window.__bundle = 1;</script>");
    expect(html).not.toMatch(/(src|href)=["']?https?:/i);
    // declaring "light dark" paints the iframe black inside a light chat when the
    // system is dark — the app follows the host theme instead
    expect(html).not.toContain("color-scheme");
  });

  it("keeps <!-- in the bundle from switching the HTML parser state — rewrites it as equivalent JS (#202)", () => {
    const html = viewHtml('const s = "<!--<script>";');
    expect(html).not.toContain("<!--");
    expect(html).toContain('const s = "<\\x21--<script>";');
  });

  it("keeps </script> in the bundle from cutting the HTML short", () => {
    const html = viewHtml('const s = "</script><img src=x>";');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it("lists the app resource only for UI hosts", () => {
    expect(viewResources(false)).toEqual([]);
    expect(viewResources(true)).toEqual([
      expect.objectContaining({ uri: VIEW_URI, mimeType: VIEW_MIME, name: expect.any(String) }),
    ]);
  });

  it("reads the app resource as HTML with the bundle, under the MCP Apps MIME type", async () => {
    const result = await readViewResource(VIEW_URI, async () => "window.x = 1;");
    expect(result.contents).toEqual([
      { uri: VIEW_URI, mimeType: VIEW_MIME, text: viewHtml("window.x = 1;") },
    ]);
  });

  it("rejects an unknown resource — without even reading the bundle", async () => {
    let read = false;
    await expect(
      readViewResource("ui://dosik/other", async () => {
        read = true;
        return "";
      }),
    ).rejects.toThrow(/Unknown resource/);
    expect(read).toBe(false);
  });
});
