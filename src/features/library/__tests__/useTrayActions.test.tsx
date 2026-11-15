import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as navigation from "../navigation";
import { TRAY_NEW_DIAGRAM_EVENT, useTrayActions } from "../useTrayActions";

const mockedInvoke = vi.mocked(invoke);
const mockedListen = vi.mocked(listen);

/** the handler the hook gave `listen` for an event */
const handlerFor = (event: string) => {
  const call = mockedListen.mock.calls.find(([name]) => name === event);
  if (!call) throw new Error(`no listener for ${event}`);
  return call[1] as (e: unknown) => void;
};

describe("useTrayActions — New Diagram in the menu bar (#213)", () => {
  beforeEach(() => {
    mockedListen.mockClear();
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(undefined);
  });

  it("takes the path of the tab strip's + and ⌘T", async () => {
    const make = vi.spyOn(navigation, "newDiagram").mockResolvedValue();
    renderHook(() => useTrayActions());
    await waitFor(() => expect(mockedListen).toHaveBeenCalled());
    handlerFor(TRAY_NEW_DIAGRAM_EVENT)({});
    expect(make).toHaveBeenCalledTimes(1);
    expect(make).toHaveBeenCalledWith();
    make.mockRestore();
  });

  it("saves a new library diagram", async () => {
    renderHook(() => useTrayActions());
    await waitFor(() => expect(mockedListen).toHaveBeenCalled());
    handlerFor(TRAY_NEW_DIAGRAM_EVENT)({});
    await waitFor(() =>
      expect(mockedInvoke.mock.calls.some(([cmd]) => cmd === "save_project")).toBe(true),
    );
  });

  it("stops listening on unmount", async () => {
    const off = vi.fn();
    mockedListen.mockResolvedValueOnce(off);
    const { unmount } = renderHook(() => useTrayActions());
    await waitFor(() => expect(mockedListen).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(off).toHaveBeenCalled());
  });
});
