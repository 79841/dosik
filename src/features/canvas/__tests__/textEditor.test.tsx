import { act, fireEvent, render, screen } from "@testing-library/react";
import { TextSelection } from "prosemirror-state";
import { describe, expect, it, vi } from "vitest";

import { commitDrafts } from "../../../shared/lib/commitDrafts";
import { editorViewOf, TextEditor } from "../TextEditor";
import { typeText } from "./editorTestUtils";

const setup = (props: Partial<Parameters<typeof TextEditor>[0]> = {}) => {
  const onFinish = vi.fn();
  const onSave = vi.fn();
  const onChange = vi.fn();
  const utils = render(
    <TextEditor
      value="Payments"
      multiline
      ariaLabel="Label"
      onFinish={onFinish}
      onSave={onSave}
      onChange={onChange}
      {...props}
    />,
  );
  const editor = screen.getByRole("textbox", { name: "Label" });
  return { ...utils, editor, onFinish, onSave, onChange, view: editorViewOf(editor)! };
};

describe("TextEditor — a shape's text, edited where it is drawn (#281)", () => {
  it("opens with the text, all of it selected, and the focus", () => {
    const { editor, view } = setup();
    expect(editor).toHaveTextContent("Payments");
    expect(view.state.selection.from).toBe(1);
    expect(view.state.selection.to).toBe(9);
    expect(editor).toHaveFocus();
  });

  it("opens with the asked range selected — a compartment's clicked row", () => {
    const { view } = setup({ value: "ab\ncde", select: [3, 6] });
    expect(view.state.selection.from).toBe(5);
    expect(view.state.selection.to).toBe(8);
  });

  it("turns off capitalising, correcting and spell-checking (#174)", () => {
    const { editor } = setup();
    expect(editor.getAttribute("spellcheck")).toBe("false");
    expect(editor.getAttribute("autocapitalize")).toBe("off");
    expect(editor.getAttribute("autocorrect")).toBe("off");
  });

  it("Enter keeps the text", () => {
    const { editor, view, onFinish } = setup();
    typeText(view, "Billing");
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onFinish).toHaveBeenCalledWith("commit", "Billing", true);
  });

  it("Shift+Enter breaks the line where it may, and does nothing where it may not", () => {
    const multi = setup({ value: "a" });
    act(() => {
      multi.view.dispatch(
        multi.view.state.tr.setSelection(TextSelection.create(multi.view.state.doc, 2)),
      );
    });
    fireEvent.keyDown(multi.editor, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(multi.editor, { key: "Enter" });
    expect(multi.onFinish).toHaveBeenCalledWith("commit", "a\n", true);
    multi.unmount();

    const single = setup({ value: "v2", multiline: false });
    fireEvent.keyDown(single.editor, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(single.editor, { key: "Enter" });
    expect(single.onFinish).toHaveBeenCalledWith("commit", "v2", false);
  });

  it("Esc drops the typing", () => {
    const { editor, view, onFinish } = setup();
    typeText(view, "Billing");
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(onFinish).toHaveBeenCalledWith("cancel", "Billing", true);
  });

  it("Tab and Shift+Tab keep the text and move on", () => {
    const tab = setup();
    fireEvent.keyDown(tab.editor, { key: "Tab" });
    expect(tab.onFinish).toHaveBeenCalledWith("next", "Payments", false);
    tab.unmount();
    const back = setup();
    fireEvent.keyDown(back.editor, { key: "Tab", shiftKey: true });
    expect(back.onFinish).toHaveBeenCalledWith("prev", "Payments", false);
  });

  it("a click away keeps the text", () => {
    const { editor, onFinish } = setup();
    fireEvent.blur(editor);
    expect(onFinish).toHaveBeenCalledWith("commit", "Payments", false);
  });

  it("closes once — the blur after Enter or Esc does not write again", () => {
    const { editor, onFinish, unmount } = setup();
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.blur(editor);
    unmount();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("says whether it was touched — typed back to what it opened with, it was not", () => {
    const { editor, view, onFinish } = setup();
    typeText(view, "Billing");
    typeText(view, "Payments");
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onFinish).toHaveBeenCalledWith("commit", "Payments", false);
  });

  it("after a Save, closing untouched since writes nothing more — the saved text is the new start", () => {
    const { editor, view, onFinish, onSave } = setup();
    typeText(view, "Billing");
    act(() => commitDrafts());
    expect(onSave).toHaveBeenCalledWith("Billing", true);
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onFinish).toHaveBeenCalledWith("commit", "Billing", false);
  });

  it("reports every change as text", () => {
    const { view, onChange } = setup();
    typeText(view, "Billing");
    expect(onChange).toHaveBeenLastCalledWith("Billing");
  });

  it("holds no more than maxLength characters", () => {
    const { view, editor } = setup({ value: "ab", maxLength: 3 });
    typeText(view, "abcd");
    expect(editor).toHaveTextContent("ab");
    typeText(view, "abc");
    expect(editor).toHaveTextContent("abc");
  });

  it("Save writes what is typed and stays open (#219)", () => {
    const { view, onSave, onFinish, editor } = setup();
    typeText(view, "Billing");
    act(() => commitDrafts());
    expect(onSave).toHaveBeenCalledWith("Billing", true);
    expect(onFinish).not.toHaveBeenCalled();
    expect(editor).toBeInTheDocument();
  });

  it("keeps a double-click, a right-click and keys to itself", () => {
    const onDoubleClick = vi.fn();
    const onContextMenu = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <div onDoubleClick={onDoubleClick} onContextMenu={onContextMenu} onKeyDown={onKeyDown}>
        <TextEditor
          value="x"
          multiline={false}
          ariaLabel="Badge"
          onFinish={() => {}}
          onSave={() => {}}
        />
      </div>,
    );
    const editor = screen.getByRole("textbox", { name: "Badge" });
    fireEvent.doubleClick(editor);
    fireEvent.contextMenu(editor);
    fireEvent.keyDown(editor, { key: "a" });
    expect(onDoubleClick).not.toHaveBeenCalled();
    expect(onContextMenu).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
  });
});
