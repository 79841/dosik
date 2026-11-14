import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useMenuKeys } from "../useMenuKeys";

const Menu = ({
  onEscape = () => {},
  onTab,
  checkedFirst,
}: {
  onEscape?: () => void;
  onTab?: () => void;
  checkedFirst?: boolean;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = useMenuKeys(ref, true, { onEscape, onTab, checkedFirst });
  return (
    <div ref={ref} role="menu" aria-label="Test" tabIndex={-1} onKeyDown={onKeyDown}>
      <button type="button" role="menuitem" disabled>
        Off
      </button>
      <button type="button" role="menuitem">
        One
      </button>
      <hr />
      <button type="button" role="menuitemcheckbox" aria-checked="false">
        Two
      </button>
      <button type="button" role="menuitemradio" aria-checked="true">
        Three
      </button>
    </div>
  );
};

const item = (name: string) => screen.getByText(name);
const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key });

/**
 * The menus' shared keyboard (#219) — PageMenu's and the tree row's
 * (#220's shared `Menu`), now one hook for every `role="menu"`.
 */
describe("useMenuKeys — menu keyboard (#219)", () => {
  it("focuses the first selectable item on open — skips disabled items", () => {
    render(<Menu />);
    expect(item("One")).toHaveFocus();
  });

  it("checkedFirst — a choice menu opens on the checked item (#220 shared Menu)", () => {
    render(<Menu checkedFirst />);
    expect(item("Three")).toHaveFocus();
    press("ArrowDown");
    expect(item("One")).toHaveFocus();
  });

  it("↑↓ wrap around and Home/End jump to the ends — checkbox and radio items are walked too", () => {
    render(<Menu />);
    press("ArrowDown");
    expect(item("Two")).toHaveFocus();
    press("ArrowDown");
    expect(item("Three")).toHaveFocus();
    press("ArrowDown");
    expect(item("One")).toHaveFocus();
    press("ArrowUp");
    expect(item("Three")).toHaveFocus();
    press("Home");
    expect(item("One")).toHaveFocus();
    press("End");
    expect(item("Three")).toHaveFocus();
  });

  it("Escape calls onEscape — it does not reach the window", () => {
    const onEscape = vi.fn();
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    try {
      render(<Menu onEscape={onEscape} />);
      press("Escape");
      expect(onEscape).toHaveBeenCalledTimes(1);
      expect(onWindow).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindow);
    }
  });

  it("Tab acts only with onTab — it closes and focus moves on as usual", () => {
    const onTab = vi.fn();
    const { unmount } = render(<Menu onTab={onTab} />);
    const tab = fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(onTab).toHaveBeenCalledTimes(1);
    // not prevented: the browser moves the focus on
    expect(tab).toBe(true);
    unmount();

    render(<Menu />);
    expect(fireEvent.keyDown(document.activeElement!, { key: "Tab" })).toBe(true);
  });
});

const Grid = () => {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = useMenuKeys(ref, true, { onEscape: () => {}, columns: 3 });
  return (
    <div ref={ref} role="menu" aria-label="Grid" tabIndex={-1} onKeyDown={onKeyDown}>
      {["A", "B", "C", "D", "E", "F", "G"].map((name) => (
        <button key={name} type="button" role="menuitem">
          {name}
        </button>
      ))}
    </div>
  );
};

/**
 * A menu whose items are laid out as a grid — the shape strip's icon flyout,
 * six to a row (#219): the arrows follow the layout.
 */
describe("useMenuKeys — grid menu (columns, #219)", () => {
  it("←→ wrap one at a time, ↑↓ move a row — stopping at the edge rows", () => {
    render(<Grid />);
    expect(item("A")).toHaveFocus();
    press("ArrowRight");
    expect(item("B")).toHaveFocus();
    press("ArrowDown");
    expect(item("E")).toHaveFocus();
    press("ArrowDown");
    // the row below has nothing under E — stay
    expect(item("E")).toHaveFocus();
    press("ArrowUp");
    expect(item("B")).toHaveFocus();
    press("ArrowUp");
    expect(item("B")).toHaveFocus();
    press("ArrowLeft");
    press("ArrowLeft");
    expect(item("G")).toHaveFocus();
    press("Home");
    expect(item("A")).toHaveFocus();
  });

  it("without columns, ←→ do not belong to the menu", () => {
    render(<Menu />);
    expect(fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" })).toBe(true);
    expect(item("One")).toHaveFocus();
  });
});
