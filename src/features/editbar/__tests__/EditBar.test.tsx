import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ICON_IDS } from "../../../shared/lib/iconIds";
import {
  ISLAND_INSET,
  SHAPE_STRIP_WIDTH,
  ZOOM_ISLAND_HEIGHT,
  ZOOM_ISLAND_WIDTH,
} from "../../../shared/lib/editorLayout";
import { useDiagramStore } from "../../../shared/lib/store";
import { MARKER_REF_X } from "../../canvas/edgeMarkers";
import type { MarkerShape } from "../../../shared/lib/types";
import { EDIT_BAR_BOTTOM, EditBar, editBarPlacement } from "../EditBar";
import { MARKER_OPTIONS } from "../sections";

/** the bar, with one of its sections opened — what a click on that button does */
const renderBar = (section?: string) => {
  const view = render(<EditBar />);
  if (section) fireEvent.click(screen.getByRole("button", { name: section }));
  return view;
};

/**
 * Canvas selection can't be driven in this environment (coordinate clicks don't
 * reach the Tauri webview and there is no select-all shortcut), so the selected
 * lifeline's sections are covered here instead of by a visual check. These
 * were the inspector's tests; the sections moved into the edit bar (#159).
 */
const selectLifeline = (opts: { second?: boolean } = {}) => {
  useDiagramStore
    .getState()
    .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
  const ops = [
    {
      op: "add_node" as const,
      node: { id: "l", label: "API", shape: "lifeline" as const, x: 0, y: 0 },
    },
    { op: "add_activation" as const, lifeline: "l", y0: 100, y1: 180 },
  ];
  useDiagramStore.getState().applyOps(
    opts.second
      ? [
          ...ops,
          {
            op: "add_node" as const,
            node: { id: "l2", label: "DB", shape: "lifeline" as const, x: 300, y: 0 },
          },
        ]
      : ops,
  );
  useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
};

describe("edit bar placement — centered on the canvas, clear of the zoom island (#219 D9, T5)", () => {
  it("wide canvas: centered 12 from the bottom, max width is the strip up to the zoom island", () => {
    expect(editBarPlacement(892, 360)).toEqual({ left: 266, bottom: 12, maxWidth: 707 });
    expect(EDIT_BAR_BOTTOM).toBe(12);
  });

  it("stays inside the strip when centering would touch the zoom island — pushed left", () => {
    const { left, bottom, maxWidth } = editBarPlacement(600, 400);
    expect({ left, bottom }).toEqual({ left: 27, bottom: 12 });
    // its right end stops 8px short of the zoom island (153 wide, 12 in)
    expect(left + 400).toBe(600 - 12 - ZOOM_ISLAND_WIDTH - 8);
    expect(maxWidth).toBe(415);
  });

  it("moves to the row above the zoom island when the strip is narrower than 260 — from the shape bar's right to the canvas edge — 960 window + sidebar + panel", () => {
    // left from the shape strip's right edge + 8 (12 + 40 + 8): a two-row bar
    // reaches the strip's bottom on a short canvas (#219)
    expect(editBarPlacement(412, 340)).toEqual({ left: 60, bottom: 56, maxWidth: 340 });
    // the row above the zoom island: 12 + 36 + 8
    expect(editBarPlacement(412, 340).bottom).toBe(12 + ZOOM_ISLAND_HEIGHT + 8);
  });

  it("a bar on the row above the island never covers the shape bar, at any width — left ≥ 12 + 40 + 8 (#219)", () => {
    for (const width of [0, 120, 240, 340, 500]) {
      expect(editBarPlacement(412, width).left).toBeGreaterThanOrEqual(
        ISLAND_INSET + SHAPE_STRIP_WIDTH + 8,
      );
    }
    // a narrow bar still centres on the canvas when the centre clears the strip
    expect(editBarPlacement(412, 120).left).toBe(206 - 60);
  });

  it("centers when the bar width isn't known yet (0)", () => {
    expect(editBarPlacement(892, 0).left).toBe(446);
  });

  it("max width doesn't depend on bar width — position and size don't change each other", () => {
    for (const width of [0, 200, 400, 900]) {
      expect(editBarPlacement(892, width).maxWidth).toBe(707);
      expect(editBarPlacement(412, width).maxWidth).toBe(340);
    }
  });

  it("starts a bar wider than the strip at the strip's left end (it wraps)", () => {
    expect(editBarPlacement(892, 900).left).toBe(12);
  });
});

