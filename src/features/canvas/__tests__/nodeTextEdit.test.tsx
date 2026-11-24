import { ReactFlowProvider } from "@xyflow/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { CLASS_NAME_H, CLASS_ROW_H, CLASS_SECTION_PAD } from "../../../shared/lib/classShape";
import { commitDrafts } from "../../../shared/lib/commitDrafts";
import { useDiagramStore } from "../../../shared/lib/store";
import type { AgentOp } from "../../../shared/lib/types";
import { useCanvasUiStore } from "../canvasUiStore";
import { ShapeNode } from "../ShapeNode";
import { editorViewOf } from "../TextEditor";
import { typeText } from "./editorTestUtils";

/** a node drawn from the store, as React Flow would redraw it after each change */
const Live = ({ id }: { id: string }) => {
  const node = useDiagramStore((s) => s.nodes.find((n) => n.id === id));
  if (!node) return null;
  return (
    <ShapeNode
      id={id}
      type="shape"
      data={node.data}
      selected
      dragging={false}
      zIndex={0}
      isConnectable
      positionAbsoluteX={node.position.x}
      positionAbsoluteY={node.position.y}
      width={node.width}
      height={node.height}
      deletable
      draggable
      selectable
    />
  );
};

const setup = (ops: AgentOp[], id: string) => {
  act(() => {
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
    useDiagramStore.getState().applyOps(ops);
  });
  return render(
    <ReactFlowProvider>
      <Live id={id} />
    </ReactFlowProvider>,
  ).container;
};

const data = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id)!.data;
const undoSteps = () => useDiagramStore.getState().past.length;
const openPart = () => useCanvasUiStore.getState().nodeTextEdit;
const editor = (name: string) => screen.getByRole("textbox", { name });
const press = (target: Element, key: string, shiftKey = false) =>
  fireEvent.keyDown(target, { key, shiftKey });

const BOX: AgentOp[] = [
  {
    op: "add_node",
    node: {
      id: "b",
      label: "Payments",
      description: "Charges cards",
      badge: "beta",
      x: 0,
      y: 0,
      width: 220,
      height: 104,
    },
  },
];

beforeEach(() => {
  act(() => useCanvasUiStore.getState().setNodeTextEdit(null));
});

describe("a box's texts open where they are drawn (#281)", () => {
  it("a double-click on the description opens it, all of it selected; the name stays drawn", () => {
    const c = setup(BOX, "b");
    fireEvent.doubleClick(c.querySelector('[data-text-part="description"]')!);
    const field = editor("Description");
    expect(field).toHaveTextContent("Charges cards");
    expect(field).toHaveFocus();
    const view = editorViewOf(field)!;
    expect(view.state.selection.to - view.state.selection.from).toBe("Charges cards".length);
    expect(c.textContent).toContain("Payments");
    expect(openPart()).toEqual({ nodeId: "b", part: "description" });
  });

  it("Enter keeps the description — one undo step; emptied, it is removed", () => {
    const c = setup(BOX, "b");
    const before = undoSteps();
    fireEvent.doubleClick(c.querySelector('[data-text-part="description"]')!);
    typeText(editor("Description"), "Charges cards and refunds");
    press(editor("Description"), "Enter");
    expect(data("b").description).toBe("Charges cards and refunds");
    expect(undoSteps()).toBe(before + 1);
    expect(openPart()).toBeNull();

    fireEvent.doubleClick(c.querySelector('[data-text-part="description"]')!);
    typeText(editor("Description"), "");
    press(editor("Description"), "Enter");
    expect(data("b").description).toBeUndefined();
  });

  it("closing a text untouched — Enter, a click away, Tab round — leaves no undo step", () => {
    const c = setup(BOX, "b");
    const before = undoSteps();
    fireEvent.doubleClick(c.querySelector('[data-text-part="description"]')!);
    press(editor("Description"), "Tab");
    press(editor("Badge"), "Tab");
    press(editor("Label"), "Tab");
    fireEvent.blur(editor("Description"));
    expect(undoSteps()).toBe(before);
  });

  it("Esc drops the typing", () => {
    const c = setup(BOX, "b");
    fireEvent.doubleClick(c.querySelector('[data-text-part="badge"]')!);
    typeText(editor("Badge"), "new");
    press(editor("Badge"), "Escape");
    expect(data("b").badge).toBe("beta");
    expect(openPart()).toBeNull();
  });

  it("a double-click on the tag opens the badge, inside the tag", () => {
    const c = setup(BOX, "b");
    const tag = c.querySelector('[data-text-part="badge"]')!;
    fireEvent.doubleClick(tag);
    expect(tag.contains(editor("Badge"))).toBe(true);
    typeText(editor("Badge"), "3");
    press(editor("Badge"), "Enter");
    expect(data("b").badge).toBe("3");
  });

  it("a step circle opens in the circle, lifted over the corner grip while it is typed", () => {
    const c = setup(
      [{ op: "add_node", node: { id: "s", label: "Checkout", badge: "2", x: 0, y: 0 } }],
      "s",
    );
    const circle = c.querySelector<HTMLElement>('[data-text-part="badge"]')!;
    expect(circle.style.zIndex).toBe("");
    fireEvent.doubleClick(circle);
    expect(circle.contains(editor("Badge"))).toBe(true);
    expect(circle.style.zIndex).toBe("30");
  });

  it("a double-click anywhere else opens the name", () => {
    const c = setup(BOX, "b");
    fireEvent.doubleClick(c.firstElementChild!);
    expect(editor("Label")).toHaveTextContent("Payments");
  });

  it("the badge takes the pointer, so the double-click reaches it", () => {
    const c = setup(BOX, "b");
    expect(c.querySelector('[data-text-part="badge"]')).toHaveClass("pointer-events-auto");
  });
});

