import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { CardSizeButton } from "../CardSizeButton";
import { HOME_KEY, useHomeMode } from "../homeMode";

const button = () => screen.getByRole("button", { name: /^Card size: / });
const menu = () => screen.getByRole("menu", { name: "Card size" });
const checked = () =>
  within(menu())
    .getAllByRole("menuitemradio")
    .filter((i) => i.getAttribute("aria-checked") === "true")
    .map((i) => i.textContent);

/** the card size button and its menu (#236 R5, T10·T11, `Home-CardSize`) */
describe("CardSizeButton — card size (#236)", () => {
  beforeEach(() => {
    localStorage.clear();
    useHomeMode.setState({ mode: "cards", size: null });
  });

  it("grid-2x2 15 + chevron 12, 28px, icon color — name is the current value, Medium by default", () => {
    render(<CardSizeButton />);
    expect(button()).toHaveAccessibleName("Card size: Medium");
    expect(button()).toHaveAttribute("aria-haspopup", "menu");
    // the canvas's tooltip (Home-CardSize): the glyph alone does not say it
    expect(button()).toHaveAttribute("title", "Card size");
    expect(button()).toHaveAttribute("aria-expanded", "false");
    expect(button()).toHaveClass("h-7", "text-icon");
    const [glyph, chevron] = [...button().querySelectorAll("svg")];
    expect(glyph).toHaveClass("lucide-grid-2x2");
    expect(glyph).toHaveAttribute("width", "15");
    expect(chevron).toHaveClass("lucide-chevron-down", "text-muted");
    expect(chevron).toHaveAttribute("width", "12");
  });

  it("the name follows the chosen value", () => {
    act(() => useHomeMode.getState().setSize("large"));
    render(<CardSizeButton />);
    expect(button()).toHaveAccessibleName("Card size: Large");
    act(() => useHomeMode.getState().setSize("small"));
    expect(button()).toHaveAccessibleName("Card size: Small");
  });

  it("opens a Small·Medium·Large radio menu, checks the current value, selected background while open", async () => {
    const user = userEvent.setup();
    render(<CardSizeButton />);
    await user.click(button());
    expect(
      within(menu())
        .getAllByRole("menuitemradio")
        .map((i) => i.textContent),
    ).toEqual(["Small", "Medium", "Large"]);
    expect(checked()).toEqual(["Medium"]);
    // the menu takes the focus on the ticked item (the shared menu)
    expect(within(menu()).getByRole("menuitemradio", { name: "Medium" })).toHaveFocus();
    expect(button()).toHaveAttribute("aria-expanded", "true");
    expect(button()).toHaveClass("bg-selected", "text-ink");
    // pressing it again closes the menu
    await user.click(button());
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button()).not.toHaveClass("bg-selected");
  });

  it("choosing changes and saves the value, closes the menu, and returns focus to the button", async () => {
    const user = userEvent.setup();
    render(<CardSizeButton />);
    await user.click(button());
    await user.click(within(menu()).getByRole("menuitemradio", { name: "Small" }));
    expect(useHomeMode.getState().size).toBe("small");
    expect(JSON.parse(localStorage.getItem(HOME_KEY)!)).toMatchObject({ size: "small" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button()).toHaveFocus();
    expect(button()).toHaveAccessibleName("Card size: Small");
  });

  it("Escape closes without changing and returns focus — an outside click does not change either", async () => {
    const user = userEvent.setup();
    render(<CardSizeButton />);
    await user.click(button());
    await user.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button()).toHaveFocus();
    expect(useHomeMode.getState().size).toBeNull();
    await user.click(button());
    await user.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(useHomeMode.getState().size).toBeNull();
  });
});
