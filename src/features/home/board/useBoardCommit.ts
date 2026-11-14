import { useEffect } from "react";

import type { FolderMeta } from "../../library/libraryApi";
import { commitBoard } from "./boardActions";
import { useBoardStore } from "./boardStore";

/**
 * Keeps what is stored in step with what the board shows (#221 D8, D9):
 * each listing first clears the overlay of what it confirms, then the board
 * pins the projects it placed itself and writes what settling moved. A
 * listing that matches the store writes nothing.
 */
export const useBoardCommit = (folders: FolderMeta[] | null): void => {
  useEffect(() => {
    if (!folders) return;
    useBoardStore.getState().reconcile(folders);
    void commitBoard({});
  }, [folders]);
};