describe("Tab goes round the shape's texts", () => {
  it("name → description → badge → name, and back with Shift+Tab", () => {
    const c = setup(BOX, "b");
    fireEvent.doubleClick(c.firstElementChild!);
    press(editor("Label"), "Tab");
    expect(openPart()?.part).toBe("description");
    press(editor("Description"), "Tab");
    expect(openPart()?.part).toBe("badge");
    press(editor("Badge"), "Tab");
    expect(openPart()?.part).toBe("label");
    press(editor("Label"), "Tab", true);
    expect(openPart()?.part).toBe("badge");
  });

  it("Tab writes what was typed before it moves on", () => {
    const c = setup(BOX, "b");
    fireEvent.doubleClick(c.firstElementChild!);
    typeText(editor("Label"), "Billing");
    press(editor("Label"), "Tab");
    expect(data("b").label).toBe("Billing");
    expect(editor("Description")).toHaveFocus();
  });

  it("a description emptied on Tab is skipped — the badge opens", () => {
    const c = setup(BOX, "b");
    fireEvent.doubleClick(c.querySelector('[data-text-part="description"]')!);
    typeText(editor("Description"), "");
    press(editor("Description"), "Tab");
    expect(data("b").description).toBeUndefined();
    expect(openPart()?.part).toBe("badge");
  });

  it("a shape with one text keeps its editor on Tab", () => {
    setup(
      [{ op: "add_node", node: { id: "l", label: "Order", shape: "lifeline", x: 0, y: 0 } }],
      "l",
    );
    act(() => useCanvasUiStore.getState().setNodeTextEdit({ nodeId: "l", part: "label" }));
    const field = editor("Label");
    typeText(field, "Orders");
    press(field, "Tab");
    expect(data("l").label).toBe("Orders");
    expect(editor("Label")).toBe(field);
    // still open: Enter keeps what is typed next
    typeText(field, "Order list");
    press(field, "Enter");
    expect(data("l").label).toBe("Order list");
  });
});

