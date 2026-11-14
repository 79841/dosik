import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { useThemeStore } from "../../lib/theme";
import { ThemeToggle } from "../ThemeToggle";

describe("ThemeToggle (#196, #217)", () => {
  beforeEach(() => useThemeStore.getState().setTheme("light"));

  it("Clicking switches the theme and the name follows", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(useThemeStore.getState().theme).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("Passes the size through — 28 at the bottom of the sidebar (#217 D30)", () => {
    render(<ThemeToggle size={28} />);
    expect(screen.getByRole("button", { name: "Switch to dark theme" }).className).toMatch(
      /(^|\s)h-7(\s|$)/,
    );
  });
});
