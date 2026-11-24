import { type Node as DocNode, Schema } from "prosemirror-model";

/**
 * The document a shape's text is edited as (#281): one block per line, so a
 * name's line breaks and a compartment's rows are the same thing — a
 * compartment's row is a line. Plain text for now; styles come as marks.
 */
export const textSchema = new Schema({
  nodes: {
    doc: { content: "line+" },
    line: {
      content: "text*",
      parseDOM: [{ tag: "div" }, { tag: "p" }],
      toDOM: () => ["div", 0],
    },
    text: {},
  },
});

/** `text` as a document, one block per line — an empty text is one empty block */
export const textToDoc = (text: string): DocNode =>
  textSchema.node(
    "doc",
    null,
    text
      .split("\n")
      .map((line) => textSchema.node("line", null, line ? [textSchema.text(line)] : [])),
  );

/** the document back as text, its blocks joined by line breaks */
export const docToText = (doc: DocNode): string => {
  const lines: string[] = [];
  doc.forEach((line) => {
    lines.push(line.textContent);
  });
  return lines.join("\n");
};

/**
 * The document position of `offset` in the text (UTF-16 units, as the stored
 * string counts them). A line break is the step between two blocks; past the
 * end, the end of the last block.
 */
export const textOffsetToPos = (doc: DocNode, offset: number): number => {
  let rest = Math.max(0, offset);
  let pos = 0;
  let end = 1;
  for (let i = 0; i < doc.childCount; i++) {
    const line = doc.child(i);
    if (rest <= line.content.size) return pos + 1 + rest;
    rest -= line.content.size + 1;
    end = pos + 1 + line.content.size;
    pos += line.nodeSize;
  }
  return end;
};