describe("a class's and an entity's texts (#281 D5)", () => {
  const CLASS: AgentOp[] = [
    { op: "add_node", node: { id: "c", label: "Order", shape: "class", x: 0, y: 0 } },
    {
      op: "update_node",
      id: "c",
      set: {
        stereotype: "entity",
        attributes: ["+ id: UUID", "- total: Money"],
        methods: ["+ pay(): void"],
      },
    },
  ];

  it("a double-click on a member row opens its compartment, that row selected", () => {
    const c = setup(CLASS, "c");
    fireEvent.doubleClick(c.querySelector('[data-text-part="attributes"][data-text-line="1"]')!);
    const field = editor("Attributes");
    expect(editorViewOf(field)!.state.doc.childCount).toBe(2);
    const { from, to } = editorViewOf(field)!.state.selection;
    expect(editorViewOf(field)!.state.doc.textBetween(from, to)).toBe("- total: Money");
    // the rows are not drawn twice
    const drawn = [...c.querySelectorAll("svg text")].map((t) => t.textContent);
    expect(drawn.join("|")).not.toContain("total");
  });

  it("a row added while typing grows the card at once; kept, the box fits it", () => {
    const c = setup(CLASS, "c");
    const height = useDiagramStore.getState().nodes[0]!.height!;
    fireEvent.doubleClick(c.querySelector('[data-text-part="attributes"][data-text-line="0"]')!);
    typeText(editor("Attributes"), "+ id: UUID\n- total: Money\n+ status: State");
    const card = c.querySelector("svg rect")!;
    expect(Number(card.getAttribute("height"))).toBeGreaterThan(height);
    press(editor("Attributes"), "Enter");
    expect(data("c").attributes).toEqual(["+ id: UUID", "- total: Money", "+ status: State"]);
    expect(useDiagramStore.getState().nodes[0]!.height!).toBeGreaterThan(height);
  });

  it("the stereotype opens on its line, typed without its guillemets", () => {
    const c = setup(CLASS, "c");
    fireEvent.doubleClick(c.querySelector('[data-text-part="stereotype"]')!);
    expect(editor("Stereotype")).toHaveTextContent("entity");
    typeText(editor("Stereotype"), "aggregate");
    press(editor("Stereotype"), "Enter");
    expect(data("c").stereotype).toBe("aggregate");
  });

  it("Tab: stereotype → name → attributes → methods → stereotype", () => {
    const c = setup(CLASS, "c");
    fireEvent.doubleClick(c.querySelector('[data-text-part="stereotype"]')!);
    const order = [];
    for (const name of ["Stereotype", "Label", "Attributes", "Methods"]) {
      press(editor(name), "Tab");
      order.push(openPart()?.part);
    }
    expect(order).toEqual(["label", "attributes", "methods", "stereotype"]);
  });

  it("an entity's columns open as the lines they are stored as", () => {
    const c = setup(
      [
        {
          op: "add_node",
          node: {
            id: "e",
            label: "orders",
            shape: "entity",
            columns: ["id uuid PK", "user_id uuid FK"],
            x: 0,
            y: 0,
          },
        },
      ],
      "e",
    );
    fireEvent.doubleClick(c.querySelector('[data-text-part="columns"][data-text-line="1"]')!);
    const view = editorViewOf(editor("Columns"))!;
    const { from, to } = view.state.selection;
    expect(view.state.doc.textBetween(from, to)).toBe("user_id uuid FK");
    typeText(editor("Columns"), "id uuid PK\nuser_id uuid FK\ntotal numeric");
    press(editor("Columns"), "Enter");
    expect(data("e").columns).toEqual(["id uuid PK", "user_id uuid FK", "total numeric"]);
  });
});