describe("edit bar — Activations", () => {
  beforeEach(() => selectLifeline());

  it("shows start and end inputs per bar for a single selected lifeline", () => {
    renderBar("Activations");
    expect(screen.getByRole("dialog", { name: "Activations" })).toBeInTheDocument();
    expect(screen.getByLabelText("Activation 1 start")).toHaveValue(100);
    expect(screen.getByLabelText("Activation 1 end")).toHaveValue(180);
  });

  it("has no section when several lifelines are selected", () => {
    selectLifeline({ second: true });
    render(<EditBar />);
    expect(screen.queryByRole("button", { name: "Activations" })).not.toBeInTheDocument();
  });

  it("writes an edited number to the store", async () => {
    const user = userEvent.setup();
    renderBar("Activations");
    const start = screen.getByLabelText("Activation 1 start");
    await user.clear(start);
    await user.type(start, "120");
    // Typing doesn't touch the store — commits once on blur/Enter
    expect(useDiagramStore.getState().nodes[0]?.data.activations?.[0]?.y0).toBe(100);
    await user.tab();
    expect(useDiagramStore.getState().nodes[0]?.data.activations?.[0]?.y0).toBe(120);
  });

  it("pulls out-of-range values inside the line instead of rejecting them", async () => {
    const user = userEvent.setup();
    renderBar("Activations");
    const start = screen.getByLabelText("Activation 1 start");
    await user.clear(start);
    await user.type(start, "9999");
    await user.tab();
    // Lifeline height 360, min height 8 → start caps at 352
    expect(useDiagramStore.getState().nodes[0]?.data.activations?.[0]).toEqual({
      y0: 352,
      y1: 360,
    });
  });

  it("Add adds a bar and ✕ removes it", async () => {
    const user = userEvent.setup();
    renderBar("Activations");
    await user.click(screen.getByText("+ Add activation"));
    expect(useDiagramStore.getState().nodes[0]?.data.activations).toHaveLength(2);
    await user.click(screen.getByLabelText("Remove activation 1"));
    const bars = useDiagramStore.getState().nodes[0]?.data.activations;
    expect(bars).toHaveLength(1);
    expect(bars?.[0]?.y0).toBeGreaterThanOrEqual(180);
  });

  it("undoes one typing session with one undo", async () => {
    const user = userEvent.setup();
    renderBar("Activations");
    const start = screen.getByLabelText("Activation 1 start");
    await user.clear(start);
    await user.type(start, "150");
    await user.tab();
    expect(useDiagramStore.getState().nodes[0]?.data.activations?.[0]?.y0).toBe(150);
    useDiagramStore.getState().undo();
    expect(useDiagramStore.getState().nodes[0]?.data.activations?.[0]?.y0).toBe(100);
  });

  it("keeps the value when left empty", async () => {
    const user = userEvent.setup();
    renderBar("Activations");
    const start = screen.getByLabelText("Activation 1 start");
    await user.clear(start);
    await user.tab();
    expect(useDiagramStore.getState().nodes[0]?.data.activations?.[0]?.y0).toBe(100);
  });

  it("disables Add when there's no room", async () => {
    const user = userEvent.setup();
    renderBar("Activations");
    const add = screen.getByText("+ Add activation");
    expect(add).toBeEnabled();
    // Fill a 360-tall lifeline to the end
    for (let i = 0; i < 8; i += 1) {
      if ((add as HTMLButtonElement).disabled) break;
      await user.click(add);
    }
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute("title", "No room left on this lifeline");
  });

  it("has no section for non-lifeline shapes", () => {
    useDiagramStore
      .getState()
      .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "b", label: "Box", x: 0, y: 0 } }]);
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
    render(<EditBar />);
    expect(screen.queryByRole("button", { name: "Activations" })).not.toBeInTheDocument();
  });
});

