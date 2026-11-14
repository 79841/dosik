import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { IconButton } from "../IconButton";

describe("IconButton (#158)", () => {
  it("The name is the label, and the same label shows as the tooltip", () => {
    render(
      <IconButton label="Undo (⌘Z)" onClick={() => {}}>
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Undo (⌘Z)" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Undo (⌘Z)");
    // the browser's own title tooltip would double up and arrive late
    expect(button).not.toHaveAttribute("title");
  });

  it("Clicking calls onClick, and a disabled button can't be clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <IconButton label="Save" onClick={onClick}>
        <svg />
      </IconButton>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <IconButton label="Save" onClick={onClick} disabled>
        <svg />
      </IconButton>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("Announces the on state with aria-pressed", () => {
    render(
      <IconButton label="Dark theme" onClick={() => {}} pressed>
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("A button that opens a menu announces aria-expanded", () => {
    render(
      <IconButton label="Layout" onClick={() => {}} expanded>
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Layout" })).toHaveAttribute("aria-expanded", "true");
  });

  it("The tooltip is the name — the same words are not read twice", () => {
    render(
      <IconButton label="Export" onClick={() => {}}>
        <svg />
      </IconButton>,
    );
    const tooltip = screen.getByRole("tooltip");
    const button = screen.getByRole("button", { name: "Export" });
    expect(button).toHaveAttribute("aria-labelledby", tooltip.id);
    expect(button).not.toHaveAttribute("aria-label");
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it("Sizes are 24·28·36 — the default is the toolbar's 36 (#217 D30)", () => {
    const { rerender } = render(
      <IconButton label="Hide sidebar" onClick={() => {}} size={24}>
        <svg />
      </IconButton>,
    );
    const button = () => screen.getByRole("button", { name: "Hide sidebar" });
    expect(button().className).toMatch(/(^|\s)h-6(\s|$)/);
    rerender(
      <IconButton label="Hide sidebar" onClick={() => {}} size={28}>
        <svg />
      </IconButton>,
    );
    expect(button().className).toMatch(/(^|\s)h-7(\s|$)/);
    rerender(
      <IconButton label="Hide sidebar" onClick={() => {}}>
        <svg />
      </IconButton>,
    );
    expect(button().className).toMatch(/(^|\s)h-9(\s|$)/);
  });

  it("The tooltip carries the shortcut — it is not part of the name and is announced with aria-keyshortcuts", () => {
    render(
      <IconButton
        label="Hide sidebar"
        shortcut={"⌘\\"}
        keyshortcuts="Meta+Backslash"
        onClick={() => {}}
      >
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Hide sidebar" });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Hide sidebar⌘\\");
    expect(screen.getByText("⌘\\")).toHaveClass("text-on-ink-muted");
    expect(button).toHaveAttribute("aria-keyshortcuts", "Meta+Backslash");
  });

  it("With align='end' the tooltip aligns to the button's right edge — so it doesn't stick out of the sidebar", () => {
    const { rerender } = render(
      <IconButton label="Hide sidebar" onClick={() => {}} align="end">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole("tooltip")).toHaveClass("right-0");
    expect(screen.getByRole("tooltip")).not.toHaveClass("-translate-x-1/2");
    rerender(
      <IconButton label="Hide sidebar" onClick={() => {}}>
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole("tooltip")).toHaveClass("left-1/2", "-translate-x-1/2");
  });

  it("A button that opened a menu also has the selected background — only while the menu is open (#219)", () => {
    render(
      <IconButton label="Arrange" onClick={() => {}} expanded={false} popup="menu">
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Arrange" });
    expect(button).toHaveClass("aria-expanded:bg-selected");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("The tooltip hides while the menu is open — both hang below the button", () => {
    render(
      <IconButton label="More" onClick={() => {}} expanded popup="menu">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole("tooltip")).toHaveClass("group-aria-expanded/icon:hidden");
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute("aria-haspopup", "menu");
  });

  it("Size 32 is the island button — shape bar and edit bar (#219 D8·D9, T6)", () => {
    render(
      <IconButton label="Flowchart" onClick={() => {}} size={32}>
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Flowchart" });
    expect(button.className).toMatch(/(^|\s)h-8(\s|$)/);
    expect(button.className).toMatch(/(^|\s)min-w-8(\s|$)/);
  });

  it("With tooltip='right' the tooltip shows 8px right of the button — vertical bars (#219 D8)", () => {
    render(
      <IconButton label="Flowchart" onClick={() => {}} tooltip="right">
        <svg />
      </IconButton>,
    );
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveClass("left-full", "ml-2", "top-1/2", "-translate-y-1/2");
    expect(tooltip).not.toHaveClass("left-1/2");
    expect(tooltip).not.toHaveClass("top-full");
  });

  it("The tooltip uses the design dimensions — height 22, horizontal padding 7, radius 5, 11px", () => {
    render(
      <IconButton label="Undo" onClick={() => {}}>
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole("tooltip")).toHaveClass(
      "h-[22px]",
      "px-[7px]",
      "rounded-(--radius-control)",
      "text-[11px]",
    );
  });

  it("A pressed toggle has ink text on the selected background (#219 D2)", () => {
    render(
      <IconButton label="Ask AI" onClick={() => {}} pressed>
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Ask AI" })).toHaveClass(
      "aria-pressed:bg-selected",
      "aria-pressed:text-ink",
    );
  });
});
