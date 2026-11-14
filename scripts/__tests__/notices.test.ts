import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dedupe,
  licenseFiles,
  licenseTexts,
  npmComponents,
  render,
  shippedCrates,
} from "../notices.mjs";

function pkgDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "notices-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe("licenseFiles", () => {
  it("finds license, licence, copying, and notice files in any case, sorted", () => {
    const dir = pkgDir({
      "LICENSE-MIT": "m",
      "license-apache": "a",
      "LICENCE.txt": "l",
      COPYING: "c",
      NOTICE: "n",
      "README.md": "r",
      "licensing.rs": "x",
    });
    expect(licenseFiles(dir)).toEqual([
      "COPYING",
      "LICENCE.txt",
      "license-apache",
      "LICENSE-MIT",
      "NOTICE",
    ]);
  });

  it("skips folders named like license files", () => {
    const dir = pkgDir({ LICENSE: "x" });
    mkdirSync(join(dir, "licenses"));
    expect(licenseFiles(dir)).toEqual(["LICENSE"]);
  });

  it("returns nothing for a missing folder", () => {
    expect(licenseFiles(join(tmpdir(), "no-such-package-folder"))).toEqual([]);
  });
});

describe("licenseTexts", () => {
  it("returns each file's text with line endings and trailing spaces normalized", () => {
    const dir = pkgDir({ "LICENSE-A": "first  \r\nline\r\n\r\n", "LICENSE-B": "second\n" });
    expect(licenseTexts(dir, "MIT", undefined)).toEqual(["first\nline", "second"]);
  });

  it("names the license and author when the package ships no file", () => {
    const dir = pkgDir({});
    expect(licenseTexts(dir, "MIT", "Jane Doe")).toEqual([
      "Licensed under MIT by Jane Doe. The package ships no license file.",
    ]);
  });
});

describe("npmComponents", () => {
  it("lists every installed version with its own folder", () => {
    const listing = {
      MIT: [
        {
          name: "left-pad",
          versions: ["1.0.0", "1.3.0"],
          paths: ["/x/left-pad@1.0.0", "/x/left-pad@1.3.0"],
          license: "MIT",
          author: { name: "Someone" },
          homepage: "https://example.com",
        },
      ],
    };
    expect(npmComponents(listing)).toEqual([
      {
        name: "left-pad",
        version: "1.0.0",
        license: "MIT",
        url: "https://example.com",
        dir: "/x/left-pad@1.0.0",
        author: "Someone",
      },
      {
        name: "left-pad",
        version: "1.3.0",
        license: "MIT",
        url: "https://example.com",
        dir: "/x/left-pad@1.3.0",
        author: "Someone",
      },
    ]);
  });
});

describe("shippedCrates", () => {
  const pkg = (id: string, kind = "lib") => ({
    id,
    name: id,
    version: "1.0.0",
    license: "MIT",
    repository: `https://example.com/${id}`,
    manifest_path: `/registry/${id}/Cargo.toml`,
    targets: [{ kind: [kind] }],
  });
  const dep = (pkgId: string, kind: string | null) => ({
    pkg: pkgId,
    dep_kinds: [{ kind, target: null }],
  });
  const metadata = {
    workspace_members: ["app"],
    packages: [
      pkg("app"),
      pkg("serde"),
      pkg("itoa"),
      pkg("derive", "proc-macro"),
      pkg("syn"),
      pkg("tempfile"),
      pkg("cc"),
    ],
    resolve: {
      nodes: [
        {
          id: "app",
          deps: [
            dep("serde", null),
            dep("derive", null),
            dep("tempfile", "dev"),
            dep("cc", "build"),
          ],
        },
        { id: "serde", deps: [dep("itoa", null)] },
        { id: "derive", deps: [dep("syn", null)] },
        { id: "itoa", deps: [] },
        { id: "syn", deps: [] },
        { id: "tempfile", deps: [] },
        { id: "cc", deps: [] },
      ],
    },
  };

  it("follows normal dependencies only, skipping proc-macros, dev, and build dependencies", () => {
    const names = shippedCrates(metadata)
      .map((c: { name: string }) => c.name)
      .sort();
    expect(names).toEqual(["itoa", "serde"]);
  });

  it("leaves out the workspace itself and keeps the crate's folder and repository", () => {
    const serde = shippedCrates(metadata).find((c: { name: string }) => c.name === "serde");
    expect(serde).toMatchObject({
      dir: "/registry/serde",
      url: "https://example.com/serde",
      license: "MIT",
    });
    expect(shippedCrates(metadata).some((c: { name: string }) => c.name === "app")).toBe(false);
  });
});

describe("render", () => {
  const mit = "MIT License\n\nCopyright (c) Someone";
  const apache = "Apache License\nVersion 2.0";

  it("prints each distinct license text once, under every component that ships it", () => {
    const a = pkgDir({ "LICENSE-MIT": mit, "LICENSE-APACHE": apache });
    const b = pkgDir({ "LICENSE-APACHE": "Apache License\n    Version 2.0" });
    const out = render([
      {
        name: "beta",
        version: "2.0.0",
        license: "Apache-2.0",
        url: "",
        dir: b,
        ecosystem: "crate",
      },
      {
        name: "alpha",
        version: "1.0.0",
        license: "MIT OR Apache-2.0",
        url: "https://a",
        dir: a,
        ecosystem: "npm",
      },
    ]);
    expect(out.match(/Apache License/g)).toHaveLength(1);
    expect(out.match(/MIT License/g)).toHaveLength(1);
    expect(out).toContain(
      "alpha 1.0.0 (npm) — MIT OR Apache-2.0  https://a\nbeta 2.0.0 (Rust crate) — Apache-2.0",
    );
  });

  it("is the same whatever order the components come in", () => {
    const a = pkgDir({ LICENSE: mit });
    const b = pkgDir({ LICENSE: apache });
    const list = [
      { name: "zeta", version: "1.0.0", license: "MIT", url: "", dir: a, ecosystem: "npm" },
      {
        name: "Alpha",
        version: "1.0.0",
        license: "Apache-2.0",
        url: "",
        dir: b,
        ecosystem: "crate",
      },
    ];
    expect(render(list)).toBe(render([...list].reverse()));
    expect(render(list).indexOf("Alpha")).toBeLessThan(render(list).indexOf("zeta"));
  });

  it("never prints the folders it read from", () => {
    const dir = pkgDir({ LICENSE: mit });
    const out = render([
      { name: "x", version: "1.0.0", license: "MIT", url: "", dir, ecosystem: "npm" },
    ]);
    expect(out).not.toContain(dir);
    expect(out).not.toContain(tmpdir());
  });
});

describe("dedupe", () => {
  it("keeps one entry per ecosystem, name, and version", () => {
    const c = {
      name: "libc",
      version: "0.2.0",
      license: "MIT",
      url: "",
      dir: "/r/libc",
      ecosystem: "crate",
    };
    expect(
      dedupe([c, { ...c }, { ...c, version: "0.2.1" }, { ...c, ecosystem: "npm" }]),
    ).toHaveLength(3);
  });
});
