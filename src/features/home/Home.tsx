import { useEffect, useLayoutEffect, useRef } from "react";

import { useSidebarStore } from "../../shared/lib/sidebarLayout";
import { useSidebarSliding } from "../../shared/lib/sidebarSlide";
import { toastError } from "../../shared/lib/toastStore";
import { useAppStore } from "../library/appStore";
import { resolveHomeView } from "../library/homeView";
import { findFolder, isMissing } from "../library/libraryTree";
import { useLibraryStore } from "../library/libraryStore";
import { focusHomeTitleIfStill } from "../library/navigation";
import { flushAutosave } from "../library/useAutosave";
import { LibraryBoard } from "./board/LibraryBoard";
import { Dashboard } from "./Dashboard";
import { FolderView } from "./FolderView";
import { cardGrid, contentColumn } from "./homeGrid";
import { HomeHeader } from "./HomeHeader";
import { useCardSize, useHomeMode } from "./homeMode";
import { useSlow } from "./homeParts";
import { NotFoundBox } from "./NotFoundBox";
import { RecentView } from "./RecentView";

/**
 * What stands in for a view whose folder the first listing has not named yet
 * — at the size picked, each in a folder card's shape (`CardFrame`, card C
 * of #265): a 15:8 well, then the 40px caption bar.
 */
const ViewSkeleton = () => (
  <div
    role="status"
    aria-busy="true"
    aria-label="Loading projects"
    className={cardGrid(useCardSize())}
  >
    {[0, 1, 2].map((i) => (
      <div key={i} className="animate-pulse rounded-lg bg-frame pb-10">
        <div className="aspect-[15/8]" />
      </div>
    ))}
  </div>
);

/**
 * The Home tab (#114, #161, #220): one of three views, picked by
 * `appStore.homeView` as the listing resolves it (D1, #231 D1) — the same
 * value the sidebar selects by, so the two never disagree. Mounted instead
 * of the editor, not over it.
 *
 * One header row at the top (#231 D2, D5) — the path, a folder's actions,
 * the Cards | Canvas switch — drawn once for every view and mode, so the
 * switch is never drawn anew; under it the body. In Cards the dashboard,
 * Recent and a folder sit on the 12-column grid — 1040 wide with the sidebar
 * docked, 1232 with it hidden or peeking (D12) — and scroll under the row. In
 * Canvas (#221 D1, D2) the same view is the library board's focus, and the
 * board fills the body — every view but Recent, which the board has no match
 * for. A project not found shows, in Cards, its frame's box centred in the
 * body (#253 R7, `Library-Missing`).
 *
 * On show it waits for the writes on their way, then lists the library, so
 * the fresh list's `updatedAt` holds the last edit (D14 ⑨). Until it comes
 * the cards draw from the list in hand — a diagram just edited shows its last
 * picture for a moment, and keeps it until the new one is drawn (no placeholder flash, #220). A move made inside the sheet puts focus
 * on the new view's heading — the header's current path step (D16, #231 D3).
 */
export const Home = () => {
  const folders = useLibraryStore((s) => s.folders);
  const homeView = useAppStore((s) => s.homeView);
  const focusTicket = useAppStore((s) => s.homeFocus);
  const hidden = useSidebarStore((s) => s.hidden);
  const sliding = useSidebarSliding();
  const mode = useHomeMode((s) => s.mode);
  const sheet = useRef<HTMLElement>(null);
  const seenTicket = useRef(focusTicket);
  const view = resolveHomeView(homeView, folders);
  const slow = useSlow(folders === null);

  useEffect(() => {
    void flushAutosave()
      .catch(() => undefined)
      .then(() => useLibraryStore.getState().refresh())
      .catch(toastError);
  }, []);

  // after the view a move asked for is drawn — its heading is in the sheet by now
  useLayoutEffect(() => {
    if (focusTicket === seenTicket.current) return;
    seenTicket.current = focusTicket;
    sheet.current?.querySelector<HTMLElement>("[data-home-heading]")?.focus();
  });

  const shown = view.kind === "folder" && folders ? findFolder(folders, view.folder)?.folder : null;
  return (
    <main ref={sheet} aria-label="Home" className="flex h-full w-full flex-col bg-surface">
      <HomeHeader />
      {mode === "canvas" && view.kind !== "recent" ? (
        <div key="canvas" className="relative min-h-0 flex-1">
          <LibraryBoard />
        </div>
      ) : (
        <div key="cards" className="min-h-0 flex-1 overflow-y-auto px-8 pt-4 pb-6">
          {shown && isMissing(shown) ? (
            // found: its heading takes the focus — the box and its button are
            // gone — while Home still shows it (#218 D15)
            <div className="flex h-full items-center justify-center">
              <NotFoundBox
                folder={shown}
                size="cards"
                onLocated={(asked) =>
                  focusHomeTitleIfStill(asked, { kind: "folder", folder: shown.id })
                }
              />
            </div>
          ) : (
            <div className={contentColumn(hidden, sliding)}>
              {view.kind === "dashboard" ? (
                <Dashboard />
              ) : view.kind === "recent" ? (
                <RecentView />
              ) : shown && folders ? (
                // one view per folder: an edit under way stays with its folder
                <FolderView key={shown.id} folder={shown} folders={folders} />
              ) : slow ? (
                <ViewSkeleton />
              ) : null}
            </div>
          )}
        </div>
      )}
    </main>
  );
};
