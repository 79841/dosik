/**
 * Mermaid source split into tokens for the preview's code view (#198). Not a
 * parser — enough to tell keywords, arrows, strings, labels and comments
 * apart at a glance, for the four diagram kinds the exports write. Joining a
 * line's tokens gives the line back exactly.
 */
export type TokenKind =
  | "keyword"
  | "arrow"
  | "string"
  | "label"
  | "comment"
  | "annotation"
  | "punct"
  | "plain";

export interface Token {
  kind: TokenKind;
  text: string;
}

/** words that start a statement — a keyword only at the head of a line */
const KEYWORDS = [
  "flowchart",
  "graph",
  "classDiagram",
  "sequenceDiagram",
  "erDiagram",
  "subgraph",
  "end",
  "direction",
  "class",
  "style",
  "classDef",
  "linkStyle",
  "participant",
  "actor",
  "note",
  "loop",
  "alt",
  "else",
  "opt",
  "par",
  "and",
  "rect",
  "critical",
  "break",
  "activate",
  "deactivate",
  "autonumber",
];

/** a direction, as the word after a diagram keyword or `direction` */
const DIRECTION = /\b(?:TB|TD|BT|LR|RL)\b/y;
const TAKES_DIRECTION = new Set(["flowchart", "graph", "direction"]);

/** in order: the first rule that matches at a position wins */
const RULES: [TokenKind, RegExp][] = [
  ["string", /"(?:[^"\\]|\\.)*"/y],
  ["annotation", /<<[^>\n]*>>/y],
  // erDiagram cardinalities: ||--o{, }|..|| and the like
  ["arrow", /(?:\|\||\|o|o\||\}o|\}\||\{o|\{\|)(?:--|\.\.)(?:\|\||o\||\|o|o\{|\|\{|\}o|\}\|)/y],
  // flowchart, classDiagram and sequence links; a lone "-" (a member's
  // visibility mark) is not one
  [
    "arrow",
    /(?:<\|?|[*o])?(?:-->>|->>|--x|-->|-\.->|-\.-|==>|===|---|--|\.\.>|\.\.)(?:\|>|>|[*o](?![\w]))?/y,
  ],
  ["label", /\|[^|\n]*\|/y],
  ["punct", /[[\]{}()]/y],
];

const KEYWORD = new RegExp(`\\b(?:${KEYWORDS.join("|")})\\b`, "y");

/** what follows a link's colon is its name (`a --> b : uses`, `a->>b: hello`) */
const LINK_LABEL = /:.*$/y;

const tokenizeLine = (line: string): Token[] => {
  const comment = line.match(/^(\s*)(%%.*)$/);
  if (comment) {
    return [
      ...(comment[1] ? [{ kind: "plain" as const, text: comment[1] }] : []),
      { kind: "comment", text: comment[2]! },
    ];
  }
  const out: Token[] = [];
  let plain = "";
  let afterLink = false;
  /** the previous keyword, while only keywords and spaces have come before */
  let lead: string | null = null;
  let atHead = true;
  const flush = () => {
    if (plain) out.push({ kind: "plain", text: plain });
    plain = "";
  };
  let i = 0;
  while (i < line.length) {
    let matched: Token | null = null;
    if (afterLink && line[i] === ":") {
      LINK_LABEL.lastIndex = i;
      const m = LINK_LABEL.exec(line);
      if (m) matched = { kind: "label", text: m[0] };
    }
    if (!matched && atHead) {
      KEYWORD.lastIndex = i;
      const m = KEYWORD.exec(line);
      if (m) {
        matched = { kind: "keyword", text: m[0] };
        lead = m[0];
      } else if (lead && TAKES_DIRECTION.has(lead)) {
        DIRECTION.lastIndex = i;
        const d = DIRECTION.exec(line);
        if (d) matched = { kind: "keyword", text: d[0] };
      }
    }
    for (const [kind, rule] of matched ? [] : RULES) {
      rule.lastIndex = i;
      const m = rule.exec(line);
      if (m?.[0]) {
        matched = { kind, text: m[0] };
        break;
      }
    }
    if (!matched) {
      // past the first word that is not a keyword, the rest is the user's
      if (line[i] !== " " && line[i] !== "\t") atHead = false;
      plain += line[i];
      i += 1;
      continue;
    }
    if (matched.kind !== "keyword") atHead = false;
    flush();
    out.push(matched);
    if (matched.kind === "arrow") afterLink = true;
    i += matched.text.length;
  }
  flush();
  return out;
};

/** each line of `code` as tokens */
export const highlightMermaid = (code: string): Token[][] => code.split("\n").map(tokenizeLine);
