import { ChevronsUpDown } from "lucide-react";
import { memo, useRef } from "react";

import { FOCUS_RING } from "../../../shared/lib/palette";
import { besidePointer } from "../../../shared/ui/Menu";
import { type FolderMeta, parseItemKey } from "../../library/libraryApi";
import { plural } from "../../library/libraryActions";
import { diagramsUnder, itemCount } from "../../library/libraryTree";
import { relativeTime } from "../../library/relativeTime";
import { openFromLibrary } from "../../library/navigation";
import { setCollapsed } from "./boardActions";
import { DiagramWell } from "./BoardCard";
import type { FrameItem } from "./boardGeometry";
import { FolderWell } from "./BoardFolderCard";
import { stackKey } from "./boardNav";
import { belowOf, focusFolder, isMenuKey, nameLine } from "./boardParts";
import { useBoardStore } from "./boardStore";

type StackItem = Extract<FrameItem, { kind: "stack" }>;

/** the faces behind the front card: (+12, +8) apart, no tilt, no picture (D6) */
const FACE_AT = ["", "left-3 top-2", "left-6 top-4"] as const;

/** the front card's line under its name: what a folder holds, a diagram's edit */
const FRONT_META = "mt-1 block truncate px-1 text-[14px] leading-[18px] text-muted";

/**
 * A collapsed project's items as one stack (#221 D6, #231 D13): the first
 * in the sidebar's order as the front card — a folder's face when it is a
 * folder — up to two plain faces behind it, and "{n} items · {d} diagrams"
 * (the project's items, as its header counts them — a folder opened in
 * place beside the stack among them — and every diagram under the project)
 * and "Latest: …" (the latest edit under it) with Expand under them. Enter, Space and Expand unfold the project
 * (kept); a double click opens the front item — a diagram in its tab
 * (#229 D18), a folder in Home's view. It is not dragged — the project
 * moves by its header.
 */
export const BoardStack = memo(function BoardStack({
  folder,
  item,
}: {
  folder: FolderMeta;
  item: StackItem;
}) {
  const key = stackKey(folder.id);
  const stop = useBoardStore((s) => s.current === key);
  const button = useRef<HTMLButtonElement>(null);
  const front = parseItemKey(item.front);
  const frontDiagram =
    front?.kind === "diagram" ? folder.diagrams.find((d) => d.id === front.id) : undefined;
  const frontFolder =
    front?.kind === "folder" ? folder.folders.find((f) => f.id === front.id) : undefined;
  const under = diagramsUnder(folder);
  // the latest edit under the project: its own time (any depth), or a diagram's if later
  const latest = relativeTime(Math.max(folder.updatedAt, under[0]?.updatedAt ?? 0));
  const items = plural(item.count, "item");
  const diagrams = plural(under.length, "diagram");
  const openFront = () => {
    if (frontDiagram) void openFromLibrary(frontDiagram.id);
    else if (frontFolder) focusFolder(frontFolder.id);
  };
  const expand = () => {
    if (!folder.stray) void setCollapsed(folder.id, false);
  };
  const menuAt = (at: { x: number; y: number }) => {
    if (!folder.stray) {
      useBoardStore.getState().openMenu({ kind: "project", folder: folder.id, at, from: key });
    }
  };

  return (
    <div
      data-board-item=""
      onContextMenu={(e) => {
        e.preventDefault();
        menuAt(besidePointer({ x: e.clientX, y: e.clientY }));
      }}
      style={{ left: item.x, top: item.y, width: item.w, height: item.h }}
      className="absolute"
    >
      {Array.from({ length: item.behind }, (_, i) => item.behind - i).map((k) => (
        <div
          key={k}
          data-stack-face=""
          aria-hidden="true"
          className={`absolute h-[192px] w-[240px] rounded-[12px] bg-surface shadow-raised ${FACE_AT[k]}`}
        />
      ))}
      <button
        ref={button}
        type="button"
        data-board-key={key}
        tabIndex={stop ? 0 : -1}
        aria-label={`${folder.name}, ${items}, ${diagrams}, latest ${latest}`}
        onFocus={() => useBoardStore.getState().setCurrent(key)}
        onClick={(e) => {
          if (e.detail !== 0) button.current?.focus({ preventScroll: true });
        }}
        onDoubleClick={openFront}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            expand();
          } else if (isMenuKey(e)) {
            e.preventDefault();
            menuAt(belowOf(e.currentTarget));
          }
        }}
        className={`absolute top-0 left-0 flex h-[192px] w-[240px] flex-col rounded-[12px] bg-surface p-[10px] text-left shadow-raised hover:shadow-lifted motion-safe:transition-shadow ${FOCUS_RING}`}
      >
        {frontFolder ? (
          <>
            <FolderWell />
            <span className={nameLine()}>{frontFolder.name}</span>
            <span className={FRONT_META}>{plural(itemCount(frontFolder), "item")}</span>
          </>
        ) : (
          <>
            <DiagramWell diagram={frontDiagram} />
            <span className={nameLine()}>{frontDiagram?.title}</span>
            <span className={FRONT_META}>
              {`Edited ${relativeTime(frontDiagram?.updatedAt ?? folder.updatedAt)}`}
            </span>
          </>
        )}
      </button>
      <div className="absolute top-[224px] right-0 left-0 flex h-[44px] items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 truncate text-[16px] font-semibold leading-5 text-ink">
            {`${items} · ${diagrams}`}
          </p>
          <p className="m-0 mt-0.5 truncate text-[14px] leading-[18px] text-muted">
            {`Latest: ${latest}`}
          </p>
        </div>
        {folder.stray ? null : (
          <button
            type="button"
            tabIndex={-1}
            aria-expanded={false}
            aria-label={`Expand ${folder.name}`}
            onClick={expand}
            className="flex h-10 flex-none items-center gap-2 rounded-[8px] bg-frame pr-3.5 pl-2.5 text-[16px] font-semibold text-ink transition-colors hover:bg-selected"
          >
            <ChevronsUpDown size={18} strokeWidth={1.75} aria-hidden="true" />
            Expand
          </button>
        )}
      </div>
    </div>
  );
});
