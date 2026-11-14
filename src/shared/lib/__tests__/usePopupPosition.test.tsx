import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POPUP_MARGIN, placePopup, usePopupPosition } from "../usePopupPosition";

const VIEW = { width: 1000, height: 800 };
const SIZE = { width: 200, height: 300 };

describe("placePopup — popups never go off screen (#142)", () => {
  it("opens right at the cursor when there is room", () => {
    expect(placePopup({ x: 100, y: 100 }, SIZE, VIEW)).toEqual({ left: 100, top: 100 });
  });

  it("flips to the left of the cursor when the right overflows — the menu does not cover the cursor", () => {
    expect(placePopup({ x: 900, y: 100 }, SIZE, VIEW)).toEqual({ left: 700, top: 100 });
  });

  it("flips above the cursor when the bottom overflows", () => {
    expect(placePopup({ x: 100, y: 700 }, SIZE, VIEW)).toEqual({ left: 100, top: 400 });
  });

  it("flips both axes in the bottom-right corner", () => {
    expect(placePopup({ x: 990, y: 790 }, SIZE, VIEW)).toEqual({ left: 790, top: 490 });
  });

  it("pushes it inside the screen edge when flipping still does not fit", () => {
    // A 300-high menu in a 500-high window, cursor in the middle — neither above nor below has room
    const view = { width: 1000, height: 500 };
    expect(placePopup({ x: 100, y: 250 }, SIZE, view)).toEqual({
      left: 100,
      top: 500 - 300 - POPUP_MARGIN,
    });
  });

  it("a popup larger than the window sticks to the top-left edges — its head (first item) must be visible", () => {
    const view = { width: 150, height: 200 };
    expect(placePopup({ x: 50, y: 50 }, SIZE, view)).toEqual({
      left: POPUP_MARGIN,
      top: POPUP_MARGIN,
    });
  });

  it("pulls negative coordinates (an anchor outside the window) back inside", () => {
    expect(placePopup({ x: -40, y: -10 }, SIZE, VIEW)).toEqual({
      left: POPUP_MARGIN,
      top: POPUP_MARGIN,
    });
  });
});

const Fixture = ({ x, y }: { x: number; y: number }) => {
  const ref = useRef<HTMLDivElement>(null);
  const style = usePopupPosition(ref, { x, y });
  return <div ref={ref} data-testid="popup" style={style} />;
};

describe("usePopupPosition", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sized = (width: number, height: number) =>
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width,
      height,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      toJSON: () => ({}),
    });

  it("measures the real size before painting to place it", () => {
    sized(200, 300);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    const { getByTestId } = render(<Fixture x={900} y={700} />);
    const el = getByTestId("popup");
    expect(el.style.left).toBe("700px");
    expect(el.style.top).toBe("400px");
  });

  it("measures nothing while closed (null)", () => {
    const measure = sized(200, 300);
    const Closed = () => {
      const ref = useRef<HTMLDivElement>(null);
      usePopupPosition(ref, null);
      return null;
    };
    render(<Closed />);
    expect(measure).not.toHaveBeenCalled();
  });

  it("repositions when the anchor changes", () => {
    sized(200, 300);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    const { getByTestId, rerender } = render(<Fixture x={900} y={100} />);
    expect(getByTestId("popup").style.left).toBe("700px");
    rerender(<Fixture x={100} y={100} />);
    expect(getByTestId("popup").style.left).toBe("100px");
  });
});
