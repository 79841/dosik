import { describe, expect, it } from "vitest";
import {
  checkFiles,
  checkMessages,
  homeNames,
  markerPattern,
  parseArgs,
  parseList,
} from "../check-public.mjs";

// Strings that the checker refuses are built from pieces, so this file passes it.
const KOREAN = "\uD55C\uAE00";
const AGENT_FILE = `${"CLAUDE"}.md`;

function file(path: string, text: string, mode = "100644") {
  return { path, mode, content: Buffer.from(text, "utf8") };
}

describe("checkFiles", () => {
  it("passes an ordinary English source file", () => {
    expect(checkFiles([file("src/a.ts", "export const a = 1; // a comment\n")])).toEqual([]);
  });

  it("refuses tracked local-only folders", () => {
    const problems = checkFiles([file(".workbench/notes.md", "x"), file(".worktrees/x/a.ts", "x")]);
    expect(problems).toEqual([
      ".workbench/notes.md: local-only folder is tracked",
      ".worktrees/x/a.ts: local-only folder is tracked",
    ]);
  });

  it("refuses agent instruction, settings and OS files", () => {
    const paths = [
      AGENT_FILE,
      "docs/AGENTS.md",
      ".claude/settings.json",
      "a/.DS_Store",
      ".mcp.json",
    ];
    const problems = checkFiles(paths.map((p) => file(p, "")));
    expect(problems).toHaveLength(paths.length);
    for (const p of problems) expect(p).toMatch(/agent or OS file$/);
  });

  it("refuses symlinks", () => {
    expect(checkFiles([file("link", "target", "120000")])).toEqual(["link: symlink"]);
  });

  it("refuses private links and the agent file's name in content", () => {
    expect(checkFiles([file("a.md", `see https://claude${".ai"}/artifact/abc`)])).toEqual([
      "a.md: private link or agent file name",
    ]);
    expect(checkFiles([file("b.md", `read ${AGENT_FILE} first`)])).toEqual([
      "b.md: private link or agent file name",
    ]);
  });

  it("refuses secret-shaped strings, also in binary files", () => {
    const key = `sk-${"ant"}-${"x".repeat(24)}`;
    expect(checkFiles([file("a.ts", `const k = "${key}";`)])).toEqual([
      "a.ts: secret-shaped string",
    ]);
    const binary = {
      path: "b.bin",
      mode: "100644",
      content: Buffer.concat([Buffer.from([0]), Buffer.from(key)]),
    };
    expect(checkFiles([binary])).toEqual(["b.bin: secret-shaped string"]);
  });

  it("refuses temp and desktop paths", () => {
    expect(checkFiles([file("a.ts", `"/private${"/tmp"}/x"`)])).toEqual(["a.ts: local path"]);
    expect(checkFiles([file("b.ts", `"~/${"Desktop"}/x"`)])).toEqual(["b.ts: local path"]);
  });

  it("refuses real home folders but not the made-up ones tests use", () => {
    expect(checkFiles([file("a.ts", `"/Users/someone/x" "/Users/a/y"`)])).toEqual([]);
    expect(checkFiles([file("b.ts", `"/${"Users"}/jane/x"`)])).toEqual([
      "b.ts: local home folder (jane)",
    ]);
  });

  it("refuses extra markers case-insensitively and ignores ones too short to mean anything", () => {
    const files = [file("a.ts", "made on Jane-Laptop"), file("b.ts", "ab cd")];
    expect(checkFiles(files, { markers: ["jane-laptop", "ab"] })).toEqual(["a.ts: private marker"]);
  });

  it("refuses notes about reviews and decisions", () => {
    expect(checkFiles([file("a.ts", `// per the ${"user"}'s call`)])).toEqual([
      "a.ts: note about reviews or decisions",
    ]);
    expect(checkFiles([file("b.ts", `// fixed in ${"review"} 2 W1`)])).toEqual([
      "b.ts: note about reviews or decisions",
    ]);
    expect(checkFiles([file("c.ts", "// reviewed the ordering of these checks")])).toEqual([]);
  });

  it("allows Korean only in listed test files and flags list entries with none left", () => {
    const files = [
      file("src/a.test.ts", `const s = "${KOREAN}";`),
      file("src/b.ts", `// ${KOREAN}`),
    ];
    expect(checkFiles(files, { allowedHangul: ["src/a.test.ts", "src/gone.test.ts"] })).toEqual([
      "src/b.ts: Korean text (allowed only as test data)",
      "src/gone.test.ts: listed in scripts/hangul-allowed.txt but has no Korean — remove it",
    ]);
  });

  it("skips the Korean check for binary files", () => {
    const binary = {
      path: "a.png",
      mode: "100644",
      content: Buffer.concat([Buffer.from([0, 1]), Buffer.from(KOREAN)]),
    };
    expect(checkFiles([binary])).toEqual([]);
  });
});