describe("edit bar — Destroy marker", () => {
  beforeEach(() => selectLifeline());

  it("is off by default with no y input", () => {
    renderBar("Activations");
    expect(screen.getByLabelText("Destroy marker")).not.toBeChecked();
    expect(screen.queryByLabelText("Destroy y")).not.toBeInTheDocument();
  });

  it("turning it on fills in a default y and shows the input", async () => {
    const user = userEvent.setup();
    renderBar("Activations");
    await user.click(screen.getByLabelText("Destroy marker"));
    const y = useDiagramStore.getState().nodes[0]?.data.destroyY;
    expect(y).toBeGreaterThanOrEqual(40);
    expect(screen.getByLabelText("Destroy y")).toBeInTheDocument();
  });

  it("turning it off clears the value", async () => {
    const user = userEvent.setup();
    renderBar("Activations");
    const toggle = screen.getByLabelText("Destroy marker");
    await user.click(toggle);
    await user.click(toggle);
    expect(useDiagramStore.getState().nodes[0]?.data.destroyY).toBeUndefined();
  });

  it("explains why when the lifeline shrinks and the marker isn't drawn", async () => {
    const user = userEvent.setup();
    renderBar("Activations");
    await user.click(screen.getByLabelText("Destroy marker"));
    expect(screen.queryByText(/Outside the line/)).not.toBeInTheDocument();
    // Same as a canvas resize — shorter than the saved value (270)
    act(() => {
      useDiagramStore.getState().applyOps([{ op: "update_node", id: "l", set: { height: 200 } }]);
    });
    expect(screen.getByText(/Outside the line/)).toBeInTheDocument();
    // The value itself must remain so it comes back when lengthened again
    expect(useDiagramStore.getState().nodes[0]?.data.destroyY).toBe(270);
  });

  it("commits the y input on blur and ignores out-of-range values", async () => {
    const user = userEvent.setup();
    renderBar("Activations");
    await user.click(screen.getByLabelText("Destroy marker"));
    const input = screen.getByLabelText("Destroy y");
    await user.clear(input);
    await user.type(input, "300");
    await user.tab();
    expect(useDiagramStore.getState().nodes[0]?.data.destroyY).toBe(300);

    await user.clear(input);
    await user.type(input, "9999");
    await user.tab();
    expect(useDiagramStore.getState().nodes[0]?.data.destroyY).toBe(300);
  });
});

describe("edit bar — alignment helpers", () => {
  const selectLifelines = (n: number) => {
    useDiagramStore
      .getState()
      .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
    useDiagramStore.getState().applyOps(
      Array.from({ length: n }, (_, i) => ({
        op: "add_node" as const,
        node: {
          id: `l${i}`,
          label: `L${i}`,
          shape: "lifeline" as const,
          x: i * 200 + i * 13,
          y: i * 30,
        },
      })),
    );
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((x) => ({ ...x, selected: true })) }));
  };

  it("has no alignment section for a single selection", () => {
    selectLifelines(1);
    render(<EditBar />);
    expect(screen.queryByRole("button", { name: "Align" })).not.toBeInTheDocument();
  });

  it("with two: only Align tops, Distribute disabled", () => {
    selectLifelines(2);
    renderBar("Align");
    expect(screen.getByText("Align tops")).toBeEnabled();
    expect(screen.getByText("Distribute")).toBeDisabled();
  });

  it("with three: Distribute is enabled and spaces them evenly", async () => {
    const user = userEvent.setup();
    selectLifelines(3);
    renderBar("Align");
    await user.click(screen.getByText("Distribute"));
    const xs = useDiagramStore.getState().nodes.map((n) => n.position.x);
    expect(xs[2]! - xs[1]!).toBe(xs[1]! - xs[0]!);
  });

  it("Align tops aligns header y", async () => {
    const user = userEvent.setup();
    selectLifelines(3);
    renderBar("Align");
    await user.click(screen.getByText("Align tops"));
    const ys = useDiagramStore.getState().nodes.map((n) => n.position.y);
    expect(new Set(ys).size).toBe(1);
  });
});

