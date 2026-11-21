/**
 * Geometry of the window's chrome band (#217, before that the floating
 * capsule of #127).
 *
 * The top 40px of the window is one band: on its left the sidebar's top row
 * (traffic lights, Hide sidebar), then the tabs; with the sidebar hidden it
 * spans the window. Everything in it shares one centre line, y = 24 — the
 * native traffic lights' centre (design system `chrome-height`,
 * `traffic-light-center`, `traffic-light-inset`).
 *
 * The window is native on macOS (`titleBarStyle: "Overlay"`), so AppKit draws
 * the traffic lights on top of the webview at `trafficLightPosition`. The band
 * and the lights must agree, and the only way they can is for the config value
 * to be derived from these numbers. `src/__tests__/windowConfig.test.ts` pins
 * `tauri.macos.conf.json` to `TRAFFIC_LIGHT_POSITION` and these constants to
 * the design tokens, so neither pair can drift apart.
 *
 * Measured on macOS 26: the buttons are 14×14, 23px apart. tao's inset sets
 * `titlebarContainer.height = 14 + y` and leaves the button's own origin.y (9)
 * alone, so the gap above the buttons is `y - 9` — **not** y.
 */
export const LIGHT_SIZE = 14;
export const LIGHT_GAP = 23;
const LIGHT_COUNT = 3;
/** the origin tao does not touch; the top gap is `trafficLightPosition.y` minus this */
export const LIGHT_ORIGIN_Y = 9;

/** the chrome band at the top of the window (`chrome-height`) */
export const CHROME_HEIGHT = 40;
/** the band's centre line, shared by everything in it (`traffic-light-center`) */
export const CHROME_CENTER_Y = 24;
/** the first traffic light's distance from the window's left edge (`traffic-light-inset`) */
export const TRAFFIC_LIGHT_INSET = 20;

/** what `trafficLightPosition` has to be for the lights to sit on the band's centre line */
export const TRAFFIC_LIGHT_POSITION = {
  x: TRAFFIC_LIGHT_INSET,
  y: CHROME_CENTER_Y - LIGHT_SIZE / 2 + LIGHT_ORIGIN_Y,
} as const;

/** the right end of the third light (20 + 2·23 + 14 = 80); 20–80 is the lights' room, always */
export const LIGHTS_END = TRAFFIC_LIGHT_INSET + (LIGHT_COUNT - 1) * LIGHT_GAP + LIGHT_SIZE;

/** a button in the band — Hide/Show sidebar, More (`control-height-sm`) */
export const BAND_BUTTON = 24;
/** a band button's top, which puts its centre on the centre line */
export const BAND_BUTTON_TOP = CHROME_CENTER_Y - BAND_BUTTON / 2;
/** room between neighbours in the band, and a band button's inset from an edge */
export const BAND_GAP = 8;
/** the space between the Show sidebar button and the first tab */
const SHOW_TO_TABS = 12;
/**
 * A band control's inset from the window's edge: the right end's (⋯ More,
 * the window controls — `right-3`), and off macOS, with no traffic lights,
 * the left end's Show sidebar
 */
export const BAND_EDGE_INSET = 12;

/**
 * Off macOS, a caption button (Minimize, Maximize or Restore, Close) is this
 * wide and as tall as the band (`caption-button` × `chrome-height`); the three
 * sit flush with the window's top-right corner, no gap between them
 */
export const CAPTION_BUTTON = 46;

/** a tab is this tall, flush with the band's bottom (`tab-height`) */
export const TAB_HEIGHT = 32;
/** a document tab (`tab-width`) */
export const TAB_WIDTH = 176;
/** the pinned Home tab, icon only (`tab-pinned-width`) */
export const TAB_PINNED_WIDTH = 36;

const CLICKABLE_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY"]);
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "option",
]);

const isClickable = (el: HTMLElement): boolean =>
  CLICKABLE_TAGS.has(el.tagName) ||
  (el.hasAttribute("contenteditable") && el.getAttribute("contenteditable") !== "false") ||
  (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") ||
  INTERACTIVE_ROLES.has(el.getAttribute("role") ?? "");

/**
 * Whether a pointer on `target` would drag the window — Tauri's own rule
 * (`drag.js`): walking up, a clickable element without a drag region of its
 * own stops it, `"false"` stops it, `"deep"` takes the subtree, a bare region
 * only itself. The band's empty places, and nothing else, are its title bar.
 */
export const isOnDragRegion = (target: EventTarget | null): boolean => {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    // what is not an HTML element (an icon's SVG) is passed over, as drag.js does
    if (!(el instanceof HTMLElement)) continue;
    const attr = el.getAttribute("data-tauri-drag-region");
    if (attr === null) {
      if (isClickable(el)) return false;
      continue;
    }
    if (attr === "false") return false;
    if (attr === "deep") return true;
    return el === target;
  }
  return false;
};

/** the window's own controls are the OS's on macOS and the app's everywhere else */
export const isMacPlatform = (userAgent: string = navigator.userAgent): boolean =>
  userAgent.includes("Mac");

/**
 * A ctrl+click that is macOS's right click — the row and the card leave it to
 * the context menu. Off macOS a ctrl+click is a click.
 */
export const isMacContextClick = (
  e: { ctrlKey: boolean },
  mac: boolean = isMacPlatform(),
): boolean => mac && e.ctrlKey;

/**
 * Where the hidden band's first control (Show sidebar) starts: past the
 * traffic lights on macOS (88 — even in full screen, where the lights slide
 * down over the band and must not cover it), at the edge elsewhere.
 */
export const bandLeading = (mac: boolean = isMacPlatform()): number =>
  mac ? LIGHTS_END + BAND_GAP : BAND_EDGE_INSET;

/**
 * Where the tabs start: past the docked sidebar (its width + 8), or — hidden,
 * `docked` null — past the Show sidebar button (124 on macOS, 48 elsewhere).
 */
export const tabsLeft = (docked: number | null, mac: boolean = isMacPlatform()): number =>
  docked !== null ? docked + BAND_GAP : bandLeading(mac) + BAND_BUTTON + SHOW_TO_TABS;
