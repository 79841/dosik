import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readClipboardText } from "../../../shared/lib/systemClipboard";
import { isMacPlatform } from "../../../shared/lib/windowChrome";
import { MermaidImportError } from "../../mermaid/import/plan";
import { MermaidDialog, resetMermaidDraftForTests } from "../MermaidDialog";
import { diagramFromMermaid, openNewDiagram } from "../newDiagram";

vi.mock("../../../shared/lib/systemClipboard", () => ({ readClipboardText: vi.fn() }));
vi.mock("../newDiagram", () => ({ diagramFromMermaid: vi.fn(), openNewDiagram: vi.fn() }));

const mockedClipboard = vi.mocked(readClipboardText);
const mockedDraw = vi.mocked(diagramFromMermaid);
const mockedOpen = vi.mocked(openNewDiagram);

const FLOW = "flowchart LR\n  A --> B";
/** ⌘ on macOS, Ctrl elsewhere — jsdom is not a Mac */
const MOD = isMacPlatform() ? "Meta" : "Control";
const DOC = { version: 1 as const, title: "Flowchart", nodes: [], edges: [] };

/** the dialog, opened from a button that should get focus back */
const renderDialog = (folder?: string) => {
  const onClose = vi.fn();
  const opener = document.createElement("button");
  opener.textContent = "From Mermaid…";
  document.body.append(opener);
  opener.focus();
  const view = render(<MermaidDialog folder={folder} onClose={onClose} />);
  return { onClose, opener, ...view };
};

const dialog = () => screen.getByRole("dialog", { name: "New diagram from Mermaid" });
const field = () => screen.getByRole("textbox", { name: "Mermaid code" });
const create = () => screen.getByRole("button", { name: /^(Create|Drawing…)$/ });

