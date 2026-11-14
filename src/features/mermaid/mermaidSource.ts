/**
 * Whether text on the clipboard is Mermaid, and its code (#200 D2) — decided
 * here, without loading mermaid.js, so pasting ordinary text costs nothing.
 * Unfenced text needs a body line after the keyword: several keywords are
 * plain words, and a copied sentence must neither draw nor be overwritten by
 * a shape copy (`canvasKeymap`).
 *
 * The code is the first ```mermaid block when there is one (a Markdown file,
 * or the app's own Copy as Markdown), else the whole text. Either way its
 * first meaningful line — past front matter, `%%` comments and `%%{init}%%`
 * directives — must open with a diagram keyword. Unsupported kinds (pie,
 * gantt, …) count as Mermaid too: the caller says it cannot draw them rather
 * than pasting something else.
 */
const DIAGRAM_KEYWORD =
  /^(flowchart|graph|sequenceDiagram|classDiagram(-v2)?|erDiagram|stateDiagram(-v2)?|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|sankey(-beta)?|xychart(-beta)?|block(-beta)?|packet(-beta)?|architecture(-beta)?|kanban|radar(-beta)?|treemap(-beta)?)(\s|;|$)/;

const FENCE = /```mermaid[^\S\n]*\n([\s\S]*?)\n[^\S\n]*```/g;

/** the lines that are not blank, front matter, comments or directives */
const meaningfulLines = (code: string): string[] => {
  const lines = code.split("\n");
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((line, j) => j > 0 && line.trim() === "---");
    if (close < 0) return [];
    i = close + 1;
  }
  return lines
    .slice(i)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("%%"));
};

/** the first line that is not blank, front matter, a comment or a directive */
export const firstMeaningfulLine = (code: string): string | undefined => meaningfulLines(code)[0];

export const mermaidSource = (text: string): { code: string; blocks: number } | null => {
  const normalized = text.replace(/\r\n?/g, "\n");
  const fenced = [...normalized.matchAll(FENCE)].map((m) => m[1]!);
  const code = (fenced[0] ?? normalized).trim();
  const lines = meaningfulLines(code);
  if (!lines[0] || !DIAGRAM_KEYWORD.test(lines[0])) return null;
  // unfenced, a keyword line alone is a sentence ("pie chart of revenue"),
  // not a diagram — every diagram has a body; a fence already says it is one.
  // `;` separates statements too: `graph TD;A-->B;` is a diagram on one line
  const statements = lines.flatMap((line) => line.split(";")).filter((s) => s.trim() !== "");
  if (fenced.length === 0 && statements.length < 2) return null;
  return { code, blocks: Math.max(1, fenced.length) };
};
