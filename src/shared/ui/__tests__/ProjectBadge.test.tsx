import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { badgeColour } from "../../lib/projectBadge";
import { ProjectBadge } from "../ProjectBadge";

const badge = (container: HTMLElement) => container.firstElementChild as HTMLElement;

describe("ProjectBadge — the first letter on its colour's tint (#236 T3)", () => {
  it("is not read: the project's name already is", () => {
    const { container } = render(<ProjectBadge id="p1" name="Payments" />);
    expect(badge(container)).toHaveAttribute("aria-hidden", "true");
    expect(badge(container)).toHaveTextContent("P");
  });

  it("draws in the colour its id picks — tint behind, colour for the letter", () => {
    for (const id of ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]) {
      const c = badgeColour(id);
      const { container, unmount } = render(<ProjectBadge id={id} name="x" />);
      expect(badge(container)).toHaveClass(`bg-badge-${c}-soft`, `text-badge-${c}`, "font-bold");
      unmount();
    }
  });

  it.each([
    [16, ["h-4", "w-4", "rounded-[4.5px]", "text-[10px]"]],
    [14, ["h-3.5", "w-3.5", "rounded-[4px]", "text-[9px]"]],
    ["board", ["h-5", "w-5", "rounded-[5.5px]", "text-[12px]"]],
  ] as const)("size %s", (size, classes) => {
    const { container } = render(<ProjectBadge id="p1" name="Payments" size={size} />);
    expect(badge(container)).toHaveClass("flex-none", ...classes);
  });

  it("defaults to the sidebar's 16", () => {
    const { container } = render(<ProjectBadge id="p1" name="Payments" />);
    expect(badge(container)).toHaveClass("h-4", "w-4");
  });

  it("keeps its square when the name is blank", () => {
    const { container } = render(<ProjectBadge id="p1" name="  " />);
    expect(badge(container)).toBeInTheDocument();
    expect(badge(container)).toHaveTextContent("");
  });

  it("takes a class for its place", () => {
    const { container } = render(<ProjectBadge id="p1" name="Payments" className="mr-1" />);
    expect(badge(container)).toHaveClass("mr-1");
  });
});
