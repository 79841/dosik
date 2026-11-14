import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { badgeColour } from "../../../shared/lib/projectBadge";
import { badgeIn } from "../../../test/badges";
import { PathCrumbs } from "../PathCrumbs";

const path = [
  { id: "pay", name: "Payments" },
  { id: "chk", name: "Checkout" },
];

/**
 * The path to a diagram (#229 D3): the editor's toolbar row and Home's
 * header row both draw it (#231 D3) — ancestors are buttons, the current
 * item is the last, "/" between them is decoration.
 */
describe("PathCrumbs (#229 D3, T42)", () => {
  it("nav Breadcrumb > ol — ancestors are buttons, separators aria-hidden, the current item aria-current", () => {
    render(<PathCrumbs path={path} current="Order flow" onCrumb={() => {}} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    const list = within(nav).getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(nav)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Payments", "Checkout"]);
    const current = within(nav).getByText("Order flow");
    expect(current.closest("[aria-current]")).toHaveAttribute("aria-current", "page");
    const slashes = [...nav.querySelectorAll("[aria-hidden='true']")].filter(
      (n) => n.textContent === "/",
    );
    expect(slashes).toHaveLength(2);
    // the slashes are not read out: the accessible text is the names alone
    expect(nav.textContent).toBe("Payments/Checkout/Order flow");
    for (const s of slashes) expect(s).toHaveClass("text-dash");
  });

  it("ancestors: muted 500, ink on hover, shrink to at most 160px — the current item is ink 600", () => {
    render(<PathCrumbs path={path} current="Order flow" onCrumb={() => {}} />);
    const payments = screen.getByRole("button", { name: "Payments" });
    expect(payments).toHaveClass("text-muted", "font-medium", "hover:text-ink", "max-w-40");
    expect(payments.querySelector(".truncate")).toHaveTextContent("Payments");
    const current = screen.getByText("Order flow").closest("[aria-current]") as HTMLElement;
    expect(current).toHaveClass("text-ink", "font-semibold");
  });

  it("when narrow, ancestors shrink to 0 first and the current item is truncated only after that (#229, D3)", () => {
    render(<PathCrumbs path={path} current="Order flow" onCrumb={() => {}} />);
    const items = screen.getAllByRole("listitem");
    const current = items.at(-1)!;
    // the current item does not give way while an ancestor can
    expect(current).toHaveClass("shrink-0", "max-w-full", "min-w-0");
    for (const ancestor of items.slice(0, -1)) {
      expect(ancestor).toHaveClass("min-w-0", "overflow-hidden");
      expect(ancestor).not.toHaveClass("shrink-0");
    }
  });

  it("clicking an ancestor calls back with its id", async () => {
    const user = userEvent.setup();
    const onCrumb = vi.fn();
    render(<PathCrumbs path={path} current="Order flow" onCrumb={onCrumb} />);
    await user.click(screen.getByRole("button", { name: "Checkout" }));
    expect(onCrumb).toHaveBeenCalledWith("chk");
  });

  it("with no ancestors, only the title — no separator either", () => {
    render(<PathCrumbs path={[]} current="Ext" onCrumb={() => {}} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).queryByRole("button")).toBeNull();
    expect(nav.textContent).toBe("Ext");
  });
});

/**
 * Home's header row draws the same path (#231 D3): its current item is the
 * sheet's one h1 — what takes the focus after a move inside the sheet — and
 * a rename puts the name field in its place.
 */
describe("PathCrumbs — heading·editor (#231 D3, T10)", () => {
  it("heading → the current item is an h1 — aria-current, data-home-heading, tabIndex -1, same look", () => {
    render(<PathCrumbs path={path} current="Flows" onCrumb={() => {}} heading />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Flows" });
    expect(h1).toHaveAttribute("aria-current", "page");
    expect(h1).toHaveAttribute("data-home-heading");
    expect(h1).toHaveAttribute("tabindex", "-1");
    expect(h1).toHaveClass("m-0", "outline-none", "text-ink", "font-semibold", "text-[12px]");
    // the ancestors stay buttons
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Payments",
      "Checkout",
    ]);
  });

  it("editor → that node in the current item's place — ancestors and separators stay", () => {
    render(
      <PathCrumbs
        path={path}
        current="Flows"
        onCrumb={() => {}}
        heading
        editor={<input aria-label="Folder name" defaultValue="Flows" />}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    const last = within(nav).getAllByRole("listitem").at(-1)!;
    expect(within(last).getByRole("textbox", { name: "Folder name" })).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(nav.querySelector("[aria-current]")).toBeNull();
    expect(last.querySelector("[aria-hidden='true']")).toHaveTextContent("/");
  });

  it("with neither, the current item is a span — not an h1 (editor toolbar)", () => {
    render(<PathCrumbs path={path} current="Order flow" onCrumb={() => {}} />);
    expect(screen.queryByRole("heading")).toBeNull();
    const current = screen.getByText("Order flow").closest("[aria-current]")!;
    expect(current.tagName).toBe("SPAN");
    expect(current).not.toHaveAttribute("data-home-heading");
    expect(current).not.toHaveAttribute("tabindex");
  });
});

