import { getCurrentWindow } from "@tauri-apps/api/window";
import { describe, expect, it, vi } from "vitest";

import { currentWindowOrNull } from "../appWindow";

const mockedWindow = vi.mocked(getCurrentWindow);

describe("currentWindowOrNull (#125)", () => {
  it("returns null outside Tauri (the window API throws) and the window inside", () => {
    mockedWindow.mockImplementationOnce(() => {
      throw new TypeError("no __TAURI_INTERNALS__");
    });
    expect(currentWindowOrNull()).toBeNull();
    expect(currentWindowOrNull()).not.toBeNull();
  });
});
