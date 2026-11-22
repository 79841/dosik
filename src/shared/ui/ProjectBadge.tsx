import { type BadgeColour, badgeColour, badgeLetter } from "../lib/projectBadge";

/** Tailwind reads class names as written: one literal pair per colour */
const COLOUR_CLASS: Record<BadgeColour, string> = {
  blue: "bg-badge-blue-soft text-badge-blue",
  teal: "bg-badge-teal-soft text-badge-teal",
  orange: "bg-badge-orange-soft text-badge-orange",
  pink: "bg-badge-pink-soft text-badge-pink",
  green: "bg-badge-green-soft text-badge-green",
  violet: "bg-badge-violet-soft text-badge-violet",
};

/**
 * 16 — a sidebar or picker row; 14 — Home's small-text lines (the header
 * path, Continue, Recent cards, "New diagrams go to"); "board" — a project
 * frame's head on the library board, in board units.
 */
export type ProjectBadgeSize = 16 | 14 | "board";

const SIZE_CLASS: Record<ProjectBadgeSize, string> = {
  16: "h-4 w-4 rounded-[4.5px] text-[10px]",
  14: "h-3.5 w-3.5 rounded-[4px] text-[9px]",
  board: "h-5 w-5 rounded-[5.5px] text-[12px]",
};

/** a project whose folder cannot be found (#253 R7): its mark greyed */
const GREYED_CLASS = "bg-fill-subtle text-muted";

/**
 * A project's mark (#236 D3, `badge` in the design system): the first letter
 * of its name in its colour on that colour's tint. The colour comes from the
 * project's folder id; `greyed`, a project not found, has none (#253 R7). Not
 * read — the name beside it is.
 */
export const ProjectBadge = ({
  id,
  name,
  size = 16,
  greyed = false,
  className = "",
}: {
  id: string;
  name: string;
  size?: ProjectBadgeSize;
  greyed?: boolean;
  className?: string;
}) => (
  <span
    aria-hidden="true"
    className={`inline-flex flex-none items-center justify-center font-bold leading-none ${SIZE_CLASS[size]} ${greyed ? GREYED_CLASS : COLOUR_CLASS[badgeColour(id)]} ${className}`}
  >
    {badgeLetter(name)}
  </span>
);
