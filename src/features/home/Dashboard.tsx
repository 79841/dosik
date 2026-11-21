import { ChevronRight } from "lucide-react";
import { useId } from "react";

import { FOCUS_RING } from "../../shared/lib/palette";
import { allDiagrams } from "../library/libraryTree";
import { viewInHome } from "../library/navigation";
import { ContinueCard } from "./ContinueCard";
import { cardGrid, recentShowClass } from "./homeGrid";
import { useCardSize } from "./homeMode";
import { continueAndRecent, RECENT_ON_DASHBOARD } from "./homeModel";
import { HomeNotice, LoadFailed, useListing } from "./homeParts";
import { SECTION_LABEL } from "./homeStyles";
import { RecentCard, RecentCardPlaceholder } from "./RecentCard";
import { StartTiles } from "./StartTiles";
import { TargetLine } from "./TargetLine";

/** what stands in for Continue and Recent while a slow listing is out (D20): their shapes */
const DashboardSkeleton = () => {
  const size = useCardSize();
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading projects"
      className="mt-5 flex flex-col gap-4"
    >
      <div className="h-[280px] animate-pulse rounded-xl bg-frame" />
      <div className={cardGrid(size)}>
        {Array.from({ length: RECENT_ON_DASHBOARD }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
          <RecentCardPlaceholder key={i} className={recentShowClass(size, i)} />
        ))}
      </div>
    </div>
  );
};

/**
 * Home's dashboard (#220 D5): start something, continue the last thing,
 * reopen a recent one — under the header row's "Home" (#231 D2). START
 * never waits for the listing; the rest shows the listing's state —
 * placeholders when it is slow, the failure, the empty library (D20).
 * RECENT is one row of cards at the size picked (#236 D7): as many as it
 * holds, four at most.
 */
export const Dashboard = () => {
  const startId = useId();
  const continueId = useId();
  const recentId = useId();
  const { folders, failed, slow } = useListing();
  const size = useCardSize();
  const { continued, recent } = folders
    ? continueAndRecent(folders)
    : { continued: null, recent: [] };
  // a diagram at any depth makes the library not empty (#229 D5)
  const empty = folders ? allDiagrams(folders).length === 0 : false;

  return (
    <>
      {/* "Home" and the switch are the header row's (#231 D2, D5): START comes first */}
      <section aria-labelledby={startId}>
        <h2 id={startId} className={`mb-2.5 ${SECTION_LABEL}`}>
          Start
        </h2>
        <StartTiles />
        <TargetLine />
      </section>
      {folders === null ? (
        slow ? (
          <DashboardSkeleton />
        ) : null
      ) : failed ? (
        <div className="mt-5">
          <LoadFailed />
        </div>
      ) : empty ? (
        <div className="mt-5">
          <HomeNotice title="No diagrams yet">
            Start one above, open a .dosik file, or send ops to the bridge — a diagram is created
            for them.
          </HomeNotice>
        </div>
      ) : (
        <>
          {continued ? (
            <section aria-labelledby={continueId} className="mt-5">
              <h2 id={continueId} className={`mb-2.5 ${SECTION_LABEL}`}>
                Continue
              </h2>
              <ContinueCard entry={continued} />
            </section>
          ) : null}
          {recent.length > 0 ? (
            <section aria-labelledby={recentId} className="mt-5">
              <div className="mb-2.5 flex items-center justify-between gap-2.5">
                <h2 id={recentId} className={SECTION_LABEL}>
                  Recent
                </h2>
                <button
                  type="button"
                  aria-label="See all recent diagrams"
                  onClick={() => viewInHome({ kind: "recent" }, true)}
                  className={`inline-flex items-center gap-1 rounded-sm text-[11.5px] font-semibold leading-[14px] text-icon transition-colors hover:text-ink ${FOCUS_RING}`}
                >
                  See all
                  <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
              <ul aria-label="Recent diagrams" className={`m-0 list-none p-0 ${cardGrid(size)}`}>
                {recent.map((entry, i) => (
                  <RecentCard
                    key={entry.diagram.id}
                    entry={entry}
                    className={recentShowClass(size, i)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </>
  );
};
