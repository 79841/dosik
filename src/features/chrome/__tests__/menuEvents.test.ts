import { readFileSync } from "node:fs";
import { join } from "node:path";

import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ closeActiveDocumentTab: vi.fn(async () => true) }));
vi.mock("../../library/navigation", () => navigation);

import { useAppStore } from "../../library/appStore";
import { CLOSE_TAB_EVENT, useMenuEvents } from "../useMenuEvents";

const mockedListen = vi.mocked(listen);
const mockedWindow = vi.mocked(getCurrentWindow);

/** the handler the hook registered for File ▸ Close Tab */
const closeTabHandler = async (): Promise<() => void> => {
  renderHook(() => useMenuEvents());
  await waitFor(() =>
    expect(mockedListen).toHaveBeenCalledWith(CLOSE_TAB_EVENT, expect.any(Function)),
  );
  return mockedListen.mock.calls.find(([name]) => name === CLOSE_TAB_EVENT)![1] as () => void;
};

describe("macOS menu events (#218 D12, T40)", () => {
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    close = vi.fn(async () => {});
    mockedWindow.mockReturnValue({ close } as never);
    useAppStore.setState({ tabs: [], activeTab: null, view: "home" });
  });

  it("File ▸ Close Tab (⌘W) closes the active document tab", async () => {
    useAppStore.setState({ activeTab: "tab-1", view: "editor" });
    const handler = await closeTabHandler();
    handler();
    await waitFor(() => expect(navigation.closeActiveDocumentTab).toHaveBeenCalledTimes(1));
    expect(close).not.toHaveBeenCalled();
  });

  it("asks to close the window when Home is active — close-requested handles confirmation and flushing", async () => {
    const handler = await closeTabHandler();
    handler();
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(navigation.closeActiveDocumentTab).not.toHaveBeenCalled();
  });

  it("does nothing outside Tauri", async () => {
    mockedWindow.mockImplementation(() => {
      throw new TypeError("no __TAURI_INTERNALS__");
    });
    const handler = await closeTabHandler();
    expect(() => handler()).not.toThrow();
    // the handler's work is async: let it run — nothing was closed
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(close).not.toHaveBeenCalled();
    expect(navigation.closeActiveDocumentTab).not.toHaveBeenCalled();
  });

  it("event names and menu ids match Rust — if only one side changes, ⌘W silently dies", () => {
    const rust = readFileSync(join(process.cwd(), "src-tauri/src/app_menu.rs"), "utf8");
    expect(rust).toContain(`pub const CLOSE_TAB_EVENT: &str = "${CLOSE_TAB_EVENT}";`);
    // the File menu's two items and their keys (D12)
    expect(rust).toMatch(/"Close Tab"[\s\S]*?Some\("CmdOrCtrl\+W"\)/);
    expect(rust).toMatch(/"Close Window"[\s\S]*?Some\("CmdOrCtrl\+Shift\+W"\)/);
  });

  it("⌘Q becomes a window close request — AppKit's terminate skips close-requested and would not ask about unsaved external tabs (#218)", () => {
    const rust = readFileSync(join(process.cwd(), "src-tauri/src/app_menu.rs"), "utf8");
    expect(rust).toMatch(/QUIT_ID,[\s\S]*?Some\("CmdOrCtrl\+Q"\)/);
    expect(rust).not.toContain("PredefinedMenuItem::quit(");
    // the close request is what useFlushOnClose answers: one question for every unsaved file
    expect(rust).toMatch(/MenuAction::Quit\)[\s\S]*?\.close\(\)/);
  });
});
