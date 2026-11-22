import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { badgeColour } from "../../../shared/lib/projectBadge";
import { badgeIn } from "../../../test/badges";
import type { FolderMeta } from "../libraryApi";
import { folderMovePicker, MovePicker, pickerPlace } from "../MovePicker";

const folder = (
  id: string,
  name: string,
  updatedAt: number,
  folders: FolderMeta[] = [],
  extra: Partial<FolderMeta> = {},
): FolderMeta => ({
  id,
  name,
  updatedAt,
  diagrams: [{ id: `${id}-d`, title: `${name} diagram`, updatedAt, readable: true }],
  folders,
  ...extra,
});

/** the artboard's library (`Hybrid-Project-Cards` #move-picker) */
const library = (): FolderMeta[] => [
  folder("pay", "Payments", 9, [
    folder("chk", "Checkout", 8, [folder("flw", "Flows", 7, [folder("drf", "Drafts", 6)])]),
    folder("arc", "Archive", 2),
  ]),
  folder("onb", "Onboarding", 5, [folder("auth", "Auth", 4), folder("mail", "Emails", 3)]),
  folder("inf", "Infrastructure", 1, [folder("net", "Network", 1)]),
  folder("skt", "Sketches", 0),
];

const show = (
  over: Partial<Parameters<typeof MovePicker>[0]> = {},
  handlers = { onMove: vi.fn(), onBack: vi.fn(), onClose: vi.fn(), onDismiss: vi.fn() },
) => {
  render(
    <MovePicker
      folders={library()}
      moving={{ name: "Payouts", kind: "diagram" }}
      current="pay"
      place={{ at: { x: 10, y: 20 } }}
      {...handlers}
      {...over}
    />,
  );
  return handlers;
};
const tree = () => screen.getByRole("tree", { name: "Move to" });
const row = (name: string | RegExp) => within(tree()).getByRole("treeitem", { name });
const line = (name: string | RegExp) => row(name).querySelector("[data-row]") as HTMLElement;
const names = () =>
  within(tree())
    .getAllByRole("treeitem")
    .map((r) => r.getAttribute("aria-label"));
const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key });

