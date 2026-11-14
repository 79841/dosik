import mermaid from "mermaid";
import { beforeAll, describe, expect, it } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { toMermaid } from "../markdown";

/**
 * Substring assertions can't see the failures that matter most here. Mermaid
 * accepts a malformed label and quietly keeps only the part before the bad
 * character, so an export can look right, parse "fine", and still have lost
 * half its text. Bugs of exactly that shape turned up in #25.
 *
 * These run the real parser, so a new escaping hole fails the build.
 */
const body = (doc: Parameters<typeof toMermaid>[0]): string =>
  toMermaid(doc)
    .replace(/^```mermaid\n/, "")
    .replace(/\n```$/, "");

const lifeline = (id: string, x: number, extra: Record<string, unknown> = {}) => {
  const n = makeNode({
    id,
    label: id.toUpperCase(),
    shape: "lifeline",
    x,
    y: 0,
    width: 120,
    height: 360,
  });
  n.data = { ...n.data, ...extra };
  return n;
};

const msg = (id: string, source: string, target: string, pct: number, label?: string) => {
  const e = makeEdge({ id, source, target, label: label ?? id });
  return { ...e, sourceHandle: `right-${pct}`, targetHandle: `left-${pct}` };
};

/**
 * Mermaid keeps a numeric entity as an internal sentinel between parse and
 * render (`#60;` -> `\uFB02\u00B0\u00B060\u00B6\u00DF`). Decoding both forms is how a test can
 * tell "escaped and intact" from "escaped and truncated".
 */
const decodeEntities = (text: string): string =>
  text
    .replace(/\uFB02\u00B0\u00B0(\d+)\u00B6\u00DF/g, (_m, code) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));

