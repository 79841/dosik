import type { ReactNode } from "react";

import { currentWindowOrNull } from "../lib/appWindow";
import { FOCUS_RING_INSET } from "../lib/palette";
import { isMacPlatform } from "../lib/windowChrome";
import { useWindowFrame } from "../lib/windowFrame";

export type WindowControlsPlatform = "mac" | "other";

const detectPlatform = (): WindowControlsPlatform => (isMacPlatform() ? "mac" : "other");

/** the system's caption glyphs: 10×10, a 1px line in the button's colour (the canvas's Win-Caption) */
const Glyph = ({ name, children }: { name: string; children: ReactNode }) => (
  <svg
    data-glyph={name}
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    stroke="currentColor"
    strokeWidth="1"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const MINIMIZE = (
  <Glyph name="minimize">
    <path d="M0 5.5h10" />
  </Glyph>
);
const MAXIMIZE = (
  <Glyph name="maximize">
    <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" />
  </Glyph>
);
const RESTORE = (
  <Glyph name="restore">
    <rect x="0.5" y="2.5" width="7" height="7" rx="1.5" />
    <path d="M2.5 2.5V2A1.5 1.5 0 0 1 4 .5h4A1.5 1.5 0 0 1 9.5 2v4A1.5 1.5 0 0 1 8 7.5h-.5" />
  </Glyph>
);
const CLOSE = (
  <Glyph name="close">
    <path d="M.5 .5l9 9M9.5 .5l-9 9" />
  </Glyph>
);

/** a caption button: 46 × the band, square, flush; its focus ring drawn inside — it touches the window's edge */
const BUTTON = `flex h-10 w-(--caption-button) flex-none items-center justify-center transition-colors ${FOCUS_RING_INSET}`;
/** Minimize and Maximize: `selected` under the pointer, `hover` while pressed */
const PLAIN = "hover:bg-selected hover:text-ink active:bg-hover";
/** Close: the system's red under the pointer, deeper while pressed, a white glyph on both */
const CLOSING =
  "hover:bg-caption-close hover:text-on-caption-close active:bg-caption-close-pressed active:text-on-caption-close";
/**
 * The native Maximize spot takes the pointer from the page (Snap layouts,
 * `window_frame.rs`): its state comes from Rust and paints the same way
 */
const NATIVE_SPOT = "data-[state=hover]:bg-selected data-[state=pressed]:bg-hover";

const act = (call: (win: NonNullable<ReturnType<typeof currentWindowOrNull>>) => Promise<void>) => {
  const win = currentWindowOrNull();
  if (win) void call(win).catch(() => undefined);
};

/**
 * The window's own controls, at the right end of the chrome band (#217 D20 —
 * before that a capsule floating over the content, #127).
 *
 * On macOS they are the **native** traffic lights: the window is undecorated
 * only on Windows and Linux (`titleBarStyle: "Overlay"` elsewhere), and AppKit
 * paints them into the band's left end at the position `windowChrome.ts`
 * derives — so there is nothing to draw here.
 *
 * Elsewhere they are Windows' caption buttons as the canvas's Win-Caption
 * draws them: Minimize, Maximize (Restore while maximized) and Close, each 46
 * × 40, flush with the window's top-right corner, the system's glyphs in ink —
 * muted while another window has the focus — and gone in full screen. A
 * dialog carries a copy of them above its scrim (`DialogCaption`), out of the
 * tab order.
 *
 * The band is the drag handle around them (`data-tauri-drag-region="deep"`);
 * Tauri leaves buttons out of the drag. A click on Maximize only lands here
 * from the keyboard: the pointer there belongs to the native spot over it,
 * whose click Windows turns into maximize or restore itself.
 */
export const WindowControls = ({
  platform = detectPlatform(),
  tabbable = true,
}: {
  platform?: WindowControlsPlatform;
  /** false for a copy whose buttons stay out of the tab order */
  tabbable?: boolean;
}) => {
  const maximized = useWindowFrame((s) => s.maximized);
  const focused = useWindowFrame((s) => s.focused);
  const fullscreen = useWindowFrame((s) => s.fullscreen);
  const maxButton = useWindowFrame((s) => s.maxButton);
  if (platform === "mac" || fullscreen) return null;
  const ink = focused ? "text-ink" : "text-muted";
  const tabIndex = tabbable ? undefined : -1;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a title bar's buttons are a group — a fieldset is a form's
    <div
      data-window-controls
      data-inactive={focused ? undefined : ""}
      role="group"
      aria-label="Window"
      className="flex select-none"
    >
      <button
        type="button"
        aria-label="Minimize"
        tabIndex={tabIndex}
        onClick={() => act((w) => w.minimize())}
        className={`${BUTTON} ${ink} ${PLAIN}`}
      >
        {MINIMIZE}
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        tabIndex={tabIndex}
        data-state={maxButton}
        onClick={() => act((w) => w.toggleMaximize())}
        className={`${BUTTON} ${ink} ${PLAIN} ${NATIVE_SPOT}`}
      >
        {maximized ? RESTORE : MAXIMIZE}
      </button>
      <button
        type="button"
        aria-label="Close"
        tabIndex={tabIndex}
        onClick={() => act((w) => w.close())}
        className={`${BUTTON} ${ink} ${CLOSING}`}
      >
        {CLOSE}
      </button>
    </div>
  );
};
