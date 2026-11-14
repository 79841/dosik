import { Minimize2, Plus } from "lucide-react";
import { memo, useId, useRef } from "react";

import { FolderGlyph } from "../../../shared/ui/KindGlyph";
import { belowRightOf } from "../../../shared/ui/Menu";
import type { FolderMeta } from "../../library/libraryApi";
import { plural } from "../../library/libraryActions";
import { itemCount } from "../../library/libraryTree";
import { relativeTime } from "../../library/relativeTime";
import { useBoardApi } from "./boardApi";
import { BoardCard } from "./BoardCard";
import { BoardFolderCard } from "./BoardFolderCard";
import type { FrameItem } from "./boardGeometry";
import { frameKey } from "./boardNav";
import { DashedOutline, toggleMenu } from "./boardParts";
import { useBoardStore } from "./boardStore";

type SubItem = Extract<FrameItem, { kind: "sub" }>;

/**
 * the + and Collapse in the header — pressed, not a place to start a drag;
 * the canvas's 28×28, radius 6 and 14 glyph × 240/180: 36×36, radius 8, an
 * 18 glyph (`SUB_TOOL`, `Home-States` 6)
 */
const TOOL =
  "flex h-9 w-9 items-center justify-center rounded-[8px] text-icon transition-colors hover:bg-hover";

/**
 * A folder opened in place on the library board (#231 D14,
 * `Hybrid-Folder-Canvas`, `Home-States` 6) — in its card's place, in its
 * project's frame or in the sub-frame of the folder it is in: a dashed
 * outline (the #221 pages sub-frame's look), a header with its name and
 * what it holds, + (the New menu for it) and Collapse (an icon: Esc for
 * this folder — the folders open inside it close with it), its items as
 * tiles — folders and diagrams, the next open folder a sub-frame of its own
 * — and a footer with when it was edited. An empty folder says so in one
 * tile's room. Both buttons are the pointer's (the keyboard has Esc and the
 * board's arrows). While a card dragged over it can land in it, it shows as
 * the drop target (D15). Its numbers are the canvas's × 240/180 — big cards
 * (`SUB_*`, `TILE_*`).
 */
export const FolderFrame = memo(function FolderFrame({
  folder,
  item,
  project,
}: {
  folder: FolderMeta;
  item: SubItem;
  /** the project whose frame holds it */
  project: string;
}) {
  const api = useBoardApi();
  const headingId = useId();
  const plus = useRef<HTMLButtonElement>(null);
  const newOpen = useBoardStore((s) => s.menu?.kind === "new" && s.menu.folder === folder.id);
  const target = useBoardStore((s) => s.drag?.kind === "card" && s.drag.target === folder.id);
  const count = plural(itemCount(folder), "item");

  /** the New menu under the + */
  const toggleNew = (e: React.MouseEvent<HTMLButtonElement>) =>
    toggleMenu({
      kind: "new",
      folder: folder.id,
      at: belowRightOf(e.currentTarget),
      from: frameKey(project),
      opener: plus,
    });

  return (
    <section
      aria-labelledby={headingId}
      data-drop-target={target ? "" : undefined}
      style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
      className="absolute"
    >
      <DashedOutline
        w={item.w}
        h={item.h}
        className={target ? "fill-hover stroke-ink" : "fill-none stroke-edge"}
      />
      {/* the title box: 20 in, on the buttons' row, 12 clear of them (`SUB_TOOLS_CLEAR`
          100) — one tile's width holds "New folder · 0 items" */}
      <div className="absolute top-3 right-[100px] left-5 flex h-9 items-center gap-2.5">
        <FolderGlyph open size={20} />
        <h3
          id={headingId}
          className="m-0 min-w-0 truncate text-[16px] font-semibold leading-7 text-ink"
        >
          {`${folder.name} `}
          <span className="font-medium text-muted">{`· ${count}`}</span>
        </h3>
      </div>
      <div data-frame-tool="" className="absolute top-3 right-3 flex gap-1">
        <button
          ref={plus}
          type="button"
          tabIndex={-1}
          aria-label={`New in ${folder.name}`}
          aria-haspopup="menu"
          aria-expanded={newOpen}
          onClick={toggleNew}
          className={`${TOOL} aria-expanded:bg-selected`}
        >
          <Plus size={18} strokeWidth={1.9} aria-hidden="true" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          // named for its folder — nested sub-frames each have one — the tooltip just
          // "Collapse", as the stack's Expand (#231 D14)
          aria-label={`Collapse ${folder.name}`}
          title="Collapse"
          aria-expanded={true}
          onClick={() => api.leave(folder.id)}
          className={TOOL}
        >
          <Minimize2 size={18} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </div>
      {item.items.map((it) => {
        switch (it.kind) {
          case "empty":
            // one tile's room for the empty project's message (Home-States 6)
            return (
              <p
                key="empty"
                style={{ left: it.x, top: it.y, width: it.w, height: it.h }}
                className="absolute m-0 flex items-center justify-center rounded-[8px] bg-hover text-[15px] leading-5 text-muted"
              >
                No folders or diagrams yet
              </p>
            );
          case "stack":
            // a sub-frame folds nothing into a stack
            return null;
          default:
            return (
              <FrameCard
                key={`${it.kind}:${it.id}`}
                item={it}
                folder={folder}
                project={project}
                tile
              />
            );
        }
      })}
      {/* the 68 footer: the canvas's pill 12 in, 6 to its sides, 11px on 18 — × 240/180 */}
      <div className="pointer-events-none absolute right-5 bottom-0 left-4 flex h-17 items-center">
        {/* on the surface, so the board's dots do not run through it */}
        <p className="m-0 truncate rounded-[6px] bg-surface px-2 text-[15px] leading-7 text-muted">
          {`${count} · edited ${relativeTime(folder.updatedAt)}`}
        </p>
      </div>
    </section>
  );
});

/**
 * What draws item `item` of folder `folder` — in a project's frame or, as a
 * `tile`, in an open folder's sub-frame (#231 D13, D14): a diagram's card, a
 * folder's card, or the next folder opened in place as a sub-frame of its
 * own. Nothing for an item the folder no longer holds.
 */
export const FrameCard = ({
  item,
  folder,
  project,
  tile = false,
}: {
  item: Extract<FrameItem, { kind: "card" | "folder" | "sub" }>;
  folder: FolderMeta;
  /** the project whose frame holds it */
  project: string;
  tile?: boolean;
}) => {
  if (item.kind === "card") {
    const diagram = folder.diagrams.find((d) => d.id === item.id);
    return diagram ? (
      <BoardCard diagram={diagram} folder={folder.id} x={item.x} y={item.y} tile={tile} />
    ) : null;
  }
  const sub = folder.folders.find((f) => f.id === item.id);
  if (!sub) return null;
  return item.kind === "sub" ? (
    <FolderFrame folder={sub} item={item} project={project} />
  ) : (
    <BoardFolderCard folder={sub} parent={folder.id} x={item.x} y={item.y} tile={tile} />
  );
};