/** the Move to… picker (#229 D13, canvas v33 `#move-picker`) */
describe("Move to… picker (#229 D13)", () => {
  it("title row 'Move to' + the item being moved, 240 wide, at most 320 tall, list scrolls", () => {
    show();
    const dialog = tree().closest("[data-move-picker]") as HTMLElement;
    expect(dialog).toHaveClass("w-60", "max-h-80");
    expect(tree()).toHaveClass("overflow-auto");
    // the title row: "Move to" and what is moving
    expect(screen.getByText("Payouts")).toBeInTheDocument();
    expect(tree()).toHaveAccessibleDescription("Moving Payouts");
  });

  it("destinations only — projects and folders, no diagrams or counts, expanded down to the current parent", () => {
    show();
    expect(names()).toEqual([
      "Payments, project, current location",
      "Checkout, folder",
      "Archive, folder",
      "Onboarding, project",
      "Infrastructure, project",
      "Sketches, project",
    ]);
    expect(screen.queryByText(/diagram$/)).toBeNull();
    expect(row(/^Payments/)).toHaveAttribute("aria-expanded", "true");
    expect(row(/^Checkout/)).toHaveAttribute("aria-expanded", "false");
    // a row without sub-folders: no chevron, the 14px spacer
    expect(row(/^Archive/)).not.toHaveAttribute("aria-expanded");
    expect(line(/^Archive/).querySelector("[data-spacer]")).toHaveClass("w-3.5");
  });

  it("a project not found is no destination — left out (#253 R7)", () => {
    show({
      folders: [
        ...library(),
        { ...folder("lost", "architecture", 0), diagrams: [], missing: true },
      ],
    });
    expect(names()).not.toContain("architecture, project");
    expect(within(tree()).queryByText("architecture")).toBeNull();
  });

  it("the current parent — check, 'Current', disabled (name at 35%), chevron still works", async () => {
    const { onMove } = show();
    const current = row(/^Payments/);
    expect(current).toHaveAttribute("aria-disabled", "true");
    expect(current).toHaveAttribute("aria-selected", "false");
    expect(within(line(/^Payments/)).getByText("Current")).toBeInTheDocument();
    expect(within(line(/^Payments/)).getByText("Payments")).toHaveClass("opacity-35");
    fireEvent.click(line(/^Payments/));
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(line(/^Payments/).querySelector("[data-chevron]")!);
    expect(current).toHaveAttribute("aria-expanded", "false");
  });

  it("when the current parent is deep, its whole path is expanded", () => {
    show({ current: "flw" });
    expect(row(/^Payments/)).toHaveAttribute("aria-expanded", "true");
    expect(row(/^Checkout/)).toHaveAttribute("aria-expanded", "true");
    expect(row("Flows, folder, current location")).toHaveAttribute("aria-expanded", "true");
    expect(row("Drafts, folder")).toBeInTheDocument();
  });

  it("rows: 30px·13px, 16px per level, folders show Folder when collapsed and FolderOpen when expanded (#236 T7)", () => {
    show({ current: "flw" });
    expect(line(/^Payments/)).toHaveClass("h-[30px]", "text-[13px]", "pl-1");
    expect(line(/^Payments/)).not.toHaveClass("h-[26px]");
    expect(line(/^Checkout/)).toHaveClass("pl-5");
    expect(line(/^Flows/)).toHaveClass("pl-9");
    expect(line(/^Drafts/)).toHaveClass("pl-13");
    expect(line(/^Checkout/).querySelector("[data-folder-icon]")).toHaveAttribute(
      "data-folder-icon",
      "open",
    );
    expect(line(/^Drafts/).querySelector("[data-folder-icon]")).toHaveAttribute(
      "data-folder-icon",
      "closed",
    );
    // a project row has no folder glyph — its badge
    expect(line(/^Payments/).querySelector("[data-folder-icon]")).toBeNull();
  });

  it("project rows have a badge after the chevron, folder rows a 16px colored icon (#236 R2·R4, T7)", () => {
    show();
    const badge = badgeIn(line(/^Onboarding/))!;
    expect(badge).toHaveTextContent("O");
    expect(badge).toHaveClass(`bg-badge-${badgeColour("onb")}-soft`, "h-4", "w-4");
    expect(badge.previousElementSibling).toHaveAttribute("data-chevron");
    // a project with nothing to unfold: the spacer, then the badge
    expect(badgeIn(line(/^Sketches/))?.previousElementSibling).toHaveAttribute("data-spacer");
    const glyph = line(/^Checkout/).querySelector("[data-folder-icon]")!;
    expect(glyph).toHaveClass("text-glyph-folder", "fill-glyph-folder-soft");
    expect(glyph).toHaveAttribute("width", "16");
    expect(badgeIn(line(/^Checkout/))).toBeNull();
  });

  it("the moved item's icon in the title chip is a 13px colored icon — pink for diagrams, blue for folders", () => {
    show();
    const chip = screen.getByText("Payouts").parentElement!;
    const diagram = chip.querySelector("svg.lucide-workflow")!;
    expect(diagram).toHaveClass("text-glyph-diagram");
    expect(diagram).toHaveAttribute("width", "13");
  });

  it("clicking a row moves there; the chevron only expands", () => {
    const { onMove } = show();
    fireEvent.click(line(/^Onboarding/).querySelector("[data-chevron]")!);
    expect(onMove).not.toHaveBeenCalled();
    expect(row(/^Onboarding/)).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(line("Auth, folder"));
    expect(onMove).toHaveBeenCalledWith("auth");
  });

  it("keyboard — starts at the current parent, ↑↓, → expands/first child, ← collapses/parent, Enter moves, Esc returns to the menu", () => {
    const { onMove, onBack } = show();
    expect(row(/^Payments/)).toHaveFocus();
    press("ArrowDown");
    expect(row(/^Checkout/)).toHaveFocus();
    press("ArrowRight");
    expect(row(/^Checkout/)).toHaveAttribute("aria-expanded", "true");
    press("ArrowRight");
    expect(row(/^Flows/)).toHaveFocus();
    press("ArrowLeft");
    expect(row(/^Checkout/)).toHaveFocus();
    press("ArrowLeft");
    expect(row(/^Checkout/)).toHaveAttribute("aria-expanded", "false");
    press("ArrowUp");
    expect(row(/^Payments/)).toHaveFocus();
    // the current location takes no Enter
    press("Enter");
    expect(onMove).not.toHaveBeenCalled();
    press("ArrowDown");
    press("Enter");
    expect(onMove).toHaveBeenCalledWith("chk");
    press("Escape");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("the current parent project row dims both name and badge to 35% (#236, canvas v55)", () => {
    show();
    expect(badgeIn(line(/^Payments/))).toHaveClass("opacity-35");
    expect(badgeIn(line(/^Onboarding/))).not.toHaveClass("opacity-35");
  });

  it("the current parent folder row dims both name and glyph to 35% (#229)", () => {
    show({ current: "chk" });
    const glyph = line(/^Checkout/).querySelector("[data-folder-icon]");
    expect(glyph).toHaveClass("opacity-35");
    expect(within(line(/^Checkout/)).getByText("Checkout")).toHaveClass("opacity-35");
    // a row that can be picked is at full strength
    expect(line(/^Flows/).querySelector("[data-folder-icon]")).not.toHaveClass("opacity-35");
  });

  it("initial expansion = what is expanded in the sidebar + the path to the current parent (#229)", () => {
    show({ current: "chk", expanded: new Set(["onb"]) });
    expect(row(/^Payments/)).toHaveAttribute("aria-expanded", "true");
    expect(row(/^Checkout/)).toHaveAttribute("aria-expanded", "true");
    expect(row(/^Onboarding/)).toHaveAttribute("aria-expanded", "true");
    expect(row("Auth, folder")).toBeInTheDocument();
    expect(row(/^Infrastructure/)).toHaveAttribute("aria-expanded", "false");
  });

  it("Tab — closes with the menu and focus moves on to the next element (#229)", () => {
    const { onDismiss, onBack } = show();
    const tab = fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    // the browser moves the focus on: nothing stops it
    expect(tab).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("the tree describes what is being moved and has an id for the menu item to point at (#229)", () => {
    show({ id: "move-picker-x" });
    expect(tree()).toHaveAttribute("id", "move-picker-x");
    expect(tree()).toHaveAccessibleDescription("Moving Payouts");
  });

  it("repositions when expanding makes it grow — it does not leave the window (#229)", () => {
    const tall = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute("data-move-picker")
          ? 36 + this.querySelectorAll("[role=treeitem]").length * 40
          : 0;
      });
    const menu = {
      left: 600,
      top: 500,
      width: 184,
      height: 140,
      right: 784,
      bottom: 640,
    } as DOMRect;
    const item = {
      left: 604,
      top: 560,
      width: 176,
      height: 28,
      right: 780,
      bottom: 588,
    } as DOMRect;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    show({ current: "skt", place: { menu, item } });
    const picker = tree().closest("[data-move-picker]") as HTMLElement;
    // 4 rows: 36 + 4 × 40 = 196, beside the item
    expect(picker.style.top).toBe("556px");
    fireEvent.click(line(/^Payments/).querySelector("[data-chevron]")!);
    fireEvent.click(line(/^Onboarding/).querySelector("[data-chevron]")!);
    // 8 rows: 356 tall — pushed up to stay 8 above the window's foot
    expect(picker.style.top).toBe(`${900 - 356 - 8}px`);
    tall.mockRestore();
  });

  it("deep folders — scrolls sideways instead of truncating, Current sticks to the right edge (Sidebar-Deep c)", () => {
    show({ current: "drf" });
    expect(tree()).toHaveClass(
      "grid",
      "grid-cols-[minmax(max-content,1fr)]",
      "overflow-auto",
      "scroll-pr-[78px]",
    );
    const name = within(line(/^Drafts/)).getByText("Drafts");
    expect(name).not.toHaveClass("truncate");
    expect(name).toHaveClass("whitespace-nowrap", "flex-[1_0_auto]");
    const current = within(line(/^Drafts/))
      .getByText("Current")
      .closest("[data-current]");
    expect(current).toHaveClass("sticky", "right-0", "pl-3", "pr-2");
    expect(current?.className).toContain(
      "linear-gradient(to_right,transparent,var(--row-bg)_12px)",
    );
    expect(line(/^Drafts/)).toHaveClass("pr-0", "[--row-bg:var(--surface)]");
    expect(line(/^Flows/)).toHaveClass("pr-2");
  });

  it("on open, scrolls the current parent row's name into view, and keeps rows reached by keys in view (Sidebar-Deep c)", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      show({ current: "drf" });
      const name = within(line(/^Drafts/)).getByText("Drafts");
      expect(scroll.mock.contexts).toContain(name);
      expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
      scroll.mockClear();
      press("ArrowUp");
      expect(scroll.mock.contexts).toContain(within(line(/^Flows/)).getByText("Flows"));
    } finally {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("disabled targets — ', unavailable' in the name, cannot be picked (#230 for moving folders)", () => {
    const { onMove } = show({
      moving: { name: "Checkout", kind: "folder" },
      current: "pay",
      unavailable: new Set(["chk", "flw", "drf"]),
    });
    expect(row("Checkout, folder, unavailable")).toHaveAttribute("aria-disabled", "true");
    expect(within(line(/^Checkout/)).getByText("Checkout")).toHaveClass("opacity-35");
    fireEvent.click(line(/^Checkout/));
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(line("Archive, folder"));
    expect(onMove).toHaveBeenCalledWith("arc");
  });
});

describe("picker position (#229 D13)", () => {
  const box = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
  const view = { width: 1440, height: 900 };

  it("4px right of the menu, title row level with the Move to… item", () => {
    expect(
      pickerPlace(
        box(600, 100, 184, 140),
        box(604, 170, 176, 28),
        { width: 240, height: 300 },
        view,
      ),
    ).toEqual({ left: 788, top: 166 });
  });

  it("goes left when there is no room on the right, and pushes up when short of room below", () => {
    expect(
      pickerPlace(
        box(1164, 144, 184, 140),
        box(1168, 213, 176, 28),
        { width: 240, height: 300 },
        view,
      ),
    ).toEqual({ left: 920, top: 209 });
    expect(
      pickerPlace(
        box(100, 700, 184, 140),
        box(104, 820, 176, 28),
        { width: 240, height: 320 },
        view,
      ),
    ).toEqual({ left: 288, top: 572 });
  });
});

/** a folder's Move to… (#230 D12, canvas `#move-picker-folder`) */
describe("folder Move to… (#230 D12, T20)", () => {
  const menuPlace = { at: { x: 10, y: 20 } };
  const done = () => ({ back: vi.fn(), close: vi.fn(), dismiss: vi.fn() });

  it("itself and descendants are disabled, the current parent is Current, picking closes the menu and moves to the top of that folder", () => {
    const folders = library();
    const checkout = folders[0]!.folders[0]!;
    const move = vi.fn();
    const closing = done();
    render(
      folderMovePicker(checkout, folders, "pay", { move, expanded: new Set(["chk"]) })(
        menuPlace,
        closing,
      ),
    );
    expect(tree()).toHaveAccessibleDescription("Moving Checkout");
    // the title row's glyph: a folder, blue, 13 (#236 T7)
    const title = tree().closest("[data-move-picker]")!.firstElementChild!;
    expect(title.querySelector("[data-folder-icon]")).toHaveClass("text-glyph-folder");
    expect(title.querySelector("[data-folder-icon]")).toHaveAttribute("width", "13");
    expect(names()).toEqual([
      "Payments, project, current location",
      "Checkout, folder, unavailable",
      "Flows, folder, unavailable",
      "Archive, folder",
      "Onboarding, project",
      "Infrastructure, project",
      "Sketches, project",
    ]);
    fireEvent.click(line(/^Flows/));
    fireEvent.click(line(/^Payments/));
    expect(move).not.toHaveBeenCalled();
    fireEvent.click(line(/^Archive/));
    expect(closing.close).toHaveBeenCalled();
    expect(move).toHaveBeenCalledWith("arc");
  });

  it("places that would exceed the depth limit after the move are disabled too (#230 D7)", () => {
    let deep: FolderMeta = folder("c9", "C9", 1);
    for (let k = 8; k >= 2; k--) deep = folder(`c${k}`, `C${k}`, 1, [deep]);
    const tall = folder("x", "X", 1, [folder("y", "Y", 1)]);
    const folders = [folder("c1", "C1", 1, [deep, tall])];
    render(
      folderMovePicker(tall, folders, "c1", {
        move: vi.fn(),
        expanded: new Set(["c2", "c3", "c4", "c5", "c6", "c7", "c8"]),
      })(menuPlace, done()),
    );
    expect(row(/^C8,/)).toHaveAttribute("aria-label", "C8, folder");
    expect(row(/^C9,/)).toHaveAttribute("aria-label", "C9, folder, unavailable");
  });
});
