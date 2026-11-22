import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");

const config = JSON.parse(read("src-tauri/tauri.conf.json")) as {
  identifier: string;
  bundle: { fileAssociations?: Record<string, unknown>[] };
};

/**
 * The bundle declares `.dosik` as its own document (#253 D16) — what makes
 * Finder open a diagram in Dosik on a double-click and list it under Open
 * With. Only the bundle reads this; nothing but a test looks at it.
 */
describe("Dosik's document type (#253)", () => {
  const associations = config.bundle.fileAssociations ?? [];

  it("is `.dosik`, a JSON text Dosik edits and owns", () => {
    expect(associations).toHaveLength(1);
    expect(associations[0]).toMatchObject({
      ext: ["dosik"],
      name: "Dosik Diagram",
      role: "Editor",
      rank: "Owner",
      // a type of its own: on Linux the `.desktop` entry would else claim every JSON file
      mimeType: "application/vnd.dosik+json",
    });
  });

  it("exports its own type, under the app's identifier, that conforms to JSON", () => {
    const exported = associations[0]?.exportedType as
      | { identifier?: string; conformsTo?: string[] }
      | undefined;
    expect(exported?.identifier).toBe("app.dosik.desktop.diagram");
    expect(exported?.identifier?.startsWith(`${config.identifier}.`)).toBe(true);
    expect(exported?.conformsTo).toContain("public.json");
  });

  it("says why it asks for the Documents folder — the library lives there (R11)", () => {
    // Tauri merges `src-tauri/Info.plist` into the bundle's own, and embeds it in a dev build
    const plist = read("src-tauri/Info.plist");
    expect(plist).toMatch(
      /<key>NSDocumentsFolderUsageDescription<\/key>\s*<string>Dosik keeps your projects in your Documents folder\.<\/string>/,
    );
  });
});
