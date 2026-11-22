import { useSidebarStore } from "../../shared/lib/sidebarLayout";
import { isMacPlatform } from "../../shared/lib/windowChrome";
import { showWindowMenu, toggleFullscreen, useWindowFrame } from "../../shared/lib/windowFrame";
import { cycleTabs, goToNthTab, newDiagram, openFileAnywhere } from "../library/navigation";
import { saveActiveDocument } from "../library/saveDocument";
import { openSettings } from "../settings/settingsStore";
import { closeTabOrWindow } from "./useMenuEvents";

/**
 * ⌘\ — or `₩` where a Korean layout puts the won sign on that key, which is
 * why the physical key (`code`) counts as much as the character.
 */
const isBackslash = (e: KeyboardEvent): boolean =>
  e.code === "Backslash" || e.key === "\\" || e.key === "₩";

/** a letter key — by the character, or by the key where an input method types a Hangul letter there */
const isLetter = (e: KeyboardEvent, letter: string): boolean =>
  e.key.toLowerCase() === letter ||
  (e.code === `Key${letter.toUpperCase()}` && !/^[a-z]$/i.test(e.key));

/**
 * ⌘1–⌘9 by the physical row of digits — the number, or null. A layout that
 * types `&` there still has the key; an event with no `code` at all (some
 * synthetic ones) falls back to the character.
 */
const digit = (e: KeyboardEvent): number | null => {
  const match = e.code ? /^Digit([1-9])$/.exec(e.code) : /^([1-9])$/.exec(e.key);
  return match ? Number(match[1]) : null;
};

/**
 * ⌘⇧] / ⌘⇧[ by the physical key, the same rule as the digits: the character
 * Shift makes of it (`}` / `{`, or `]` / `[`) only when the event has no `code`.
 */
const bracket = (e: KeyboardEvent): 1 | -1 | null => {
  if (e.code ? e.code === "BracketRight" : e.key === "}" || e.key === "]") return 1;
  if (e.code ? e.code === "BracketLeft" : e.key === "{" || e.key === "[") return -1;
  return null;
};

/**
 * The key comes from inside an open modal dialog (From Mermaid…): what is
 * behind it waits — no tab changes under it, no file or diagram opens over
 * it (#220). The keys stay the app's, so nothing else acts on
 * them either.
 */
const resting = (e: KeyboardEvent): boolean =>
  e.target instanceof Element && e.target.closest("dialog[open]") !== null;

/**
 * Acts on an app key — once: a held key's repeats are taken too but not
 * acted on (#217) — unless a modal dialog has it.
 */
const perform = (e: KeyboardEvent, action: () => unknown): void => {
  if (!e.repeat && !resting(e)) void action();
};

/**
 * A tab key: its action runs, and the key goes no further — not into a field,
 * not to the canvas. A held ⌘T makes one diagram, not one per repeat.
 */
const take = (e: KeyboardEvent, action: () => unknown): void => {
  e.preventDefault();
  e.stopPropagation();
  perform(e, action);
};

/**
 * The tab shortcuts (#218 D12), ⌘ on macOS and Ctrl elsewhere — except ⌃Tab,
 * which is Control everywhere. `true` when the key was one of them.
 */
const handleTabKeys = (e: KeyboardEvent, mac: boolean): boolean => {
  if (e.altKey) return false;
  // ⌃Tab / ⌃⇧Tab: the next or previous tab, Home included, round
  if (e.code === "Tab" || e.key === "Tab") {
    if (!e.ctrlKey || e.metaKey) return false;
    take(e, () => cycleTabs(e.shiftKey ? -1 : 1));
    return true;
  }
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod) return false;
  // ⌘⇧] / ⌘⇧[: the same, by the physical key — the macOS custom
  if (e.shiftKey) {
    const dir = bracket(e);
    if (dir === null) return false;
    take(e, () => cycleTabs(dir));
    return true;
  }
  const n = digit(e);
  if (n !== null) {
    take(e, () => goToNthTab(n));
    return true;
  }
  if (isLetter(e, "t") || isLetter(e, "n")) {
    take(e, newDiagram);
    return true;
  }
  // ⌘W on macOS is File ▸ Close Tab — the menu's own, so it fires once
  // whatever WebKit does with the key (`app_menu.rs`). Ctrl+W does what it
  // does: closes Settings when it is up, the tab, or on Home the window — so
  // it is let through an open dialog, which it handles itself
  if (!mac && isLetter(e, "w")) {
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) void closeTabOrWindow();
    return true;
  }
  // ⌘, on macOS is Dosik ▸ Settings… — the menu's own, the same way (#252)
  if (!mac && (e.code === "Comma" || e.key === ",")) {
    take(e, () => openSettings());
    return true;
  }
  return false;
};

