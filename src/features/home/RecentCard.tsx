import { clickOpens } from "../../shared/lib/doubleClickGuard";
import { FOCUS_CARD } from "../../shared/lib/palette";
import { DiagramGlyph } from "../../shared/ui/KindGlyph";
import { ProjectBadge } from "../../shared/ui/ProjectBadge";
import { openFromLibrary } from "../library/navigation";
import { relativeTimeSegment } from "../library/relativeTime";
import { DiagramThumbnail } from "./DiagramThumbnail";
import { type DiagramEntry, pathNames } from "./homeModel";
import { NoPreview, PathText } from "./homeParts";
import {
  CAPTION_LINE,
  CAPTION_META,
  CAPTION_POINTING,
  CARD_HOVER,
  CARD_LINE,
  CARD_PRESS,
} from "./homeStyles";

/**
 * what stands in for a recent card while the listing is slow: its shape, a
 * 15:8 well and the caption block's 56 (a hairline + 8 + 15 + 8 + 16 + 8)
 */
export const RecentCardPlaceholder = ({ className }: { className?: string }) => (
  <div className={`animate-pulse rounded-lg bg-frame pb-[56px] ${className ?? ""}`}>
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
 * Card C (#265, `Main`): a hairline, the picture full bleed, and under a
 * hairline the caption block — first where it lives and when ("{path} ·
 * {time}"), then the diagram's glyph and title. Both rows keep one left edge:
 * the project's badge sits in the same 16px slot as the glyph below, and
 * the block keeps one step all round — 8 above, between and below. One
 * shape at every width. Pointing at it darkens its lines and tints the
 * caption, as on a folder view's card. Its well is 15:8 like every card's
 * (#236 D5). `className` is the cell's place in its row (`recentShowClass`).
 */
export const RecentCard = ({ entry, className }: { entry: DiagramEntry; className?: string }) => {
  const { diagram } = entry;
  const { readable } = diagram;
  const path = pathNames(entry);
  const [project] = entry.path;
  const time = relativeTimeSegment(diagram.updatedAt);
  return (
    <li className={`min-w-0 ${className ?? ""}`}>
      <button
        type="button"
        aria-label={`Open ${diagram.title} in ${path.join(" / ")}`}
        // one open per double click — the rest would land on the tab it opened
        onClick={(e) => {
          if (clickOpens(e)) void openFromLibrary(diagram.id);
        }}
        className={`group/card flex h-full w-full flex-col overflow-hidden rounded-lg bg-surface text-left ${CARD_LINE} ${CARD_HOVER} ${CARD_PRESS} ${FOCUS_CARD}`}
      >
        <span className="block aspect-[15/8] w-full overflow-hidden bg-surface">
          {readable ? (
            <DiagramThumbnail id={diagram.id} updatedAt={diagram.updatedAt} lazy />
          ) : (
            <NoPreview />
          )}
        </span>
        <span
          className={`flex w-full flex-auto flex-col gap-2 px-3 py-2 ${CAPTION_LINE} ${CAPTION_POINTING}`}
        >
          {/* where it lives and when: the project's badge first (#236 D4), in the glyph's
              16px slot; only the path gives way — the badge and the time stay whole, the
              time a segment of its own ("· Yesterday", `Main`) */}
          <span
            className={`flex w-full min-w-0 items-center gap-2 whitespace-nowrap text-[11px] leading-[15px] ${CAPTION_META}`}
          >
            <span className="flex w-4 flex-none justify-center">
              {project ? <ProjectBadge id={project.id} name={project.name} size={14} /> : null}
            </span>
            <span className="min-w-0 truncate">
              <PathText names={path} />
            </span>
            <span className="-ml-2 flex-none">{`\u00a0· ${time}`}</span>
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <DiagramGlyph />
            <span className="min-w-0 flex-auto truncate text-[12px] font-semibold leading-4 text-ink">
              {diagram.title}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
};
