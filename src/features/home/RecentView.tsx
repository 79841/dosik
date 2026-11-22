import { cardGrid } from "./homeGrid";
import { useCardSize } from "./homeMode";
import { allRecent } from "./homeModel";
import { HomeNotice, LoadFailed, useListing } from "./homeParts";
import { RecentCard, RecentCardPlaceholder } from "./RecentCard";

/**
 * Recent (#220 D10) — the sidebar's Recent row and the dashboard's See all:
 * every diagram, most recently edited first, as the dashboard's recent cards,
 * at the size picked (#236 D5 — Medium until one is).
 * No cap; the pictures are read as they scroll into view. "Recent" and how
 * many are the header row's (#231 D2); the grid comes first.
 */
export const RecentView = () => {
  const { folders, failed, slow } = useListing();
  const entries = folders ? allRecent(folders) : [];
  const grid = cardGrid(useCardSize());
  if (folders === null) {
    return slow ? (
      <div role="status" aria-busy="true" aria-label="Loading projects" className={grid}>
        {[0, 1, 2, 3].map((i) => (
          <RecentCardPlaceholder key={i} />
        ))}
      </div>
    ) : null;
  }
  if (failed) return <LoadFailed />;
  if (entries.length === 0) {
    return (
      <HomeNotice title="No diagrams yet">
        Start one from Home, open a .dosik file, or send ops to the bridge.
      </HomeNotice>
    );
  }
  return (
    <ul aria-label="Recent diagrams" className={`m-0 list-none p-0 ${grid}`}>
      {entries.map((entry) => (
        <RecentCard key={entry.diagram.id} entry={entry} />
      ))}
    </ul>
  );
};