describe("edit bar — Fragment / Order", () => {
  const selectFragment = () => {
    useDiagramStore
      .getState()
      .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "f", label: "cond", shape: "fragment", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 600, y: 0 } },
    ]);
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: n.id === "f" })),
    }));
  };

  beforeEach(selectFragment);

  it("writes a changed kind to the store", async () => {
    const user = userEvent.setup();
    renderBar("Fragment");
    await user.selectOptions(screen.getByLabelText("Fragment kind"), "loop");
    expect(useDiagramStore.getState().nodes[0]?.data.fragmentKind).toBe("loop");
  });

  it("lets the branch count be picked only for alt", async () => {
    const user = userEvent.setup();
    const view = renderBar("Fragment");
    expect(screen.getByLabelText("Branches")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Fragment kind"), "opt");
    view.rerender(<EditBar />);
    expect(screen.queryByLabelText("Branches")).not.toBeInTheDocument();
  });

  it("applies a changed branch count", async () => {
    const user = userEvent.setup();
    renderBar("Fragment");
    await user.selectOptions(screen.getByLabelText("Branches"), "4");
    expect(useDiagramStore.getState().nodes[0]?.data.branches).toBe(4);
  });

  it("Bring to front / Send to back change z", async () => {
    const user = userEvent.setup();
    render(<EditBar />);
    const zOf = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id)?.zIndex;
    await user.click(screen.getByRole("button", { name: "Bring to front" }));
    expect(zOf("f")).toBeGreaterThan(zOf("b") ?? 0);
    await user.click(screen.getByRole("button", { name: "Send to back" }));
    expect(zOf("f")).toBeLessThan(zOf("b") ?? 0);
  });

  it("disables the Fragment option for nodes with edges and explains why", () => {
    useDiagramStore
      .getState()
      .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 300, y: 0 } },
      { op: "add_edge", edge: { id: "e", source: "a", target: "b" } },
    ]);
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: n.id === "a" })),
    }));
    renderBar("Shape");
    expect(screen.getByRole("option", { name: "Fragment frame" })).toBeDisabled();
    expect(screen.getByText(/take no connections/)).toBeInTheDocument();
  });

  it("has no Fragment section for a lifeline selection", () => {
    selectLifeline();
    render(<EditBar />);
    expect(screen.queryByRole("button", { name: "Fragment" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bring to front" })).toBeInTheDocument();
  });
});

describe("MARKER_OPTIONS", () => {
  // This array is `{ id: MarkerShape }[]`, so the type checker can't catch a missing element.
  // We've already left one out three times in places like this — tie it to the union here.
  it("covers every MarkerShape", () => {
    const covered = new Set(MARKER_OPTIONS.map((m) => m.id));
    const all = Object.keys(MARKER_REF_X) as MarkerShape[];

    expect([...all].filter((shape) => !covered.has(shape))).toEqual([]);
  });
});

describe("class member editing — concurrent edits with an agent", () => {
  const seedClass = () => {
    useDiagramStore.getState().loadDoc({ version: 1, title: "T", nodes: [], edges: [] }, null);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "c", label: "C", shape: "class", x: 0, y: 0 } }]);
    useDiagramStore
      .getState()
      .applyOps([{ op: "update_node", id: "c", set: { attributes: ["+ old: int"] } }]);
    act(() => {
      useDiagramStore.setState((st) => ({
        nodes: st.nodes.map((n) => ({ ...n, selected: n.id === "c" })),
      }));
    });
  };
  const agentEdits = (value: string) => {
    act(() => {
      useDiagramStore
        .getState()
        .applyOps([{ op: "update_node", id: "c", set: { attributes: [value] } }]);
    });
  };
  const box = () => screen.getByLabelText("Attributes") as HTMLTextAreaElement;

  beforeEach(seedClass);

  it("takes focus with a single click", async () => {
    renderBar("Members");
    await userEvent.click(box());
    expect(document.activeElement).toBe(box());
  });

  it("keeps the typed input when the agent changes the same field mid-typing", async () => {
    renderBar("Members");
    await userEvent.click(box());
    await userEvent.type(box(), "X");
    agentEdits("+ fromAgent: int");

    expect(box().value).toBe("+ old: intX");
    expect(document.activeElement).toBe(box());
  });

  it("shows agent changes again after focus leaves", async () => {
    renderBar("Members");
    await userEvent.click(box());
    await userEvent.tab();
    agentEdits("+ fromAgent: int");

    expect(box().value).toBe("+ fromAgent: int");
  });

  it("commits nothing when leaving without edits — agent changes made meanwhile aren't overwritten", async () => {
    renderBar("Members");
    await userEvent.click(box());
    agentEdits("+ fromAgent: int");
    await userEvent.tab();

    expect(useDiagramStore.getState().nodes[0]?.data.attributes).toEqual(["+ fromAgent: int"]);
    expect(box().value).toBe("+ fromAgent: int");
  });

  it("lets the user's input win when leaving after edits", async () => {
    renderBar("Members");
    await userEvent.click(box());
    await userEvent.type(box(), "!");
    await userEvent.tab();

    expect(useDiagramStore.getState().nodes[0]?.data.attributes).toEqual(["+ old: int!"]);
  });
});

