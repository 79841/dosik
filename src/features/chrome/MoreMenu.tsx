import { Ellipsis, FolderOpen, type LucideIcon, Moon, PanelLeftOpen, Sun } from "lucide-react";
import { useRef, useState } from "react";

import { FOCUS_ITEM } from "../../shared/lib/palette";
import { keyshortcuts, shortcutLabel } from "../../shared/lib/shortcutLabel";
import { useSidebarStore } from "../../shared/lib/sidebarLayout";
import { useThemeStore } from "../../shared/lib/theme";
import { useMenuKeys } from "../../shared/lib/useMenuKeys";
import { useOutsideDismiss } from "../../shared/lib/useOutsideDismiss";
import { ICON_STROKE, IconButton, SMALL_ICON_SIZE } from "../../shared/ui/IconButton";
import { openFileAnywhere } from "../library/navigation";

const MenuItem = ({
  label,
  icon: Icon,
  shortcut,
  keys,
  onSelect,
}: {
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  keys?: string;
  onSelect: () => void;
}) => (
  <button
    type="button"
    role="menuitem"
    tabIndex={-1}
    aria-keyshortcuts={keys}
    onClick={onSelect}
    className={`flex h-7 w-full flex-none items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-[12px] font-medium text-ink transition-colors hover:bg-hover ${FOCUS_ITEM}`}
  >
    <Icon
      size={SMALL_ICON_SIZE}
      strokeWidth={ICON_STROKE}
      aria-hidden="true"
      className="text-icon"
    />
    <span className="min-w-0 flex-1">{label}</span>
    {shortcut ? (
      <span aria-hidden="true" className="flex-none text-[11px] font-medium text-muted">
        {shortcut}
      </span>
    ) : null}
  </button>
);

/**
 * ⋯ More, at the band's right end while the sidebar is hidden (#217 R8,
 * D21): what the hidden sidebar's footer held — Open file…, the theme — and
 * Show sidebar. ↑↓ Home End move; Escape, or an item chosen, closes it and
 * gives focus back to the button — Show sidebar's goes on to Hide sidebar
 * instead (D29); a click outside closes it (#80).
 */
export const MoreMenu = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const theme = useThemeStore((s) => s.theme);
  useOutsideDismiss(ref, open, () => setOpen(false));

  const backToButton = () => {
    setOpen(false);
    ref.current?.querySelector<HTMLElement>("button")?.focus();
  };
  // focus goes back to More, not to the body the menu leaves it on (#217)
  const pick = (action: () => void) => () => {
    backToButton();
    action();
  };

  // a menu takes focus when it opens, so the keyboard can go on from here
  const onKeyDown = useMenuKeys(menuRef, open, {
    onEscape: backToButton,
    onTab: () => setOpen(false),
  });

  return (
    <div ref={ref} className="relative flex">
      <IconButton
        label="More"
        popup="menu"
        expanded={open}
        onClick={() => setOpen((v) => !v)}
        size={24}
        align="end"
      >
        <Ellipsis size={SMALL_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
      </IconButton>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="More"
          // in the band: a press on the menu's padding must not drag the window
          data-tauri-drag-region="false"
          // what docking takes off screen: focus here goes on to Hide sidebar (D29)
          data-sidebar-opener=""
          onKeyDown={onKeyDown}
          className="absolute -right-1 top-7 z-50 flex w-[200px] flex-col rounded-[10px] bg-surface p-1 shadow-popover"
        >
          <MenuItem
            label="Open file…"
            icon={FolderOpen}
            shortcut={shortcutLabel("O")}
            keys={keyshortcuts("O")}
            onSelect={pick(() => void openFileAnywhere())}
          />
          <MenuItem
            label={theme === "dark" ? "Light theme" : "Dark theme"}
            icon={theme === "dark" ? Sun : Moon}
            onSelect={pick(() => useThemeStore.getState().toggleTheme())}
          />
          <hr className="my-1 h-px flex-none border-0 bg-line" />
          <MenuItem
            label="Show sidebar"
            icon={PanelLeftOpen}
            shortcut={shortcutLabel("\\")}
            keys={keyshortcuts("\\")}
            onSelect={() => {
              // docking first: the store sees focus in this menu and owes it to Hide sidebar
              useSidebarStore.getState().show();
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
};