describe("a text added from right-click › Add … (#281)", () => {
  it("a description not there yet opens empty under the name; typed and kept, it is there", () => {
    setup([{ op: "add_node", node: { id: "p", label: "Plain", x: 0, y: 0, height: 80 } }], "p");
    act(() =>
      useCanvasUiStore
        .getState()
        .setNodeTextEdit({ nodeId: "p", part: "description", adding: true }),
    );
    expect(editor("Description")).toHaveTextContent("");
    typeText(editor("Description"), "New note");
    press(editor("Description"), "Enter");
    expect(data("p").description).toBe("New note");
  });

  it("closed empty, nothing is added and no undo step is left", () => {
    setup([{ op: "add_node", node: { id: "p", label: "Plain", x: 0, y: 0 } }], "p");
    const before = undoSteps();
    act(() =>
      useCanvasUiStore.getState().setNodeTextEdit({ nodeId: "p", part: "badge", adding: true }),
    );
    press(editor("Badge"), "Enter");
    expect(data("p").badge).toBeUndefined();
    expect(undoSteps()).toBe(before);
  });

  it("a row added to a compartment opens it with a new last line", () => {
    setup(
      [
        { op: "add_node", node: { id: "c", label: "Order", shape: "class", x: 0, y: 0 } },
        { op: "update_node", id: "c", set: { attributes: ["+ id: UUID"] } },
      ],
      "c",
    );
    act(() =>
      useCanvasUiStore
        .getState()
        .setNodeTextEdit({ nodeId: "c", part: "attributes", adding: true }),
    );
    const view = editorViewOf(editor("Attributes"))!;
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.selection.from).toBe(view.state.doc.content.size - 1);
  });
});

