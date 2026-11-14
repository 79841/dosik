import { describe, expect, it } from "vitest";

import { keyshortcuts, shortcutLabel } from "../shortcutLabel";

describe("shortcut labels (#217 D15·D30)", () => {
  it("⌘ on macOS, Ctrl+ elsewhere", () => {
    expect(shortcutLabel("\\", true)).toBe("⌘\\");
    expect(shortcutLabel("\\", false)).toBe("Ctrl+\\");
    expect(shortcutLabel("O", true)).toBe("⌘O");
    expect(shortcutLabel("O", false)).toBe("Ctrl+O");
  });

  it("aria-keyshortcuts uses key names — Meta / Control", () => {
    expect(keyshortcuts("\\", true)).toBe("Meta+Backslash");
    expect(keyshortcuts("\\", false)).toBe("Control+Backslash");
    expect(keyshortcuts("O", true)).toBe("Meta+O");
    expect(keyshortcuts("O", false)).toBe("Control+O");
  });

  it("save and undo too — with ⇧, ⇧⌘ on macOS and Ctrl+Shift+ elsewhere (#219 D18)", () => {
    expect(shortcutLabel("S", true)).toBe("⌘S");
    expect(shortcutLabel("Z", true)).toBe("⌘Z");
    expect(shortcutLabel("Z", true, { shift: true })).toBe("⇧⌘Z");
    expect(shortcutLabel("Z", false, { shift: true })).toBe("Ctrl+Shift+Z");
    expect(keyshortcuts("Z", true, { shift: true })).toBe("Meta+Shift+Z");
    expect(keyshortcuts("S", false)).toBe("Control+S");
  });
});
