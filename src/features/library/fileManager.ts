import { isMacPlatform } from "../../shared/lib/windowChrome";

/**
 * "Show in …" with the OS's name for its file manager (#238 D10, owner
 * decision 2026-11-11): one set of words for the library menus and Home's
 * path card — macOS Finder, Windows File Explorer, anything else a file
 * manager.
 */
export const showInLabel = (userAgent: string = navigator.userAgent): string => {
  // the app's one Mac test: the traffic lights and the shortcuts read it too
  if (isMacPlatform(userAgent)) return "Show in Finder";
  if (userAgent.includes("Windows")) return "Show in File Explorer";
  return "Show in File Manager";
};

/**
 * The same words naming what they show — "Show Research notes in Finder" —
 * for a button among others of its kind, one per row (#256).
 */
export const showNamedInLabel = (name: string, userAgent: string = navigator.userAgent): string =>
  showInLabel(userAgent).replace(/^Show /, `Show ${name} `);
