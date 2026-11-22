import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FOLD_MS, FoldGroup } from "../FoldGroup";

/** a folder's rows folding and unfolding (#260 R1) */

const rows = () => (
  <>
    <li data-child="">Login flow</li>
    <li data-child="">Sequence</li>
  </>
);
const group = () => document.querySelector("[data-fold]") as HTMLElement | null;
const children = () => document.querySelectorAll("[data-child]");

describe("FoldGroup (#260 R1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closed from the start: nothing is drawn — its rows are not even built", () => {
    const build = vi.fn(rows);
    render(<FoldGroup open={false} render={build} />);
    expect(group()).toBeNull();
    expect(build).not.toHaveBeenCalled();
  });

  it("open from the start: open at once, no motion — the list's first draw, a peek opening", () => {
    render(<FoldGroup open render={rows} />);
    expect(group()).toHaveClass("grid-rows-[1fr]", "opacity-100");
    expect(group()).not.toHaveClass("overflow-y-clip");
    expect(group()).not.toHaveAttribute("inert");
    expect(screen.getByRole("group")).toBeInTheDocument();
    expect(children()).toHaveLength(2);
  });

  it("opening: the rows are there at once and grow from 0, clipped until the motion ends", () => {
    const { rerender } = render(<FoldGroup open={false} render={rows} />);
    rerender(<FoldGroup open render={rows} />);
    expect(children()).toHaveLength(2);
    expect(group()).toHaveClass("grid-rows-[1fr]", "opacity-100", "overflow-y-clip");
    fireEvent.transitionEnd(group()!);
    // open: nothing clips a row that glides out of its place in a drag
    expect(group()).not.toHaveClass("overflow-y-clip");
  });

  it("closing: height 0 and transparent, out of reach of the focus and screen readers, the rows kept until the motion ends", () => {
    const { rerender } = render(<FoldGroup open render={rows} />);
    rerender(<FoldGroup open={false} render={rows} />);
    expect(group()).toHaveClass("grid-rows-[0fr]", "opacity-0", "overflow-y-clip");
    expect(group()).toHaveAttribute("inert");
    expect(group()).toHaveAttribute("aria-hidden", "true");
    expect(children()).toHaveLength(2);
    expect(screen.queryByRole("group")).toBeNull();
    fireEvent.transitionEnd(group()!);
    expect(group()).toBeNull();
  });

  it("a motion that never ends (reduced motion, no transition) still ends — by a timer just past its length", () => {
    const { rerender } = render(<FoldGroup open render={rows} />);
    rerender(<FoldGroup open={false} render={rows} />);
    act(() => vi.advanceTimersByTime(FOLD_MS + 49));
    expect(group()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(group()).toBeNull();

    rerender(<FoldGroup open render={rows} />);
    expect(group()).toHaveClass("overflow-y-clip");
    act(() => vi.advanceTimersByTime(FOLD_MS + 50));
    expect(group()).not.toHaveClass("overflow-y-clip");
  });

  it("a row's own motion ending inside it does not end the fold", () => {
    const { rerender } = render(<FoldGroup open render={rows} />);
    rerender(<FoldGroup open={false} render={rows} />);
    fireEvent.transitionEnd(children()[0]!);
    expect(group()).not.toBeNull();
  });

  it("opened again while closing: the same rows turn back from where they are — no new list, nothing queued", () => {
    const { rerender } = render(<FoldGroup open render={rows} />);
    const before = group();
    const first = children()[0];
    rerender(<FoldGroup open={false} render={rows} />);
    rerender(<FoldGroup open render={rows} />);
    expect(group()).toBe(before);
    expect(children()[0]).toBe(first);
    expect(group()).toHaveClass("grid-rows-[1fr]", "opacity-100");
    expect(group()).not.toHaveAttribute("inert");
    expect(group()).not.toHaveAttribute("aria-hidden");
    // the closing timer is gone with the closing
    act(() => vi.advanceTimersByTime(FOLD_MS * 4));
    expect(group()).toBe(before);
  });

  it("height and opacity move together, 180ms ease-out — only when motion is allowed", () => {
    expect(FOLD_MS).toBe(180);
    render(<FoldGroup open render={rows} />);
    const motion = group()!
      .className.split(/\s+/)
      .filter((c) => /transition|duration|ease/.test(c));
    expect(motion).toEqual([
      "motion-safe:transition-[grid-template-rows,opacity]",
      "motion-safe:duration-180",
      "motion-safe:ease-[cubic-bezier(0.2,0,0,1)]",
    ]);
  });

  it("its list is the tree's group — a row's 1px gap inside it, so it folds away with it", () => {
    render(<FoldGroup open render={rows} />);
    const list = screen.getByRole("group");
    expect(list.tagName).toBe("UL");
    expect(list.parentElement).toBe(group());
    expect(list).toHaveClass("min-h-0", "[&>li]:mt-px");
  });

  describe("the focus inside rows that grew is scrolled into view again (#260)", () => {
    const focusable = () => (
      <>
        <li tabIndex={-1} data-child="">
          Login flow
        </li>
        <li tabIndex={-1} data-child="">
          Sequence
        </li>
      </>
    );
    const scroll = vi.fn();
    beforeEach(() => {
      scroll.mockClear();
      Element.prototype.scrollIntoView = scroll;
    });
    afterEach(() => {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    });
    /** a closed group opened, its first row focused while it grows */
    const grow = () => {
      const view = render(<FoldGroup open={false} render={focusable} />);
      view.rerender(<FoldGroup open render={focusable} />);
      act(() => (children()[0] as HTMLElement).focus());
      return view;
    };

    it("when its motion ends — the list was shorter while it grew, so the first scroll fell short", () => {
      grow();
      expect(scroll).not.toHaveBeenCalled();
      fireEvent.transitionEnd(group()!);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(children()[0]);
      expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    });

    it("when the timer settles it too — no transition under reduced motion", () => {
      grow();
      act(() => vi.advanceTimersByTime(FOLD_MS + 50));
      expect(scroll.mock.contexts).toEqual([children()[0]]);
    });

    it("not when the focus is elsewhere, nor for a group open from the start, nor when it folds", () => {
      const { rerender } = render(<FoldGroup open={false} render={focusable} />);
      rerender(<FoldGroup open render={focusable} />);
      fireEvent.transitionEnd(group()!);
      expect(scroll).not.toHaveBeenCalled();
      rerender(<FoldGroup open={false} render={focusable} />);
      fireEvent.transitionEnd(group()!);
      render(<FoldGroup open render={focusable} />);
      act(() => (children()[0] as HTMLElement).focus());
      act(() => vi.advanceTimersByTime(FOLD_MS * 4));
      expect(scroll).not.toHaveBeenCalled();
    });
  });
});
