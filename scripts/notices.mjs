#!/usr/bin/env node
/**
 * Writes THIRD_PARTY_NOTICES.txt — the licenses of the npm packages and Rust
 * crates that ship inside the app. Their licenses ask for the copyright and
 * license text to travel with every copy, binaries included, so the file is
 * bundled into the app (tauri.conf.json `bundle.resources`) and published with
 * the source.
 *
 *   node scripts/notices.mjs           regenerate the file
 *   node scripts/notices.mjs --check   fail if the committed file is out of date
 *
 * Inputs are the installed node_modules (`pnpm licenses list --prod`) and the
 * cargo registry (`cargo metadata`), so run it after `pnpm install` and with the
 * crates fetched. The output is deterministic and carries no local paths.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** the platforms whose dependencies are bundled — the release builds */
export const TARGETS = ["aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-pc-windows-msvc"];

/**
 * Dev dependencies whose code still ends up in the bundle: Tailwind's base
 * styles are compiled into the app's CSS without a license banner.
 */
export const BUNDLED_DEV_PACKAGES = ["tailwindcss"];

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-_.].*)?$/i;

/** License, copying, and notice files directly in a package folder, sorted. */
export function licenseFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name) && statSync(join(dir, name)).isFile())
    .sort((a, b) => a.localeCompare(b, "en"));
}

const normalize = (text) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

/**
 * The texts a component is shipped under, one per license file, or a stand-in
 * naming the license when the package ships none.
 */
export function licenseTexts(dir, license, author) {
  const files = licenseFiles(dir);
  if (files.length > 0) {
    return files.map((name) => normalize(readFileSync(join(dir, name), "utf8"))).filter(Boolean);
  }
  const by = author ? ` by ${author}` : "";
  return [
    `Licensed under ${license || "an unspecified license"}${by}. The package ships no license file.`,
  ];
}

/** npm packages from `pnpm licenses list --prod --json`, one entry per installed version. */
export function npmComponents(listing) {
  const out = [];
  for (const packages of Object.values(listing)) {
    for (const pkg of packages) {
      pkg.versions.forEach((version, i) => {
        out.push({
          name: pkg.name,
          version,
          license: pkg.license,
          url: pkg.homepage ?? "",
          dir: pkg.paths[i],
          author: typeof pkg.author === "string" ? pkg.author : pkg.author?.name,
        });
      });
    }
  }
  return out;
}

/**
 * Crates linked into the app: reachable from the workspace through normal
 * dependencies. Dev and build dependencies and proc-macros run only at compile
 * time, so they are not shipped.
 */
export function shippedCrates(metadata) {
  const packages = new Map(metadata.packages.map((p) => [p.id, p]));
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const members = new Set(metadata.workspace_members);
  const seen = new Set();
  const stack = [...members];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (!dep.dep_kinds.some((k) => k.kind === null)) continue;
      const pkg = packages.get(dep.pkg);
      if (!pkg || pkg.targets.some((t) => t.kind.includes("proc-macro"))) continue;
      stack.push(dep.pkg);
    }
  }
  return [...seen]
    .filter((id) => !members.has(id))
    .map((id) => packages.get(id))
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license ?? "",
      url: p.repository ?? p.homepage ?? "",
      dir: dirname(p.manifest_path),
      author: p.authors?.[0],
    }));
}

const RULE = "=".repeat(80);
const THIN = "-".repeat(80);
const byName = (a, b) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
  a.version.localeCompare(b.version, "en", { numeric: true });

/**
 * The notices file. Each distinct license text appears once, under every
 * component that ships it — the Apache and MIT texts most crates share are not
 * repeated hundreds of times.
 */
export function render(components) {
  const groups = new Map();
  // texts that differ only in line wrapping or indentation are the same license
  const key = (text) => text.replace(/\s+/g, " ");
  for (const c of [...components].sort(byName)) {
    for (const text of licenseTexts(c.dir, c.license, c.author)) {
      const group = groups.get(key(text)) ?? { text, members: [] };
      group.members.push(c);
      groups.set(key(text), group);
    }
  }
  const ordered = [...groups.values()]
    .map((g) => ({ ...g, members: [...g.members].sort(byName) }))
    .sort((a, b) => byName(a.members[0], b.members[0]));

  const lines = [
    "THIRD-PARTY SOFTWARE NOTICES",
    "",
    "Dosik includes the third-party software listed below. Each component is",
    "distributed under its own license, reproduced here.",
    "",
    "This file is generated by scripts/notices.mjs.",
  ];
  for (const group of ordered) {
    lines.push("", RULE);
    for (const c of group.members) {
      const kind = c.ecosystem === "crate" ? "Rust crate" : "npm";
      const license = c.license ? ` — ${c.license}` : "";
      const url = c.url ? `  ${c.url}` : "";
      lines.push(`${c.name} ${c.version} (${kind})${license}${url}`);
    }
    lines.push(THIN, "", group.text);
  }
  return `${lines.join("\n")}\n`;
}

/** Same component listed twice (two cargo platforms, say) counts once. */
export function dedupe(components) {
  const seen = new Map();
  for (const c of components) seen.set(`${c.ecosystem}:${c.name}@${c.version}`, c);
  return [...seen.values()];
}

function collect(root) {
  const listing = JSON.parse(
    execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 << 20,
    }),
  );
  const bundledDev = BUNDLED_DEV_PACKAGES.map((name) => {
    const dir = realpathSync(join(root, "node_modules", name));
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return {
      name,
      version: manifest.version,
      license: manifest.license ?? "",
      url: manifest.homepage ?? "",
      dir,
    };
  });
  const npm = [...npmComponents(listing), ...bundledDev].map((c) => ({ ...c, ecosystem: "npm" }));
  const crates = TARGETS.flatMap((target) => {
    const metadata = JSON.parse(
      execFileSync(
        "cargo",
        ["metadata", "--format-version", "1", "--locked", "--filter-platform", target],
        { cwd: join(root, "src-tauri"), encoding: "utf8", maxBuffer: 256 << 20 },
      ),
    );
    return shippedCrates(metadata).map((c) => ({ ...c, ecosystem: "crate" }));
  });
  return dedupe([...npm, ...crates]);
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const file = join(root, "THIRD_PARTY_NOTICES.txt");
  const notices = render(collect(root));
  if (process.argv.includes("--check")) {
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (current !== notices) {
      console.error("THIRD_PARTY_NOTICES.txt is out of date — run `pnpm notices` and commit it.");
      process.exit(1);
    }
    console.log("THIRD_PARTY_NOTICES.txt is up to date.");
    return;
  }
  writeFileSync(file, notices);
  console.log(`wrote THIRD_PARTY_NOTICES.txt (${notices.length} bytes)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
