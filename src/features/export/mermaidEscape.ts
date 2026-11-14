/**
 * Label escaping for both Mermaid export paths — the single place that decides
 * what a label looks like on the way out.
 *
 * The two paths quote differently (flowchart wraps labels in `["…"]`, sequence
 * has no quoting device at all) so they escape different sets, but they must
 * agree on the characters they *both* mishandle. Before #52 they did not: a
 * multi-line label became `<br/>` in flowchart and a plain space in sequence,
 * so the same document exported two different diagrams.
 *
 * Characters that bite:
 *
 * - `;` is the statement separator — an unescaped one truncates the line and
 *   the rest fails to parse. (sequence only; the flowchart quotes cover it)
 * - `#` opens an entity reference. One that doesn't complete (`C# rocks`) ends
 *   the text right there, so the label survives parsing but arrives as `C`.
 * - `%%{…}%%` is read as an init directive anywhere in the document — it
 *   disappears from the label and reconfigures the whole diagram.
 * - `<` and `>` are **not** a parse problem — they survive as text and are then
 *   handed to the label renderer as HTML. `Vec<int>` renders as `Vec` followed
 *   by whatever the browser makes of an unknown `<int>` tag. Generics are
 *   common enough in real labels to matter, and class diagrams make them
 *   routine (#52).
 *
 * Escaping runs in one pass, before the line breaks go in: chained replaces
 * would re-escape the `;` that each entity ends with (turning `#` into
 * `#35#59;`), and escaping *after* inserting `<br/>` would mangle the break
 * markup itself.
 */
const ENTITY: Record<string, string> = {
  "#": "#35;",
  "%": "#37;",
  ";": "#59;",
  "<": "#60;",
  ">": "#62;",
};

/** Line-break markup Mermaid renders inside a label. Both paths use it (#52). */
const BR = "<br/>";

/** Sequence labels: no quoting device, so everything is escaped by hand. */
export const sequenceLabel = (label: string): string =>
  label
    .replace(/[#%;<>]/g, (c) => ENTITY[c] ?? c)
    .replace(/\r?\n/g, BR)
    .trim();

/**
 * Flowchart labels: the `["…"]` quotes already neutralise `;` and `%`, so only
 * the quote itself and the two HTML characters need escaping. A blank result
 * would emit `[""]`, which Mermaid rejects — hence the space fallback.
 */
export const flowchartLabel = (label: string): string =>
  label
    .replace(/"/g, "#quot;")
    .replace(/[<>]/g, (c) => ENTITY[c] ?? c)
    .replace(/\r?\n/g, BR)
    .trim() || " ";

/**
 * erDiagram labels (#5): quoted like flowchart, but the quotes do not
 * neutralise `%` or `\` there — a single one fails the whole block — and a
 * quote cannot be written raw (#156, checked against mermaid's parser).
 * Everything that bites becomes a numeric entity; a blank result, rejected
 * like flowchart's, becomes a space.
 */
const ER_ENTITY: Record<string, string> = {
  ...ENTITY,
  '"': "#34;",
  "\\": "#92;",
};

export const erLabel = (label: string): string =>
  label
    .replace(/["\\#%;<>]/g, (c) => ER_ENTITY[c] ?? c)
    .replace(/\r?\n/g, BR)
    .trim() || " ";

/**
 * One word of an erDiagram attribute (its type or its name). The attribute
 * grammar is stricter than a label's (#156, checked against mermaid's parser):
 * - letters of any script, decimal digits and `_ ( ) [ ] . -` only — `½` and
 *   other non-decimal numerals fail even after an underscore;
 * - the first character must be a letter or `_`: `2fa_enabled`, `(decimal)`
 *   and `-x` each fail the whole block;
 * - `PK`/`FK`/`UK` are key tokens and fail in either place.
 * Spaces become underscores; a word with nothing left is `fallback`.
 */
export const erAttributeWord = (value: string, fallback: string): string => {
  const kept = value.replace(/\s+/g, "_").replace(/[^\p{L}\p{Nd}_()[\].-]/gu, "");
  if (kept === "") return fallback;
  const led = /^[\p{L}_]/u.test(kept) ? kept : `_${kept}`;
  return /^(pk|fk|uk)$/i.test(led) ? `${led}_` : led;
};
