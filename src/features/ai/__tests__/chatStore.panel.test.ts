import { beforeEach, describe, expect, it } from "vitest";

import { useChatStore } from "../chatStore";

const stored = () => JSON.parse(localStorage.getItem("dosik.side-panel") ?? "null") as unknown;
const panel = () => {
  const { open, view } = useChatStore.getState();
  return { open, view };
};

describe("one panel, two views — toolbar toggles (#219 D13, T4)", () => {
  beforeEach(() => {
    localStorage.clear();
    useChatStore.setState({ open: false, view: "chat" });
  });

  it("opens to that view when closed", () => {
    useChatStore.getState().togglePanel("mermaid");
    expect(panel()).toEqual({ open: true, view: "mermaid" });
  });

  it("closes when the same view is open", () => {
    useChatStore.setState({ open: true, view: "chat" });
    useChatStore.getState().togglePanel("chat");
    expect(panel()).toEqual({ open: false, view: "chat" });
  });

  it("switches while staying open when another view is open", () => {
    useChatStore.setState({ open: true, view: "chat" });
    useChatStore.getState().togglePanel("mermaid");
    expect(panel()).toEqual({ open: true, view: "mermaid" });
  });

  it("remembers every open, close and switch — togglePanel, showView, toggleOpen", () => {
    useChatStore.getState().togglePanel("chat");
    expect(stored()).toEqual({ open: true, view: "chat" });
    useChatStore.getState().showView("mermaid");
    expect(stored()).toEqual({ open: true, view: "mermaid" });
    useChatStore.getState().toggleOpen();
    expect(stored()).toEqual({ open: false, view: "mermaid" });
    useChatStore.getState().togglePanel("mermaid");
    expect(stored()).toEqual({ open: true, view: "mermaid" });
  });
});
