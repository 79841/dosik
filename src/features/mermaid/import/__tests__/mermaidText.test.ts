import { describe, expect, it } from "vitest";

import { decodeLabel, paletteFromStyles } from "../mermaidText";

describe("decodeLabel — text returned by the parser becomes a label (#200)", () => {
  it("Decodes both the entity codes mermaid wraps (numeric and named) and codes written plainly", () => {
    expect(decodeLabel("ﬂ°°60¶ßTﬂ°°62¶ß ﬂ°quot¶ßqﬂ°quot¶ß ﬂ°amp¶ß")).toBe('<T> "q" &');
    expect(decodeLabel("C#35; #59; #quot;x#quot;")).toBe('C# ; "x"');
  });

  it("Any spelling of <br> is a line break", () => {
    expect(decodeLabel("a<br>b<br/>c<BR />d")).toBe("a\nb\nc\nd");
  });

  it("Missing text is an empty string", () => {
    expect(decodeLabel(undefined)).toBe("");
  });
});

describe("paletteFromStyles — the nearest palette color", () => {
  it("A fill the app exported is exactly that color", () => {
    expect(paletteFromStyles(["fill:#DCFCE7", "stroke:#22C55E"])).toBe("green");
    expect(paletteFromStyles(["fill:#FFE4E6"])).toBe("rose");
  });

  it("Reads short hex and rgb() too, and the last fill wins", () => {
    expect(paletteFromStyles(["fill:#fff"])).toBe("mono");
    expect(paletteFromStyles(["fill:rgb(220, 234, 254)"])).toBe("blue");
    expect(paletteFromStyles(["fill:#fff", "fill:#fef3c7"])).toBe("amber");
  });

  it("null when there is no fill or it can't be read", () => {
    expect(paletteFromStyles(["stroke:#f00"])).toBeNull();
    expect(paletteFromStyles(["fill:red"])).toBeNull();
    expect(paletteFromStyles([])).toBeNull();
  });
});

describe("decodeLabel — decodes in one pass", () => {
  it("Does not decode the decoded result again", () => {
    // `#35;` is "#"; what follows it is text, not the rest of another code
    expect(decodeLabel("ﬂ°°35¶ß59;")).toBe("#59;");
    expect(decodeLabel("&amp;lt;")).toBe("&lt;");
  });

  it("Decodes HTML entities too (the ones mermaid's sanitizer makes)", () => {
    expect(decodeLabel("x &lt; y &amp; z &#62; w &#x41;")).toBe("x < y & z > w A");
  });

  it("Strips formatting tags, and keeps angle brackets written as entities", () => {
    expect(decodeLabel("<b>Vec</b>&lt;int&gt;")).toBe("Vec<int>");
  });
});

describe("decodeLabel — generics are not tags", () => {
  it("List<Item> stays as is", () => {
    expect(decodeLabel("+ List<Item> items")).toBe("+ List<Item> items");
  });
});

describe("decodeLabel — any named entity", () => {
  it("#eacute;, #hellip; and #rarr; wrapped by mermaid become characters too", () => {
    expect(decodeLabel("cafﬂ°eacute¶ß ﬂ°hellip¶ß aﬂ°rarr¶ßb")).toBe("café … a→b");
  });

  it("An unknown name stays as written — no internal sentinel characters are left behind", () => {
    expect(decodeLabel("ﬂ°zzz¶ß")).toBe("&zzz;");
  });
});

describe("decodeLabel — secondary conversions", () => {
  it("Decodes two adjacent codes separately", () => {
    expect(decodeLabel("#35;#35;")).toBe("##");
  });

  it("#x41; is not decoded, as in Mermaid — Mermaid also draws it as &x41;. &#x41; is A", () => {
    expect(decodeLabel("#x41;")).toBe("&x41;");
    expect(decodeLabel("&#x41;")).toBe("A");
  });
});