describe("when the selection changes while focus stays", () => {
  const seedTwo = () => {
    useDiagramStore.getState().loadDoc({ version: 1, title: "T", nodes: [], edges: [] }, null);
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", shape: "class", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", shape: "class", x: 300, y: 0 } },
      { op: "update_node", id: "a", set: { attributes: ["+ fromA: int"] } },
      { op: "update_node", id: "b", set: { attributes: ["+ fromB: str"] } },
    ]);
  };
  const select = (id: string) =>
    act(() => {
      useDiagramStore.setState((st) => ({
        nodes: st.nodes.map((n) => ({ ...n, selected: n.id === id })),
      }));
    });
  const box = () => screen.getByLabelText("Attributes") as HTMLTextAreaElement;

  beforeEach(seedTwo);

  it("swaps in the new node's values — no uncommitted input from the previous node remains", async () => {
    select("a");
    renderBar("Members");
    await userEvent.click(box());
    await userEvent.type(box(), "XYZ");

    select("b");

    expect(box().value).toBe("+ fromB: str");
  });

  it("a later blur doesn't commit the previous node's input to the new node", async () => {
    select("a");
    renderBar("Members");
    await userEvent.click(box());
    await userEvent.type(box(), "XYZ");
    select("b");
    await userEvent.tab();

    const nodes = useDiagramStore.getState().nodes;
    expect(nodes.find((n) => n.id === "b")?.data.attributes).toEqual(["+ fromB: str"]);
    expect(nodes.find((n) => n.id === "a")?.data.attributes).toEqual(["+ fromA: int"]);
  });
});

describe("Shape display", () => {
  const selectShape = (shape: "sticky" | "rect") => {
    useDiagramStore.getState().loadDoc({ version: 1, title: "T", nodes: [], edges: [] }, null);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "n", label: "N", shape, x: 0, y: 0 } }]);
    act(() => {
      useDiagramStore.setState((st) => ({
        nodes: st.nodes.map((x) => ({ ...x, selected: true })),
      }));
    });
  };

  it("the Shape button shows the selected shape's picture", () => {
    selectShape("sticky");
    render(<EditBar />);

    // A sticky is drawn as two paths with a cut corner, not a rect
    const thumb = screen.getByRole("button", { name: "Shape" }).querySelector("svg");
    expect(thumb).not.toBeNull();
    expect(thumb?.querySelectorAll("path")).toHaveLength(2);
  });

  it("changes the picture when the shape changes", () => {
    selectShape("rect");
    render(<EditBar />);

    const thumb = screen.getByRole("button", { name: "Shape" }).querySelector("svg");
    expect(thumb?.querySelector("rect")).not.toBeNull();
    expect(thumb?.querySelectorAll("path")).toHaveLength(0);
  });
});

