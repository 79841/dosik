import { describe, expect, it } from "vitest";

import { docToText, textOffsetToPos, textToDoc } from "../textDoc";

describe("textDoc — a shape's text as an editor document, one block per line", () => {
  it("round-trips plain text, line breaks and empty lines", () => {
    for (const text of ["", "Payments", "a\nb", "a\n\nb", "\n", "+ id: UUID\n- total: Money\n"]) {
      expect(docToText(textToDoc(text))).toBe(text);
    }
  });

  it("keeps Korean and emoji as they are", () => {
    const text = "결제 서비스\n🙂 ok";
    expect(docToText(textToDoc(text))).toBe(text);
  });

  it("one block per line, never none", () => {
    expect(textToDoc("").childCount).toBe(1);
    expect(textToDoc("a\nb\nc").childCount).toBe(3);
  });

  it("maps an offset in the text to a position in the document", () => {
    const doc = textToDoc("ab\ncde");
    // inside the first block: positions start after its opening token
    expect(textOffsetToPos(doc, 0)).toBe(1);
    expect(textOffsetToPos(doc, 2)).toBe(3);
    // the line break steps over the closing and opening tokens of two blocks
    expect(textOffsetToPos(doc, 3)).toBe(5);
    expect(textOffsetToPos(doc, 6)).toBe(8);
    // past the end clamps to the end of the last block
    expect(textOffsetToPos(doc, 99)).toBe(8);
  });

  it("an offset counts UTF-16 units, as the stored string does", () => {
    const doc = textToDoc("🙂a");
    expect(textOffsetToPos(doc, 2)).toBe(3);
  });
});
