type XY = { x: number; y: number };

/**
 * How near the pane's edge a node drag makes React Flow slide the view — its
 * `calcAutoPan` default (`distance = 40`, @xyflow/system). Dosik does not set
 * its own, so this mirrors the library's — `xyDragContract.test.ts` holds the
 * zone rule and the drop's rounding to the real thing.
 */
export const AUTO_PAN_DISTANCE = 40;

/**
 * Whether React Flow slides the view under a drag with the pointer at
 * `client` (#228) — the rule `calcAutoPan` applies, a non-zero speed when the
 * pointer is less than `distance` from any edge of `pane`, or outside it.
 * Exactly `distance` away is still at rest.
 */
export const inAutoPanZone = (
  client: XY,
  pane: { left: number; top: number; width: number; height: number },
  distance = AUTO_PAN_DISTANCE,
): boolean => {
  const x = client.x - pane.left;
  const y = client.y - pane.top;
  return x < distance || x > pane.width - distance || y < distance || y > pane.height - distance;
};

/**
 * The moves that put dropped nodes back on the grid, rounded the way React
 * Flow snaps a drag (#228): one node to its nearest cell (`snapPosition`),
 * several by the first one's correction so they keep their spacing
 * (`calculateSnapOffset`). Nodes already in place are left out.
 */
export const snapDrop = (
  nodes: readonly { id: string; position: XY }[],
  [gx, gy]: readonly [number, number],
): { id: string; position: XY }[] => {
  const first = nodes[0];
  if (!first) return [];
  const snap = (p: XY): XY => ({ x: gx * Math.round(p.x / gx), y: gy * Math.round(p.y / gy) });
  const ref = snap(first.position);
  const dx = ref.x - first.position.x;
  const dy = ref.y - first.position.y;
  return nodes.flatMap(({ id, position }) => {
    const next =
      nodes.length === 1 ? ref : { x: Math.round(position.x + dx), y: Math.round(position.y + dy) };
    return next.x === position.x && next.y === position.y ? [] : [{ id, position: next }];
  });
};
