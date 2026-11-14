import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The design system's generated tokens (`design/design-system/project/tokens.json`,
 * #216), for tests that pin the app's hex values to them.
 */
export const REPO_ROOT = join(__dirname, "..", "..");
export const DS_DIR = join(REPO_ROOT, "design", "design-system", "project");
export const readRepo = (...parts: string[]): string =>
  readFileSync(join(REPO_ROOT, ...parts), "utf8");

export type Themed = string | { light: string; dark: string };
export type ThemeName = "light" | "dark";

export interface DesignTokens {
  color: { tokens: { name: string; value: Themed }[] };
  shadow: { tokens: { name: string; value: { light: string; dark: string } }[] };
  type: {
    families: Record<"sans" | "mono", string>;
    groups: { styles: { name: string }[] }[];
  };
  spacing: { tokens: { name: string; value: string }[] };
  radius: { tokens: { name: string; value: string }[] };
  layout: { tokens: { name: string; value: string }[] };
}

export const DESIGN_TOKENS = JSON.parse(
  readFileSync(join(DS_DIR, "tokens.json"), "utf8"),
) as DesignTokens;

export const themed = (value: Themed, theme: ThemeName): string =>
  typeof value === "string" ? value : value[theme];

/** a colour token in a theme, `{references}` followed, hex in upper case like palette.ts */
export const dsColor = (name: string, theme: ThemeName): string => {
  const token = DESIGN_TOKENS.color.tokens.find((t) => t.name === name);
  if (!token) throw new Error(`no colour token ${name}`);
  const value = themed(token.value, theme);
  if (value.startsWith("{")) return dsColor(value.slice(1, -1), theme);
  return value.startsWith("#") ? value.toUpperCase() : value;
};

/** WCAG relative luminance of `#RRGGBB` */
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

/** WCAG contrast ratio of two `#RRGGBB` colours */
export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
