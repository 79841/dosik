import { graphemes } from "./textLayout";

/**
 * A project's badge (#236 D3): the first letter of its name on a soft tint,
 * in one of six colours. Nobody picks the colour — it comes from the project's
 * folder id, so a project keeps its colour across restarts and renames.
 */
export const BADGE_COLOURS = ["blue", "teal", "orange", "pink", "green", "violet"] as const;
export type BadgeColour = (typeof BADGE_COLOURS)[number];

/** 32-bit FNV-1a over the id's UTF-16 code units */
const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

export const badgeColour = (id: string): BadgeColour =>
  BADGE_COLOURS[fnv1a(id) % BADGE_COLOURS.length]!;

/**
 * the name's first character as it is seen — a flag or an emoji sequence
 * whole, an accent with its letter — upper case; `""` when the name is blank
 */
export const badgeLetter = (name: string): string => {
  const [first] = graphemes(name.trim());
  return first ? first.toLocaleUpperCase() : "";
};
