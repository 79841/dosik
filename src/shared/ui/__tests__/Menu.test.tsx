import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilePlus, Trash2 } from "lucide-react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Menu, MENU_MIN_WIDTH, type MenuItem } from "../Menu";

const setup = (items: MenuItem[]) => {
  const onSelect = vi.fn((item: MenuItem) => item.onSelect());
  const onClose = vi.fn();
  render(
    <Menu
      at={{ x: 10, y: 10 }}
      label="Actions"
      items={items}
      onSelect={onSelect}
      onClose={onClose}
    />,
  );
  return { onSelect, onClose };
};

describe("Shared menu (#217 D10, #220 D8·D11)", () => {
  it("menuitem — focuses the first item on open, ↑↓ Home End cycle, Enter picks", async () => {
    const user = userEvent.setup();
    const picked = vi.fn();
    setup([
      { label: "New diagram", icon: FilePlus, onSelect: picked },
      { label: "Delete", icon: Trash2, danger: true, onSelect: vi.fn() },
    ]);
    const menu = screen.getByRole("menu", { name: "Actions" });
    const [first, second] = screen.getAllByRole("menuitem");
    expect(menu).toBeInTheDocument();
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(second).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(first).toHaveFocus();
    await user.keyboard("{End}");
    expect(second).toHaveFocus();
    await user.keyboard("{Home}{Enter}");
    expect(picked).toHaveBeenCalledTimes(1);
  });

  it("menuitemradio — aria-checked, focuses the checked item on open", () => {
    setup([
      { label: "Work", checked: false, onSelect: vi.fn() },
      { label: "Side", checked: true, onSelect: vi.fn() },
    ]);
    const radios = screen.getAllByRole("menuitemradio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(radios[1]).toHaveFocus();
  });

  it("Clicking the opener is not an outside click — that button toggles (#220)", () => {
    const opener = createRef<HTMLButtonElement>();
    const onClose = vi.fn();
    render(
      <>
        <button ref={opener} type="button">
          More
        </button>
        <Menu
          at={{ x: 10, y: 10 }}
          label="Actions"
          items={[{ label: "Open", onSelect: vi.fn() }]}
          opener={opener}
          onSelect={vi.fn()}
          onClose={onClose}
        />
      </>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "More" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("Escape closes and asks for focus back; an outside click just closes", async () => {
    const user = userEvent.setup();
    const first = setup([{ label: "Open", onSelect: vi.fn() }]);
    await user.keyboard("{Escape}");
    expect(first.onClose).toHaveBeenCalledWith(true);
    document.body.innerHTML = "";
    const second = setup([{ label: "Open", onSelect: vi.fn() }]);
    fireEvent.pointerDown(document.body);
    expect(second.onClose).toHaveBeenCalledWith(false);
  });

  it("Separator — role=separator before an item with separatorBefore (#229, design canvas sidebarMenus)", () => {
    setup([
      { label: "Open", onSelect: vi.fn() },
      { label: "Rename", separatorBefore: true, onSelect: vi.fn() },
      { label: "Delete", separatorBefore: true, onSelect: vi.fn() },
    ]);
    const menu = screen.getByRole("menu", { name: "Actions" });
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    expect([...menu.children].map((c) => c.tagName)).toEqual([
      "BUTTON",
      "HR",
      "BUTTON",
      "HR",
      "BUTTON",
    ]);
  });

  it("Picker item — chevron, aria-haspopup=tree; picking it opens the picker next to the menu and the menu stays (#229 D13)", async () => {
    const user = userEvent.setup();
    const picker = vi.fn((_place: unknown, done: { back: () => void; close: () => void }) => (
      <div data-testid="picker">
        <button type="button" onClick={done.back}>
          back
        </button>
        <button type="button" onClick={done.close}>
          done
        </button>
      </div>
    ));
    const { onSelect, onClose } = setup([
      { label: "Open", onSelect: vi.fn() },
      { label: "Move to…", picker, onSelect: vi.fn() },
    ]);
    const move = screen.getByRole("menuitem", { name: "Move to…" });
    expect(move).toHaveAttribute("aria-haspopup", "tree");
    expect(move).toHaveAttribute("aria-expanded", "false");
    await user.click(move);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId("picker")).toBeInTheDocument();
    expect(move).toHaveAttribute("aria-expanded", "true");
    expect(picker.mock.calls[0]![0]).toHaveProperty("menu");
    expect(picker.mock.calls[0]![0]).toHaveProperty("item");
    // a press inside the picker is not outside the menu
    fireEvent.pointerDown(screen.getByText("back"));
    expect(onClose).not.toHaveBeenCalled();
    // back: the picker goes, the focus returns to the item
    await user.click(screen.getByText("back"));
    expect(screen.queryByTestId("picker")).toBeNull();
    expect(move).toHaveFocus();
    // → opens it too; done closes the whole menu
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("picker")).toBeInTheDocument();
    await user.click(screen.getByText("done"));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("Picker — the item points to it with aria-controls, and dismiss closes without taking focus back (#229)", async () => {
    const user = userEvent.setup();
    const picker = vi.fn((_place: unknown, done: { dismiss: () => void }, id: string) => (
      <ul id={id} data-testid="picker">
        <li>
          <button type="button" onClick={done.dismiss}>
            tab away
          </button>
        </li>
      </ul>
    ));
    const { onClose } = setup([{ label: "Move to…", picker, onSelect: vi.fn() }]);
    const move = screen.getByRole("menuitem", { name: "Move to…" });
    expect(move).not.toHaveAttribute("aria-controls");
    await user.click(move);
    const id = picker.mock.calls[0]![2];
    expect(id).toBeTruthy();
    expect(move).toHaveAttribute("aria-controls", id);
    expect(screen.getByTestId("picker")).toHaveAttribute("id", id);
    await user.click(screen.getByText("tab away"));
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("The minimum width is 184 — all seven menus in the design canvas are 184 (#230)", () => {
    setup([{ label: "Open", onSelect: vi.fn() }]);
    expect(MENU_MIN_WIDTH).toBe(184);
    expect(screen.getByRole("menu")).toHaveClass("min-w-46");
  });
});
