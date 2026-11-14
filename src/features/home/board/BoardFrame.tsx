import { Ellipsis, Plus } from "lucide-react";
import { memo, useId, useRef, useState } from "react";

import { FOCUS_RING } from "../../../shared/lib/palette";
import { usePointerDrag } from "../../../shared/lib/pointerDrag";
import { belowRightOf, besidePointer } from "../../../shared/ui/Menu";
import { ProjectBadge } from "../../../shared/ui/ProjectBadge";
import { plural, renameFolderTo } from "../../library/libraryActions";
import { NameInput } from "../../library/libraryParts";
import { itemCount } from "../../library/libraryTree";
import { dropFrame } from "./boardActions";
import { useBoardApi } from "./boardApi";
import { drawsStack } from "./boardGeometry";
import type { LayoutFrame } from "./boardLayout";
import { frameKey } from "./boardNav";
import {
  belowOf,
  DashedOutline,
  focusFolder,
  followCamera,
  isMenuKey,
  toggleMenu,
} from "./boardParts";
import { BoardStack } from "./BoardStack";
import { FrameCard } from "./FolderFrame";
import { useBoardStore } from "./boardStore";

/** the + and ⋯ in a frame's header — pressed, not a place to start a drag */
const TOOL =
  "flex h-9 w-9 items-center justify-center rounded-[7px] text-icon transition-colors hover:bg-hover";

/**
 * A project on the library board (#221 D4–D6, D12–D15, #231 D13): a dashed
 * frame at its place, its header — name, the count of its items, + (the New
 * menu) and ⋯ (the folder's menu) — and what it holds: folder cards and
 * diagram cards in the sidebar's order — one of its folders opened in
 * place, maybe, as a sub-frame on a row of its own (#231 D14) — a stack, or
 * "No folders or diagrams yet". The header is the handle: a click focuses
 * the project, a drag moves the frame (kept on the 20 grid), F2 renames it
 * in place. While a card is dragged over it and it can take it, it shows as
 * the drop target. A stray listing has no folder: no +, no ⋯, no menu, no
 * drag.
 */
