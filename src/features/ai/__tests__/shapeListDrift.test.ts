import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PALETTE_COLORS, SHAPE_KINDS } from "../../../shared/lib/palette";
import { MARKER_SHAPES } from "../../../shared/lib/store/opValidation";
import { MARKER_OPTIONS } from "../../editbar/sections";
import { apiSystemPrompt, cliSystemPrompt } from "../systemPrompt";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * The shape list is mirrored in four places an agent reads: GET /api,
 * openapi.yaml, AGENT_PROTOCOL.md and the AI system prompt. The icon list had
 * a drift test; the shape list did not, and `image` reached only two (#155).
 */
describe("the shape list agents read follows SHAPE_KINDS (#155)", () => {
  it.each(SHAPE_KINDS)("%s", (kind) => {
    // the shape line itself — "image" is also an icon id, elsewhere in the prompt
    for (const prompt of [apiSystemPrompt(), cliSystemPrompt({ port: 4517, token: "t" })]) {
      const line = prompt.split("\n").find((l) => l.trim().startsWith("- shape:"));
      expect(
        line
          ?.split(":")[1]
          .split("|")
          .map((s) => s.trim()),
      ).toContain(kind);
    }
    const protocol = read("../../../../docs/AGENT_PROTOCOL.md");
    const shapeLine = protocol.split("\n").find((l) => l.startsWith("- `shape`:"));
    expect(shapeLine).toContain(`\`${kind}\``);
    const yaml = read("../../../../docs/openapi.yaml").split("\n");
    const at = yaml.findIndex((l) => l.trim() === "ShapeKind:");
    // ShapeKind's own enum, a few lines down — never a later schema's
    const enumLine = yaml.slice(at, at + 12).find((l) => l.trim().startsWith("enum:"));
    expect(enumLine).toMatch(new RegExp(`\\b${kind}\\b`));
    const rust = read("../../../../src-tauri/src/bridge.rs");
    const shapes = rust.split("\n").find((l) => l.includes('"shapes":'));
    expect(shapes).toContain(`"${kind}"`);
  });
});

describe("the line-end shape list follows one source too (#156)", () => {
  const sorted = (list: readonly string[]) => [...list].sort();

  it("openapi MarkerShape enum", () => {
    const yaml = read("../../../../docs/openapi.yaml").split("\n");
    const start = yaml.findIndex((l) => l.trim() === "MarkerShape:");
    const enumLine = yaml.slice(start, start + 5).find((l) => l.trim().startsWith("enum:"));
    const listed = enumLine
      ?.match(/\[(.*)\]/)?.[1]
      .split(",")
      .map((s) => s.trim());
    expect(sorted(listed ?? [])).toEqual(sorted(MARKER_SHAPES));
  });

  it("AGENT_PROTOCOL and the AI prompts", () => {
    const protocol = read("../../../../docs/AGENT_PROTOCOL.md");
    const inProtocol = protocol.match(/`markerStart`\/`markerEnd`: `([^`]*)`/)?.[1].split("|");
    expect(sorted(inProtocol ?? [])).toEqual(sorted(MARKER_SHAPES));
    for (const prompt of [apiSystemPrompt(), cliSystemPrompt({ port: 4517, token: "t" })]) {
      const line = prompt.match(/markerStart\/markerEnd: ([^,]*),/)?.[1].split("|");
      expect(sorted(line ?? [])).toEqual(sorted(MARKER_SHAPES));
    }
  });

  it("the list the inspector offers", () => {
    expect(sorted(MARKER_OPTIONS.map((o) => o.id))).toEqual(sorted(MARKER_SHAPES));
  });
});

describe("the color list follows PALETTE_COLORS too (#158)", () => {
  const sorted = (list: readonly string[]) => [...list].sort();

  it("openapi PaletteColor enum", () => {
    const yaml = read("../../../../docs/openapi.yaml").split("\n");
    const start = yaml.findIndex((l) => l.trim() === "PaletteColor:");
    const enumLine = yaml.slice(start, start + 8).find((l) => l.trim().startsWith("enum:"));
    const listed = enumLine
      ?.match(/\[(.*)\]/)?.[1]
      .split(",")
      .map((s) => s.trim());
    expect(sorted(listed ?? [])).toEqual(sorted(PALETTE_COLORS));
  });

  it("GET /api (bridge.rs)", () => {
    const rust = read("../../../../src-tauri/src/bridge.rs");
    const line = rust.split("\n").find((l) => l.includes('"colors":'));
    const listed = line
      ?.match(/\[(.*)\]/)?.[1]
      .split(",")
      .map((s) => s.trim().replace(/"/g, ""));
    expect(sorted(listed ?? [])).toEqual(sorted(PALETTE_COLORS));
  });

  it("AGENT_PROTOCOL and the AI prompts", () => {
    const protocol = read("../../../../docs/AGENT_PROTOCOL.md");
    const colorLine = protocol.split("\n").find((l) => l.startsWith("- `color`:"));
    const listPart = (colorLine ?? "").split("—")[0].replace("- `color`:", "");
    const inProtocol = [...listPart.matchAll(/`([a-z]+)`/g)].map((m) => m[1]);
    expect(sorted(inProtocol)).toEqual(sorted(PALETTE_COLORS));
    for (const prompt of [apiSystemPrompt(), cliSystemPrompt({ port: 4517, token: "t" })]) {
      const line = prompt.split("\n").find((l) => l.trim().startsWith("- color:"));
      const listed = line
        ?.split(":")[1]
        .split("—")[0]
        .split("|")
        .map((s) => s.trim());
      expect(sorted(listed ?? [])).toEqual(sorted(PALETTE_COLORS));
    }
  });
});

describe("add_node defaults are written in the schema too (#158)", () => {
  it("openapi NodeInput shape and color defaults are DEFAULT_SHAPE and DEFAULT_COLOR", async () => {
    const { DEFAULT_COLOR, DEFAULT_SHAPE } = await import("../../../shared/lib/store/nodeFactory");
    const yaml = read("../../../../docs/openapi.yaml").split("\n");
    const start = yaml.findIndex((l) => l.trim() === "NodeInput:");
    const block = yaml.slice(start, start + 12).join("\n");
    expect(block).toContain(
      `shape: { $ref: "#/components/schemas/ShapeKind", default: ${DEFAULT_SHAPE} }`,
    );
    expect(block).toContain(
      `color: { $ref: "#/components/schemas/PaletteColor", default: ${DEFAULT_COLOR} }`,
    );
  });
});

/** a diagram is one canvas (#229 D16): the chat's prompts say so and offer no page op or new_diagram */
describe("system prompts have no pages (#229 D16, T23)", () => {
  it.each([
    ["API", apiSystemPrompt()],
    ["CLI", cliSystemPrompt({ port: 4517, token: "t" })],
  ])("%s prompt", (_, prompt) => {
    for (const gone of ["add_page", "switch_page", "rename_page", "delete_page", "activePage"]) {
      expect(prompt).not.toContain(gone);
    }
    expect(prompt).not.toMatch(/^- Pages:/m);
    expect(prompt).not.toContain("new_diagram");
    expect(prompt).toContain("one canvas");
  });
});