describe("From Mermaid… dialog (#220 D15, T22)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetMermaidDraftForTests();
    mockedClipboard.mockReset();
    mockedClipboard.mockResolvedValue(null);
    mockedDraw.mockReset();
    mockedOpen.mockReset();
    mockedOpen.mockResolvedValue(true);
  });

  it("dialog·aria-modal·title·hint, focus in the text field, monospace font", async () => {
    renderDialog();
    expect(dialog()).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Flowchart, sequence, class and ER diagrams")).toBeInTheDocument();
    expect(field()).toHaveFocus();
    expect(field()).toHaveClass("font-mono");
    expect(field()).toHaveAttribute("spellcheck", "false");
  });

  it("fills the field on open when the clipboard holds Mermaid", async () => {
    mockedClipboard.mockResolvedValue(FLOW);
    renderDialog();
    await waitFor(() => expect(field()).toHaveValue(FLOW));
  });

  it("empty field when the clipboard is not Mermaid — Create disabled", async () => {
    mockedClipboard.mockResolvedValue("hello there");
    renderDialog();
    await act(async () => {});
    expect(field()).toHaveValue("");
    expect(create()).toBeDisabled();
  });

  it("the clipboard does not overwrite text already typed", async () => {
    let land: (text: string) => void = () => {};
    mockedClipboard.mockReturnValue(new Promise((resolve) => (land = resolve)));
    const user = userEvent.setup();
    renderDialog();
    await user.type(field(), "graph TD");
    await act(async () => land(FLOW));
    expect(field()).toHaveValue("graph TD");
  });

  it("Create — adds the document to the target project as a new diagram, announces the drawn result, and closes", async () => {
    mockedDraw.mockResolvedValue({ doc: DOC, message: "Drew 2 shapes from Mermaid" });
    const user = userEvent.setup();
    const { onClose } = renderDialog("work");
    await user.type(field(), FLOW);
    await user.click(create());
    expect(mockedDraw).toHaveBeenCalledWith(FLOW);
    await waitFor(() =>
      expect(mockedOpen).toHaveBeenCalledWith(DOC, "work", "Drew 2 shapes from Mermaid"),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("Create with ⌘Enter (Ctrl+Enter outside macOS)", async () => {
    mockedDraw.mockResolvedValue({ doc: DOC, message: "ok" });
    const user = userEvent.setup();
    renderDialog();
    await user.type(field(), FLOW);
    await user.keyboard(`{${MOD}>}{Enter}{/${MOD}}`);
    await waitFor(() => expect(mockedDraw).toHaveBeenCalledTimes(1));
  });

  it("'Drawing…' disabled while drawing — pressing again still runs once", async () => {
    let land: (v: { doc: typeof DOC; message: string }) => void = () => {};
    mockedDraw.mockReturnValue(new Promise((resolve) => (land = resolve)));
    const user = userEvent.setup();
    renderDialog();
    await user.type(field(), FLOW);
    await user.click(create());
    expect(create()).toHaveTextContent("Drawing…");
    expect(create()).toBeDisabled();
    await user.keyboard(`{${MOD}>}{Enter}{/${MOD}}`);
    expect(mockedDraw).toHaveBeenCalledTimes(1);
    await act(async () => land({ doc: DOC, message: "ok" }));
    expect(mockedOpen).toHaveBeenCalledTimes(1);
  });

  it("an alert inside the dialog when it cannot draw — nothing saved, fix and Create again", async () => {
    mockedDraw.mockRejectedValueOnce(
      new MermaidImportError("The Mermaid diagram has no shapes to draw"),
    );
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.type(field(), "sequenceDiagram\n  autonumber");
    await user.click(create());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The Mermaid diagram has no shapes to draw",
    );
    expect(mockedOpen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    mockedDraw.mockResolvedValueOnce({ doc: DOC, message: "ok" });
    await user.click(create());
    await waitFor(() => expect(mockedOpen).toHaveBeenCalledTimes(1));
  });

  it("Escape·Cancel close and return focus to the opening button", async () => {
    const user = userEvent.setup();
    const first = renderDialog();
    await user.keyboard("{Escape}");
    expect(first.onClose).toHaveBeenCalledTimes(1);
    expect(first.opener).toHaveFocus();
    first.unmount();
    const second = renderDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(second.onClose).toHaveBeenCalledTimes(1);
    expect(second.opener).toHaveFocus();
  });

  it("Cancel while drawing — discards the result, nothing saved", async () => {
    let land: (v: { doc: typeof DOC; message: string }) => void = () => {};
    mockedDraw.mockReturnValue(new Promise((resolve) => (land = resolve)));
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.type(field(), FLOW);
    await user.click(create());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => land({ doc: DOC, message: "ok" }));
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  describe("closing and saving (#220)", () => {
    it("if the dialog unmounts while drawing (going to another tab unmounts Home), discards the result — no save, no new tab", async () => {
      let land: (v: { doc: typeof DOC; message: string }) => void = () => {};
      mockedDraw.mockReturnValue(new Promise((resolve) => (land = resolve)));
      const user = userEvent.setup();
      const { unmount } = renderDialog();
      await user.type(field(), FLOW);
      await user.click(create());
      unmount();
      await act(async () => land({ doc: DOC, message: "ok" }));
      expect(mockedOpen).not.toHaveBeenCalled();
    });

    it("StrictMode's double mount is not a close either — Create opens", async () => {
      mockedDraw.mockResolvedValue({ doc: DOC, message: "ok" });
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(
        <StrictMode>
          <MermaidDialog onClose={onClose} />
        </StrictMode>,
      );
      await user.type(field(), FLOW);
      await user.click(create());
      await waitFor(() => expect(mockedOpen).toHaveBeenCalledTimes(1));
      expect(onClose).toHaveBeenCalled();
    });

    it("Cancel·Escape are ignored while saving — the diagram is saved and opened", async () => {
      mockedDraw.mockResolvedValue({ doc: DOC, message: "ok" });
      let saved: (opened: boolean) => void = () => {};
      mockedOpen.mockReturnValue(new Promise((resolve) => (saved = resolve)));
      const user = userEvent.setup();
      const { onClose } = renderDialog();
      await user.type(field(), FLOW);
      await user.click(create());
      await waitFor(() => expect(mockedOpen).toHaveBeenCalledTimes(1));
      const cancel = screen.getByRole("button", { name: "Cancel" });
      expect(cancel).toBeDisabled();
      await user.click(cancel);
      fireEvent.keyDown(field(), { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => saved(true));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("if saving fails (toast), Cancel works again and the text stays", async () => {
      mockedDraw.mockResolvedValue({ doc: DOC, message: "ok" });
      mockedOpen.mockResolvedValue(false);
      const user = userEvent.setup();
      const { onClose } = renderDialog();
      await user.type(field(), FLOW);
      await user.click(create());
      await waitFor(() => expect(create()).toHaveTextContent("Create"));
      expect(field()).toHaveValue(FLOW);
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("Escape·⌘Enter during Hangul composition belong to the IME — neither closes nor creates (#220)", async () => {
    mockedDraw.mockResolvedValue({ doc: DOC, message: "ok" });
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.type(field(), FLOW);
    fireEvent.keyDown(field(), { key: "Escape", isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), {
      key: "Enter",
      metaKey: MOD === "Meta",
      ctrlKey: MOD === "Control",
      isComposing: true,
    });
    await act(async () => {});
    expect(mockedDraw).not.toHaveBeenCalled();
    // once the syllable is done, the same keys work
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("top-layer modal (#220)", () => {
    it("opens a native <dialog> with showModal() — covers even the tab strip, the rest is inert", () => {
      const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
      renderDialog();
      expect(dialog().tagName).toBe("DIALOG");
      expect(showModal).toHaveBeenCalledTimes(1);
      expect(dialog()).toHaveAttribute("open");
      showModal.mockRestore();
    });

    it("takes Escape on keydown and blocks the browser's close request — the dialog closes itself", () => {
      const { onClose, opener } = renderDialog();
      const key = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        field().dispatchEvent(key);
      });
      expect(key.defaultPrevented).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(opener).toHaveFocus();
    });

    it("a cancel that still arrives is blocked and it closes directly — not while saving", async () => {
      mockedDraw.mockResolvedValue({ doc: DOC, message: "ok" });
      let saved: (opened: boolean) => void = () => {};
      mockedOpen.mockReturnValue(new Promise((resolve) => (saved = resolve)));
      const user = userEvent.setup();
      const { onClose } = renderDialog();
      await user.type(field(), FLOW);
      await user.click(create());
      await waitFor(() => expect(mockedOpen).toHaveBeenCalledTimes(1));
      const whileSaving = new Event("cancel", { cancelable: true });
      act(() => {
        dialog().dispatchEvent(whileSaving);
      });
      expect(whileSaving.defaultPrevented).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => saved(false));
      const after = new Event("cancel", { cancelable: true });
      act(() => {
        dialog().dispatchEvent(after);
      });
      expect(after.defaultPrevented).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("releases the modal before returning focus — focus cannot reach behind an open modal since it is inert", async () => {
      const user = userEvent.setup();
      const { opener } = renderDialog();
      const shown = dialog() as HTMLDialogElement;
      let openWhenFocused: boolean | null = null;
      opener.addEventListener("focus", () => {
        openWhenFocused = shown.open;
      });
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(openWhenFocused).toBe(false);
    });

    it("counts it as closed even if the browser closes it anyway (an unblocked cancel) — even while saving", async () => {
      mockedDraw.mockResolvedValue({ doc: DOC, message: "ok" });
      mockedOpen.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      const { onClose, opener } = renderDialog();
      await user.type(field(), FLOW);
      await user.click(create());
      await waitFor(() => expect(mockedOpen).toHaveBeenCalledTimes(1));
      act(() => (dialog() as HTMLDialogElement).close());
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(opener).toHaveFocus();
    });
  });

  it("unmounting without closing (bridge op·tab switch) keeps the draft — reopening shows it, the clipboard does not overwrite it", async () => {
    mockedClipboard.mockResolvedValue(FLOW);
    const user = userEvent.setup();
    const first = renderDialog();
    await waitFor(() => expect(field()).toHaveValue(FLOW));
    await user.clear(field());
    await user.type(field(), "sequenceDiagram");
    first.unmount();
    renderDialog();
    await act(async () => {});
    expect(field()).toHaveValue("sequenceDiagram");
  });

  it("closing with Cancel discards the draft — reopening shows an empty field (or the clipboard)", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(field(), "graph TD");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    renderDialog();
    await act(async () => {});
    expect(field()).toHaveValue("");
  });

  it("creating with Create discards the draft", async () => {
    mockedDraw.mockResolvedValue({ doc: DOC, message: "ok" });
    const user = userEvent.setup();
    renderDialog();
    await user.type(field(), FLOW);
    await user.click(create());
    await waitFor(() => expect(mockedOpen).toHaveBeenCalled());
    renderDialog();
    await act(async () => {});
    expect(field()).toHaveValue("");
  });

  it("Tab cycles inside the dialog", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(field(), FLOW);
    expect(field()).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.tab();
    expect(create()).toHaveFocus();
    await user.tab();
    expect(field()).toHaveFocus();
    await user.tab({ shift: true });
    expect(create()).toHaveFocus();
  });
});