describe("icon node section (#9)", () => {
  const selectIcon = (icon?: string) => {
    useDiagramStore
      .getState()
      .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "i", label: "DB", shape: "icon", x: 0, y: 0 } }]);
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({
        ...n,
        selected: true,
        data: { ...n.data, ...(icon ? { icon } : {}) },
      })),
    }));
  };

  /** the glyph grid the panel opens — the same picking as the left rail's Icons group */
  const grid = () => within(screen.getByRole("group", { name: "Icons" }));

  it("picks an icon from a grid like the left rail — the current one is the pressed cell, clicking changes it", async () => {
    const user = userEvent.setup();
    selectIcon();
    renderBar("Icon");
    // every glyph is a cell, not a list item
    expect(screen.queryByRole("combobox", { name: "Icon" })).toBeNull();
    expect(grid().getAllByRole("button")).toHaveLength(ICON_IDS.length);
    expect(grid().getByRole("button", { name: "Server" })).toHaveAttribute("aria-pressed", "true");
    await user.click(grid().getByRole("button", { name: "Database" }));
    expect(useDiagramStore.getState().nodes[0]!.data.icon).toBe("database");
    expect(grid().getByRole("button", { name: "Database" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("icon nodes have no None cell — the glyph is the node", () => {
    selectIcon();
    renderBar("Icon");
    expect(grid().queryByRole("button", { name: "None" })).toBeNull();
  });

  it("shows an unknown id as an 'Unknown' cell, and picking turns it into a known id", async () => {
    const user = userEvent.setup();
    selectIcon("future-icon");
    renderBar("Icon");
    expect(grid().getByRole("button", { name: "Unknown (future-icon)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(grid().getByRole("button", { name: "Cloud" }));
    expect(useDiagramStore.getState().nodes[0]!.data.icon).toBe("cloud");
  });

  it("has no Icon section for nodes that are neither icon nor box", () => {
    useDiagramStore
      .getState()
      .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "r", label: "R", shape: "text", x: 0, y: 0 } }]);
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
    render(<EditBar />);
    expect(screen.queryByRole("button", { name: "Icon" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Icon")).not.toBeInTheDocument();
  });
});

describe("Shape ↔ Icon transition (#9)", () => {
  const selectRect = () => {
    useDiagramStore
      .getState()
      .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "r", label: "R", x: 0, y: 0 } }]);
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
  };

  it("picking Icon in the Shape select gives the default glyph and icon size, and going back to a box makes the glyph the box's icon (#160)", async () => {
    const user = userEvent.setup();
    selectRect();
    renderBar("Shape");
    const shapeSelect = screen
      .getAllByRole("combobox")
      .find((el) => (el as HTMLSelectElement).value === "rect")!;
    await user.selectOptions(shapeSelect, "icon");
    let node = useDiagramStore.getState().nodes[0]!;
    expect(node.data).toMatchObject({ shape: "icon", icon: "server" });
    expect([node.width, node.height]).toEqual([96, 96]);
    await user.selectOptions(shapeSelect, "rect");
    node = useDiagramStore.getState().nodes[0]!;
    expect(node.data.shape).toBe("rect");
    expect(node.data.icon).toBe("server");
    // and the document keeps it — a box's icon is part of the file now
    expect(useDiagramStore.getState().toDoc().nodes[0]!.data.icon).toBe("server");
  });
});

describe("editing box decorations (#160)", () => {
  const selectBox = () => {
    useDiagramStore.getState().loadDoc({ version: 1, title: "T", nodes: [], edges: [] }, null);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "b", label: "Orders", x: 0, y: 0 } }]);
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
  };
  const data = () => useDiagramStore.getState().nodes[0]!.data;

  it("adds an icon to a box and removes it with None", async () => {
    const user = userEvent.setup();
    selectBox();
    renderBar("Icon");
    const grid = within(screen.getByRole("group", { name: "Icons" }));
    expect(grid.getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "true");
    await user.click(grid.getByRole("button", { name: "Database" }));
    expect(data().icon).toBe("database");
    await user.click(grid.getByRole("button", { name: "None" }));
    expect(data().icon).toBeUndefined();
  });

  it("clicking the already-picked cell again doesn't stack undo steps", async () => {
    const user = userEvent.setup();
    selectBox();
    renderBar("Icon");
    const grid = within(screen.getByRole("group", { name: "Icons" }));
    await user.click(grid.getByRole("button", { name: "Database" }));
    const past = useDiagramStore.getState().past.length;
    await user.click(grid.getByRole("button", { name: "Database" }));
    expect(useDiagramStore.getState().past.length).toBe(past);
  });

  it("saves description and badge on leaving the field — spaces between words survive", async () => {
    const user = userEvent.setup();
    selectBox();
    renderBar("Text");
    const description = screen.getByRole("textbox", { name: "Description" });
    await user.click(description);
    await user.type(description, "Postgres 16 primary");
    expect(data().description).toBeUndefined();
    const badge = screen.getByRole("textbox", { name: "Badge" });
    await user.click(badge);
    expect(data().description).toBe("Postgres 16 primary");
    await user.type(badge, "v2");
    await user.tab();
    expect(data().badge).toBe("v2");
  });

  it("has no description or badge fields for non-boxes", () => {
    useDiagramStore.getState().loadDoc({ version: 1, title: "T", nodes: [], edges: [] }, null);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "c", label: "C", shape: "class", x: 0, y: 0 } }]);
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
    renderBar("Text");
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Badge" })).toBeNull();
  });

  it("frames only have a badge field — no description field (#210 D23)", async () => {
    const user = userEvent.setup();
    useDiagramStore.getState().loadDoc({ version: 1, title: "T", nodes: [], edges: [] }, null);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "f", label: "VPC", shape: "frame", x: 0, y: 0 } }]);
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
    renderBar("Text");
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
    const badge = screen.getByRole("textbox", { name: "Badge" });
    await user.click(badge);
    await user.type(badge, "1");
    await user.tab();
    expect(data().badge).toBe("1");
  });
});

