import { isMacPlatform } from "./windowChrome";

/** the shortcuts that are shown to the user (#217 D22, #218 D12, #219 D18) */
export type ShortcutKey = "\\" | "," | "O" | "S" | "T" | "W" | "Z";

/** with Shift too — Redo */
type Modifiers = { shift?: boolean };

/** `⌘\` on macOS, `Ctrl+\` elsewhere — for tooltips, menus and toasts; `⇧⌘Z` with Shift */
export const shortcutLabel = (
  key: ShortcutKey,
  mac: boolean = isMacPlatform(),
  { shift = false }: Modifiers = {},
): string => (mac ? `${shift ? "⇧" : ""}⌘${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`);

/** the same shortcut as an `aria-keyshortcuts` value */
export const keyshortcuts = (
  key: ShortcutKey,
  mac: boolean = isMacPlatform(),
  { shift = false }: Modifiers = {},
): string => `${mac ? "Meta" : "Control"}+${shift ? "Shift+" : ""}${KEY_NAME[key] ?? key}`;

/** the keys `aria-keyshortcuts` spells out */
const KEY_NAME: Partial<Record<ShortcutKey, string>> = { "\\": "Backslash", ",": "Comma" };
