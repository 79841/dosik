import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOutsideDismiss } from "../useOutsideDismiss";

/** The dismissal contract every popup shares (#80) — pins the hook itself */
const Fixture = () => {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideDismiss(ref, open, () => setOpen(false));
  return open ? (
    <div ref={ref} data-testid="popup">
      <button type="button">inside</button>
    </div>
  ) : null;
};

const swallow = (e: Event): void => e.stopPropagation();

afterEach(() => {
  document.body.removeEventListener("pointerdown", swallow);
});

describe("useOutsideDismiss", () => {
  it("closes even on canvas clicks that stop propagation, by listening in the capture phase", () => {
    const { queryByTestId } = render(<Fixture />);
    document.body.addEventListener("pointerdown", swallow);
    fireEvent.pointerDown(document.body);
    expect(queryByTestId("popup")).toBeNull();
  });

  it("does not close on a pointerdown inside", () => {
    const { getByText, queryByTestId } = render(<Fixture />);
    fireEvent.pointerDown(getByText("inside"));
    expect(queryByTestId("popup")).not.toBeNull();
  });

  it("closes on Escape", () => {
    const { queryByTestId } = render(<Fixture />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(queryByTestId("popup")).toBeNull();
  });

  it("does not close on a pointerdown over ignore (the opening button) — that button's click toggles it closed (#220)", async () => {
    // a popup placed at a point, outside its opener — Home's menus
    const Opener = ({ ignoreOpener }: { ignoreOpener: boolean }) => {
      const [open, setOpen] = useState(false);
      const ref = useRef<HTMLDivElement>(null);
      const button = useRef<HTMLButtonElement>(null);
      useOutsideDismiss(ref, open, () => setOpen(false), {
        ignore: ignoreOpener ? button : undefined,
      });
      return (
        <>
          <button ref={button} type="button" onClick={() => setOpen(!open)}>
            More
          </button>
          {open ? <div ref={ref} data-testid="popup" /> : null}
        </>
      );
    };
    const user = userEvent.setup();
    const { unmount } = render(<Opener ignoreOpener />);
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByTestId("popup")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByTestId("popup")).toBeNull();
    // anywhere else still closes it
    await user.click(screen.getByRole("button", { name: "More" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("popup")).toBeNull();
    unmount();

    // without it, the opener's pointerdown dismisses and its click opens again
    render(<Opener ignoreOpener={false} />);
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByTestId("popup")).toBeInTheDocument();
  });

  it("attaches no listeners while inactive", () => {
    const Inactive = () => {
      const [dismissed, setDismissed] = useState(false);
      const ref = useRef<HTMLDivElement>(null);
      useOutsideDismiss(ref, false, () => setDismissed(true));
      return <div ref={ref}>{dismissed ? "dismissed" : "idle"}</div>;
    };
    const { getByText } = render(<Inactive />);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(getByText("idle")).toBeTruthy();
  });

  it("does not reattach listeners when a new ignore array is passed every render (#229)", () => {
    const Many = ({ n }: { n: number }) => {
      const ref = useRef<HTMLDivElement>(null);
      const a = useRef<HTMLDivElement>(null);
      const b = useRef<HTMLDivElement>(null);
      // a fresh array on every render, as a caller writes it inline
      useOutsideDismiss(ref, true, () => undefined, { ignore: [a, b] });
      return <div ref={ref}>{n}</div>;
    };
    const add = vi.spyOn(window, "addEventListener");
    const { rerender } = render(<Many n={1} />);
    const once = add.mock.calls.filter(([type]) => type === "pointerdown").length;
    rerender(<Many n={2} />);
    rerender(<Many n={3} />);
    expect(add.mock.calls.filter(([type]) => type === "pointerdown").length).toBe(once);
    add.mockRestore();
  });
});