/** a key with none of the modifiers */
const bare = (e: KeyboardEvent): boolean => !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;

/**
 * Off macOS, the keys a window frame answers there (the canvas's Win-Caption)
 * — on macOS the native window has them. F11: full screen on or off, with a
 * dialog open too. Alt+Space: the window menu, as a title bar opens it —
 * nothing in full screen, where the band is no title bar. `true` when the key
 * was one of them.
 */
const handleWindowKeys = (e: KeyboardEvent, mac: boolean): boolean => {
  if (mac) return false;
  if (e.key === "F11" && bare(e)) {
    e.preventDefault();
    if (!e.repeat) void toggleFullscreen();
    return true;
  }
  const altOnly = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
  if (altOnly && (e.code === "Space" || e.key === " ")) {
    if (useWindowFrame.getState().fullscreen) return true;
    e.preventDefault();
    if (!e.repeat) showWindowMenu(false);
    return true;
  }
  return false;
};

/**
 * The app's own shortcuts, as opposed to the canvas's (`canvasKeymap`) — they
 * work on Home and in the editor alike, so the Frame registers them once, in
 * the capture phase (#217 D22, #218 D12). All of them work inside text fields
 * too: none means anything to text editing, and ⌘\ is how a sidebar the user
 * is typing next to goes away.
 *
 * - ⌘\ (Ctrl+\ off macOS): hide or dock the sidebar; from the peek, dock it.
 * - ⌘O (Ctrl+O): Open file…
 * - ⌘S (Ctrl+S): Save — the active document; nothing on Home (#219 D5)
 * - ⌘T / ⌘N: New diagram. ⌃Tab / ⌃⇧Tab, ⌘⇧] / ⌘⇧[: next / previous tab.
 *   ⌘1 Home, ⌘2–⌘8 a document tab, ⌘9 the last. Ctrl+W off macOS: close
 *   Settings, the tab, or on Home the window. Ctrl+, off macOS: Settings (#252).
 * - Off macOS: F11 full screen, Alt+Space the window menu.
 *
 * A held key acts once: its repeats are swallowed, not acted on. While a
 * modal dialog is open they are swallowed too, and do nothing.
 */
export const handleAppKeyDown = (e: KeyboardEvent, mac: boolean = isMacPlatform()): void => {
  // a key that finishes a Hangul syllable is the input method's, not ours
  if (e.isComposing) return;
  if (handleWindowKeys(e, mac)) return;
  if (handleTabKeys(e, mac)) return;
  if (e.shiftKey || e.altKey) return;
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod) return;
  if (isBackslash(e)) {
    e.preventDefault();
    // a held key repeats: only the first press toggles, or the sidebar flickers
    perform(e, () => useSidebarStore.getState().toggle());
    return;
  }
  if (isLetter(e, "o")) {
    // the webview's own ⌘O would try to open a file into the page — repeats too
    e.preventDefault();
    // a held key repeats: one Open file…, not a queue of them
    perform(e, openFileAnywhere);
    return;
  }
  if (isLetter(e, "s")) {
    // the webview's own ⌘S would offer to save the page
    e.preventDefault();
    // a held key repeats: one write, not one per repeat
    perform(e, saveActiveDocument);
  }
};
