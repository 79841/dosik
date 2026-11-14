import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ openFileAnywhere: vi.fn(async () => {}) }));
vi.mock("../../library/navigation", () => navigation);

import { useSidebarStore } from "../../../shared/lib/sidebarLayout";
import { useThemeStore } from "../../../shared/lib/theme";
import { MoreMenu } from "../MoreMenu";

const more = () => screen.getByRole("button", { name: "More" });
const menu = () => screen.getByRole("menu", { name: "More" });
const items = () => within(menu()).getAllByRole("menuitem");

describe("⋯ More (#217 R8, D21, T30)", () => {
  beforeEach(() => {
    localStorage.clear();
    useSidebarStore.setState({ hidden: true, peek: false, hinted: true, focusAfter: null });
    useThemeStore.getState().setTheme("light");
  });

  it("Open file… ⌘O · Dark theme · separator · Show sidebar ⌘\\", async () => {
    const user = userEvent.setup();
    render(<MoreMenu />);
    expect(more()).toHaveAttribute("aria-haspopup", "menu");
    expect(more()).toHaveAttribute("aria-expanded", "false");
    await user.click(more());
    expect(more()).toHaveAttribute("aria-expanded", "true");
    expect(items().map((i) => i.textContent)).toEqual([
      "Open file…Ctrl+O",
      "Dark theme",
      "Show sidebarCtrl+\\",
    ]);
    // the shortcut is shown, not read as part of the name
    expect(items().map((i) => i.getAttribute("aria-keyshortcuts"))).toEqual([
      "Control+O",
      null,
      "Control+Backslash",
    ]);
    expect(within(menu()).getByRole("separator")).toBeInTheDocument();
    // inside the band: clicking the menu's padding must not drag the window (T4)
    expect(menu()).toHaveAttribute("data-tauri-drag-region", "false");
    expect(items()[0]).toHaveFocus();
  });

  it("arrows cycle, and Escape closes and returns focus to More", async () => {
    const user = userEvent.setup();
    render(<MoreMenu />);
    await user.click(more());
    await user.keyboard("{ArrowDown}");
    expect(items()[1]).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(items()[0]).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(items()[2]).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(more()).toHaveFocus();
  });

  it("choosing an item returns focus to More — it does not stay on the vanished menu (#217)", async () => {
    const user = userEvent.setup();
    render(<MoreMenu />);
    await user.click(more());
    await user.keyboard("{ArrowDown}{Enter}");
    expect(useThemeStore.getState().theme).toBe("dark");
    expect(more()).toHaveFocus();
    await user.click(more());
    await user.keyboard("{Enter}");
    expect(navigation.openFileAnywhere).toHaveBeenCalledTimes(1);
    expect(more()).toHaveFocus();
  });

  it("closes on an outside click", async () => {
    const user = userEvent.setup();
    render(
      <>
        <MoreMenu />
        <button type="button">outside</button>
      </>,
    );
    await user.click(more());
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("each item does its job and closes the menu", async () => {
    const user = userEvent.setup();
    render(<MoreMenu />);
    await user.click(more());
    await user.click(screen.getByRole("menuitem", { name: "Open file…" }));
    expect(navigation.openFileAnywhere).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(more());
    await user.click(screen.getByRole("menuitem", { name: "Dark theme" }));
    expect(useThemeStore.getState().theme).toBe("dark");
    await user.click(more());
    expect(screen.getByRole("menuitem", { name: "Light theme" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Show sidebar" }));
    // docked — and the band owes focus to Hide sidebar, since it was in this menu (D29)
    expect(useSidebarStore.getState()).toMatchObject({ hidden: false, focusAfter: "hide" });
  });
});