describe("Checked with the real mermaid parser", () => {
  beforeAll(() => {
    mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
  });

  const parses = async (doc: Parameters<typeof toMermaid>[0]): Promise<boolean> =>
    Boolean(await mermaid.parse(body(doc)));

  it("A plain sequence parses", async () => {
    await expect(
      parses(makeDoc([lifeline("a", 0), lifeline("b", 200)], [msg("m", "a", "b", 50)])),
    ).resolves.toBe(true);
  });

  it.each([
    ["semicolon", "save; verify"],
    ["hash", "C# rocks"],
    ["hash and semicolon", "step #1; done"],
    ["init directive", 'x %%{init: {"theme":"dark"}}%% y'],
    ["quotes and colon", 'he said "go": now'],
  ])("A %s in a label does not break parsing", async (_name, label) => {
    await expect(
      parses(makeDoc([lifeline("a", 0), lifeline("b", 200)], [msg("m", "a", "b", 50, label)])),
    ).resolves.toBe(true);
  });

  it.each(["end", "loop", "note", "links", "over", "sequenceDiagram", "participant", "destroy"])(
    "Parses with the reserved-word id '%s' too",
    async (id) => {
      await expect(
        parses(makeDoc([lifeline(id, 0), lifeline("b", 200)], [msg("m", id, "b", 50)])),
      ).resolves.toBe(true);
    },
  );

  it("Label text survives escaping", async () => {
    // Parsing alone is not enough — mermaid also accepts a truncated label
    const out = body(
      makeDoc([lifeline("a", 0), lifeline("b", 200)], [msg("m", "a", "b", 50, "step #1; done")]),
    );
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(out);
    const texts = (diagram.db as unknown as { getMessages: () => { message: string }[] })
      .getMessages()
      .map((m) => m.message);

    expect(texts.join(" ")).toContain("done");
  });

  it.each([
    ["generics", "Vec<int>"],
    ["nested angle brackets", "Map<String, List<int>>"],
    ["a lone opening angle bracket", "a < b"],
  ])("Sequence label — %s survives as text", async (_name, label) => {
    const out = body(
      makeDoc([lifeline("a", 0), lifeline("b", 200)], [msg("m", "a", "b", 50, label)]),
    );
    expect(out).not.toContain(`${label}`); // carried verbatim, the renderer would swallow it as a tag
    await expect(mermaid.parse(out)).resolves.toBeTruthy();
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(out);
    const texts = (diagram.db as unknown as { getMessages: () => { message: string }[] })
      .getMessages()
      .map((m) => m.message);
    // mermaid swaps `#60;` for its own sentinel and turns it back at render time.
    // Turned back, it must equal the original — meaning not a single character was cut off
    expect(decodeEntities(texts.join(" "))).toBe(label);
  });

  it("Angle brackets in flowchart labels are escaped too (#52)", async () => {
    const out = body(
      makeDoc(
        [makeNode({ id: "a", label: "Vec<int>" }), makeNode({ id: "b", label: "B", x: 300 })],
        [makeEdge({ id: "e", source: "a", target: "b", label: "x > y" })],
      ),
    );
    expect(out).toContain("Vec#60;int#62;");
    expect(out).toContain("x #62; y");
    await expect(mermaid.parse(out)).resolves.toBeTruthy();
  });

  it("A line break goes out as <br/> the same way on both paths (#52)", async () => {
    const flow = body(
      makeDoc(
        [makeNode({ id: "a", label: "first\nsecond" }), makeNode({ id: "b", label: "B", x: 300 })],
        [makeEdge({ id: "e", source: "a", target: "b" })],
      ),
    );
    const seq = body(
      makeDoc([lifeline("a", 0), lifeline("b", 200)], [msg("m", "a", "b", 50, "first\nsecond")]),
    );
    expect(flow).toContain("first<br/>second");
    expect(seq).toContain("first<br/>second");
    await expect(mermaid.parse(flow)).resolves.toBeTruthy();
    await expect(mermaid.parse(seq)).resolves.toBeTruthy();
  });

  it("The flowchart path does not break on reserved-word ids either", async () => {
    await expect(
      parses(
        makeDoc(
          [makeNode({ id: "end", label: "End" }), makeNode({ id: "b", label: "B" })],
          [makeEdge({ id: "e", source: "end", target: "b" })],
        ),
      ),
    ).resolves.toBe(true);
  });

  it.each(["o", "x"])(
    "An id '%s' that matches a line end symbol also parses — classDiagram·flowchart (#200 round-trip test)",
    async (id) => {
      const cls = (nid: string) => makeNode({ id: nid, label: nid.toUpperCase(), shape: "class" });
      await expect(
        parses(makeDoc([cls(id), cls("b")], [makeEdge({ id: "e", source: id, target: "b" })])),
      ).resolves.toBe(true);
      await expect(
        parses(
          makeDoc(
            [makeNode({ id: "a" }), makeNode({ id })],
            [makeEdge({ id: "e", source: "a", target: id })],
          ),
        ),
      ).resolves.toBe(true);
    },
  );

  it("An ERD parses as erDiagram, and relationships and columns survive (#5)", async () => {
    const entity = (id: string, label: string, columns: string[]) => {
      const n = makeNode({ id, label, shape: "entity" });
      return { ...n, data: { ...n.data, columns } };
    };
    const rel = (id: string, s: string, t: string, start: string, end: string, label?: string) => {
      const e = makeEdge({ id, source: s, target: t, label });
      return { ...e, data: { ...e.data!, markerStart: start as never, markerEnd: end as never } };
    };
    const doc = makeDoc(
      [
        entity("customer", "Customer Account", ["id uuid PK", "email varchar(255) UK"]),
        entity("order", "Order", [
          "id uuid PK",
          "customer_id uuid FK",
          "placed_at timestamp with time zone",
        ]),
        entity("line", "Line item", ["order_id uuid PK,FK", "qty int"]),
      ],
      [
        rel("r1", "customer", "order", "one", "zero-many", 'places "online"'),
        rel("r2", "order", "line", "one", "one-many"),
      ],
    );
    const out = body(doc);
    await expect(mermaid.parse(out)).resolves.toBeTruthy();
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(out);
    const db = diagram.db as unknown as {
      getRelationships: () => unknown[];
      getEntities: () => Map<string, { alias: string; attributes: { name: string }[] }>;
    };
    expect(db.getRelationships()).toHaveLength(2);
    const entities = [...db.getEntities().values()];
    expect(entities.map((e) => e.alias)).toEqual(expect.arrayContaining(["Customer Account"]));
    expect(entities.flatMap((e) => e.attributes.map((a) => a.name))).toEqual(
      expect.arrayContaining(["customer_id", "placed_at", "order_id"]),
    );
  });

  describe("erDiagram does not break — labels, columns, ids (#156)", () => {
    const entity = (id: string, label: string, columns: string[] = []) => {
      const n = makeNode({ id, label, shape: "entity" });
      return { ...n, data: { ...n.data, columns } };
    };
    const rel = (id: string, s: string, t: string, label?: string, variant?: string) => {
      const e = makeEdge({ id, source: s, target: t, label });
      return {
        ...e,
        data: {
          ...e.data!,
          markerStart: "one" as never,
          markerEnd: "zero-many" as never,
          ...(variant ? { variant: variant as never } : {}),
        },
      };
    };
    const erDb = async (out: string) => {
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(out);
      return diagram.db as unknown as {
        getRelationships: () => { roleA: string; relSpec: { relType: string } }[];
        getEntities: () => Map<
          string,
          { alias: string; attributes: { name: string; type: string; keys: string[] }[] }
        >;
      };
    };

    it.each(["100% done", "a %% b", "a\\b", '"""', 'He said "go"', "C# rocks; ok", ""])(
      "Label %j",
      async (label) => {
        const out = body(
          makeDoc([entity("a", label || "x"), entity("b", "B")], [rel("r", "a", "b", label)]),
        );
        await expect(mermaid.parse(out)).resolves.toBeTruthy();
        const db = await erDb(out);
        if (label) {
          const alias = [...db.getEntities().values()].find((e) => e.alias !== "B")?.alias ?? "";
          expect(decodeEntities(alias)).toBe(label);
          expect(decodeEntities(db.getRelationships()[0]?.roleA ?? "")).toBe(label);
        }
      },
    );

    it("Even when column names are pk·fk·uk — they don't collide with the key tokens", async () => {
      const out = body(makeDoc([entity("a", "A", ["pk int", "FK int PK", "uk boolean"])], []));
      await expect(mermaid.parse(out)).resolves.toBeTruthy();
      const [a] = [...(await erDb(out)).getEntities().values()];
      expect(a?.attributes.map((x) => x.name.toLowerCase())).toEqual(["pk_", "fk_", "uk_"]);
      expect(a?.attributes[1]?.keys).toEqual(["PK"]);
    });

    it("Korean column names and types survive", async () => {
      const out = body(
        makeDoc(
          [entity("a", "고객", ["고객번호 정수 PK", "이름 문자열", "주소 varchar(255)"])],
          [],
        ),
      );
      await expect(mermaid.parse(out)).resolves.toBeTruthy();
      const [a] = [...(await erDb(out)).getEntities().values()];
      expect(a?.attributes.map((x) => [x.type, x.name])).toEqual([
        ["정수", "고객번호"],
        ["문자열", "이름"],
        ["varchar(255)", "주소"],
      ]);
    });

    it("Unusable symbols are dropped, and a default is used when nothing is left", async () => {
      const out = body(makeDoc([entity("a", "A", ["col$name int", "$$$ %%%"])], []));
      await expect(mermaid.parse(out)).resolves.toBeTruthy();
      const [a] = [...(await erDb(out)).getEntities().values()];
      expect(a?.attributes.map((x) => [x.type, x.name])).toEqual([
        ["int", "colname"],
        ["string", "column"],
      ]);
    });

    it("Names and types that start with a digit or symbol too — common columns like 2fa_enabled (#156)", async () => {
      const out = body(
        makeDoc(
          [
            entity("a", "A", [
              "2fa_enabled boolean",
              "3ds_status varchar(10)",
              "amount (decimal)",
              "x pk PK",
              "half ½",
              "-x .y",
            ]),
          ],
          [],
        ),
      );
      await expect(mermaid.parse(out)).resolves.toBeTruthy();
      const [a] = [...(await erDb(out)).getEntities().values()];
      expect(a?.attributes.map((x) => [x.type, x.name])).toEqual([
        ["boolean", "_2fa_enabled"],
        ["varchar(10)", "_3ds_status"],
        ["_(decimal)", "amount"],
        ["pk_", "x"],
        ["string", "half"],
        ["_.y", "_-x"],
      ]);
    });

    it("Even when the id is erDiagram", async () => {
      const out = body(
        makeDoc([entity("erDiagram", "E"), entity("b", "B")], [rel("r", "erDiagram", "b")]),
      );
      await expect(mermaid.parse(out)).resolves.toBeTruthy();
    });

    it("Every non-solid relationship line becomes dotted (non-identifying) — not just dashed", async () => {
      for (const variant of ["dashed", "dotted", "dashdot"]) {
        const out = body(
          makeDoc([entity("a", "A"), entity("b", "B")], [rel("r", "a", "b", "", variant)]),
        );
        const [r] = (await erDb(out)).getRelationships();
        expect(r?.relSpec.relType).toBe("NON_IDENTIFYING");
      }
    });
  });
});
