import { ReactFlowProvider } from "@xyflow/react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { open } from "@tauri-apps/plugin-dialog";
import { SHAPE_STRIP_WIDTH, TOOLBAR_HEIGHT } from "../../../shared/lib/editorLayout";
import { ICON_IDS, ICON_LABELS } from "../../../shared/lib/iconIds";
import { SHAPE_GROUPS, SHAPE_KINDS, SHAPE_LABELS, SHAPE_ROLES } from "../../../shared/lib/palette";
import { useDiagramStore } from "../../../shared/lib/store";
import { CHROME_HEIGHT } from "../../../shared/lib/windowChrome";
import { useCanvasUiStore } from "../../canvas/canvasUiStore";
import { ShapePalette } from "../ShapePalette";
import { ShapePreview } from "../ShapePreview";

const renderPalette = () =>
  render(
    <ReactFlowProvider>
      <ShapePalette />
    </ReactFlowProvider>,
  );

/** the groups that open a flyout — Images goes straight to a file picker */
const FLYOUT_GROUPS = SHAPE_GROUPS.filter((g) => g.id !== "image");
const groupButton = (label: string) => screen.getByRole("button", { name: label });

describe("ShapePalette", () => {
  it("renders one collapsed button per group plus the arrow tool", () => {
    renderPalette();
    for (const group of FLYOUT_GROUPS) {
      expect(groupButton(group.label)).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.getByRole("button", { name: /arrow tool/i })).toBeInTheDocument();
    // shapes stay hidden until a group is opened
    for (const shape of SHAPE_KINDS) {
      expect(screen.queryByTitle(SHAPE_LABELS[shape])).not.toBeInTheDocument();
    }
  });

  it("opens a group to reveal exactly that group's shapes", async () => {
    const user = userEvent.setup();
    renderPalette();
    for (const group of FLYOUT_GROUPS) {
      await user.click(groupButton(group.label));
      const menu = screen.getByRole("menu", { name: group.label });
      const titles = [...menu.querySelectorAll("button")].map((b) => b.title);
      // the icons group lists glyphs, not shape kinds
      expect(titles).toEqual(
        group.id === "icons"
          ? ICON_IDS.map((id) => ICON_LABELS[id])
          : group.shapes.map((s) => SHAPE_LABELS[s]),
      );
    }
    // opening a group closes the previously open one
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });

  it("toggles a group closed when its button is clicked again", async () => {
    const user = userEvent.setup();
    renderPalette();
    const trigger = groupButton(SHAPE_GROUPS[0].label);
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the open group on Escape", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.click(groupButton(SHAPE_GROUPS[0].label));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("adds a node and closes the group when a shape is picked", async () => {
    const user = userEvent.setup();
    renderPalette();
    const group = SHAPE_GROUPS[0];
    const before = useDiagramStore.getState().nodes.length;
    await user.click(groupButton(group.label));
    await user.click(screen.getByTitle(SHAPE_LABELS[group.shapes[0]]));
    expect(useDiagramStore.getState().nodes.length).toBe(before + 1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("covers every shape kind exactly once across the groups", () => {
    expect(SHAPE_GROUPS.flatMap((g) => g.shapes).sort()).toEqual([...SHAPE_KINDS].sort());
  });

  it("labels shapes by role, with the geometry only as a subtitle", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.click(groupButton("Flowchart"));
    const menu = screen.getByRole("menu", { name: "Flowchart" });
    // the point of the grouping: a decision is found as "Decision", not "Diamond"
    expect(menu).toHaveTextContent("Decision");
    expect(menu).toHaveTextContent("Input / Output");
    expect(menu).toHaveTextContent("Start / End");
    // geometry still shown, but subordinate
    expect(menu).toHaveTextContent("Diamond");
    // no duplicated line when role and geometry are the same word
    expect(menu.textContent?.match(/Database/g)).toHaveLength(1);
  });

  it("names every shape kind by role", () => {
    for (const shape of SHAPE_KINDS) expect(SHAPE_ROLES[shape]).toBeTruthy();
  });

  it("notes & text holds only notes and text — image and frame have their own groups (#180)", () => {
    const shapesOf = (id: string) => SHAPE_GROUPS.find((g) => g.id === id)?.shapes;
    expect(shapesOf("note")).toEqual(["sticky", "text"]);
    expect(shapesOf("image")).toEqual(["image"]);
    expect(shapesOf("frame")).toEqual(["frame"]);
  });

  it("the strip fits the smallest canvas — 640 window less the band and the toolbar row (#219 D8)", () => {
    // padding 4 · a 32 button a group · the divider (1 + 3 + 3) · the arrow · 2 between each
    const strip = 4 + 32 * SHAPE_GROUPS.length + 7 + 32 + 2 * (SHAPE_GROUPS.length + 1) + 4;
    expect(strip).toBe(321);
    expect(strip).toBeLessThanOrEqual(640 - CHROME_HEIGHT - TOOLBAR_HEIGHT - 24);
  });

  it("toolbar 'Shapes' — vertical, 40 wide, icons only (#219 D8, T8)", () => {
    renderPalette();
    const strip = screen.getByRole("toolbar", { name: "Shapes" });
    expect(strip).toHaveAttribute("aria-orientation", "vertical");
    expect(strip).toHaveClass("w-10", "left-3");
    expect(SHAPE_STRIP_WIDTH).toBe(40);
    for (const group of SHAPE_GROUPS) {
      const button = within(strip).getByRole("button", { name: group.label });
      // an icon, and the tooltip that names it — no caption beside the icon
      expect(button.querySelector("svg, [aria-hidden=true]")).not.toBeNull();
      expect(button.textContent).toBe(group.label);
      if (group.id === "image") expect(button).not.toHaveAttribute("aria-haspopup");
      else expect(button).toHaveAttribute("aria-haspopup", "menu");
      // its tooltip hangs to the right of the strip
      expect(within(button).getByRole("tooltip")).toHaveClass("left-full");
    }
    expect("caption" in SHAPE_GROUPS[0]).toBe(false);
  });

  it("Images picks a file directly, without a flyout (#219 T8)", async () => {
    const user = userEvent.setup();
    vi.mocked(open).mockResolvedValueOnce(null);
    renderPalette();
    await user.click(groupButton("Images"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("the Arrow tool is a toggle that announces its pressed state", async () => {
    const user = userEvent.setup();
    useCanvasUiStore.getState().setArrowMode(false);
    renderPalette();
    const arrow = screen.getByRole("button", { name: /arrow tool/i });
    expect(arrow).toHaveAttribute("aria-pressed", "false");
    await user.click(arrow);
    expect(useCanvasUiStore.getState().arrowMode).toBe(true);
    expect(arrow).toHaveAttribute("aria-pressed", "true");
    await user.click(arrow);
    expect(useCanvasUiStore.getState().arrowMode).toBe(false);
  });

  it("gives each group a distinct rail icon drawn from its own shapes", () => {
    const icons = SHAPE_GROUPS.map((g) => g.icon);
    expect(new Set(icons).size).toBe(icons.length);
    for (const group of SHAPE_GROUPS) expect(group.shapes).toContain(group.icon);
  });
});

/**
 * A flyout is a `role="menu"`, so it keeps the menus' keyboard (#219, `useMenuKeys`): it opened without taking the focus and the arrows did
 * nothing — the W2 rule's blank spot.
 */
describe("flyout keyboard — menu rules (#219)", () => {
  const flowchart = SHAPE_GROUPS.find((g) => g.id === "flow")!;
  const label = (shape: (typeof flowchart.shapes)[number]) => SHAPE_LABELS[shape];
  const focusedTitle = () => (document.activeElement as HTMLElement | null)?.title;

  it("focuses the first item on open; ↑↓ wrap and Home End go to the ends", async () => {
    const user = userEvent.setup();
    renderPalette();
    groupButton("Flowchart").focus();
    await user.keyboard("{Enter}");
    const shapes = flowchart.shapes;
    expect(focusedTitle()).toBe(label(shapes[0]!));
    await user.keyboard("{ArrowDown}");
    expect(focusedTitle()).toBe(label(shapes[1]!));
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(focusedTitle()).toBe(label(shapes.at(-1)!));
    await user.keyboard("{Home}");
    expect(focusedTitle()).toBe(label(shapes[0]!));
    await user.keyboard("{End}");
    expect(focusedTitle()).toBe(label(shapes.at(-1)!));
  });

  it("Escape closes and returns focus to that group's button", async () => {
    const user = userEvent.setup();
    renderPalette();
    groupButton("Flowchart").focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(groupButton("Flowchart")).toHaveFocus();
  });

  it("choosing with Enter creates the shape and closes, with focus back on the group button — not dropped to the page", async () => {
    const user = userEvent.setup();
    renderPalette();
    const before = useDiagramStore.getState().nodes.length;
    groupButton("Flowchart").focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(useDiagramStore.getState().nodes).toHaveLength(before + 1);
    expect(useDiagramStore.getState().nodes.at(-1)?.data.shape).toBe(flowchart.shapes[1]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(groupButton("Flowchart")).toHaveFocus();
  });

  it("Tab closes and focus goes its own way", async () => {
    const user = userEvent.setup();
    renderPalette();
    groupButton("Flowchart").focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moving straight to another group still focuses the new flyout's first item", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.click(groupButton("Flowchart"));
    await user.click(groupButton("Notes & text"));
    const notes = SHAPE_GROUPS.find((g) => g.label === "Notes & text")!;
    expect(focusedTitle()).toBe(SHAPE_LABELS[notes.shapes[0]!]);
  });

  it("Architecture icons is a six-column grid — ←→ move one at a time, ↑↓ one row at a time", async () => {
    const user = userEvent.setup();
    renderPalette();
    groupButton("Architecture icons").focus();
    await user.keyboard("{Enter}");
    const name = () => document.activeElement?.getAttribute("aria-label");
    expect(name()).toBe(ICON_LABELS[ICON_IDS[0]]);
    await user.keyboard("{ArrowRight}");
    expect(name()).toBe(ICON_LABELS[ICON_IDS[1]]);
    await user.keyboard("{ArrowDown}");
    expect(name()).toBe(ICON_LABELS[ICON_IDS[7]]);
    await user.keyboard("{ArrowLeft}{ArrowUp}");
    expect(name()).toBe(ICON_LABELS[ICON_IDS[0]]);
  });

  it("shows an item's keyboard focus as a hover background, like a menu item", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.click(groupButton("Flowchart"));
    for (const item of within(screen.getByRole("menu")).getAllByRole("menuitem")) {
      expect(item).toHaveClass("focus-visible:bg-hover");
    }
    await user.click(groupButton("Architecture icons"));
    for (const item of within(screen.getByRole("menu")).getAllByRole("menuitem")) {
      expect(item).toHaveClass("focus-visible:bg-hover");
    }
  });
});

describe("ShapePreview", () => {
  it("text thumbnails are decorative, so screen readers skip them", () => {
    // The palette already has its own label, and the inspector a select
    const { container } = render(<ShapePreview shape="text" />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("so are shape thumbnails", () => {
    const { container } = render(<ShapePreview shape="sticky" />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("flyouts stay inside the canvas column (#180, #219 D8)", () => {
  const MARGIN = 8;
  /** the canvas column below the band (40) and the toolbar row (36) */
  const CANVAS = { top: 76, bottom: 700 };
  const withMenuRect = (top: number, height: number) =>
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const shift = Number.parseFloat(this.style.marginTop || "0");
      if (this.getAttribute("role") === "menu") {
        return { top: top + shift, bottom: top + shift + height, height } as DOMRect;
      }
      if (this.hasAttribute("data-editor-canvas")) {
        return { ...CANVAS, height: CANVAS.bottom - CANVAS.top, left: 0, right: 900 } as DOMRect;
      }
      return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 } as DOMRect;
    });
  const renderInCanvas = () =>
    render(
      <ReactFlowProvider>
        <div data-editor-canvas>
          <ShapePalette />
        </div>
      </ReactFlowProvider>,
    );

  afterEach(() => vi.restoreAllMocks());

  it("comes down inside the canvas column's top edge when overflowing upward — not covering the toolbar row", async () => {
    withMenuRect(40, 310);
    renderInCanvas();
    await userEvent.click(groupButton(SHAPE_GROUPS[0].label));
    expect(screen.getByRole("menu").style.marginTop).toBe(`${CANVAS.top + MARGIN - 40}px`);
  });

  it("goes up inside the canvas column's bottom edge when overflowing downward", async () => {
    withMenuRect(CANVAS.bottom - 100, 300);
    renderInCanvas();
    await userEvent.click(groupButton(SHAPE_GROUPS[0].label));
    expect(screen.getByRole("menu").style.marginTop).toBe(`${-(300 - 100 + MARGIN)}px`);
  });

  it("stays put when it fits — aligned to the trigger's center", async () => {
    withMenuRect(200, 300);
    renderInCanvas();
    await userEvent.click(groupButton(SHAPE_GROUPS[0].label));
    expect(screen.getByRole("menu").style.marginTop).toBe("");
  });

  it("bases max height on the canvas column too", async () => {
    withMenuRect(200, 300);
    renderInCanvas();
    await userEvent.click(groupButton(SHAPE_GROUPS[0].label));
    expect(screen.getByRole("menu").style.maxHeight).toBe(
      `${CANVAS.bottom - CANVAS.top - 2 * MARGIN}px`,
    );
  });

  it("stays inside the window without a canvas column", async () => {
    withMenuRect(-45, 310);
    renderPalette();
    await userEvent.click(groupButton(SHAPE_GROUPS[0].label));
    expect(screen.getByRole("menu").style.marginTop).toBe(`${MARGIN + 45}px`);
  });
});
