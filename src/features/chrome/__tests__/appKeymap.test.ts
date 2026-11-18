import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  openFileAnywhere: vi.fn(async () => {}),
  newDiagram: vi.fn(async () => {}),
  closeActiveDocumentTab: vi.fn(async () => true),
  cycleTabs: vi.fn(async () => {}),
  goToNthTab: vi.fn(async () => {}),
}));
vi.mock("../../library/navigation", () => navigation);
const saving = vi.hoisted(() => ({ saveActiveDocument: vi.fn(async () => {}) }));
vi.mock("../../library/saveDocument", () => saving);

import { useSidebarStore } from "../../../shared/lib/sidebarLayout";
import { useSettingsStore } from "../../settings/settingsStore";
import { handleAppKeyDown } from "../appKeymap";

/** a keydown as the window sees it — `target` is where focus was */
const press = (init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, "target", { value: target });
  return e;
};
const hidden = () => useSidebarStore.getState().hidden;

describe("app shortcuts (#217 D22, T34)", () => {
  beforeEach(() => {
    localStorage.clear();
    useSidebarStore.setState({ hidden: false, peek: false, hinted: true });
  });

  it("⌘\\ hides the sidebar and shows it again — macOS", () => {
    const e = press({ key: "\\", code: "Backslash", metaKey: true });
    handleAppKeyDown(e, true);
    expect(hidden()).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    handleAppKeyDown(press({ key: "\\", code: "Backslash", metaKey: true }), true);
    expect(hidden()).toBe(false);
  });

  it("the Korean layout (₩) and a missing code are the same key", () => {
    handleAppKeyDown(press({ key: "₩", code: "Backslash", metaKey: true }), true);
    expect(hidden()).toBe(true);
    handleAppKeyDown(press({ key: "\\", metaKey: true }), true);
    expect(hidden()).toBe(false);
    handleAppKeyDown(press({ key: "₩", metaKey: true }), true);
    expect(hidden()).toBe(true);
  });

  it("outside macOS it is Ctrl+\\ — not ⌘", () => {
    handleAppKeyDown(press({ key: "\\", code: "Backslash", metaKey: true }), false);
    expect(hidden()).toBe(false);
    handleAppKeyDown(press({ key: "\\", code: "Backslash", ctrlKey: true }), false);
    expect(hidden()).toBe(true);
    // and on macOS Ctrl+\ is not it
    handleAppKeyDown(press({ key: "\\", code: "Backslash", ctrlKey: true }), true);
    expect(hidden()).toBe(true);
  });

  it("ignores the key with Shift or Alt, or while composing text", () => {
    for (const extra of [{ shiftKey: true }, { altKey: true }, { isComposing: true }]) {
      const e = press({ key: "\\", code: "Backslash", metaKey: true, ...extra });
      handleAppKeyDown(e, true);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(hidden()).toBe(false);
  });

  it("works inside text inputs — the key means nothing to text editing", () => {
    const input = document.createElement("input");
    handleAppKeyDown(press({ key: "\\", code: "Backslash", metaKey: true }, input), true);
    expect(hidden()).toBe(true);
    handleAppKeyDown(press({ key: "o", code: "KeyO", metaKey: true }, input), true);
    expect(navigation.openFileAnywhere).toHaveBeenCalledTimes(1);
  });

  it("⌘\\ while peeking docks the sidebar", () => {
    useSidebarStore.setState({ hidden: true, peek: true });
    handleAppKeyDown(press({ key: "\\", code: "Backslash", metaKey: true }), true);
    expect(useSidebarStore.getState()).toMatchObject({ hidden: false, peek: false });
  });

  it("⌘O is Open file… — blocks the browser's open", () => {
    const e = press({ key: "o", code: "KeyO", metaKey: true });
    handleAppKeyDown(e, true);
    expect(navigation.openFileAnywhere).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    // Korean input: the key is a Hangul letter, the code still O
    handleAppKeyDown(press({ key: "ㅐ", code: "KeyO", metaKey: true }), true);
    expect(navigation.openFileAnywhere).toHaveBeenCalledTimes(2);
    handleAppKeyDown(press({ key: "o", code: "KeyO", ctrlKey: true }), false);
    expect(navigation.openFileAnywhere).toHaveBeenCalledTimes(3);
  });

  it("a held, repeating ⌘\\ or ⌘O fires only once — the sidebar does not flicker and open dialogs do not pile up (#217)", () => {
    handleAppKeyDown(press({ key: "\\", code: "Backslash", metaKey: true }), true);
    expect(hidden()).toBe(true);
    const held = press({ key: "\\", code: "Backslash", metaKey: true, repeat: true });
    handleAppKeyDown(held, true);
    expect(hidden()).toBe(true);
    // still the app's key: the webview gets none of the repeats either
    expect(held.defaultPrevented).toBe(true);
    const heldO = press({ key: "o", code: "KeyO", metaKey: true, repeat: true });
    handleAppKeyDown(heldO, true);
    expect(navigation.openFileAnywhere).not.toHaveBeenCalled();
    expect(heldO.defaultPrevented).toBe(true);
  });

  it("leaves ⇧⌘O, plain O and other keys alone", () => {
    for (const init of [
      { key: "O", code: "KeyO", metaKey: true, shiftKey: true },
      { key: "o", code: "KeyO" },
      { key: "z", code: "KeyZ", metaKey: true },
    ]) {
      const e = press(init);
      handleAppKeyDown(e, true);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(navigation.openFileAnywhere).not.toHaveBeenCalled();
    expect(hidden()).toBe(false);
  });
});

describe("tab shortcuts (#218 D12, T39)", () => {
  beforeEach(() => {
    localStorage.clear();
    useSidebarStore.setState({ hidden: false, peek: false, hinted: true });
  });

  /** handled: the action ran, and the key went no further */
  const handled = (init: KeyboardEventInit, mac: boolean, target?: EventTarget) => {
    const e = press(init, target);
    const stop = vi.spyOn(e, "stopPropagation");
    handleAppKeyDown(e, mac);
    expect(e.defaultPrevented).toBe(true);
    expect(stop).toHaveBeenCalled();
  };
  const ignored = (init: KeyboardEventInit, mac: boolean) => {
    const e = press(init);
    handleAppKeyDown(e, mac);
    expect(e.defaultPrevented).toBe(false);
  };

  it("⌘T · ⌘N — New diagram (macOS), Ctrl+T · Ctrl+N (elsewhere)", () => {
    handled({ key: "t", code: "KeyT", metaKey: true }, true);
    handled({ key: "n", code: "KeyN", metaKey: true }, true);
    handled({ key: "t", code: "KeyT", ctrlKey: true }, false);
    // a Korean layout types ㅅ on T; the key is still T
    handled({ key: "ㅅ", code: "KeyT", metaKey: true }, true);
    expect(navigation.newDiagram).toHaveBeenCalledTimes(4);
    ignored({ key: "t", code: "KeyT", ctrlKey: true }, true);
    ignored({ key: "T", code: "KeyT", metaKey: true, shiftKey: true }, true);
    ignored({ key: "n", code: "KeyN", metaKey: true, altKey: true }, true);
  });

  it("a held, repeating tab shortcut fires only once — diagrams do not pile up, and the key still belongs to the app (#217)", () => {
    handled({ key: "t", code: "KeyT", metaKey: true }, true);
    handled({ key: "t", code: "KeyT", metaKey: true, repeat: true }, true);
    handled({ key: "w", code: "KeyW", ctrlKey: true, repeat: true }, false);
    handled({ key: "Tab", code: "Tab", ctrlKey: true, repeat: true }, true);
    expect(navigation.newDiagram).toHaveBeenCalledTimes(1);
    expect(navigation.closeActiveDocumentTab).not.toHaveBeenCalled();
    expect(navigation.cycleTabs).not.toHaveBeenCalled();
  });

  it("⌃Tab / ⌃⇧Tab — next / previous tab, Control on both platforms", () => {
    handled({ key: "Tab", code: "Tab", ctrlKey: true }, true);
    handled({ key: "Tab", code: "Tab", ctrlKey: true, shiftKey: true }, true);
    handled({ key: "Tab", code: "Tab", ctrlKey: true }, false);
    expect(navigation.cycleTabs.mock.calls).toEqual([[1], [-1], [1]]);
    ignored({ key: "Tab", code: "Tab" }, true);
    ignored({ key: "Tab", code: "Tab", metaKey: true }, true);
    ignored({ key: "Tab", code: "Tab", ctrlKey: true, altKey: true }, true);
  });

  it("⌘⇧] / ⌘⇧[ — the same cycle, by physical key regardless of layout", () => {
    handled({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true }, true);
    handled({ key: "{", code: "BracketLeft", metaKey: true, shiftKey: true }, true);
    handled({ key: "}", code: "BracketRight", ctrlKey: true, shiftKey: true }, false);
    // an event with no code still says which bracket by its character
    handled({ key: "{", code: "", metaKey: true, shiftKey: true }, true);
    expect(navigation.cycleTabs.mock.calls).toEqual([[1], [-1], [1], [-1]]);
    // without Shift, ⌘] is not a tab key
    ignored({ key: "]", code: "BracketRight", metaKey: true }, true);
    // the character counts only when there is no code — as for the digits: a
    // layout that types } on another key does not cycle with it (#218)
    ignored({ key: "}", code: "Digit0", metaKey: true, shiftKey: true }, true);
    ignored({ key: "{", code: "Quote", metaKey: true, shiftKey: true }, true);
    expect(navigation.cycleTabs).toHaveBeenCalledTimes(4);
  });

  it("⌘1~⌘9 — the tab at that position, but not with Shift or Alt", () => {
    handled({ key: "1", code: "Digit1", metaKey: true }, true);
    handled({ key: "5", code: "Digit5", metaKey: true }, true);
    handled({ key: "9", code: "Digit9", ctrlKey: true }, false);
    expect(navigation.goToNthTab.mock.calls).toEqual([[1], [5], [9]]);
    // no code: the character
    handled({ key: "3", code: "", metaKey: true }, true);
    expect(navigation.goToNthTab).toHaveBeenLastCalledWith(3);
    // a layout that types & on 1 still has the key
    handled({ key: "&", code: "Digit1", metaKey: true }, true);
    expect(navigation.goToNthTab).toHaveBeenLastCalledWith(1);
    ignored({ key: "0", code: "Digit0", metaKey: true }, true);
    ignored({ key: "!", code: "Digit1", metaKey: true, shiftKey: true }, true);
    ignored({ key: "1", code: "Numpad1", metaKey: true }, true);
  });

  it("Ctrl+W closes the active tab outside macOS — ⌘W on macOS belongs to the menu, so it is left alone", () => {
    handled({ key: "w", code: "KeyW", ctrlKey: true }, false);
    expect(navigation.closeActiveDocumentTab).toHaveBeenCalledTimes(1);
    ignored({ key: "w", code: "KeyW", metaKey: true }, true);
    expect(navigation.closeActiveDocumentTab).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+, opens Settings outside macOS — ⌘, on macOS is Dosik ▸ Settings…, the menu's (#252)", () => {
    useSettingsStore.setState({ open: false });
    handled({ key: ",", code: "Comma", ctrlKey: true }, false);
    expect(useSettingsStore.getState().open).toBe(true);
    useSettingsStore.setState({ open: false });
    ignored({ key: ",", code: "Comma", metaKey: true }, true);
    expect(useSettingsStore.getState().open).toBe(false);
  });

  it("works inside inputs and is ignored while composing text", () => {
    const input = document.createElement("textarea");
    handled({ key: "Tab", code: "Tab", ctrlKey: true }, true, input);
    expect(navigation.cycleTabs).toHaveBeenCalledTimes(1);
    ignored({ key: "2", code: "Digit2", metaKey: true, isComposing: true }, true);
    expect(navigation.goToNthTab).not.toHaveBeenCalled();
  });

  it("⌘ · ⌘O stay as before — propagation is not stopped (#217)", () => {
    const e = press({ key: "o", code: "KeyO", metaKey: true });
    const stop = vi.spyOn(e, "stopPropagation");
    handleAppKeyDown(e, true);
    expect(e.defaultPrevented).toBe(true);
    expect(stop).not.toHaveBeenCalled();
  });
});

describe("while a modal dialog is open (#220)", () => {
  beforeEach(() => {
    useSidebarStore.setState({ hidden: false, peek: false, hinted: true });
  });

  it("app shortcuts do nothing — tabs do not change and files do not open behind the dialog", () => {
    const shown = document.createElement("dialog");
    const field = document.createElement("textarea");
    shown.append(field);
    document.body.append(shown);
    shown.showModal();
    for (const init of [
      { key: "1", code: "Digit1", metaKey: true },
      { key: "t", code: "KeyT", metaKey: true },
      { key: "Tab", code: "Tab", ctrlKey: true },
      { key: "}", code: "BracketRight", metaKey: true, shiftKey: true },
      { key: "o", code: "KeyO", metaKey: true },
      { key: "s", code: "KeyS", metaKey: true },
      { key: "\\", code: "Backslash", metaKey: true },
    ]) {
      const e = press(init, field);
      handleAppKeyDown(e, true);
      // still the app's keys: the webview does nothing of its own with them
      expect(e.defaultPrevented).toBe(true);
    }
    expect(navigation.goToNthTab).not.toHaveBeenCalled();
    expect(navigation.newDiagram).not.toHaveBeenCalled();
    expect(navigation.cycleTabs).not.toHaveBeenCalled();
    expect(navigation.openFileAnywhere).not.toHaveBeenCalled();
    expect(saving.saveActiveDocument).not.toHaveBeenCalled();
    expect(hidden()).toBe(false);
    shown.close();
    // closed: the same keys work again
    handleAppKeyDown(press({ key: "1", code: "Digit1", metaKey: true }, field), true);
    expect(navigation.goToNthTab).toHaveBeenCalledWith(1);
    shown.remove();
  });
});

describe("⌘S — save (#219 D5·D18, T21)", () => {
  it("⌘S (macOS) / Ctrl+S (elsewhere) saves and blocks the webview's save", () => {
    const e = press({ key: "s", code: "KeyS", metaKey: true });
    handleAppKeyDown(e, true);
    expect(saving.saveActiveDocument).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    handleAppKeyDown(press({ key: "s", code: "KeyS", ctrlKey: true }), false);
    expect(saving.saveActiveDocument).toHaveBeenCalledTimes(2);
    // and not the other platform's modifier
    handleAppKeyDown(press({ key: "s", code: "KeyS", ctrlKey: true }), true);
    handleAppKeyDown(press({ key: "s", code: "KeyS", metaKey: true }), false);
    expect(saving.saveActiveDocument).toHaveBeenCalledTimes(2);
  });

  it("the Korean layout (ㄴ) is the same key", () => {
    handleAppKeyDown(press({ key: "ㄴ", code: "KeyS", metaKey: true }), true);
    expect(saving.saveActiveDocument).toHaveBeenCalledTimes(1);
  });

  it("saves inside inputs too — including the label being typed, and editing continues (#219)", () => {
    const input = document.createElement("input");
    handleAppKeyDown(press({ key: "s", code: "KeyS", metaKey: true }, input), true);
    expect(saving.saveActiveDocument).toHaveBeenCalledTimes(1);
  });

  it("ignores composition, Shift and Alt", () => {
    for (const extra of [{ isComposing: true }, { shiftKey: true }, { altKey: true }]) {
      const e = press({ key: "s", code: "KeyS", metaKey: true, ...extra });
      handleAppKeyDown(e, true);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(saving.saveActiveDocument).not.toHaveBeenCalled();
  });

  it("saves only once when held and repeating", () => {
    handleAppKeyDown(press({ key: "s", code: "KeyS", metaKey: true }), true);
    const held = press({ key: "s", code: "KeyS", metaKey: true, repeat: true });
    handleAppKeyDown(held, true);
    expect(held.defaultPrevented).toBe(true);
    expect(saving.saveActiveDocument).toHaveBeenCalledTimes(1);
  });
});
