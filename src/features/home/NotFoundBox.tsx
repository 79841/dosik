import type { CSSProperties } from "react";

import { FOCUS_RING } from "../../shared/lib/palette";
import type { FolderMeta } from "../library/libraryApi";
import { locateProjectAsking } from "../library/libraryActions";
import { type ScreenStamp, screenStamp } from "../library/screenStamp";

/** about how many characters of mono text the box's line holds before its middle is elided */
export const PATH_CHARS = 30;

/**
 * A long path with its middle elided (`Library-Missing`): the first folders
 * that fit and the last name, `…` between — `~/Projects/…/architecture`. One
 * that fits stays whole; a last name too long for anything before it keeps
 * the root alone, and the box's own ellipsis cuts the rest.
 */
export const shortPath = (path: string, max = PATH_CHARS): string => {
  if (path.length <= max) return path;
  const sep = path.includes("/") ? "/" : "\\";
  const parts = path.split(sep);
  if (parts.length < 3) return path;
  const last = parts.at(-1)!;
  const tail = `${sep}…${sep}${last}`;
  let head = parts[0]!;
  for (const part of parts.slice(1, -1)) {
    const next = `${head}${sep}${part}`;
    if (next.length + tail.length > max) break;
    head = next;
  }
  return `${head}${tail}`;
};

/**
 * Its sizes: in the Cards view the canvas's own; on the library board in
 * board units — the canvas's ÷ 0.7 on the 4 grid, as every frame number
 * (`boardGeometry`), the box itself placed by the frame's layout.
 */
const SIZE = {
  cards: {
    box: "h-[92px] w-[212px] gap-1.5 rounded-[6px] px-3 py-2.5",
    title: "text-[11px] leading-[14px]",
    path: "text-[10px] leading-[13px]",
    button: "h-6 rounded-[5px] px-[9px] text-[11px]",
  },
  board: {
    box: "absolute gap-2 rounded-[8px] p-4",
    title: "text-[16px] leading-5",
    path: "text-[14px] leading-[18px]",
    button: "h-9 rounded-[7px] px-3 text-[16px]",
  },
} as const;

/**
 * What stands in for a project whose folder cannot be found (#253 R7,
 * `Library-Missing`): "Can't find this folder", its last known path — mono,
 * its middle elided when long — and Locate…, the system's folder picker. On
 * the board it fills its frame's body, where `style` puts it; in the Cards
 * view it is centred under the header. `onLocated` follows a Locate… that
 * went through, with the screen it was asked from (#218 D15).
 */
export const NotFoundBox = ({
  folder,
  size,
  style,
  tabIndex,
  onLocated,
}: {
  folder: FolderMeta;
  size: keyof typeof SIZE;
  style?: CSSProperties;
  tabIndex?: number;
  onLocated?: (asked: ScreenStamp) => void;
}) => {
  const sizes = SIZE[size];
  const shown = folder.shown ?? folder.path;
  const locate = () => {
    const asked = screenStamp();
    void locateProjectAsking(folder).then((located) => {
      if (located) onLocated?.(asked);
    });
  };
  return (
    <div
      style={style}
      className={`box-border flex flex-col items-center justify-center bg-hover text-center ${sizes.box}`}
    >
      <p className={`m-0 font-semibold text-ink ${sizes.title}`}>Can't find this folder</p>
      {shown ? (
        <p className={`m-0 max-w-full truncate font-mono text-muted ${sizes.path}`}>
          {shortPath(shown)}
        </p>
      ) : null}
      <button
        type="button"
        tabIndex={tabIndex}
        onClick={locate}
        className={`inline-flex flex-none items-center bg-surface font-semibold text-ink transition-colors hover:bg-selected ${FOCUS_RING} ${sizes.button}`}
      >
        Locate…
      </button>
    </div>
  );
};
