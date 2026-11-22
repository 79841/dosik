import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSidebarStore } from "../../../shared/lib/sidebarLayout";
import {
  resetSidebarSlideForTests,
  SLIDE_MS,
  useSidebarSlideStore,
} from "../../../shared/lib/sidebarSlide";
import { DockedSidebarSlot } from "../DockedSidebarSlot";

/**
 * The docked sidebar sliding out and in (canvas `TabsCollapse-Toggle`, hide /
 * show motion): its slot narrows to 0 or widens from 0, the sidebar keeping
 * its width; an edge drag and reduced motion are instant.
 */

const renderSlot = () =>
  render(
    <DockedSidebarSlot>
      <aside data-testid="sidebar">
        <span data-testid="row">Payments</span>
      </aside>
    </DockedSidebarSlot>,
  );
const slot = () => document.querySelector("[data-sidebar-slot]") as HTMLElement | null;
/** the sidebar's own box inside the slot — it keeps its width */
const inner = () => slot()?.firstElementChild as HTMLElement | null;
const phase = () => useSidebarSlideStore.getState().phase;
const MOTION = "motion-safe:transition-[width]";
const reduceMotion = (reduce: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
  }));

describe("the docked sidebar slides out and in", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSidebarStore.setState({
      hidden: false,
      width: 248,
      hinted: true,
      peek: false,
      resizing: false,
    });
    resetSidebarSlideForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("docked from the start: the slot is the sidebar's width, still — no motion", () => {
    renderSlot();
    expect(slot()!.style.width).toBe("248px");
    expect(inner()!.style.width).toBe("248px");
    expect(slot()).not.toHaveClass(MOTION);
    expect(slot()).not.toHaveClass("overflow-hidden");
    expect(phase()).toBe("open");
  });

  it("hidden from the start: no slot", () => {
    act(() => useSidebarStore.setState({ hidden: true }));
    renderSlot();
    expect(slot()).toBeNull();
  });

  it("hiding: the slot narrows to 0 over 200ms while the sidebar keeps its width and slides out, out of reach, then goes", () => {
    renderSlot();
    act(() => useSidebarStore.getState().hide());
    expect(slot()!.style.width).toBe("0px");
    expect(slot()).toHaveClass(
      MOTION,
      "motion-safe:duration-200",
      "overflow-hidden",
      "justify-end",
    );
    expect(inner()!.style.width).toBe("248px");
    expect(slot()).toHaveAttribute("inert");
    expect(slot()).toHaveAttribute("aria-hidden", "true");
    expect(phase()).toBe("closing");
    act(() => {
      fireEvent.transitionEnd(slot()!, { propertyName: "width" });
    });
    expect(slot()).toBeNull();
    expect(phase()).toBe("closed");
  });

  it("showing: the slot comes in at 0 and widens to the sidebar's width, then stands still", () => {
    act(() => useSidebarStore.setState({ hidden: true }));
    renderSlot();
    act(() => useSidebarStore.getState().show());
    // laid out at 0 first, so widening is a transition
    expect(phase()).toBe("opening");
    expect(slot()!.style.width).toBe("248px");
    expect(slot()).toHaveClass(MOTION, "overflow-hidden");
    expect(slot()).not.toHaveAttribute("inert");
    expect(inner()!.style.width).toBe("248px");
    act(() => {
      fireEvent.transitionEnd(slot()!, { propertyName: "width" });
    });
    expect(slot()).not.toHaveClass(MOTION);
    expect(slot()).not.toHaveClass("overflow-hidden");
    expect(phase()).toBe("open");
  });

  it("docking from the peek slides too — its Pin, or Show sidebar clicked while it is up: the panel is a card, not the docked sidebar", () => {
    act(() => useSidebarStore.setState({ hidden: true }));
    renderSlot();
    act(() => useSidebarStore.getState().openPeek());
    act(() => useSidebarStore.getState().pin());
    expect(phase()).toBe("opening");
    expect(slot()).toHaveClass(MOTION);
    act(() => {
      fireEvent.transitionEnd(slot()!, { propertyName: "width" });
    });
    act(() => useSidebarStore.getState().hide());
    act(() => {
      fireEvent.transitionEnd(slot()!, { propertyName: "width" });
    });
    act(() => useSidebarStore.getState().openPeek());
    act(() => useSidebarStore.getState().show());
    expect(phase()).toBe("opening");
  });

  it("a toggle mid-slide turns it round from where it is — the same slot, not a fresh one from 0", () => {
    renderSlot();
    act(() => useSidebarStore.getState().hide());
    const leaving = slot();
    act(() => useSidebarStore.getState().show());
    expect(slot()).toBe(leaving);
    expect(slot()!.style.width).toBe("248px");
    expect(slot()).toHaveClass(MOTION);
    expect(slot()).not.toHaveAttribute("inert");
    act(() => useSidebarStore.getState().hide());
    expect(slot()).toBe(leaving);
    expect(phase()).toBe("closing");
  });

  it("a motion that never runs ends no later than 250ms — out and in", () => {
    renderSlot();
    act(() => useSidebarStore.getState().hide());
    act(() => {
      vi.advanceTimersByTime(SLIDE_MS + 49);
    });
    expect(slot()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(slot()).toBeNull();
    act(() => useSidebarStore.getState().show());
    act(() => {
      vi.advanceTimersByTime(SLIDE_MS + 50);
    });
    expect(phase()).toBe("open");
    expect(slot()).not.toHaveClass(MOTION);
  });

  it("under reduced motion it hides and shows at once", () => {
    reduceMotion(true);
    renderSlot();
    act(() => useSidebarStore.getState().hide());
    expect(slot()).toBeNull();
    act(() => useSidebarStore.getState().show());
    expect(phase()).toBe("open");
    expect(slot()).not.toHaveClass(MOTION);
  });

  it("a row's own transition ending inside it does not end the slide", () => {
    renderSlot();
    act(() => useSidebarStore.getState().hide());
    act(() => {
      fireEvent.transitionEnd(document.querySelector("[data-testid=row]")!, {
        propertyName: "transform",
      });
    });
    expect(slot()).not.toBeNull();
  });

  it("an edge drag hides it and brings it back at once — the pointer moves it", () => {
    renderSlot();
    act(() => useSidebarStore.getState().beginDrag());
    act(() => useSidebarStore.getState().dragTo(100));
    expect(slot()).toBeNull();
    act(() => useSidebarStore.getState().dragTo(260));
    expect(slot()!.style.width).toBe("260px");
    expect(slot()).not.toHaveClass(MOTION);
    act(() => useSidebarStore.getState().endDrag());
    expect(phase()).toBe("open");
  });

  it("a width change while docked (a resize, the window) follows at once", () => {
    renderSlot();
    act(() => useSidebarStore.setState({ width: 300 }));
    expect(slot()!.style.width).toBe("300px");
    expect(inner()!.style.width).toBe("300px");
    expect(slot()).not.toHaveClass(MOTION);
  });
});
