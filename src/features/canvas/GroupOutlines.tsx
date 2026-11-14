import { useStore, ViewportPortal } from "@xyflow/react";
import { useMemo } from "react";

import { useDiagramStore } from "../../shared/lib/store";
import {
  groupBox,
  RESIZE_HANDLES,
  type ResizeHandle,
  resizeBox,
  scaleFloor,
} from "../../shared/lib/store/groupResize";
import { groupOutlineBoxes, liveGroups } from "../../shared/lib/store/groups";
import { startPointerDrag } from "../../shared/lib/pointerDrag";

/** on-screen size of a corner handle and thickness of a side's grab band, px */
const HANDLE_PX = 10;
/** above every node — a member must not cover its own group's handles */
const HANDLE_Z = 1000;

const CURSORS: Record<ResizeHandle, string> = {
  "top-left": "cursor-nwse-resize",
  "bottom-right": "cursor-nwse-resize",
  "top-right": "cursor-nesw-resize",
  "bottom-left": "cursor-nesw-resize",
  top: "cursor-ns-resize",
  bottom: "cursor-ns-resize",
  left: "cursor-ew-resize",
  right: "cursor-ew-resize",
};

type OutlineBox = { x: number; y: number; w: number; h: number };

/** where a handle sits on the outline box, in flow units */
const handleRect = (
  handle: ResizeHandle,
  box: OutlineBox,
  size: number,
): { left: number; top: number; width: number; height: number } => {
  const half = size / 2;
  const x = handle.includes("left")
    ? box.x - half
    : handle.includes("right")
      ? box.x + box.w - half
      : null;
  const y = handle.includes("top")
    ? box.y - half
    : handle.includes("bottom")
      ? box.y + box.h - half
      : null;
  // a corner is a dot; a side is a band along it, between the corners
  if (x !== null && y !== null) return { left: x, top: y, width: size, height: size };
  // zoomed far out a small group's side is shorter than a dot — no negative size
  if (x !== null)
    return { left: x, top: box.y + half, width: size, height: Math.max(0, box.h - size) };
  return { left: box.x + half, top: y as number, width: Math.max(0, box.w - size), height: size };
};

/**
 * The resize handles of a whole selected group (#179): four corner dots and
 * four side bands on its outline. Dragging one scales every member by the
 * same factors, anchored at the opposite side; the members' own resizers are
 * hidden meanwhile. `box` is the outline in flow units, `zoom` the viewport's.
 */
export const GroupResizeHandles = ({
  groupId,
  box,
  zoom,
}: {
  groupId: string;
  box: OutlineBox;
  zoom: number;
}) => {
  const size = HANDLE_PX / zoom;
  const grab = (handle: ResizeHandle) => (e: React.PointerEvent) => {
    // the pane would start a selection box or a pan underneath
    e.stopPropagation();
    const toFlow = (client: { x: number; y: number }) => ({
      x: client.x / zoom,
      y: client.y / zoom,
    });
    let origin = { x: 0, y: 0 };
    let from = { x: 0, y: 0, width: 0, height: 0 };
    let limits = { minWidth: 0, minHeight: 0, keepAspect: false };
    startPointerDrag(e, toFlow, {
      onStart: (p) => {
        const store = useDiagramStore.getState();
        const ids = liveGroups(store.nodes).get(groupId);
        if (!ids) return;
        const members = store.nodes.filter((n) => ids.includes(n.id));
        origin = p;
        from = groupBox(members);
        const least = scaleFloor(members);
        limits = {
          minWidth: from.width * least.x,
          minHeight: from.height * least.y,
          // a picture must not be stretched, so a group holding one keeps its shape
          keepAspect: members.some((n) => n.data.shape === "image"),
        };
        store.beginGroupResize(groupId);
      },
      onMove: (p) => {
        if (from.width === 0 && from.height === 0) return;
        useDiagramStore
          .getState()
          .resizeGroup(resizeBox(from, handle, p.x - origin.x, p.y - origin.y, limits));
      },
      onEnd: () => useDiagramStore.getState().endGroupResize(),
    });
  };

  return (
    <>
      {RESIZE_HANDLES.map((handle) => {
        const r = handleRect(handle, box, size);
        const corner = handle.includes("-");
        return (
          <div
            key={handle}
            data-group-handle={handle}
            aria-hidden="true"
            onPointerDown={grab(handle)}
            className={`nodrag nopan pointer-events-auto absolute left-0 top-0 ${CURSORS[handle]} ${
              corner ? "rounded-full border-primary bg-surface" : ""
            }`}
            style={{
              transform: `translate(${r.left}px, ${r.top}px)`,
              width: r.width,
              height: r.height,
              zIndex: HANDLE_Z,
              borderWidth: corner ? 2 / zoom : 0,
            }}
          />
        );
      })}
    </>
  );
};

/**
 * The dashed box around a group (#171): drawn while the whole group is
 * selected, and fainter around the group the user stepped into while one of
 * its shapes is picked. A whole group carries the resize handles (#179).
 * Selection-only chrome — an image export captures with nothing selected, so
 * it never reaches a file.
 */
export const GroupOutlines = () => {
  const nodes = useDiagramStore((s) => s.nodes);
  const entered = useDiagramStore((s) => s.enteredGroup);
  const zoom = useStore((s) => s.transform[2]);
  const boxes = useMemo(() => groupOutlineBoxes(nodes, entered), [nodes, entered]);

  if (boxes.length === 0) return null;
  return (
    <ViewportPortal>
      {boxes.map((b) => (
        <div key={b.id}>
          <div
            data-group-outline={b.id}
            className={`pointer-events-none absolute left-0 top-0 rounded-sm border-[1.5px] border-dashed ${
              b.inside ? "border-primary/30" : "border-primary/70"
            }`}
            style={{ transform: `translate(${b.x}px, ${b.y}px)`, width: b.w, height: b.h }}
          />
          {b.inside ? null : <GroupResizeHandles groupId={b.id} box={b} zoom={zoom} />}
        </div>
      ))}
    </ViewportPortal>
  );
};