describe("when a frame is selected (#170 D8)", () => {
  beforeEach(() => {
    useDiagramStore
      .getState()
      .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "f", label: "VPC", shape: "frame", x: 0, y: 0 } },
      { op: "add_node", node: { id: "a", label: "A", x: 600, y: 0 } },
    ]);
  });
  const pick = (ids: string[]) =>
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: ids.includes(n.id) })),
    }));

  it("has Color and Text but no Shape", () => {
    pick(["f"]);
    renderBar();
    expect(screen.getByRole("button", { name: "Color" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Text" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Shape" })).not.toBeInTheDocument();
  });

  it("changing shape alongside a box leaves the frame alone, and Frame isn't in the list", () => {
    pick(["a", "f"]);
    // the first picked shape decides the buttons; put the box first
    useDiagramStore.setState((s) => ({ nodes: [...s.nodes].reverse() }));
    renderBar("Shape");
    const select = screen.getByRole("combobox", { name: "Shape" }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).not.toContain("frame");
    fireEvent.change(select, { target: { value: "ellipse" } });
    const shapes = Object.fromEntries(
      useDiagramStore.getState().nodes.map((n) => [n.id, n.data.shape]),
    );
    expect(shapes).toEqual({ a: "ellipse", f: "frame" });
  });
});
