import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { writeAtomic } from "../writeAtomic";

const scratch = () => mkdtempSync(join(tmpdir(), "dosik-atomic-"));

describe("writeAtomic — how user files are written (#151)", () => {
  it("Writes a new file and leaves no temp file behind", () => {
    const dir = scratch();
    writeAtomic(join(dir, "a.dosik.json"), "{}");
    expect(readdirSync(dir)).toEqual(["a.dosik.json"]);
  });

  it("Keeps an existing file's permissions — 600 does not widen to 644", () => {
    const dir = scratch();
    const path = join(dir, "a.dosik.json");
    writeFileSync(path, "old");
    chmodSync(path, 0o600);
    writeAtomic(path, "new");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe("new");
  });

  it("Does not overwrite a file locked read-only — rename ignores file permissions", () => {
    const dir = scratch();
    const path = join(dir, "a.dosik.json");
    writeFileSync(path, "locked");
    chmodSync(path, 0o444);
    expect(() => writeAtomic(path, "new")).toThrow(/EACCES|read-only|permission/i);
    expect(readFileSync(path, "utf8")).toBe("locked");
    expect(readdirSync(dir)).toEqual(["a.dosik.json"]);
  });

  it("The failure message names the requested path, not the temp file", () => {
    const dir = scratch();
    const path = join(dir, "missing", "a.dosik.json");
    expect(() => writeAtomic(path, "x")).toThrow(path);
    try {
      writeAtomic(path, "x");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(".tmp");
    }
    expect(existsSync(join(dir, "missing"))).toBe(false);
  });
});
