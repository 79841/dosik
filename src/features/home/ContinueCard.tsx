import { ArrowRight } from "lucide-react";
import { type MouseEvent, useId } from "react";

import { clickOpens } from "../../shared/lib/doubleClickGuard";
import { ProjectBadge } from "../../shared/ui/ProjectBadge";
import { openFromLibrary } from "../library/navigation";
import { relativeTime } from "../library/relativeTime";
import { DiagramThumbnail } from "./DiagramThumbnail";
import { type DiagramEntry, pathNames } from "./homeModel";
import { DOT_GRID_16, PathText } from "./homeParts";
import { INK_FILL, TILE_LINE } from "./homeStyles";

/**
 * CONTINUE (#220 D9): the diagram edited last — its picture, where it lives
 * (#231 D10, `Main`), title and edit, and Resume. A hairline round it, no
 * shadow (card C, #265). A diagram open in a tab is
 * only switched to. The well is Resume for the pointer; the keyboard has the
 * button.
 */
export const ContinueCard = ({ entry }: { entry: DiagramEntry }) => {
  const titleId = useId();
  const { diagram } = entry;
  const { title } = diagram;
  const [project] = entry.path;
  // one open per double click — the rest would land on the tab it opened
  const resume = (e: MouseEvent) => {
    if (clickOpens(e)) void openFromLibrary(diagram.id);
  };
  return (
    <article
      aria-labelledby={titleId}
      className={`flex min-h-[280px] flex-wrap gap-5 rounded-xl bg-surface p-2.5 ${TILE_LINE}`}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard resumes with the Resume button — the well is no tab stop of its own (D9) */}
      <div
        role="img"
        aria-label={`Preview of ${title}`}
        onClick={resume}
        className={`relative h-[260px] min-w-0 flex-[11_1_330px] cursor-pointer overflow-hidden rounded-[6px] bg-surface ${DOT_GRID_16}`}
      >
        <div className="absolute inset-4">
          <DiagramThumbnail id={diagram.id} updatedAt={diagram.updatedAt} />
        </div>
      </div>
      <div className="flex min-w-0 flex-[9_1_270px] flex-col items-start pb-1 pr-2.5 pt-2">
        {/* the project, with its badge (#236 D4), then the folders down to the diagram's (#231 D10) */}
        <span className="inline-flex h-[22px] max-w-full items-center gap-1.5 whitespace-nowrap rounded-full bg-hover pl-1 pr-2 text-[11px] font-medium text-icon">
          {project ? <ProjectBadge id={project.id} name={project.name} size={14} /> : null}
          <PathText names={pathNames(entry)} />
        </span>
        <h3
          id={titleId}
          className="m-0 mt-3 max-w-full truncate text-[18px] font-semibold leading-6 tracking-[-0.015em] text-ink"
        >
          {title}
        </h3>
        <p className="m-0 mt-1 text-[11.5px] leading-[15px] text-muted">
          {`Edited ${relativeTime(diagram.updatedAt)}`}
        </p>
        {/* at the foot */}
        <div className="mt-auto pt-3">
          <button
            type="button"
            aria-label={`Resume ${title}`}
            onClick={resume}
            className={`h-8 gap-2 rounded-lg pl-3 pr-2.5 ${INK_FILL}`}
          >
            Resume
            <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
};
