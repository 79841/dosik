import { getCurrentWindow } from "@tauri-apps/api/window";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetWindowFrame, useWindowFrame } from "../../lib/windowFrame";
import { DialogCaption } from "../DialogCaption";

const mockedWindow = vi.mocked(getCurrentWindow);

/** a modal dialog as the app opens them, the caption copy last inside it */
const Modal = ({ mac }: { mac?: boolean }) => {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} aria-label="A dialog">
      <button type="button">Inside</button>
      <DialogCaption mac={mac} />
    </dialog>
  );
};
const dialog = () => screen.getByRole("dialog", { name: "A dialog" });

describe("caption buttons above a dialog's scrim, off macOS (the canvas's Win-Settings, Win-Caption)", () => {
  let w: {
    minimize: ReturnType<typeof vi.fn>;
    toggleMaximize: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    resetWindowFrame();
    w = {
      minimize: vi.fn(async () => {}),
      toggleMaximize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    mockedWindow.mockReturnValue(w as never);
  });

  it("sit inside the open dialog — a modal leaves everything outside it inert — pinned to the window's corner", () => {
    render(<Modal mac={false} />);
    const group = within(dialog()).getByRole("group", { name: "Window" });
    const pin = group.closest("[data-dialog-caption]") as HTMLElement;
    expect(pin).toHaveClass("fixed", "top-0", "right-0");
    expect(dialog().lastElementChild).toBe(pin);
  });

  it("each calls the window — Close asks the window to close with the dialog still up", async () => {
    const user = userEvent.setup();
    render(<Modal mac={false} />);
    await user.click(within(dialog()).getByRole("button", { name: "Minimize" }));
    await user.click(within(dialog()).getByRole("button", { name: "Maximize" }));
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(w.minimize).toHaveBeenCalledTimes(1);
    expect(w.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(w.close).toHaveBeenCalledTimes(1);
  });

  it("stay out of the tab order — the dialog's first focus and Tab round are its own", () => {
    render(<Modal mac={false} />);
    for (const b of within(dialog()).getAllByRole("button").slice(1)) {
      expect(b).toHaveAttribute("tabindex", "-1");
    }
  });

  it("follow the window: Restore while maximized", () => {
    useWindowFrame.setState({ maximized: true });
    render(<Modal mac={false} />);
    expect(within(dialog()).getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("none on macOS, none in full screen", () => {
    const { unmount } = render(<Modal mac />);
    expect(within(dialog()).queryByRole("group", { name: "Window" })).toBeNull();
    unmount();
    useWindowFrame.setState({ fullscreen: true });
    render(<Modal mac={false} />);
    expect(dialog().querySelector("[data-dialog-caption]")).toBeNull();
  });
});
