import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSidebarStore } from "../sidebarLayout";
import {
  registerSidebarSlot,
  resetSidebarSlideForTests,
  useContentRoom,
  useSidebarSlideStore,
} from "../sidebarSlide";

/** the room the chat panel sizes itself in, as the sidebar slides (canvas TabsCollapse-Toggle) */
describe("useContentRoom", () => {
  let leave: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    useSidebarStore.setState({ hidden: false, width: 248, peek: false, resizing: false });
    resetSidebarSlideForTests();
    leave = registerSidebarSlot();
  });
  afterEach(() => {
    leave();
    vi.useRealTimers();
  });

  it("the window less the docked sidebar — which still counts while it slides out, so nothing widens before there is room", () => {
    // jsdom's window is 1024 wide
    const { result } = renderHook(() => useContentRoom());
    expect(result.current).toBe(1024 - 248);
    act(() => useSidebarStore.getState().hide());
    expect(useSidebarSlideStore.getState().phase).toBe("closing");
    expect(result.current).toBe(1024 - 248);
    act(() => useSidebarSlideStore.getState().settle());
    expect(result.current).toBe(1024);
  });

  it("showing, it counts the sidebar at once — the panel only narrows early", () => {
    act(() => useSidebarStore.setState({ hidden: true }));
    act(() => useSidebarSlideStore.getState().settle());
    const { result } = renderHook(() => useContentRoom());
    expect(result.current).toBe(1024);
    act(() => useSidebarStore.getState().show());
    expect(result.current).toBe(1024 - 248);
  });
});
