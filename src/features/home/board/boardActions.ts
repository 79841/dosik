import { toastError } from "../../../shared/lib/toastStore";
import {
  type BoardFailure,
  type FolderMeta,
  type ItemKey,
  setFolderBoards,
} from "../../library/libraryApi";
import { newFolder, placeItem } from "../../library/libraryActions";
import { refreshLibraryQuietly, useLibraryStore } from "../../library/libraryStore";
import { canPlace, projectOf, siblingsOf } from "../../library/libraryTree";
import { screenStamp, stillOnScreen } from "../../library/screenStamp";
import { SNAP } from "./boardGeometry";
import {
  type BoardEntry,
  effectiveBoards,
  persistentLayout,
  placeNewFrame,
  planCommit,
} from "./boardLayout";
import { frameKey } from "./boardNav";
import { useBoardStore } from "./boardStore";

/**
 * What the library board does to the library (#221 D6, D9, D13–D15). Every
 * place change goes through `commitBoard`: it settles the board with the
 * change in, puts what differs from the store into the overlay at once — the
 * screen does not wait — and queues one `set_folder_boards`. Working out
 * and showing are synchronous; only the writes are chained, in order.
 */

/** the writes, one after another — a later place never lands before an earlier one */
let chain: Promise<boolean> = Promise.resolve(true);
/** New project is under way — a second press makes nothing */
let creating = false;

export interface BoardChange {
  /** places and settings the action sets (merged over what is known) */
  overrides?: Record<string, BoardEntry>;
  /** whose place wins (D9): a frame that grew, a project that took a card */
  first?: string;
  /** who makes room: a frame dropped somewhere */
  last?: string;
  /** a person's action: a failure is a toast and a fresh listing */
  user?: boolean;
}

/** what a person is told when projects could not take their places: their names and the first why */
const placeFailed = (failures: BoardFailure[]): Error => {
  const folders = useLibraryStore.getState().folders ?? [];
  const names = failures
    .map(({ id }) => `“${folders.find((f) => f.id === id)?.name ?? id}”`)
    .join(", ");
  return new Error(`Could not place ${names} on the canvas — ${failures[0]?.error ?? ""}`);
};

/**
 * Settles the board with `change` and writes what moved (D9). Resolves
 * whether the write went through — `true` with nothing to write. A person's
 * action that fails says so and lists the library again; the board's own
 * placing fails quietly and does not try those projects again this run.
 */
export const commitBoard = (change: BoardChange = {}): Promise<boolean> => {
  const folders = useLibraryStore.getState().folders;
  if (!folders) return Promise.resolve(true);
  const board = useBoardStore.getState();
  const stored = effectiveBoards(folders, board.overlay);
  const boards = effectiveBoards(folders, board.overlay, change.overrides);
  const layout = persistentLayout(folders, boards, { first: change.first, last: change.last });
  // what the action is about is tried again even if placing it failed before
  const touched = new Set([...Object.keys(change.overrides ?? {}), change.first, change.last]);
  const skip = new Set([...board.failed].filter((id) => !touched.has(id)));
  const plan = planCommit(layout, boards, stored, skip);
  if (plan.length === 0) return Promise.resolve(true);
  board.sent(plan);
  /** some (or all) of the places did not go down: out of the overlay, and said or noted */
  const fail = (ids: Set<string>, error: unknown): false => {
    useBoardStore.getState().unsent(plan.filter((e) => ids.has(e.id)));
    if (change.user) {
      toastError(error);
      refreshLibraryQuietly();
    } else {
      useBoardStore.getState().markFailed([...ids]);
    }
    return false;
  };
  // `chain` never rejects: each link settles to whether its write went through
  const done = chain
    .then(() => setFolderBoards(plan))
    .then(
      // Rust names the projects it could not place; the rest are written
      (failures) =>
        failures.length === 0 || fail(new Set(failures.map((f) => f.id)), placeFailed(failures)),
      // the call itself failed: nothing sent went down
      (error: unknown) => fail(new Set(plan.map((e) => e.id)), error),
    );
  chain = done;
  return done;
};

/** the board as it is kept now — what a new frame or a drop is placed against */
const keptLayout = (folders: FolderMeta[]) => {
  const { overlay } = useBoardStore.getState();
  return persistentLayout(folders, effectiveBoards(folders, overlay), {});
};

/**
 * Right-click › New project (D15): a project whose frame's corner is at
 * board point `at` — or the nearest room past what is there — made with its
 * place in one write, then named in its frame. A second press while the
 * first is out makes nothing. Resolves the new id.
 */
export const newProjectAt = async (
  at: { x: number; y: number },
  /** whether the new frame's name may still take the focus once made (#218 D15) */
  mayFocus: () => boolean = () => true,
): Promise<string | undefined> => {
  if (creating) return undefined;
  creating = true;
  // the screen it was asked from: named in place only if it still is (#218 D15, #229)
  const asked = screenStamp();
  try {
    const spot = placeNewFrame(keptLayout(useLibraryStore.getState().folders ?? []), at);
    const id = await newFolder({ board: spot });
    if (id && stillOnScreen(asked) && mayFocus()) {
      const board = useBoardStore.getState();
      board.setRenaming(id);
      board.setCurrent(frameKey(id));
    }
    return id;
  } finally {
    creating = false;
  }
};

/** Expand / Collapse (D6): kept, the frame growing in place and its neighbours making room */
export const setCollapsed = (folder: string, collapsed: boolean): Promise<boolean> =>
  commitBoard({ overrides: { [folder]: { collapsed } }, first: folder, user: true });

const snap = (v: number) => Math.round(v / SNAP) * SNAP + 0;

/** a frame let go at board point `at` (D14): on the 20 grid, making room if it lands on another */
export const dropFrame = (folder: string, at: { x: number; y: number }): Promise<boolean> =>
  commitBoard({
    overrides: { [folder]: { x: snap(at.x), y: snap(at.y) } },
    last: folder,
    user: true,
  });

/**
 * Moves a card's item — a diagram or a folder — to the top of folder `to`,
 * at any depth: a card dropped on another frame (#231 D15) and a card's
 * Move to… (#229 D13) alike, by `placeItem` (#230 D13). The screen shows it
 * at once and the project that took it keeps its place — its neighbours
 * make room (D9); then the move itself, which says what it did — or,
 * failing, says so and lists again. Nothing where `canPlace` says no (#230
 * D7), nor into the folder it is in already.
 */
export const moveCardInto = (item: ItemKey, to: string): Promise<boolean> => {
  const folders = useLibraryStore.getState().folders;
  const project = folders ? projectOf(folders, to) : null;
  if (!folders || !project || !canPlace(folders, item, to)) return Promise.resolve(false);
  if (siblingsOf(folders, item)?.parent === to) return Promise.resolve(false);
  // `placeItem` shows the new listing before it returns: settled with the receiver first
  const placing = placeItem(item, { parent: to, index: 0 });
  void commitBoard({ first: project.id, user: true });
  return placing;
};

/** test seam: no write on its way, nothing being made */
export const resetBoardActionsForTests = (): void => {
  chain = Promise.resolve(true);
  creating = false;
};
