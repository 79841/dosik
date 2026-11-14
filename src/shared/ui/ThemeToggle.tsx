import { Moon, Sun } from "lucide-react";

import { useThemeStore } from "../lib/theme";
import {
  ICON_SIZE,
  ICON_STROKE,
  IconButton,
  type IconButtonSize,
  SMALL_ICON_SIZE,
} from "./IconButton";

/**
 * Light / dark switch — one button, wherever it shows: the sidebar's footer
 * (#217; the editor's toolbar and Home's header before, #196). The icon is
 * where it goes (a moon in light), and the label says so.
 */
export const ThemeToggle = ({
  size = 36,
  tooltip,
  align,
}: {
  size?: IconButtonSize;
  /** where the tooltip hangs — above at the bottom of the sidebar */
  tooltip?: "above" | "below";
  align?: "center" | "end";
}) => {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const icon = {
    size: size === 36 ? ICON_SIZE : SMALL_ICON_SIZE,
    strokeWidth: ICON_STROKE,
    "aria-hidden": true,
  } as const;
  return (
    <IconButton
      label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      pressed={theme === "dark"}
      onClick={toggleTheme}
      size={size}
      tooltip={tooltip}
      align={align}
    >
      {theme === "dark" ? <Sun {...icon} /> : <Moon {...icon} />}
    </IconButton>
  );
};
