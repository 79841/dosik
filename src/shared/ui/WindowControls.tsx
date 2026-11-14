import { type LucideIcon, Minus, Square, X } from "lucide-react";

import { currentWindowOrNull } from "../lib/appWindow";
import { FOCUS_RING, TEXT_MUTED, TEXT_MUTED_HOVER } from "../lib/palette";
import { isMacPlatform } from "../lib/windowChrome";

export type WindowControlsPlatform = "mac" | "other";

const detectPlatform = (): WindowControlsPlatform => (isMacPlatform() ? "mac" : "other");

type Control = {
  id: "minimize" | "maximize" | "close";
  label: string;
  icon: LucideIcon;
  act: () => void;
};

/**
 * The window's own controls, at the right end of the chrome band (#217 D20 —
 * before that a capsule floating over the content, #127).
 *
 * On macOS they are the **native** traffic lights: the window is undecorated
 * only on Windows and Linux (`titleBarStyle: "Overlay"` elsewhere), and AppKit
 * paints them into the band's left end at the position `windowChrome.ts`
 * derives — so there is nothing to draw here. Elsewhere these three buttons
 * are the only way to minimize, maximize and close.
 *
 * The band is the drag handle around them (`data-tauri-drag-region="deep"`);
 * Tauri leaves buttons out of the drag.
 */
export const WindowControls = ({
  platform = detectPlatform(),
}: {
  platform?: WindowControlsPlatform;
}) => {
  if (platform === "mac") return null;
  const win = () => currentWindowOrNull();
  const controls: Control[] = [
    {
      id: "minimize",
      label: "Minimize",
      icon: Minus,
      act: () =>
        void win()
          ?.minimize()
          .catch(() => undefined),
    },
    {
      id: "maximize",
      label: "Maximize",
      icon: Square,
      act: () =>
        void win()
          ?.toggleMaximize()
          .catch(() => undefined),
    },
    {
      id: "close",
      label: "Close",
      icon: X,
      act: () =>
        void win()
          ?.close()
          .catch(() => undefined),
    },
  ];

  return (
    <div data-window-controls className="flex select-none items-center gap-0.5">
      {controls.map(({ id, label, icon: Icon, act }) => (
        <button
          key={id}
          type="button"
          aria-label={label}
          onClick={act}
          className={`flex h-6 w-7 items-center justify-center rounded-[5px] transition-colors hover:bg-hover ${TEXT_MUTED} ${TEXT_MUTED_HOVER} ${FOCUS_RING}`}
        >
          <Icon size={id === "maximize" ? 11 : 14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
};
