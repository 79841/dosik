import { Plus } from "lucide-react";
import { useRef, useState } from "react";

import { FOCUS_RING } from "../../shared/lib/palette";
import { MENU_MIN_WIDTH } from "../../shared/ui/Menu";
import type { FolderMeta } from "../library/libraryApi";
import { canHoldFolders } from "../library/libraryTree";
import { NewMenu } from "./NewMenu";

const KINDS = "Blank, Flowchart, Sequence, Class, ERD or paste Mermaid";

/**
 * The dashed card that ends a folder's cards (#220 D11, #231 D9,
 * `Hybrid-Project-Cards`): the header's New ▾ in the grid — the same New
 * menu, made in this folder. Its line names what the menu makes; the new
 * folder only where one can go (#229 D9).
 *
 * The cards set the row's height (#236 D5): no height of its own, but the
 * 230 it had when it is alone — an empty folder. Under 240px wide — only a
 * content narrower than Small's least width (#236 D5) — it drops its line and
 * tightens to 16.
 */
export const NewCard = ({
  folder,
  folders,
}: {
  folder: FolderMeta;
  folders: readonly FolderMeta[];
}) => {
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const subtitle = canHoldFolders(folders, folder.id) ? `${KINDS} · or a new folder` : KINDS;
  return (
    <li className="@container flex min-w-0 only:min-h-[230px]">
      <button
        ref={button}
        type="button"
        aria-label={`New diagram, ${subtitle}`}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={(e) => {
          // the menu's middle on the card's
          const box = e.currentTarget.getBoundingClientRect();
          setAt(
            at
              ? null
              : { x: box.left + box.width / 2 - MENU_MIN_WIDTH / 2, y: box.top + box.height / 2 },
          );
        }}
        className={`flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg border-[1.5px] border-dashed border-dot p-4 text-center transition-colors hover:bg-hover @min-[240px]:p-5 ${FOCUS_RING}`}
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-frame text-ink"
        >
          <Plus size={18} strokeWidth={2} />
        </span>
        <span className="mt-3 text-[12px] font-semibold leading-4 text-ink">New diagram</span>
        <span className="mt-1 hidden max-w-[260px] text-[11px] leading-[15px] text-muted @min-[240px]:block">
          {subtitle}
        </span>
      </button>
      {at ? (
        <NewMenu
          at={at}
          folder={folder}
          folders={folders}
          opener={button}
          onClose={() => setAt(null)}
        />
      ) : null}
    </li>
  );
};