describe("the open text and the document", () => {
  it("closes when an agent removes the text being typed into", () => {
    const c = setup(BOX, "b");
    fireEvent.doubleClick(c.querySelector('[data-text-part="badge"]')!);
    act(() => {
      useDiagramStore.getState().applyOps([{ op: "update_node", id: "b", set: { badge: "" } }]);
    });
    expect(openPart()).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Save writes the open text and leaves it open (#219)", () => {
    const c = setup(BOX, "b");
    fireEvent.doubleClick(c.querySelector('[data-text-part="description"]')!);
    typeText(editor("Description"), "Saved mid-sentence");
    act(() => commitDrafts());
    expect(data("b").description).toBe("Saved mid-sentence");
    expect(openPart()?.part).toBe("description");
    expect(editor("Description")).toHaveFocus();
  });

  it("Enter on a selected shape still opens its name", () => {
    setup(BOX, "b");
    act(() => useDiagramStore.getState().requestEditLabel("b"));
    expect(openPart()).toEqual({ nodeId: "b", part: "label" });
  });

  it("an image opens nothing", () => {
    const c = setup(
      [
        {
          op: "add_node",
          node: {
            id: "i",
            label: "pic",
            shape: "image",
            src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            x: 0,
            y: 0,
          },
        },
      ],
      "i",
    );
    fireEvent.doubleClick(c.firstElementChild!);
    act(() => useDiagramStore.getState().requestEditLabel("i"));
    expect(openPart()).toBeNull();
  });
});

describe("a text whose right-click menu is open is outlined (#281)", () => {
  it("the description, the badge and a row, while their menu is open", () => {
    const c = setup(BOX, "b");
    // round the description's words, not across the box's width
    const ring = () =>
      c.querySelector<HTMLElement>('[data-text-part="description"] > span')?.style.outline ?? "";
    expect(ring()).toBe("");
    act(() =>
      useCanvasUiStore
        .getState()
        .setNodeMenu({ nodeId: "b", clientX: 0, clientY: 0, textPart: "description" }),
    );
    expect(ring()).toContain("solid");
    expect(c.querySelector<HTMLElement>('[data-text-part="badge"]')!.style.outline).toBe("");
    act(() => useCanvasUiStore.getState().setNodeMenu(null));
    expect(ring()).toBe("");
  });

  it("only the row the menu was opened on", () => {
    const c = setup(
      [
        { op: "add_node", node: { id: "c", label: "Order", shape: "class", x: 0, y: 0 } },
        { op: "update_node", id: "c", set: { attributes: ["a", "b"] } },
      ],
      "c",
    );
    act(() =>
      useCanvasUiStore
        .getState()
        .setNodeMenu({ nodeId: "c", clientX: 0, clientY: 0, textPart: "attributes", line: 1 }),
    );
    // the ring is drawn round the row itself, beside its band
    const ringAfter = (line: number) =>
      c.querySelector<HTMLElement>(`[data-text-part="attributes"][data-text-line="${line}"]`)!
        .nextElementSibling as HTMLElement | null;
    expect(ringAfter(1)?.style.outline).toContain("solid");
    expect(ringAfter(1)?.style.top).toBe(`${CLASS_NAME_H + CLASS_SECTION_PAD + CLASS_ROW_H - 1}px`);
    expect(ringAfter(0)?.style.outline ?? "").toBe("");
  });
});

describe("an open text looks as it is drawn (#281)", () => {
  it("on a tile, the editor draws its selection in the light scheme — the tile stays light in the dark theme", () => {
    const c = setup(BOX, "b");
    fireEvent.doubleClick(c.querySelector('[data-text-part="description"]')!);
    expect((editor("Description").parentElement as HTMLElement).style.colorScheme).toBe("light");
  });

  it("the description's quiet tone is in its colour, not an opacity that would wash the selection out", () => {
    const c = setup(BOX, "b");
    fireEvent.doubleClick(c.querySelector('[data-text-part="description"]')!);
    const field = editor("Description");
    expect(field).not.toHaveClass("opacity-65");
    expect((field.parentElement as HTMLElement).style.color).toContain("color-mix");
  });

  it("a compartment on the card's body keeps the theme's own scheme", () => {
    const c = setup(
      [
        { op: "add_node", node: { id: "c", label: "Order", shape: "class", x: 0, y: 0 } },
        { op: "update_node", id: "c", set: { attributes: ["+ id: UUID", "name: string"] } },
      ],
      "c",
    );
    fireEvent.doubleClick(c.querySelector('[data-text-part="attributes"]')!);
    const field = editor("Attributes");
    expect((field.parentElement as HTMLElement).style.colorScheme).toBe("");
    // a member's visibility mark keeps its quiet tone while it is typed
    const tinted = [...field.querySelectorAll<HTMLElement>("span[style]")];
    expect(tinted.map((t) => t.textContent)).toEqual(["+"]);
  });
});

describe("an editor and what changes around it (#281)", () => {
  it("an untouched editor leaves an agent's change made meanwhile alone", () => {
    setup(
      [
        { op: "add_node", node: { id: "c", label: "C", shape: "class", x: 0, y: 0 } },
        { op: "update_node", id: "c", set: { attributes: ["+ old: int"] } },
      ],
      "c",
    );
    act(() =>
      useCanvasUiStore.getState().setNodeTextEdit({ nodeId: "c", part: "attributes", line: 0 }),
    );
    act(() => {
      useDiagramStore
        .getState()
        .applyOps([{ op: "update_node", id: "c", set: { attributes: ["+ fromAgent: int"] } }]);
    });
    fireEvent.blur(editor("Attributes"));
    expect(data("c").attributes).toEqual(["+ fromAgent: int"]);
  });

  it("the same for a name passed through with Tab", () => {
    setup(BOX, "b");
    act(() => useCanvasUiStore.getState().setNodeTextEdit({ nodeId: "b", part: "label" }));
    act(() => {
      useDiagramStore
        .getState()
        .applyOps([{ op: "update_node", id: "b", set: { label: "Agent" } }]);
    });
    press(editor("Label"), "Tab");
    expect(data("b").label).toBe("Agent");
  });

  it("Save on an emptied description writes it and keeps the editor open, focused", () => {
    const c = setup(BOX, "b");
    fireEvent.doubleClick(c.querySelector('[data-text-part="description"]')!);
    typeText(editor("Description"), "");
    act(() => commitDrafts());
    expect(data("b").description).toBeUndefined();
    expect(openPart()).toMatchObject({ nodeId: "b", part: "description" });
    expect(editor("Description")).toHaveFocus();
    // typed again and kept, it is back
    typeText(editor("Description"), "Back");
    press(editor("Description"), "Enter");
    expect(data("b").description).toBe("Back");
  });

  it("Save on a compartment emptied of rows keeps it open too", () => {
    setup(
      [
        { op: "add_node", node: { id: "c", label: "C", shape: "class", x: 0, y: 0 } },
        { op: "update_node", id: "c", set: { attributes: ["+ a: int"] } },
      ],
      "c",
    );
    act(() =>
      useCanvasUiStore.getState().setNodeTextEdit({ nodeId: "c", part: "attributes", line: 0 }),
    );
    typeText(editor("Attributes"), "");
    act(() => commitDrafts());
    expect(data("c").attributes).toBeUndefined();
    expect(editor("Attributes")).toHaveFocus();
  });

  it("a double-click on the corner grip within the step circle opens the badge", () => {
    const c = setup(
      [{ op: "add_node", node: { id: "s", label: "Checkout", badge: "2", x: 0, y: 0 } }],
      "s",
    );
    const circle = c.querySelector<HTMLElement>('[data-text-part="badge"]')!;
    circle.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 0,
        right: 124,
        bottom: 24,
        width: 24,
        height: 24,
        x: 100,
        y: 0,
      }) as DOMRect;
    // the selected shape's corner grip, over the circle's middle
    const grip = c.querySelector(".react-flow__resize-control.handle")!;
    fireEvent.doubleClick(grip, { clientX: 112, clientY: 12 });
    expect(openPart()).toEqual({ nodeId: "s", part: "badge" });
  });

  it("a class's name is one line: Shift+Enter adds no line", () => {
    setup([{ op: "add_node", node: { id: "c", label: "Order", shape: "class", x: 0, y: 0 } }], "c");
    act(() => useCanvasUiStore.getState().setNodeTextEdit({ nodeId: "c", part: "label" }));
    press(editor("Label"), "Enter", true);
    press(editor("Label"), "Enter");
    expect(data("c").label).toBe("Order");
  });
});

