import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Mermaid draws `$$…$$` labels with KaTeX, which it loads on its own. The
 * workspace pins that KaTeX above mermaid 11's own range (pnpm-workspace.yaml
 * overrides), so these tests read the copy mermaid resolves, not one of ours.
 */
const fromMermaid = createRequire(createRequire(import.meta.url).resolve("mermaid/package.json"));

const atLeast = (version: string, floor: readonly number[]): boolean => {
  const parts = version.split(/[.-]/).map(Number);
  for (const [i, min] of floor.entries()) {
    const part = parts[i] ?? 0;
    if (part !== min) return part > min;
  }
  return true;
};

describe("the KaTeX mermaid loads", () => {
  it("is 0.18.2 or later — earlier releases let prototype pollution bypass trust settings (GHSA-238p-pmpm-9mq7)", () => {
    const { version } = fromMermaid("katex/package.json") as { version: string };
    expect(atLeast(version, [0, 18, 2]), `katex ${version}`).toBe(true);
  });

  // mermaid 11's one call (renderKatexUnsanitized): MathML by default, HTML and
  // MathML when a diagram opts into legacyMathML
  it.each(["mathml", "htmlAndMathml"])(
    "still answers mermaid 11's renderToString call with %s output",
    async (output) => {
      const katex = (await import(pathToFileURL(fromMermaid.resolve("katex")).href)) as {
        default: { renderToString: (tex: string, options: Record<string, unknown>) => string };
      };
      const html = katex.default.renderToString("x^2 + 1", {
        throwOnError: true,
        displayMode: true,
        output,
      });
      expect(html).toContain("<math");
      expect(html).toContain("<msup>");
      // mermaid's own label styles hang off this class
      expect(html).toContain('class="katex"');
    },
  );
});
