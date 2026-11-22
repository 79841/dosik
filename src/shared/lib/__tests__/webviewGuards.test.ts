import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installWebviewGuards, isTextField } from "../webviewGuards";

/** dispatches a cancelable event on `target` and says whether something prevented it */
const fire = (target: EventTarget, event: Event): boolean => {
  target.dispatchEvent(event);
  return event.defaultPrevented;
};
const contextMenu = () => new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

/** a drag event whose dataTransfer carries these types (jsdom has no DataTransfer) */
const drag = (type: "dragover" | "drop", types: string[]): Event => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { types, dropEffect: "copy" } });
  return e;
};

describe("the webview's own behaviour off macOS", () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => stop());

  describe("right click", () => {
    beforeEach(() => {
      stop = installWebviewGuards(false);
    });

    it("no browser menu on an empty place — the canvas, Home, the band, the toolbar", () => {
      const pane = document.createElement("div");
      document.body.append(pane);
      expect(fire(pane, contextMenu())).toBe(true);
      expect(fire(document.body, contextMenu())).toBe(true);
    });

    it("text fields keep the system's edit menu — cut, copy, paste", () => {
      const input = document.createElement("input");
      const area = document.createElement("textarea");
      const editable = document.createElement("div");
      editable.setAttribute("contenteditable", "true");
      const inside = document.createElement("span");
      editable.append(inside);
      document.body.append(input, area, editable);
      expect(fire(input, contextMenu())).toBe(false);
      expect(fire(area, contextMenu())).toBe(false);
      expect(fire(inside, contextMenu())).toBe(false);
    });

    it("the app's own menus still open — the guard prevents the browser's, not the event", () => {
      const node = document.createElement("div");
      document.body.append(node);
      const open = vi.fn();
      node.addEventListener("contextmenu", open);
      fire(node, contextMenu());
      expect(open).toHaveBeenCalledTimes(1);
    });
  });

  describe("files dragged over the window", () => {
    beforeEach(() => {
      stop = installWebviewGuards(false);
    });

    it("a file dropped where nothing takes it does not open in the webview", () => {
      const sidebar = document.createElement("nav");
      document.body.append(sidebar);
      const over = drag("dragover", ["Files"]);
      expect(fire(sidebar, over)).toBe(true);
      expect(
        (over as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect,
      ).toBe("none");
      expect(fire(sidebar, drag("drop", ["Files"]))).toBe(true);
    });

    it("leaves a drop the canvas took alone — it said copy", () => {
      const canvas = document.createElement("div");
      document.body.append(canvas);
      canvas.addEventListener("dragover", (e) => {
        e.preventDefault();
        (e as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect = "copy";
      });
      const over = drag("dragover", ["Files"]);
      fire(canvas, over);
      expect(
        (over as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect,
      ).toBe("copy");
    });

    it("leaves drags that carry no files alone — a shape from the strip, a tree row, a tab", () => {
      const target = document.createElement("div");
      document.body.append(target);
      expect(fire(target, drag("dragover", ["application/modern-diagram-shape"]))).toBe(false);
      expect(fire(target, drag("drop", ["text/plain"]))).toBe(false);
    });
  });

  it("macOS: no guard — the native webview and Tauri's file drop have these", () => {
    stop = installWebviewGuards(true);
    const pane = document.createElement("div");
    document.body.append(pane);
    expect(fire(pane, contextMenu())).toBe(false);
    expect(fire(pane, drag("drop", ["Files"]))).toBe(false);
  });

  it("stops guarding when removed", () => {
    installWebviewGuards(false)();
    const pane = document.createElement("div");
    document.body.append(pane);
    expect(fire(pane, contextMenu())).toBe(false);
  });
});

describe("isTextField", () => {
  it("text inputs, text areas and editable content — not buttons, checkboxes or plain boxes", () => {
    const make = (html: string) => {
      const box = document.createElement("div");
      box.innerHTML = html;
      return box.firstElementChild!;
    };
    expect(isTextField(make('<input type="text">'))).toBe(true);
    expect(isTextField(make("<input>"))).toBe(true);
    expect(isTextField(make('<input type="search">'))).toBe(true);
    expect(isTextField(make('<input type="password">'))).toBe(true);
    expect(isTextField(make("<textarea></textarea>"))).toBe(true);
    expect(isTextField(make('<div contenteditable="true"></div>'))).toBe(true);
    expect(isTextField(make('<input type="checkbox">'))).toBe(false);
    expect(isTextField(make('<input type="range">'))).toBe(false);
    expect(isTextField(make("<button></button>"))).toBe(false);
    expect(isTextField(make('<div contenteditable="false"></div>'))).toBe(false);
    expect(isTextField(make("<div></div>"))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});
