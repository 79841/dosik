import { COLOR_TOKENS } from "../../shared/lib/palette";
import type { DiagramNode } from "../../shared/lib/types";

/**
 * What a Mermaid export could not carry, said in the export itself (#194):
 * one `%% omitted` comment right under the diagram keyword, the form the
 * sequence export started (#25). Mermaid does not draw comments; the preview
 * reads them back to show the same list (`omittedFrom`). Null when nothing
 * was left out.
 */
export const omittedNote = (diagram: string, omitted: string[]): string | null =>
  omitted.length > 0
    ? `    %% omitted (no ${diagram} equivalent): ${[...new Set(omitted)].join(", ")}`
    : null;

/** puts the note under the diagram keyword (line 0), where every export keeps it */
export const withOmittedNote = (lines: string[], diagram: string, omitted: string[]): string[] => {
  const note = omittedNote(diagram, omitted);
  return note ? [lines[0]!, note, ...lines.slice(1)] : lines;
};

/** the omitted things an export lists, read back from its Mermaid source */
export const omittedFrom = (code: string): string[] =>
  code
    .split("\n")
    .map((line) => line.match(/^\s*%% omitted \(no [^)]*\): (.+)$/)?.[1])
    .filter((list): list is string => Boolean(list))
    .flatMap((list) => list.split(", "));

/**
 * A shape's colour as a Mermaid `style` line — the light palette, the one an
 * exported file is read in. The default grey (`mono`) is close to Mermaid's
 * own look already and gets no line.
 */
export const colorStyles = (nodes: DiagramNode[], ids: Map<string, string>): string[] =>
  nodes.flatMap((node) => {
    const id = ids.get(node.id);
    if (!id || node.data.color === "mono" || !COLOR_TOKENS[node.data.color]) return [];
    const { fill, stroke, text } = COLOR_TOKENS[node.data.color];
    return [`    style ${id} fill:${fill},stroke:${stroke},color:${text}`];
  });
