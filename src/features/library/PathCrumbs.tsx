import type { ReactNode } from "react";

import { FOCUS_RING } from "../../shared/lib/palette";
import { ProjectBadge } from "../../shared/ui/ProjectBadge";

/** a step of the path: a folder the user can go to */
export interface Crumb {
  id: string;
  name: string;
}

const ITEM = "flex h-[26px] min-w-0 items-center gap-1.5 rounded-[5px] px-1.5 text-[12px]";

/**
 * The path to a diagram (#229 D3, `EditorH-Tabs`): its folders, from the top
 * down, then the diagram — "Payments / Checkout / Order flow". An ancestor is
 * a button, muted until the pointer is on it; "/" between the steps is
 * decoration; the diagram is the current step, in ink. No dot. When it is
 * narrow the ancestors give way first (each at most 160px, cut with an
 * ellipsis), the current step last. The editor's toolbar row draws it; what
 * a press does is the caller's.
 *
 * Home's header row draws it too (#231 D3): there the current step is the
 * sheet's one h1 (`heading`) — what takes the focus after a move inside the
 * sheet — and a rename puts its field in the current step's place (`editor`).
 * There the project's step carries its badge (#236 D4, `project`); the
 * editor's path keeps names only. Home's current step also says when the
 * pointer is on it (`onCurrentHover`) — the folder's path card hangs from it
 * (#238 R3) — and keeps the hover wash while that card is open.
 */
export const PathCrumbs = ({
  path,
  current,
  currentId,
  project,
  onCrumb,
  heading = false,
  editor,
  onCurrentHover,
  currentActive = false,
  className = "",
}: {
  path: readonly Crumb[];
  current: string;
  /** the current step's folder, when it is one */
  currentId?: string | null;
  /** the project's folder id: its step, an ancestor or the current one, shows the badge */
  project?: string | null;
  onCrumb: (id: string) => void;
  /** the current step is the page's title: an h1 that takes the focus a move asks for */
  heading?: boolean;
  /** drawn in the current step's place — a name being edited */
  editor?: ReactNode;
  /** the pointer on the current step: it, then null when it leaves (#238 — Home's path card) */
  onCurrentHover?: (step: HTMLElement | null) => void;
  /** the current step's card is open: the step keeps the hover wash */
  currentActive?: boolean;
  /** the nav's own layout in its row */
  className?: string;
}) => {
  /** the current step is the project's: the badge goes before its name, or before the field renaming it */
  const badge = project != null && currentId === project ? project : null;
  const currentName = (
    <>
      {badge ? <ProjectBadge id={badge} name={current} size={14} /> : null}
      <span className="truncate">{current}</span>
    </>
  );
  // a step that answers the pointer takes the hover wash, and keeps it while its card is open
  const hover = onCurrentHover
    ? {
        onPointerEnter: (e: React.PointerEvent<HTMLElement>) => onCurrentHover(e.currentTarget),
        onPointerLeave: () => onCurrentHover(null),
      }
    : {};
  const wash = onCurrentHover
    ? `transition-colors hover:bg-hover${currentActive ? " bg-hover" : ""}`
    : "";
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex min-w-0 items-center overflow-hidden ${className}`}
    >
      <ol className="m-0 flex min-w-0 list-none items-center gap-0.5 whitespace-nowrap p-0">
        {path.map((crumb, i) => (
          // an ancestor can give way to nothing — clipped, never pushing the current item
          <li
            key={crumb.id}
            className="flex min-w-0 shrink-[1000] items-center gap-0.5 overflow-hidden"
          >
            {i > 0 ? <Slash /> : null}
            <button
              type="button"
              onClick={() => onCrumb(crumb.id)}
              className={`${ITEM} max-w-40 bg-surface font-medium text-muted transition-colors hover:text-ink ${FOCUS_RING}`}
            >
              {crumb.id === project ? (
                <ProjectBadge id={crumb.id} name={crumb.name} size={14} />
              ) : null}
              <span className="truncate">{crumb.name}</span>
            </button>
          </li>
        ))}
        {/* the current item gives way only when no ancestor can: then it is cut at the end (D3) */}
        <li className="flex min-w-0 max-w-full shrink-0 items-center gap-0.5">
          {path.length > 0 ? <Slash /> : null}
          {editor ? (
            <>
              {badge ? (
                <ProjectBadge id={badge} name={current} size={14} className="mr-1.5" />
              ) : null}
              {editor}
            </>
          ) : heading ? (
            <h1
              aria-current="page"
              data-home-heading=""
              tabIndex={-1}
              {...hover}
              className={`${ITEM} m-0 font-semibold text-ink outline-none ${wash}`}
            >
              {currentName}
            </h1>
          ) : (
            <span
              aria-current="page"
              {...hover}
              className={`${ITEM} font-semibold text-ink ${wash}`}
            >
              {currentName}
            </span>
          )}
        </li>
      </ol>
    </nav>
  );
};

const Slash = () => (
  <span aria-hidden="true" className="flex-none text-[12px] text-dash">
    /
  </span>
);
