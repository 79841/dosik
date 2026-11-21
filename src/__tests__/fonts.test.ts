import { describe, expect, it } from "vitest";

import { FONT_MONO } from "../shared/lib/palette";
import { DESIGN_TOKENS, readRepo } from "../test/designTokens";

/**
 * Two faces, each in its own place (#216): the
 * interface is Manrope, the diagram and Mermaid source IBM Plex Mono. Label
 * sizes (`textLayout.ts`) assume the monospaced face, so the diagram must not
 * inherit the interface's.
 */
const WEIGHTS = ["400", "500", "600", "700"];

describe("faces: Manrope for the interface, IBM Plex Mono for the diagram (#216 R4)", () => {
  it("both faces are bundled — the app looks the same offline (T11)", () => {
    const main = readRepo("src", "main.tsx");
    for (const weight of WEIGHTS) {
      expect(main).toContain(`import "@fontsource/manrope/${weight}.css";`);
      expect(main).toContain(`import "@fontsource/ibm-plex-mono/${weight}.css";`);
    }
    const pkg = JSON.parse(readRepo("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies).toHaveProperty("@fontsource/manrope");
    expect(pkg.dependencies).toHaveProperty("@fontsource/ibm-plex-mono");
  });

  it("the page is set in the interface face; no screen root re-sets it in mono (T10)", () => {
    expect(readRepo("src", "App.css")).toMatch(/:root \{\s*font-family: var\(--font-sans\);/);
    for (const file of [
      ["src", "App.tsx"],
      ["src", "features", "home", "Home.tsx"],
      ["src", "shared", "ui", "ErrorBoundary.tsx"],
    ]) {
      expect(readRepo(...file), file.join("/")).not.toMatch(/\bfont-mono\b/);
    }
  });

  it("the canvas sets the diagram in mono — every label inside inherits it (T10)", () => {
    const canvas = readRepo("src", "features", "canvas", "DiagramCanvas.tsx");
    const flow = canvas.slice(canvas.indexOf("<ReactFlow"), canvas.indexOf("</ReactFlow>"));
    const own = flow.slice(0, flow.indexOf(">\n"));
    expect(own).toMatch(/className="[^"]*\bfont-mono\b[^"]*"/);
  });

  it("Mermaid source is set in mono (T10)", () => {
    const preview = readRepo("src", "features", "mermaid", "MermaidPreview.tsx");
    expect(preview).toMatch(/<pre className="[^"]*\bfont-mono\b[^"]*">/);
  });

  it("FONT_MONO, for SVG and Mermaid, is the design system's mono stack", () => {
    // single quotes: it goes into an SVG attribute
    expect(FONT_MONO.replace(/'/g, '"')).toBe(DESIGN_TOKENS.type.families.mono);
  });

  it("the mono stack names Windows' faces after the macOS ones, before the generic family", () => {
    // Plex Mono has no Hangul and no emoji: on Windows they would fall to
    // whatever the webview picks, and the canvas and the SVG export could pick
    // differently. The macOS faces come first, so a Mac never reaches these
    const mono = DESIGN_TOKENS.type.families.mono;
    expect(mono).toBe(
      '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Malgun Gothic", "Segoe UI Emoji", monospace',
    );
  });
});