/** Home's header names the project with its badge (#236 R4, T9) */
describe("PathCrumbs — project cell badge (#236)", () => {
  it("given project, a 14px badge before the name of the ancestor cell with that id — the button's name is unchanged", () => {
    render(
      <PathCrumbs path={path} current="Flows" currentId="flw" project="pay" onCrumb={() => {}} />,
    );
    const payments = screen.getByRole("button", { name: "Payments" });
    const badge = badgeIn(payments)!;
    expect(badge).toHaveTextContent("P");
    expect(badge).toHaveClass(`bg-badge-${badgeColour("pay")}-soft`, "h-3.5", "w-3.5");
    expect(badge.nextElementSibling).toHaveTextContent("Payments");
    expect(payments).toHaveClass("gap-1.5");
    expect(badgeIn(screen.getByRole("button", { name: "Checkout" }))).toBeNull();
    expect(badgeIn(screen.getByText("Flows").closest("[aria-current]")!)).toBeNull();
  });

  it("when the current cell is the project, the badge goes on the current cell", () => {
    render(
      <PathCrumbs
        path={[]}
        current="Payments"
        currentId="pay"
        project="pay"
        heading
        onCrumb={() => {}}
      />,
    );
    const heading = screen.getByRole("heading", { name: "Payments" });
    expect(badgeIn(heading)).toHaveTextContent("P");
  });

  it("while renaming the project, the badge stays before the input (6px gap)", () => {
    render(
      <PathCrumbs
        path={[]}
        current="Payments"
        currentId="pay"
        project="pay"
        heading
        onCrumb={() => {}}
        editor={<input aria-label="Project name" defaultValue="Payments" />}
      />,
    );
    const field = screen.getByRole("textbox", { name: "Project name" });
    const badge = badgeIn(field.parentElement!)!;
    expect(badge).toHaveClass("mr-1.5");
    expect(badge.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("no badge without project (editor toolbar)", () => {
    render(<PathCrumbs path={path} current="Order flow" onCrumb={() => {}} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(badgeIn(nav)).toBeNull();
    expect(nav.textContent).toBe("Payments/Checkout/Order flow");
  });
});

/** Home's path card hangs from the current step (#238 R3) — the editor's path has none */
describe("current cell hover — path card anchor (#238)", () => {
  it("reports the cell on enter and null on leave — whether h1 or span", () => {
    const onCurrentHover = vi.fn();
    const { rerender } = render(
      <PathCrumbs
        path={path}
        current="Flows"
        onCrumb={() => {}}
        heading
        onCurrentHover={onCurrentHover}
      />,
    );
    const step = screen.getByRole("heading", { level: 1 });
    fireEvent.pointerEnter(step);
    expect(onCurrentHover).toHaveBeenLastCalledWith(step);
    fireEvent.pointerLeave(step);
    expect(onCurrentHover).toHaveBeenLastCalledWith(null);
    rerender(
      <PathCrumbs path={path} current="Flows" onCrumb={() => {}} onCurrentHover={onCurrentHover} />,
    );
    const span = screen.getByText("Flows").closest("[aria-current]") as HTMLElement;
    fireEvent.pointerEnter(span);
    expect(onCurrentHover).toHaveBeenLastCalledWith(span);
  });

  it("hover background, kept while the card is open — no background without a callback (editor path)", () => {
    const { rerender } = render(
      <PathCrumbs
        path={path}
        current="Flows"
        onCrumb={() => {}}
        heading
        onCurrentHover={() => {}}
      />,
    );
    const step = () => screen.getByRole("heading", { level: 1 });
    expect(step()).toHaveClass("hover:bg-hover");
    expect(step()).not.toHaveClass("bg-hover");
    rerender(
      <PathCrumbs
        path={path}
        current="Flows"
        onCrumb={() => {}}
        heading
        onCurrentHover={() => {}}
        currentActive
      />,
    );
    expect(step()).toHaveClass("bg-hover");
    rerender(<PathCrumbs path={path} current="Flows" onCrumb={() => {}} heading />);
    expect(step()).not.toHaveClass("hover:bg-hover");
  });
});