export const BoardFrame = memo(function BoardFrame({ frame }: { frame: LayoutFrame }) {
  const api = useBoardApi();
  const { folder } = frame;
  const nameId = useId();
  const key = frameKey(folder.id);
  const stop = useBoardStore((s) => s.current === key);
  const renaming = useBoardStore((s) => s.renaming === folder.id);
  const menuOpen = useBoardStore((s) => s.menu?.kind === "project" && s.menu.folder === folder.id);
  const newOpen = useBoardStore((s) => s.menu?.kind === "new" && s.menu.folder === folder.id);
  const drag = useBoardStore((s) =>
    s.drag?.kind === "frame" && s.drag.id === folder.id ? s.drag : null,
  );
  const target = useBoardStore((s) => s.drag?.kind === "card" && s.drag.target === folder.id);
  // right after a drop the frame takes its new place at once, not by gliding from the old
  const [settled, setSettled] = useState(true);
  const startDrag = usePointerDrag();
  const dragged = useRef(false);
  const count = itemCount(folder);
  // as drawn: an open folder may leave a collapsed project's last item a card (#231 D13)
  const collapsed = drawsStack(frame.layout);

  const more = useRef<HTMLButtonElement>(null);
  const plus = useRef<HTMLButtonElement>(null);
  /** + (the New menu) or ⋯ (the folder's): its menu under its right end */
  const toggle = (
    e: React.MouseEvent<HTMLButtonElement>,
    kind: "new" | "project",
    opener: typeof more,
  ) =>
    toggleMenu({ kind, folder: folder.id, at: belowRightOf(e.currentTarget), from: key, opener });
  const menuAt = (at: { x: number; y: number }) => {
    if (!folder.stray) {
      useBoardStore.getState().openMenu({ kind: "project", folder: folder.id, at, from: key });
    }
  };

  const onHeadPointerDown = (e: React.PointerEvent) => {
    dragged.current = false;
    if (e.button !== 0 || folder.stray || renaming) return;
    if ((e.target as Element).closest("[data-frame-tool]")) return;
    const start = api.toBoard({ x: e.clientX, y: e.clientY });
    const board = useBoardStore.getState();
    let pointer = { x: e.clientX, y: e.clientY };
    const follow = (client: { x: number; y: number }) => {
      pointer = client;
      const at = api.toBoard(client);
      board.setDrag({ kind: "frame", id: folder.id, dx: at.x - start.x, dy: at.y - start.y });
    };
    let unfollow = () => {};
    // dropped with the frame: a delete or a view switch may take it off mid-drag
    startDrag(e, (client) => client, {
      onStart: () => {
        dragged.current = true;
        // the board moving under a still pointer moves the frame with it
        unfollow = followCamera(() => follow(pointer));
      },
      onMove: follow,
      onEnd: (client) => {
        unfollow();
        const at = api.toBoard(client);
        // from where the frame is now: a listing may have settled it elsewhere mid-drag (#221)
        const now = api.layout().byId.get(folder.id) ?? frame;
        setSettled(false);
        board.setDrag(null);
        void dropFrame(folder.id, { x: now.x + at.x - start.x, y: now.y + at.y - start.y });
        setTimeout(() => setSettled(true), 0);
      },
      onCancel: () => {
        unfollow();
        board.setDrag(null);
      },
    });
  };

  return (
    <section
      aria-labelledby={nameId}
      data-drop-target={target ? "" : undefined}
      style={{
        left: frame.x,
        top: frame.y,
        width: frame.w,
        height: frame.h,
        transform: drag ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
      }}
      className={`absolute ${drag ? "z-20" : settled ? "motion-safe:transition-[left,top] motion-safe:duration-180" : ""}`}
    >
      <DashedOutline
        w={frame.w}
        h={frame.h}
        className={target ? "fill-hover stroke-ink" : "fill-none stroke-frame-dash"}
      />
      {/* the header is the frame's handle */}
      <div
        data-board-item=""
        onPointerDown={onHeadPointerDown}
        onContextMenu={(e) => {
          e.preventDefault();
          menuAt(besidePointer({ x: e.clientX, y: e.clientY }));
        }}
        className={`absolute top-0 right-0 left-0 h-16 ${folder.stray ? "" : drag ? "cursor-grabbing" : "cursor-grab"}`}
      >
        <div
          className={`absolute top-4 left-5 flex h-8 items-center gap-2.5 ${folder.stray ? "right-5" : "right-[100px]"}`}
        >
          {/* the project's badge, in board units (#236 D4) */}
          <ProjectBadge id={folder.id} name={folder.name} size="board" />
          <h2 className="m-0 flex min-w-0 items-center text-[16px] font-semibold leading-8 text-ink">
            {renaming ? (
              <>
                <span id={nameId} className="sr-only">
                  {folder.name}
                </span>
                <NameInput
                  name={folder.name}
                  label="Project name"
                  size="board"
                  onDone={(name) => {
                    useBoardStore.getState().setRenaming(null);
                    if (name !== null) void renameFolderTo(folder, name);
                    api.focusItem(key);
                  }}
                />
              </>
            ) : (
              <button
                type="button"
                data-board-key={key}
                tabIndex={stop ? 0 : -1}
                aria-label={`${folder.name}, ${plural(count, "item")}${collapsed ? ", collapsed" : ""}`}
                // a stray has no rename and no menu — nothing to announce (#221)
                aria-keyshortcuts={folder.stray ? undefined : "F2 Shift+F10"}
                onFocus={() => useBoardStore.getState().setCurrent(key)}
                onClick={(e) => {
                  // the click a drag ends with moved the frame; one from the keyboard is the keydown's
                  if (dragged.current) {
                    dragged.current = false;
                    return;
                  }
                  if (e.detail !== 0) focusFolder(folder.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    focusFolder(folder.id);
                  } else if (e.key === "F2" && !folder.stray) {
                    e.preventDefault();
                    useBoardStore.getState().setRenaming(folder.id);
                  } else if (isMenuKey(e)) {
                    e.preventDefault();
                    menuAt(belowOf(e.currentTarget));
                  }
                }}
                className={`-mx-1 min-w-0 truncate rounded-[6px] px-1 text-left ${FOCUS_RING}`}
              >
                <span id={nameId}>{folder.name}</span>
              </button>
            )}
          </h2>
          <span aria-hidden="true" className="flex-none text-[16px] font-medium text-muted">
            {count}
          </span>
        </div>
        {folder.stray ? null : (
          <div data-frame-tool="" className="absolute top-3 right-3 flex gap-0.5">
            <button
              ref={plus}
              type="button"
              tabIndex={-1}
              aria-label={`New in ${folder.name}`}
              aria-haspopup="menu"
              aria-expanded={newOpen}
              onClick={(e) => toggle(e, "new", plus)}
              className={`${TOOL} aria-expanded:bg-selected`}
            >
              <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              ref={more}
              type="button"
              tabIndex={-1}
              aria-label={`More for ${folder.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => toggle(e, "project", more)}
              className={`${TOOL} aria-expanded:bg-selected`}
            >
              <Ellipsis size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {frame.layout.items.map((item) => {
        switch (item.kind) {
          case "stack":
            return <BoardStack key="stack" folder={folder} item={item} />;
          case "empty":
            // an empty project: its message, across the frame as a stack is (#231 D13)
            return (
              <p
                key="empty"
                data-frame-empty=""
                style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
                className="absolute m-0 flex items-center justify-center rounded-[8px] bg-hover text-[16px] leading-5 text-muted"
              >
                No folders or diagrams yet
              </p>
            );
          default:
            // a card — or a folder opened in place, in its card's place (#231 D14)
            return (
              <FrameCard
                key={`${item.kind}:${item.id}`}
                item={item}
                folder={folder}
                project={folder.id}
              />
            );
        }
      })}
    </section>
  );
});
