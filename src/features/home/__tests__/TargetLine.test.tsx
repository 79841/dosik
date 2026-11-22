import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { badgeColour } from "../../../shared/lib/projectBadge";
import { badgeIn, spoken } from "../../../test/badges";
import { useAppStore } from "../../library/appStore";
import type { FolderMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { TargetLine } from "../TargetLine";

const project = (id: string, name: string, extra: Partial<FolderMeta> = {}): FolderMeta => ({
  id,
  name,
  updatedAt: 1,
  diagrams: [],
  folders: [],
  ...extra,
});

const change = () => screen.getByRole("button", { name: "Change project for new diagrams" });

describe("New diagrams go to … · Change (#220 D8, T23)", () => {
  beforeEach(() => {
    useAppStore.setState({ newDiagramTarget: null });
    useLibraryStore.setState({
      folders: [
        // the most recent project is the default (#230 D5) — not the first listed
        project("work", "Work", { updatedAt: 2 }),
        project("side", "Side"),
      ],
    });
  });

  it("the label is the target's name — the default (most recent project) when nothing is chosen", () => {
    render(<TargetLine />);
    // a word space and 4 on each side of the dot, as the boards' markup (Main, HomeCollapse-Hidden)
    const line = screen.getByText(/New diagrams go to/);
    expect(spoken(line)).toBe("New diagrams go to Work · Change");
    expect(within(line).getByText("·")).toHaveClass("mx-1");
    expect(change()).toHaveAttribute("aria-haspopup", "menu");
    expect(change()).toHaveAttribute("aria-expanded", "false");
  });

  it("a project badge before the name — 4px before the badge, 4px between badge and name (#236 R4, T15)", () => {
    render(<TargetLine />);
    const line = screen.getByText(/New diagrams go to/);
    const badge = badgeIn(line)!;
    const name = badge.parentElement!;
    expect(spoken(name)).toBe("Work");
    expect(badge).toBe(name.firstElementChild);
    expect(name).toHaveClass("inline-flex", "items-center", "gap-1", "ml-1", "font-semibold");
    expect(badge).toHaveTextContent("W");
    expect(badge).toHaveClass(`bg-badge-${badgeColour("work")}-soft`, "h-3.5", "w-3.5");
  });

  it("no row without projects, no Change with only one", () => {
    useLibraryStore.setState({ folders: [] });
    const { container, rerender } = render(<TargetLine />);
    expect(container).toBeEmptyDOMElement();
    useLibraryStore.setState({
      folders: [project("work", "Work")],
    });
    rerender(<TargetLine />);
    expect(screen.getByText(/New diagrams go to/)).toHaveTextContent("Work");
    expect(screen.queryByRole("button", { name: /Change/ })).toBeNull();
  });

  it("menu — a menuitemradio per project, current target checked", async () => {
    const user = userEvent.setup();
    render(<TargetLine />);
    await user.click(change());
    expect(change()).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((i) => [i.textContent, i.getAttribute("aria-checked")])).toEqual([
      ["Work", "true"],
      ["Side", "false"],
    ]);
    expect(items[0]).toHaveFocus();
    // no project dot in the line or the menu (#229 D19)
    expect(document.querySelector(".bg-project-grey")).toBeNull();
  });

  it("a project not found is no choice — and never the line's name (#253 R7)", async () => {
    useLibraryStore.setState({
      folders: [
        project("lost", "architecture", { updatedAt: 9, missing: true }),
        project("work", "Work", { updatedAt: 2 }),
        project("side", "Side"),
      ],
    });
    const user = userEvent.setup();
    render(<TargetLine />);
    expect(spoken(change().parentElement!)).not.toContain("architecture");
    await user.click(change());
    expect(screen.getAllByRole("menuitemradio").map((i) => i.textContent)).toEqual([
      "Work",
      "Side",
    ]);
  });

  it("choosing changes the label, closes the menu, and moves focus to Change", async () => {
    const user = userEvent.setup();
    render(<TargetLine />);
    await user.click(change());
    await user.keyboard("{ArrowDown}{Enter}");
    expect(useAppStore.getState().newDiagramTarget).toBe("side");
    expect(screen.getByText(/New diagrams go to/)).toHaveTextContent("Side");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(change()).toHaveFocus();
  });

  it("Escape closes and returns focus, an outside click also closes", async () => {
    const user = userEvent.setup();
    render(<TargetLine />);
    await user.click(change());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(change()).toHaveFocus();
    await user.click(change());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("two projects with the same name — both shown separately, choosing the second picks the second (#220)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    useLibraryStore.setState({
      folders: [project("a", "New project"), project("b", "New project"), project("work", "Work")],
    });
    const user = userEvent.setup();
    render(<TargetLine />);
    await user.click(change());
    // a refresh landing while it is open draws the list again
    act(() =>
      useLibraryStore.setState({
        folders: [
          project("a", "New project"),
          project("b", "New project"),
          project("work", "Work"),
        ],
      }),
    );
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["New project", "New project", "Work"]);
    await user.click(items[1]!);
    expect(useAppStore.getState().newDiagramTarget).toBe("b");
    expect(errors.mock.calls.filter(([m]) => String(m).includes("same key"))).toEqual([]);
    errors.mockRestore();
  });

  it("names the default when the chosen project disappears", () => {
    useAppStore.setState({ newDiagramTarget: "gone" });
    render(<TargetLine />);
    expect(screen.getByText(/New diagrams go to/)).toHaveTextContent("Work");
  });
});
