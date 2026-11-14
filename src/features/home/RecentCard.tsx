import { FOCUS_RING } from "../../shared/lib/palette";
import { ProjectBadge } from "../../shared/ui/ProjectBadge";
import { openFromLibrary } from "../library/navigation";
import { relativeTimeSegment } from "../library/relativeTime";
import { DiagramThumbnail } from "./DiagramThumbnail";
import { type DiagramEntry, pathNames } from "./homeModel";
import { NoPreview, PathText } from "./homeParts";

/** what stands in for a recent card while the listing is slow: its shape, a 15:8 well and the two lines */
export const RecentCardPlaceholder = ({ className }: { className?: string }) => (
  <div className={`animate-pulse rounded-lg bg-frame px-2 pb-[55px] pt-2 ${className ?? ""}`}>
    <div className="aspect-[15/8]" />
  </div>
);

/**
 * A recent diagram (#178, #220 D10) — the dashboard's RECENT row and the
 * Recent view. It only opens; the tree and the folder views manage it. Where
 * it lives — the project, then its folders (#231 D10, `Main`) — is its meta
 * line and part of its name, so two diagrams with one title stay apart. A
 * diagram that could not be read has no picture.
 *
 * Its well is 15:8 like every card's (#236 D5). Two shapes by the card's
 * own width — the cell is the container, so the sidebar narrows it as much
 * as the window. Under `RECENT_WIDE_AT` (368 — `Main`, Medium's 336):
 * "{path} · {time}" below the title. From it (`HomeCollapse-Hidden`,
 * Medium's 400): the time at the title row's right end, and the path alone
 * below (#231 D10). Tailwind needs the `@min-[368px]:` classes spelled out
 * whole. `className` is the cell's place in its row (`recentShowClass`).
 */
export const RecentCard = ({ entry, className }: { entry: DiagramEntry; className?: string }) => {
  const { diagram } = entry;
  const { readable } = diagram;
  const path = pathNames(entry);
  const [project] = entry.path;
  const time = relativeTimeSegment(diagram.updatedAt);
  return (
    <li className={`@container min-w-0 ${className ?? ""}`}>
      <button
        type="button"
        aria-label={`Open ${diagram.title} in ${path.join(" / ")}`}
        onClick={() => void openFromLibrary(diagram.id)}
        className={`flex h-full w-full flex-col rounded-lg bg-surface px-2 pb-2.5 pt-2 text-left shadow-raised motion-safe:transition-shadow hover:shadow-lifted ${FOCUS_RING}`}
      >
        <span className="block aspect-[15/8] w-full overflow-hidden rounded-[6px] bg-surface">
          {readable ? (
            <DiagramThumbnail id={diagram.id} updatedAt={diagram.updatedAt} lazy />
          ) : (
            <NoPreview />
          )}
        </span>
        <span className="mt-2 flex w-full items-baseline gap-2 px-0.5">
          <span className="min-w-0 flex-auto truncate text-[12px] font-semibold leading-4 text-ink">
            {diagram.title}
          </span>
          <span className="hidden flex-none whitespace-nowrap text-[11px] leading-4 text-muted @min-[368px]:block">
            {time}
          </span>
        </span>
        {/* the project's badge first (#236 D4), 6 under the title; only the path gives
            way when the card is narrow — the badge and the time stay whole, the time a
            segment of its own ("· Yesterday", `Main`) */}
        <span className="mt-1.5 flex w-full items-center whitespace-nowrap px-0.5 text-[11px] leading-[15px] text-muted">
          {project ? (
            <ProjectBadge id={project.id} name={project.name} size={14} className="mr-[5px]" />
          ) : null}
          <span className="min-w-0 truncate">
            <PathText names={path} />
          </span>
          <span className="flex-none @min-[368px]:hidden">{`\u00a0· ${time}`}</span>
        </span>
      </button>
    </li>
  );
};