describe("checkMessages", () => {
  const id = "0123456789abcdef";

  it("passes an English conventional message with a co-author line", () => {
    const message =
      "fix: keep shapes steady while autopanning\n\nCo-Authored-By: A <a@example.com>\n";
    expect(checkMessages([{ id, message }])).toEqual([]);
  });

  it("refuses Korean, issue numbers, workflow notes and markers", () => {
    expect(checkMessages([{ id, message: `fix: ${KOREAN}` }])).toEqual([
      "0123456: Korean in the commit message",
    ]);
    expect(checkMessages([{ id, message: "fix: tray menu (#213)" }])).toEqual([
      "0123456: issue number in the commit message",
    ]);
    expect(checkMessages([{ id, message: `docs: address ${"review"} round 2` }])).toEqual([
      "0123456: note about reviews or decisions",
    ]);
    expect(
      checkMessages([{ id, message: "chore: built on jane-laptop" }], { markers: ["Jane-Laptop"] }),
    ).toEqual(["0123456: private marker in the commit message"]);
  });

  it("allows a hash sign that is not an issue number", () => {
    expect(checkMessages([{ id, message: "fix: parse colors like #1f5fe0 and C#" }])).toEqual([]);
  });
});

describe("helpers", () => {
  it("parseList drops comments and blank lines", () => {
    expect(parseList("# note\n\na.ts\n  b.ts  \n")).toEqual(["a.ts", "b.ts"]);
  });

  it("homeNames reads POSIX, escaped and Windows homes", () => {
    const text = `/${"Users"}/jo/x \\/${"Users"}\\/kim\\/y C:\\${"Users"}\\lee\\z /home/u/w`;
    expect(homeNames(text).sort()).toEqual(["jo", "kim", "lee"]);
  });

  it("markerPattern escapes regex characters and returns null for no markers", () => {
    expect(markerPattern([])).toBeNull();
    expect(markerPattern(["a.b(c)"])?.test("x A.B(C) y")).toBe(true);
    expect(markerPattern(["a.b(c)"])?.test("aXb(c)")).toBe(false);
  });
});

describe("checkFiles — paths and decomposed Korean", () => {
  it("refuses an agent folder in any letter case", () => {
    expect(checkFiles([file(".Claude/settings.json", "{}")])).toEqual([
      ".Claude/settings.json: agent or OS file",
    ]);
  });

  it("refuses Korean and private markers in file paths", () => {
    const path = `docs/${String.fromCharCode(0xd55c)}.md`;
    expect(checkFiles([file(path, "x")])).toEqual([`${path}: Korean in the file path`]);
    expect(checkFiles([file("notes/jane-laptop.txt", "x")], { markers: ["Jane-Laptop"] })).toEqual([
      "notes/jane-laptop.txt: private marker in the file path",
    ]);
  });

  it("refuses decomposed (NFD) Korean, as macOS file names produce", () => {
    const nfd = String.fromCharCode(0x1112, 0x1161, 0x11ab);
    expect(checkFiles([file("a.ts", `// ${nfd}`)])).toEqual([
      "a.ts: Korean text (allowed only as test data)",
    ]);
  });
});

describe("parseArgs", () => {
  it("reads the known options", () => {
    expect(parseArgs([])).toEqual({});
    expect(parseArgs(["--rev", "HEAD", "--markers", "m.txt"])).toEqual({
      rev: "HEAD",
      markers: "m.txt",
    });
    expect(parseArgs(["--messages", "origin/main..HEAD"])).toEqual({
      messages: "origin/main..HEAD",
    });
  });

  it("refuses unknown arguments, missing values and both modes at once", () => {
    expect(parseArgs(["--rev=HEAD"])).toEqual({ error: "unknown argument: --rev=HEAD" });
    expect(parseArgs(["--message", "a..b"])).toEqual({ error: "unknown argument: --message" });
    expect(parseArgs(["--messages"])).toEqual({ error: "--messages needs a value" });
    expect(parseArgs(["--rev", "--markers", "m"])).toEqual({ error: "--rev needs a value" });
    expect(parseArgs(["--rev", "HEAD", "--messages", "a..b"])).toEqual({
      error: "use --rev or --messages, not both",
    });
  });
});
