import { Clock, FolderOpen, House, type LucideIcon, PanelLeft, Settings } from "lucide-react";

import { FOCUS_RING } from "../../shared/lib/palette";
import { keyshortcuts, shortcutLabel } from "../../shared/lib/shortcutLabel";
import { useSidebarStore } from "../../shared/lib/sidebarLayout";
import { useDiagramStore } from "../../shared/lib/store";
import { ICON_STROKE, IconButton, SMALL_ICON_SIZE } from "../../shared/ui/IconButton";
import { ThemeToggle } from "../../shared/ui/ThemeToggle";
import { useAppStore } from "../library/appStore";
import { DASHBOARD } from "../library/homeView";
import { useLibraryStore } from "../library/libraryStore";
import { openFileAnywhere, showRecent, viewInHome } from "../library/navigation";
import { openSettings } from "../settings/settingsStore";
import { ProjectsSection } from "./LibraryTree";
import { HOME_KEY, RECENT_KEY, selectedKey } from "./treeModel";

const icon = { size: SMALL_ICON_SIZE, strokeWidth: ICON_STROKE, "aria-hidden": true } as const;
/** a sidebar row's icon is 16, like the tree's glyphs (#236 D1) */
const rowIcon = { ...icon, size: 16 } as const;

/** a Views row, 30px like the tree's (`row-height`, #236 D1) */
const NavRow = ({
  label,
  icon: Icon,
  current,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  current?: boolean;
  onClick: () => void;
}) => (
  <li>
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      onClick={onClick}
      className={`flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink transition-colors ${FOCUS_RING} ${
        current ? "bg-selected font-semibold" : "font-medium hover:bg-hover"
      }`}
    >
      <Icon {...rowIcon} className={current ? "text-ink" : "text-icon"} />
      {label}
    </button>
  </li>
);

/**
 * What the docked sidebar and the peek share (R5): the Views nav, the
 * PROJECTS tree, and the footer — Open file… and the theme switch. Only the
 * frame around it differs: nothing above it when docked (no brand row, #231
 * D17), a "Library" header with Pin when peeking.
 */
export const LibraryBody = () => {
  const view = useAppStore((s) => s.view);
  const homeView = useAppStore((s) => s.homeView);
  const folders = useLibraryStore((s) => s.folders);
  const projectId = useDiagramStore((s) => s.projectId);
  const selected = selectedKey({ view, homeView, folders, projectId });
  return (
    <>
      <nav aria-label="Views" className="flex-none">
        <ul className="m-0 flex list-none flex-col gap-px p-0">
          <NavRow
            label="Home"
            icon={House}
            current={selected === HOME_KEY}
            onClick={() => viewInHome(DASHBOARD)}
          />
          <NavRow
            label="Recent"
            icon={Clock}
            current={selected === RECENT_KEY}
            onClick={showRecent}
          />
        </ul>
      </nav>
      <ProjectsSection />
      <div className="mt-1.5 flex flex-none items-center gap-1">
        <button
          type="button"
          aria-keyshortcuts={keyshortcuts("O")}
          onClick={() => void openFileAnywhere()}
          className={`flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-hover ${FOCUS_RING}`}
        >
          <FolderOpen {...rowIcon} className="flex-none text-icon" />
          <span className="truncate">Open file…</span>
        </button>
        <IconButton
          label="Settings"
          shortcut={shortcutLabel(",")}
          keyshortcuts={keyshortcuts(",")}
          popup="dialog"
          onClick={() => openSettings()}
          size={28}
          tooltip="above"
          align="end"
        >
          <Settings size={SMALL_ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </IconButton>
        <ThemeToggle size={28} tooltip="above" align="end" />
      </div>
    </>
  );
};

/**
 * The docked library sidebar (#217 R2), under the chrome band — the band's
 * left end is its top row (traffic lights, Hide sidebar). The Frame gives it
 * its slot, width and error boundary — a crash in the tree leaves the document.
 */
export const LibrarySidebar = () => (
  <aside
    aria-label="Library"
    // what hiding takes off screen: focus in here goes to Show sidebar (D29)
    data-sidebar-region=""
    // nodelete: Backspace in here must not delete the canvas selection (D27)
    // no brand row (#231 D17): the Views nav starts 7 under the band, so the
    // 30px Home row is y 47–77 — centred on the Home header's axis (62, #236 D1)
    className="nodelete flex h-full min-h-0 w-full flex-col bg-frame px-2 pt-[7px] pb-2"
  >
    <LibraryBody />
  </aside>
);

/**
 * Hide sidebar, in the sidebar's top row in the band. On macOS it is at the
 * row's right end, past the traffic lights (R1, D30), and its tooltip ends at
 * the button's right edge so it stays over the sidebar. Elsewhere it is at
 * the window's left edge, where Show sidebar is while the sidebar is hidden,
 * and its tooltip starts at the button's left edge. Hiding moves focus to
 * Show sidebar (D29) — the band does that.
 */
export const HideSidebarButton = ({ atLeftEdge = false }: { atLeftEdge?: boolean }) => {
  const hide = useSidebarStore((s) => s.hide);
  return (
    <div data-sidebar-region="" className="flex">
      <IconButton
        label="Hide sidebar"
        shortcut={shortcutLabel("\\")}
        keyshortcuts={keyshortcuts("\\")}
        onClick={hide}
        size={24}
        align={atLeftEdge ? "start" : "end"}
      >
        <PanelLeft {...icon} />
      </IconButton>
    </div>
  );
};
