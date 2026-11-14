import { readFileSync } from "node:fs";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DEFAULT_ICON, ICON_IDS, ICON_LABELS, isIconId } from "../iconIds";
import { ICON_PATHS, IconGlyph } from "../icons";

describe("icon registry (#9)", () => {
  it("every id has a label and a non-empty path", () => {
    expect(ICON_IDS.length).toBeGreaterThanOrEqual(58);
    expect(new Set(ICON_IDS).size).toBe(ICON_IDS.length);
    for (const id of ICON_IDS) {
      expect(ICON_LABELS[id]).toBeTruthy();
      expect(ICON_PATHS[id].length).toBeGreaterThan(0);
      for (const d of ICON_PATHS[id]) expect(d).toMatch(/^M/);
    }
    expect(isIconId(DEFAULT_ICON)).toBe(true);
    expect(isIconId("aws-s3")).toBe(false);
  });

  it("the bridge's advertised list, the openapi enum, and the protocol doc match the registry — no drift", () => {
    const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
    const rust = read("../../../../src-tauri/src/bridge.rs").match(/"icons": \[([^\]]*)\]/)?.[1];
    expect(rust?.split(",").map((s) => s.trim().replace(/"/g, ""))).toEqual([...ICON_IDS]);
    const yaml = read("../../../../docs/openapi.yaml");
    const enumLine = yaml.split("\n").find((l) => l.includes("enum: [database, server"));
    expect(
      enumLine
        ?.match(/\[(.*)\]/)?.[1]
        .split(",")
        .map((s) => s.trim()),
    ).toEqual([...ICON_IDS]);
    const protocol = read("../../../../docs/AGENT_PROTOCOL.md");
    for (const id of ICON_IDS) expect(protocol).toContain(`\`${id}\``);
  });

  it("IconGlyph draws the path for known ids and a placeholder for unknown ids", () => {
    const known = render(
      <svg>
        <IconGlyph icon="database" size={48} color="#000" />
      </svg>,
    ).container;
    expect(known.querySelectorAll("path")).toHaveLength(ICON_PATHS.database.length);
    const unknown = render(
      <svg>
        <IconGlyph icon="nope" size={48} color="#000" />
      </svg>,
    ).container;
    expect(unknown.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(unknown.querySelector("g")?.getAttribute("transform")).toContain("scale(2)");
  });
});

describe("Glyph stroke width inside diagrams (#204)", () => {
  const strokeOf = (el: Element) => Number(el.querySelector("g")!.getAttribute("stroke-width"));
  const glyph = (size: number, strokePx?: number) =>
    render(
      <svg>
        <IconGlyph icon="database" size={size} color="#000" strokePx={strokePx} />
      </svg>,
    ).container;

  it("with strokePx, the on-screen stroke is that width at any size", () => {
    // the 24-grid scales up with size, so the grid value must be inversely proportional to size
    expect(strokeOf(glyph(40, 1)) * (40 / 24)).toBeCloseTo(1, 6);
    expect(strokeOf(glyph(12, 1)) * (12 / 24)).toBeCloseTo(1, 6);
  });

  it("without it, keeps the app UI grid stroke width", () => {
    expect(strokeOf(glyph(20))).toBe(1.25);
  });
});
