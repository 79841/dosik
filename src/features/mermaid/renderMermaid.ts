import { FONT_MONO } from "../../shared/lib/palette";
import type { ThemeMode } from "../../shared/lib/theme";

type Mermaid = typeof import("mermaid")["default"];

/**
 * mermaid.js is large; it loads the first time a preview is drawn, never with
 * the app (#194 D1). A failed load is forgotten so the next preview retries.
 */
let loading: Promise<Mermaid> | null = null;
/** the one loader — the preview draws with it, ⌘V parses with it (#200) */
export const loadMermaid = (): Promise<Mermaid> => {
  loading ??= import("mermaid").then(
    (module) => module.default,
    (error) => {
      loading = null;
      throw error;
    },
  );
  return loading;
};

let renders = 0;

/**
 * Draws Mermaid source to an SVG string the way GitHub would: its `default`
 * theme in light, `dark` in dark (#194 D2). `strict` keeps script and HTML out
 * of labels — they also come from documents an agent wrote (D3).
 *
 * Throws Mermaid's own message when it cannot draw the source.
 */
export const renderMermaid = async (code: string, theme: ThemeMode): Promise<string> => {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "default",
    fontFamily: FONT_MONO,
  });
  // a fresh id per render: the SVG's <style> is scoped by it, so two renders
  // on screen in turn never share rules
  renders += 1;
  const id = `dsk-mermaid-${renders}`;
  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } finally {
    // mermaid measures in a scratch element on <body>; a failed parse can
    // leave it (and its error drawing) behind
    document.getElementById(`d${id}`)?.remove();
  }
};
