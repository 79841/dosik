import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";

import type { FolderMeta } from "../../../library/libraryApi";
import { type BoardApi, BoardApiContext } from "../boardApi";
import { effectiveBoards, persistentLayout } from "../boardLayout";

/** a board api over `folders`' kept layout, at 100% with the board at the window's corner */
export const fakeApi = (folders: FolderMeta[] = [], over: Partial<BoardApi> = {}): BoardApi => ({
  toBoard: (client) => client,
  layout: () => persistentLayout(folders, effectiveBoards(folders, {}), {}),
  overIsland: () => false,
  focusItem: vi.fn(),
  holdsFocus: () => true,
  leave: vi.fn(),
  ...over,
});

export const renderInBoard = (ui: ReactElement, api: BoardApi = fakeApi()) => ({
  api,
  ...render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <BoardApiContext.Provider value={api}>{children}</BoardApiContext.Provider>
    ),
  }),
});