describe("an editor kept going, and pasted lines (#281)", () => {
  it("after Tab wrote a one-text shape's name and kept the editor, closing untouched leaves an agent's change alone", () => {
    setup(
      [{ op: "add_node", node: { id: "l", label: "Order", shape: "lifeline", x: 0, y: 0 } }],
      "l",
    );
    act(() => useCanvasUiStore.getState().setNodeTextEdit({ nodeId: "l", part: "label" }));
    typeText(editor("Label"), "Orders");
    press(editor("Label"), "Tab");
    act(() => {
      useDiagramStore
        .getState()
        .applyOps([{ op: "update_node", id: "l", set: { label: "FromAgent" } }]);
    });
    press(editor("Label"), "Enter");
    expect(data("l").label).toBe("FromAgent");
  });

  it("a one-line text takes pasted lines as one line", () => {
    setup([{ op: "add_node", node: { id: "c", label: "Order", shape: "class", x: 0, y: 0 } }], "c");
    act(() => useCanvasUiStore.getState().setNodeTextEdit({ nodeId: "c", part: "label" }));
    const view = editorViewOf(editor("Label"))!;
    let pasted = "";
    view.someProp("transformPastedText", (f) => {
      pasted = f("Order\nLine", false, view);
      return true;
    });
    expect(pasted).toBe("Order Line");
  });
});

describe("a step circle's editor in either theme (#281)", () => {
  it("takes the scheme opposite the page's — the circle is the ink", async () => {
    const { useThemeStore } = await import("../../../shared/lib/theme");
    const before = useThemeStore.getState().theme;
    try {
      act(() => useThemeStore.setState({ theme: "light" }));
      const c = setup(
        [{ op: "add_node", node: { id: "s", label: "Checkout", badge: "2", x: 0, y: 0 } }],
        "s",
      );
      fireEvent.doubleClick(c.querySelector('[data-text-part="badge"]')!);
      expect((editor("Badge").parentElement as HTMLElement).style.colorScheme).toBe("dark");
      act(() => useCanvasUiStore.getState().setNodeTextEdit(null));
      act(() => useThemeStore.setState({ theme: "dark" }));
      fireEvent.doubleClick(c.querySelector('[data-text-part="badge"]')!);
      expect((editor("Badge").parentElement as HTMLElement).style.colorScheme).toBe("light");
    } finally {
      act(() => useThemeStore.setState({ theme: before }));
    }
  });

  it("a tag's editor stays light — the cap is light in both themes", () => {
    const c = setup(BOX, "b");
    fireEvent.doubleClick(c.querySelector('[data-text-part="badge"]')!);
    expect((editor("Badge").parentElement as HTMLElement).style.colorScheme).toBe("light");
  });
});
