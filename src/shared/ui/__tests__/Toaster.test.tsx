import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TOAST_DURATION, toastError, useToastStore } from "../../lib/toastStore";
import { Toaster } from "../Toaster";

describe("Toaster", () => {
  beforeEach(() => useToastStore.getState().dismissAll());

  it("The live region is mounted, empty, even with no toasts", () => {
    render(<Toaster />);
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).toBeInTheDocument();
    expect(region).toBeEmptyDOMElement();
  });

  it("info reads as the status role, error as the alert role", () => {
    useToastStore.getState().pushToast("Saved");
    useToastStore.getState().pushToast("Error: boom", "error");
    render(<Toaster />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByRole("alert")).toHaveTextContent("Error: boom");
  });

  it("The × button closes only that toast", async () => {
    const user = userEvent.setup();
    useToastStore.getState().pushToast("A");
    useToastStore.getState().pushToast("B");
    render(<Toaster />);
    await user.click(within(screen.getByText("A").parentElement!).getByLabelText("Dismiss"));
    expect(screen.queryByText("A")).not.toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("Does not disappear while the pointer is over it, and restarts the count when it leaves", () => {
    vi.useFakeTimers();
    try {
      useToastStore.getState().pushToast("Saved");
      render(<Toaster />);
      fireEvent.mouseEnter(screen.getByRole("status"));
      act(() => vi.advanceTimersByTime(TOAST_DURATION.info * 3));
      expect(screen.getByText("Saved")).toBeInTheDocument();

      fireEvent.mouseLeave(screen.getByRole("status"));
      act(() => vi.advanceTimersByTime(TOAST_DURATION.info - 1));
      expect(screen.getByText("Saved")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("The same while it has focus — it doesn't vanish just as you go to close it", () => {
    vi.useFakeTimers();
    try {
      useToastStore.getState().pushToast("Saved");
      render(<Toaster />);
      act(() => screen.getByLabelText("Dismiss").focus());
      act(() => vi.advanceTimersByTime(TOAST_DURATION.info * 3));
      expect(screen.getByText("Saved")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Does not disappear when focus leaves the × button while the mouse is still over it", () => {
    vi.useFakeTimers();
    try {
      useToastStore.getState().pushToast("Saved");
      render(<Toaster />);
      const toast = screen.getByRole("status");
      fireEvent.mouseEnter(toast);
      act(() => screen.getByLabelText("Dismiss").focus());
      act(() => screen.getByLabelText("Dismiss").blur());
      act(() => vi.advanceTimersByTime(TOAST_DURATION.info * 3));
      expect(screen.getByText("Saved")).toBeInTheDocument();

      fireEvent.mouseLeave(toast);
      act(() => vi.advanceTimersByTime(TOAST_DURATION.info));
      expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("The 'Dismiss all' button is outside the live region — it is not read like a notification", () => {
    useToastStore.getState().pushToast("A");
    useToastStore.getState().pushToast("B");
    render(<Toaster />);
    const region = document.querySelector('[aria-live="polite"]')!;
    expect(region).not.toContainElement(screen.getByText("Dismiss all"));
    expect(region).toContainElement(screen.getByText("A"));
  });

  it("'Dismiss all' shows only when several toasts are up, and clicking it closes them all", async () => {
    const user = userEvent.setup();
    useToastStore.getState().pushToast("A");
    render(<Toaster />);
    expect(screen.queryByText("Dismiss all")).not.toBeInTheDocument();

    useToastStore.getState().pushToast("B");
    await user.click(await screen.findByText("Dismiss all"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("Bottom center of the canvas — leaves room on the right for a docked panel and centers within the rest (#219 D16, T24)", () => {
    const { container: host } = render(<Toaster />);
    const container = host.firstElementChild as HTMLElement;
    expect(container.style.right).toBe("var(--dsk-toast-right, 0px)");
    // 16 on Home's sheet (#231 D18); the editor holds them on the row above
    // its bottom islands, the edit bar lifts them over itself when it is
    // raised or wraps, the Home board over its bottom islands — whichever is
    // highest (#159, #221); each lift has its own owner
    expect(container.style.bottom).toBe(
      "calc(16px + max(var(--dsk-toast-editor-lift, 0px), var(--dsk-toast-lift, 0px), var(--dsk-toast-board-lift, 0px)))",
    );
    expect(container).toHaveClass("left-0", "flex", "items-center");
    expect(container).not.toHaveClass("-translate-x-1/2");
    expect(container).not.toHaveClass("left-1/2");
    // a long message wraps inside the canvas — 412 wide beside the panel at the smallest
    act(() => useToastStore.getState().pushToast("Saved"));
    expect(screen.getByRole("status")).toHaveClass("max-w-[min(28rem,calc(100%_-_24px))]");
    expect(screen.getByRole("status").parentElement).toHaveClass("w-full");
  });
});

/**
 * One toast (#231 D18, the canvas's `HomeCollapse-Hidden` hint and DS
 * `.dsk-toast`): a light tile 30 tall on one line — 5 above and below a 20
 * row, 10 in on the left, 5 on the right — radius 8, `shadow-raised`, the
 * text `icon` 11.5/500 on a 16 line, a 20 dismiss button with an 11 X. A
 * long one wraps inside the canvas (#219) and the toast grows by 16 a line
 * with the same 5 above and below, the X centred on its height. An error is
 * the danger pair with a `deep-rose` alert icon ahead of the sentence.
 */
describe("Toast appearance (#231 D18)", () => {
  beforeEach(() => useToastStore.getState().dismissAll());

  it("One light line is 30 — 5 above and below + a 20 line, padding 0 5 0 10, radius 8, raised, text in icon color 11.5/500", () => {
    render(<Toaster />);
    act(() => useToastStore.getState().pushToast("Saved"));
    const toast = screen.getByRole("status");
    expect(toast).toHaveClass(
      "min-h-[30px]",
      "items-center",
      "gap-1.5",
      "rounded-lg",
      "py-[5px]",
      "pr-[5px]",
      "pl-2.5",
      "text-[11.5px]",
      "font-medium",
      "shadow-raised",
      "bg-surface",
      "text-icon",
    );
    expect(toast).not.toHaveClass("shadow-popover");
    expect(toast).not.toHaveClass("text-ink");
    expect(toast).not.toHaveClass("text-[12.5px]");
    // one line: 5 + the 20 button row (the 16 line centred in it) + 5 = 30
    const text = within(toast).getByText("Saved");
    expect(text).toHaveClass("whitespace-pre-wrap", "leading-4");
    expect(text).not.toHaveClass("py-px");
    expect(text).not.toHaveClass("leading-[18px]");
    // a light toast says nothing ahead of its sentence
    expect(toast.querySelectorAll("svg")).toHaveLength(1);
  });

  it("Multiple lines grow by 16 each and the close button stays vertically centered — DS `.dsk-toast` (items-center)", () => {
    render(<Toaster />);
    act(() => useToastStore.getState().pushToast(`Saved ${"a long sentence ".repeat(12)}`));
    const toast = screen.getByRole("status");
    expect(toast).toHaveClass("items-center");
    expect(toast).not.toHaveClass("items-start");
    expect(within(toast).getByRole("button", { name: "Dismiss" })).not.toHaveClass("self-start");
  });

  it("Long text with no break points (paths, URLs) does not overflow the toast and wraps anywhere", () => {
    render(<Toaster />);
    const long = `Couldn't open /Users/someone/${"a".repeat(160)}.dosik.json`;
    act(() => useToastStore.getState().pushToast(long, "error"));
    const text = within(screen.getByRole("alert")).getByText(long);
    // a flex child shrinks below its content only with min-w-0; anywhere breaks inside the word
    expect(text).toHaveClass("min-w-0", "[overflow-wrap:anywhere]", "whitespace-pre-wrap");
  });

  it("Close button 20, X 11 — the same icon color as the text", () => {
    render(<Toaster />);
    act(() => useToastStore.getState().pushToast("Saved"));
    const dismiss = within(screen.getByRole("status")).getByRole("button", { name: "Dismiss" });
    expect(dismiss).toHaveClass("size-5", "shrink-0", "rounded-sm", "text-icon");
    expect(dismiss).not.toHaveClass("h-6");
    const x = dismiss.querySelector("svg")!;
    expect(x).toHaveAttribute("width", "11");
    expect(x).toHaveAttribute("stroke-width", "2.2");
  });

  it("Errors have the same size and text — only the color is the current danger pair", () => {
    render(<Toaster />);
    act(() => useToastStore.getState().pushToast("Error: boom", "error"));
    const toast = screen.getByRole("alert");
    expect(toast).toHaveClass(
      "min-h-[30px]",
      "py-[5px]",
      "pr-[5px]",
      "pl-2.5",
      "rounded-lg",
      "text-[11.5px]",
      "font-medium",
      "shadow-raised",
      "bg-tile-rose",
      "text-tile-ink",
    );
    expect(toast).not.toHaveClass("bg-surface");
    expect(toast).not.toHaveClass("text-icon");
    const dismiss = within(toast).getByRole("button", { name: "Dismiss" });
    expect(dismiss).toHaveClass("size-5", "text-tile-ink-muted");
    expect(dismiss).not.toHaveClass("text-tile-ink/60");
    expect(dismiss.querySelector("svg")).toHaveAttribute("width", "11");
  });

  it("Errors get a deep-rose warning icon 15 before the sentence — hidden, 6 from the text (DS `.dsk-toast--error`)", () => {
    render(<Toaster />);
    act(() => useToastStore.getState().pushToast("Couldn't write the file.", "error"));
    const toast = screen.getByRole("alert");
    const icon = toast.firstElementChild!;
    expect(icon.tagName.toLowerCase()).toBe("svg");
    // deep-rose, the same in both themes: the tile stays light, dark's bright danger would vanish on it
    expect(icon).toHaveClass("lucide-circle-alert", "flex-none", "text-deep-rose");
    expect(icon).not.toHaveClass("text-danger");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("width", "15");
    expect(icon).toHaveAttribute("stroke-width", "1.75");
    // the toast's gap-1.5 is the 6 between icon, sentence and button
    expect(toast).toHaveClass("gap-1.5");
    expect(icon.nextElementSibling).toBe(within(toast).getByText("Couldn't write the file."));
    expect(toast.textContent).toBe("Couldn't write the file.");
  });

  it("The 'Error: ' prefix is not shown, only read — the spoken sentence is unchanged", () => {
    render(<Toaster />);
    act(() => {
      toastError(new Error("boom"));
    });
    const toast = screen.getByRole("alert");
    expect(toast).toHaveTextContent("Error: boom");
    expect(toast.textContent).toBe("Error: boom");
    const hidden = toast.querySelector(".sr-only")!;
    expect(hidden.textContent).toBe("Error: ");
    // what shows is the message alone, after the icon
    const sentence = hidden.parentElement!;
    expect(Array.from(sentence.childNodes, (n) => n.textContent)).toEqual(["Error: ", "boom"]);
    expect(screen.getByText("boom")).toBe(sentence);
  });

  it("Does not hide the prefix when it isn't at the start of the text — the whole sentence is visible", () => {
    render(<Toaster />);
    act(() => useToastStore.getState().pushToast("Saved", "error", { prefix: "Error: " }));
    const toast = screen.getByRole("alert");
    expect(toast.querySelector(".sr-only")).toBeNull();
    expect(within(toast).getByText("Saved")).toBeInTheDocument();
  });

  it("A shortcut sits in place within the sentence as kbd 11/600 ink — the spoken sentence is unchanged (HomeCollapse-Hidden)", () => {
    render(<Toaster />);
    act(() =>
      useToastStore.getState().pushToast("Sidebar hidden · ⌘\\ to show", "info", { keys: "⌘\\" }),
    );
    const toast = screen.getByRole("status");
    expect(toast.textContent).toBe("Sidebar hidden · ⌘\\ to show");
    const kbd = toast.querySelector("kbd")!;
    expect(kbd).toHaveTextContent("⌘\\");
    expect(kbd).toHaveClass("font-[inherit]", "text-[11px]", "font-semibold", "text-ink");
    // no chip: the canvas draws it bare in the sentence
    expect(kbd).not.toHaveClass("bg-hover");
    const sentence = kbd.parentElement!;
    expect(sentence).toHaveClass("whitespace-pre-wrap", "leading-4");
    expect(Array.from(sentence.childNodes, (n) => n.textContent)).toEqual([
      "Sidebar hidden · ",
      "⌘\\",
      " to show",
    ]);
  });

  it("No kbd when there is no shortcut or it isn't in the text", () => {
    render(<Toaster />);
    act(() => {
      useToastStore.getState().pushToast("Saved");
      useToastStore.getState().pushToast("Moved", "info", { keys: "⌘\\" });
    });
    expect(document.querySelector("kbd")).toBeNull();
    expect(screen.getByText("Moved")).toBeInTheDocument();
  });

  it("With several, 'Dismiss all' is on top and the toasts below — every gap is 8", () => {
    const { container: host } = render(<Toaster />);
    act(() => {
      useToastStore.getState().pushToast("A");
      useToastStore.getState().pushToast("B");
    });
    const stack = host.firstElementChild as HTMLElement;
    const region = document.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(stack.firstElementChild).toBe(screen.getByRole("button", { name: "Dismiss all" }));
    expect(stack.lastElementChild).toBe(region);
    expect(stack).toHaveClass("flex-col", "gap-2");
    expect(region).toHaveClass("flex-col", "gap-2");
    // the same type as the toasts
    expect(screen.getByRole("button", { name: "Dismiss all" })).toHaveClass(
      "text-[11.5px]",
      "font-medium",
    );
  });
});
