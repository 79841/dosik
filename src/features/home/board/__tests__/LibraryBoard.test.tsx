import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeNode } from "../../../../shared/lib/__tests__/testFixtures";
import {
  ISLAND_GAP,
  ISLAND_INSET,
  TOAST_BOTTOM,
  ZOOM_ISLAND_HEIGHT,
} from "../../../../shared/lib/editorLayout";
import { useDiagramStore } from "../../../../shared/lib/store";
import { NOTICE_BOTTOM } from "../../../../shared/ui/Toaster";
import { EditBar } from "../../../editbar/EditBar";

import { useAppStore } from "../../../library/appStore";
import { DASHBOARD, type HomeView } from "../../../library/homeView";
import type { BoardSpot, FolderMeta } from "../../../library/libraryApi";
import { resetPlacementsForTests } from "../../../library/libraryActions";
import { useLibraryStore } from "../../../library/libraryStore";
import { openDocument, resetTabsForTests } from "../../../library/tabActions";
import { resetPreviewCacheForTests } from "../../diagramPreview";
import { HomeHeader } from "../../HomeHeader";
import { useHomeMode } from "../../homeMode";
import { resetBoardActionsForTests } from "../boardActions";
import { resetBoardForTests, useBoardStore } from "../boardStore";
import { FIT_TOP, FOCUS_PAD, fitRect, toScreen } from "../boardViewport";
import { LibraryBoard } from "../LibraryBoard";
import { diagrams, folder } from "./boardFixtures";
import { spoken } from "../../../../test/badges";
import { showInLabel } from "../../../library/fileManager";

/** "Show in …" as this web view names its file manager (#238 D10) */
const SHOW_IN = showInLabel();

const mockedInvoke = vi.mocked(invoke);
// a move left on its way by one test must not hold the next one's (#230 D13)
beforeEach(() => {
  resetPlacementsForTests();
  useAppStore.setState({ folderRenameRequest: null });
});
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);

/** the library Rust holds — boards written to it stay */
let disk: FolderMeta[] = [];
const serve = () =>
  mockedInvoke.mockImplementation(async (cmd, args) => {
    if (cmd === "list_library") return structuredClone(disk);
    if (cmd === "set_folder_boards") {
      for (const { id, board } of (args as { boards: { id: string; board: BoardSpot }[] }).boards) {
        disk = disk.map((f) => (f.id === id ? { ...f, board } : f));
      }
      return undefined;
    }
    if (cmd === "load_project") return new Promise(() => {});
    if (cmd === "delete_folder") {
      disk = disk.filter((f) => f.id !== (args as { id: string }).id);
    }
    if (cmd === "delete_project") {
      const { id } = args as { id: string };
      disk = disk.map((f) => ({ ...f, diagrams: f.diagrams.filter((d) => d.id !== id) }));
    }
    if (cmd === "move_project") {
      const { id, folder: to } = args as { id: string; folder: string };
      const all = (fs: FolderMeta[]): FolderMeta[] => fs.flatMap((f) => [f, ...all(f.folders)]);
      const moved = all(disk)
        .flatMap((f) => f.diagrams)
        .find((d) => d.id === id);
      // out of wherever it is, into `to` at any depth
      const place = (fs: FolderMeta[]): FolderMeta[] =>
        fs.map((f) => {
          const rest = f.diagrams.filter((d) => d.id !== id);
          const diagrams =
            f.id === to && moved
              ? [...rest, moved].sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1))
              : rest;
          return { ...f, diagrams, folders: place(f.folders) };
        });
      disk = place(disk);
    }
    if (cmd === "create_folder") {
      // a folder inside another goes on top of it: the newest, with no order (#230 D5)
      const { id, name, parent } = args as { id: string; name: string; parent?: string };
      const made: FolderMeta = { id, name, updatedAt: Date.now(), diagrams: [], folders: [] };
      const into = (fs: FolderMeta[]): FolderMeta[] =>
        fs.map((f) =>
          f.id === parent
            ? { ...f, folders: [made, ...f.folders] }
            : { ...f, folders: into(f.folders) },
        );
      if (parent) disk = into(disk);
    }
    if (cmd === "rename_folder") {
      const { id, name } = args as { id: string; name: string };
      const renamed = (fs: FolderMeta[]): FolderMeta[] =>
        fs.map((f) => ({ ...(f.id === id ? { ...f, name } : f), folders: renamed(f.folders) }));
      disk = renamed(disk);
    }
    if (cmd === "move_folder") {
      const { id, parent } = args as { id: string; parent: string };
      const all = (fs: FolderMeta[]): FolderMeta[] => fs.flatMap((f) => [f, ...all(f.folders)]);
      const moved = all(disk).find((f) => f.id === id);
      const place = (fs: FolderMeta[]): FolderMeta[] =>
        fs.map((f) => {
          const rest = place(f.folders.filter((c) => c.id !== id));
          return { ...f, folders: f.id === parent && moved ? [moved, ...rest] : rest };
        });
      disk = place(disk);
    }
    return undefined;
  });

const pay = { ...folder("pay", 3, { board: { x: 0, y: 0 } }), name: "Payments" };
pay.diagrams[0] = { ...pay.diagrams[0]!, title: "Checkout", readable: true };
const onb = { ...folder("onb", 2, { board: { x: 0, y: 400 } }), name: "Onboarding" };
const infra = { ...folder("infra", 9, { board: { x: 900, y: 0 } }), name: "Infrastructure" };
const placed = () => [pay, onb, infra];

const original = {
  width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
};
const sized = (el: HTMLElement) => el.getAttribute("aria-label") === "Library canvas";

const show = (folders: FolderMeta[] | null, view: HomeView = DASHBOARD) => {
  if (folders) disk = structuredClone(folders);
  useLibraryStore.setState({ folders: folders && structuredClone(folders), readFailed: false });
  useAppStore.setState({ homeView: view });
  return render(<LibraryBoard />);
};
/** the board under Home's header row, in the sheet — as Home draws them (#231 D5, D12) */
const showInSheet = (folders: FolderMeta[], view: HomeView = DASHBOARD) => {
  disk = structuredClone(folders);
  useLibraryStore.setState({ folders: structuredClone(folders), readFailed: false });
  useAppStore.setState({ homeView: view });
  return render(
    <main aria-label="Home">
      <HomeHeader />
      <LibraryBoard />
    </main>,
  );
};
const board = () => screen.getByRole("region", { name: "Library canvas" });
/** how far the toasts rise now: the highest of the lifts the Toaster reads */
const noticeLift = () =>
  Math.max(
    0,
    ...(NOTICE_BOTTOM.match(/--dsk-[\w-]+/g) ?? []).map(
      (name) => Number.parseFloat(document.documentElement.style.getPropertyValue(name)) || 0,
    ),
  );
const hint = () => document.getElementById(board().getAttribute("aria-describedby") ?? "")!;

describe("board assembly (#221 D2·D8·D16·D18, T37)", () => {
  beforeEach(() => {
    resetBoardForTests();
    resetBoardActionsForTests();
    resetPreviewCacheForTests();
    useHomeMode.setState({ mode: "canvas" });
    mockedInvoke.mockReset();
    serve();
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return sized(this) ? 1000 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return sized(this) ? 800 : 0;
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (original.width) Object.defineProperty(HTMLElement.prototype, "clientWidth", original.width);
    if (original.height)
      Object.defineProperty(HTMLElement.prototype, "clientHeight", original.height);
  });

  it("the only islands are the hint pill and the zoom island — Library·count and the switch live in the header row, tab order is header → board → zoom (#231 D12, T24)", () => {
    showInSheet(placed());
    const library = screen.getByRole("heading", { level: 1, name: "Library" });
    expect(document.querySelector("header")).toContainElement(library);
    expect(document.querySelector("header")).toHaveTextContent("3 projects · 14 diagrams");
    expect(board()).not.toContainElement(screen.getByRole("radiogroup", { name: "View" }));
    expect(screen.queryByRole("button", { name: "Back to library" })).toBeNull();
    expect([...board().querySelectorAll("[data-board-island]")]).toEqual([
      hint(),
      screen.getByRole("group", { name: "Zoom" }),
    ]);
    expect(hint()).toHaveTextContent(
      "Double-click a folder to open it in place · Drag a card onto another frame to move it",
    );
    const order = [
      screen.getByRole("radio", { name: "Canvas" }),
      screen.getByRole("button", { name: /^Payments, 3 items/ }),
      screen.getByRole("button", { name: "Zoom out" }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  describe("nested folders — as folder cards in project frames (#231 D13, T25 — ends the 'flatten' of #229 D18)", () => {
    /** Payments › Checkout › Flows, two diagrams below the top */
    const nestedPay = (): FolderMeta => ({
      ...pay,
      folders: [
        {
          id: "chk",
          name: "Checkout folder",
          updatedAt: 2000,
          diagrams: [{ id: "deep", title: "Deep", updatedAt: 2000, readable: true }],
          folders: [
            {
              id: "flw",
              name: "Flows",
              updatedAt: 1,
              diagrams: [{ id: "deeper", title: "Deeper", updatedAt: 1, readable: true }],
              folders: [],
            },
          ],
        },
      ],
    });

    it("a frame holds direct children — folder cards and diagram cards, its count is the item count, the header row count covers all depths", () => {
      showInSheet([nestedPay(), onb, infra]);
      expect(document.querySelector("header")).toHaveTextContent("3 projects · 16 diagrams");
      const frame = screen.getByRole("region", { name: "Payments" });
      expect(screen.getByRole("button", { name: /^Payments, 4 items/ })).toBeInTheDocument();
      expect(
        [...frame.querySelectorAll("[data-board-key]")].map((el) =>
          el.getAttribute("data-board-key"),
        ),
      ).toEqual(["frame:pay", "folder:chk", "card:pay-0", "card:pay-1", "card:pay-2"]);
      expect(
        within(frame).getByRole("button", { name: "Checkout folder, folder, 2 items" }),
      ).toBeInTheDocument();
      expect(within(frame).queryByRole("button", { name: /^Deep/ })).toBeNull();
    });

    it("nested folder view → remembers the viewport before the camera moves, header path is Library / Payments / Checkout / Flows", () => {
      showInSheet([nestedPay(), onb, { ...infra, board: { x: 6000, y: 4000 } }]);
      const before = useBoardStore.getState().viewport;
      act(() => useAppStore.getState().setHomeView({ kind: "folder", folder: "flw" }));
      expect(useBoardStore.getState().beforeFocus).toEqual(before);
      const path = screen.getByRole("navigation", { name: "Breadcrumb" });
      expect(spoken(path)).toBe("Library/Payments/Checkout folder/Flows");
      expect(within(path).getByText("Flows").closest("[aria-current]")).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    it("double-pressing a folder card opens it in place as a subframe — the card disappears and focus goes to its first tile, not the header (#231 D14, T30)", () => {
      showInSheet([nestedPay(), onb, { ...infra, board: { x: 6000, y: 4000 } }]);
      const before = useBoardStore.getState().viewport;
      const chk = screen.getByRole("button", { name: /^Checkout folder, folder/ });
      act(() => chk.focus());
      const focusBefore = useAppStore.getState().homeFocus;
      fireEvent.doubleClick(chk);
      expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
      expect(useAppStore.getState().homeFocus).toBe(focusBefore);
      expect(useBoardStore.getState().beforeFocus).toEqual(before);
      const frame = screen.getByRole("region", { name: "Payments" });
      const sub = within(frame).getByRole("region", { name: "Checkout folder · 2 items" });
      expect(within(frame).queryByRole("button", { name: /^Checkout folder, folder/ })).toBeNull();
      expect(within(sub).getByRole("button", { name: /^Deep, edited/ })).toHaveFocus();
      expect(spoken(screen.getByRole("navigation", { name: "Breadcrumb" }))).toBe(
        "Library/Payments/Checkout folder",
      );
    });

    it("folder card menu: New diagram · New folder · Rename · Move to… · Delete — Rename edits the name on the card", async () => {
      show([nestedPay(), onb, infra]);
      const chk = screen.getByRole("button", { name: /^Checkout folder, folder/ });
      act(() => chk.focus());
      fireEvent.keyDown(chk, { key: "F10", shiftKey: true });
      const menu = screen.getByRole("menu", { name: "More for Checkout folder" });
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((i) => i.textContent),
      ).toEqual([
        "New diagram",
        "New folder",
        SHOW_IN,
        "Copy Path",
        "Rename",
        "Move to…",
        "Delete",
      ]);
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Rename" }));
      const input = screen.getByRole("textbox", { name: "Folder name" });
      expect(input).toHaveFocus();
      fireEvent.change(input, { target: { value: "Billing" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(calls("rename_folder")).toHaveLength(1));
      expect(calls("rename_folder")[0]![1]).toEqual({ id: "chk", name: "Billing" });
      expect(screen.getByRole("button", { name: /folder, 2 items$/ })).toHaveFocus();
    });

    it("dragging a folder card onto another project frame calls move_folder — it appears as a folder card in the receiving frame (#231 D15, T31)", async () => {
      show([nestedPay(), onb, infra]);
      act(() => useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 1 }));
      const box = screen.getByRole("button", { name: /^Checkout folder, folder/ }).parentElement!;
      // Payments grows to four items (540×488): Onboarding has made room below it, at y 528
      fireEvent.pointerDown(box, { button: 0, clientX: 30, clientY: 70 });
      fireEvent.pointerMove(window, { clientX: 60, clientY: 600 });
      expect(screen.getByRole("region", { name: "Onboarding" })).toHaveAttribute(
        "data-drop-target",
      );
      fireEvent.pointerUp(window, { clientX: 60, clientY: 600 });
      await waitFor(() => expect(calls("move_folder")).toHaveLength(1));
      expect(calls("move_folder")[0]![1]).toEqual({ id: "chk", parent: "onb", index: 0 });
      await waitFor(() =>
        expect(
          within(screen.getByRole("region", { name: "Onboarding" })).getByRole("button", {
            name: /^Checkout folder, folder/,
          }),
        ).toBeInTheDocument(),
      );
    });
  });

  describe("opening in place — Esc goes one level at a time, Collapse, camera, dropping on the innermost frame (#231 D14·D15, T30·T31)", () => {
    /** Payments › Checkout folder (Deep, then Flows › Deeper), three diagrams of its own */
    const nestedPay = (): FolderMeta => ({
      ...pay,
      folders: [
        {
          id: "chk",
          name: "Checkout folder",
          updatedAt: 2000,
          diagrams: [{ id: "deep", title: "Deep", updatedAt: 2000, readable: true }],
          folders: [
            {
              id: "flw",
              name: "Flows",
              updatedAt: 1,
              diagrams: [{ id: "deeper", title: "Deeper", updatedAt: 1, readable: true }],
              folders: [],
            },
          ],
        },
      ],
    });
    const library = () => [nestedPay(), onb, { ...infra, board: { x: 6000, y: 4000 } }];
    const view = () => useAppStore.getState().homeView;
    const region = (name: string) => screen.getByRole("region", { name });
    const outer = () => region("Checkout folder · 2 items");
    const pressEscape = () =>
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    it("folder tiles inside a subframe open in place too — the inner subframe sits inside the outer one, focus on its first tile", () => {
      showInSheet(library(), { kind: "folder", folder: "chk" });
      const flows = within(outer()).getByRole("button", { name: "Flows, folder, 1 item" });
      act(() => flows.focus());
      fireEvent.doubleClick(flows);
      expect(view()).toEqual({ kind: "folder", folder: "flw" });
      const inner = within(outer()).getByRole("region", { name: "Flows · 1 item" });
      expect(within(inner).getByRole("button", { name: /^Deeper, edited/ })).toHaveFocus();
      expect(spoken(screen.getByRole("navigation", { name: "Breadcrumb" }))).toBe(
        "Library/Payments/Checkout folder/Flows",
      );
    });

    it("Esc = one level up — nested folder → parent folder → project → dashboard (remembered viewport), focus on the card of the folder just closed", async () => {
      showInSheet(library());
      const before = useBoardStore.getState().viewport;
      act(() => useAppStore.getState().setHomeView({ kind: "folder", folder: "flw" }));
      act(() => screen.getByRole("button", { name: /^Deeper, edited/ }).focus());
      pressEscape();
      expect(view()).toEqual({ kind: "folder", folder: "chk" });
      expect(screen.queryByRole("region", { name: "Flows · 1 item" })).toBeNull();
      expect(within(outer()).getByRole("button", { name: "Flows, folder, 1 item" })).toHaveFocus();
      pressEscape();
      expect(view()).toEqual({ kind: "folder", folder: "pay" });
      expect(screen.queryByRole("region", { name: /^Checkout folder ·/ })).toBeNull();
      expect(screen.getByRole("button", { name: /^Checkout folder, folder/ })).toHaveFocus();
      pressEscape();
      expect(view()).toEqual(DASHBOARD);
      expect(useBoardStore.getState().viewport).toEqual(before);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /^Payments, 4 items/ })).toHaveFocus(),
      );
    });

    it("arrows move in and out of subframes — tiles are board items too, one tab stop (T29)", () => {
      show(library(), { kind: "folder", folder: "chk" });
      const below = screen.getByRole("button", { name: /^Checkout, edited/ });
      act(() => below.focus());
      fireEvent.keyDown(below, { key: "ArrowUp" });
      const deep = within(outer()).getByRole("button", { name: /^Deep, edited/ });
      expect(deep).toHaveFocus();
      fireEvent.keyDown(deep, { key: "ArrowRight" });
      expect(within(outer()).getByRole("button", { name: "Flows, folder, 1 item" })).toHaveFocus();
      expect(
        [...document.querySelectorAll("[data-board-key]")].filter(
          (el) => el.getAttribute("tabindex") === "0",
        ),
      ).toHaveLength(1);
    });

    it("a subframe's Collapse = Esc from that folder — closing the outer one closes the inner too, focus on that folder card", () => {
      showInSheet(library(), { kind: "folder", folder: "flw" });
      const inner = within(outer()).getByRole("region", { name: "Flows · 1 item" });
      fireEvent.click(within(inner).getByRole("button", { name: "Collapse Flows" }));
      expect(view()).toEqual({ kind: "folder", folder: "chk" });
      expect(within(outer()).getByRole("button", { name: "Flows, folder, 1 item" })).toHaveFocus();
      act(() => useAppStore.getState().setHomeView({ kind: "folder", folder: "flw" }));
      // the outer sub-frame's own Collapse, named for it
      fireEvent.click(within(outer()).getByRole("button", { name: "Collapse Checkout folder" }));
      expect(view()).toEqual({ kind: "folder", folder: "pay" });
      expect(screen.queryByRole("region", { name: /·/ })).toBeNull();
      expect(screen.getByRole("button", { name: /^Checkout folder, folder/ })).toHaveFocus();
    });

    it("camera: project = fit frame + 48 at 30–100%, frame top 48 from the board top, subfolder = unchanged if the innermost subframe + 48 is fully visible at 50% or more", () => {
      showInSheet(library());
      const size = { width: 1000, height: 800 };
      act(() => useAppStore.getState().setHomeView({ kind: "folder", folder: "pay" }));
      // Payments, four items (540×488) at (0, 0)
      const fitted = fitRect({ x: 0, y: 0, w: 540, h: 488 }, size, {
        min: 0.3,
        max: 1,
        pad: FOCUS_PAD,
        top: FIT_TOP.focus,
      });
      expect(useBoardStore.getState().viewport).toEqual(fitted);
      // 100% (the frame and 48 around it fit), centred across, hung 48 below the board's top (Hybrid-Folder-Canvas)
      expect(fitted.zoom).toBe(1);
      expect(toScreen(fitted, { x: 0, y: 0 })).toEqual({ x: 24 + (952 - 540) / 2, y: 48 });
      // at 80% the Checkout folder's sub-frame (708×412 at 20, 64) and 48 around it are in view: opened, the camera stays
      const inView = { x: 50, y: 20, zoom: 0.8 };
      act(() => useBoardStore.getState().setViewport(inView));
      act(() => useAppStore.getState().setHomeView({ kind: "folder", folder: "chk" }));
      expect(useBoardStore.getState().viewport).toEqual(inView);
    });

    it("camera: fits at 50–100% if the innermost subframe is below 50% or off screen — remembers the viewport from before the first focus", () => {
      showInSheet(library());
      const far = { x: 0, y: 0, zoom: 0.3 };
      act(() => useBoardStore.getState().setViewport(far));
      act(() => useAppStore.getState().setHomeView({ kind: "folder", folder: "chk" }));
      // the sub-frame at (20, 64) in Payments at (0, 0): 708×412 (two tiles), fitted with 48
      // around it — and Payments, the frame it is opened in, hangs 48 below the board's top
      // as the canvas draws it (#231 D14, Hybrid-Folder-Canvas): its top border stays in view
      const fitted = fitRect(
        { x: 20, y: 64, w: 708, h: 412 },
        { width: 1000, height: 800 },
        { min: 0.5, max: 1, pad: FOCUS_PAD, top: FIT_TOP.focus },
      );
      const now = useBoardStore.getState().viewport!;
      expect(now.zoom).toBe(fitted.zoom);
      expect(now.x).toBe(fitted.x);
      expect(toScreen(now, { x: 0, y: 0 }).y).toBeCloseTo(FIT_TOP.focus);
      expect(useBoardStore.getState().beforeFocus).toEqual(far);
    });

    it("camera: follows to the new spot when a folder opened in place moves to another project — same view, but the chain changed (#231, D14)", () => {
      showInSheet(library());
      // at 80% the Checkout folder's sub-frame in Payments is in view: opened, the camera stays
      const inView = { x: 50, y: 20, zoom: 0.8 };
      act(() => useBoardStore.getState().setViewport(inView));
      act(() => useAppStore.getState().setHomeView({ kind: "folder", folder: "chk" }));
      expect(useBoardStore.getState().viewport).toEqual(inView);
      // elsewhere (the sidebar's Move to…) it goes under Infrastructure, far off at (6000, 4000)
      const [payments, onboarding, infrastructure] = library();
      act(() =>
        useLibraryStore.setState({
          folders: [
            { ...payments!, folders: [] },
            onboarding!,
            { ...infrastructure!, folders: payments!.folders },
          ],
        }),
      );
      expect(view()).toEqual({ kind: "folder", folder: "chk" });
      expect(
        within(region("Infrastructure")).getByRole("region", { name: /^Checkout folder ·/ }),
      ).toBeInTheDocument();
      // Infrastructure (ten items, collapsed): the sub-frame (708×412) first, at (20, 64) in it —
      // fitted, with Infrastructure's top 48 below the board's top (D14)
      const now = useBoardStore.getState().viewport!;
      expect(now).not.toEqual(inView);
      const topLeft = toScreen(now, { x: 6020, y: 4064 });
      const bottomRight = toScreen(now, { x: 6020 + 708, y: 4064 + 412 });
      expect(topLeft.x).toBeGreaterThanOrEqual(0);
      expect(bottomRight.x).toBeLessThanOrEqual(1000);
      expect(bottomRight.y).toBeLessThanOrEqual(800);
      expect(toScreen(now, { x: 6000, y: 4000 }).y).toBeCloseTo(FIT_TOP.focus);
    });

    it("dropping a diagram card on an open subframe puts it at the top of that folder — placeItem, the subframe shows as the drop target (T31)", async () => {
      show(library(), { kind: "folder", folder: "chk" });
      act(() => useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 1 }));
      // Payments at (0, 0): the sub-frame's row first (20, 64, 708×412), Checkout (the diagram) under it at (20, 496)
      const card = screen.getByRole("button", { name: /^Checkout, edited/ }).parentElement!;
      fireEvent.pointerDown(card, { button: 0, clientX: 40, clientY: 510 });
      fireEvent.pointerMove(window, { clientX: 400, clientY: 90 });
      expect(outer()).toHaveAttribute("data-drop-target");
      expect(region("Payments")).not.toHaveAttribute("data-drop-target");
      fireEvent.pointerUp(window, { clientX: 400, clientY: 90 });
      await waitFor(() => expect(calls("move_project")).toHaveLength(1));
      expect(calls("move_project")[0]![1]).toEqual({ id: "pay-0", folder: "chk", index: 0 });
      await waitFor(() =>
        expect(
          within(region("Checkout folder · 3 items")).getByRole("button", {
            name: /^Checkout, edited/,
          }),
        ).toBeInTheDocument(),
      );
    });

    it("dropping a subframe tile on a project frame outside it moves it to the project — the current subframe is not a drop target (T31)", async () => {
      show(library(), { kind: "folder", folder: "chk" });
      act(() => useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 1 }));
      const tile = within(outer()).getByRole("button", { name: /^Deep, edited/ }).parentElement!;
      fireEvent.pointerDown(tile, { button: 0, clientX: 60, clientY: 150 });
      fireEvent.pointerMove(window, { clientX: 400, clientY: 90 });
      expect(outer()).not.toHaveAttribute("data-drop-target");
      fireEvent.pointerMove(window, { clientX: 300, clientY: 30 });
      expect(region("Payments")).toHaveAttribute("data-drop-target");
      fireEvent.pointerUp(window, { clientX: 300, clientY: 30 });
      await waitFor(() => expect(calls("move_project")).toHaveLength(1));
      expect(calls("move_project")[0]![1]).toEqual({ id: "deep", folder: "pay", index: 0 });
    });

    it("a subframe's + → that folder's New menu, New folder → the subframe's new tile is the name input", async () => {
      show(library(), { kind: "folder", folder: "chk" });
      fireEvent.click(within(outer()).getByRole("button", { name: "New in Checkout folder" }));
      const menu = screen.getByRole("menu", { name: "New in Checkout folder" });
      fireEvent.click(within(menu).getByRole("menuitem", { name: "New folder" }));
      await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
      expect(calls("create_folder")[0]![1]).toMatchObject({ parent: "chk" });
      await waitFor(() =>
        expect(
          within(region("Checkout folder · 3 items")).getByRole("textbox", { name: "Folder name" }),
        ).toHaveFocus(),
      );
    });
  });

  it("the initial viewport is 70%, once per session — unchanged on redraw", () => {
    const first = show(placed());
    const start = useBoardStore.getState().viewport;
    expect(start?.zoom).toBe(0.7);
    // the board fits: the topmost frame (Payments at y 0) hangs 36 below the board's top (Hybrid-Home-Canvas)
    expect(start?.y).toBe(FIT_TOP.board);
    act(() => useBoardStore.getState().setViewport({ x: 5, y: 6, zoom: 1.1 }));
    first.unmount();
    show(placed());
    expect(useBoardStore.getState().viewport).toEqual({ x: 5, y: 6, zoom: 1.1 });
  });

  it("project view → Esc → dashboard + remembered viewport, focus on that frame name (#231 D1 — no diagram focus)", async () => {
    showInSheet(placed());
    const before = useBoardStore.getState().viewport;
    act(() => useAppStore.getState().setHomeView({ kind: "folder", folder: "pay" }));
    expect(useBoardStore.getState().beforeFocus).toEqual(before);
    const path = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(spoken(path)).toBe("Library/Payments");
    // the header's path has no project dot (#229 D19)
    expect(path.querySelector(".bg-project-grey")).toBeNull();
    expect(hint()).toHaveTextContent(
      "Esc to zoom out · Double-click a diagram to open it in a tab",
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /^Checkout, edited/ }), { key: "Escape" });
    expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
    expect(useBoardStore.getState().viewport).toEqual(before);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Payments, 3 items/ })).toHaveFocus(),
    );
  });

  it("project view → the camera goes to that frame, 'Library' in the header path → restores (#231 T11)", () => {
    showInSheet(placed());
    const before = useBoardStore.getState().viewport;
    act(() => useAppStore.getState().setHomeView({ kind: "folder", folder: "onb" }));
    expect(useBoardStore.getState().viewport).not.toEqual(before);
    expect(useBoardStore.getState().beforeFocus).toEqual(before);
    const path = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(path).getByText("Onboarding").closest("[aria-current]")).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
    expect(useBoardStore.getState().viewport).toEqual(before);
  });

  it("Esc leaves focus even when focus is in the header row — it is inside the sheet (the old island spot)", () => {
    showInSheet(placed(), { kind: "folder", folder: "pay" });
    const canvas = screen.getByRole("radio", { name: "Canvas" });
    act(() => canvas.focus());
    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
  });

  it("with a menu open, Esc only closes the menu", () => {
    show(placed(), { kind: "folder", folder: "pay" });
    fireEvent.keyDown(screen.getByRole("button", { name: /^Payments, 3 items/ }), {
      key: "F10",
      shiftKey: true,
    });
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
  });

  it("right click on empty space → Canvas menu (New project) — outside the transform layer, at the board root", async () => {
    show(placed());
    const surface = document.querySelector<HTMLElement>("[data-board-surface]")!;
    fireEvent.contextMenu(surface, { clientX: 600, clientY: 500 });
    const menu = screen.getByRole("menu", { name: "Canvas" });
    expect(useBoardStore.getState().menu?.at).toEqual({ x: 602, y: 502 });
    expect(within(menu).getByRole("menuitem", { name: "New project" })).toBeInTheDocument();
    expect(menu.closest("[data-board-layer]")).toBeNull();
    expect(board().contains(menu)).toBe(true);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "New project" }));
    await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
    const { board: spot } = calls("create_folder")[0]![1] as { board: BoardSpot };
    const vp = useBoardStore.getState().viewport!;
    expect(spot).toEqual({
      x: Math.round((600 - vp.x) / vp.zoom),
      y: Math.round((500 - vp.y) / vp.zoom),
    });
  });

  it("going to a field outside the board while New project is being created — the name field does not steal focus (#229, #218 D15)", async () => {
    const serveDisk = mockedInvoke.getMockImplementation()!;
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "create_folder") {
        await new Promise((r) => setTimeout(r, 30));
        const { id, name, board: spot } = args as { id: string; name: string; board: BoardSpot };
        disk = [...disk, { ...folder(id, 0), name, board: spot }];
        return undefined;
      }
      return serveDisk(cmd, args);
    });
    show(placed());
    const surface = document.querySelector<HTMLElement>("[data-board-surface]")!;
    fireEvent.contextMenu(surface, { clientX: 600, clientY: 500 });
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Canvas" })).getByRole("menuitem", {
        name: "New project",
      }),
    );
    const field = document.createElement("input");
    document.body.appendChild(field);
    act(() => field.focus());
    await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
    // the new frame is drawn — and its name is not being edited
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "New project" })).toBeInTheDocument(),
    );
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(field).toHaveFocus();
    field.remove();
  });

  it("going to another tab while New project is being created — does not open the name field even if focus is on body (#229, WebKit)", async () => {
    const serveDisk = mockedInvoke.getMockImplementation()!;
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "create_folder") {
        await new Promise((r) => setTimeout(r, 30));
        const { id, name, board: spot } = args as { id: string; name: string; board: BoardSpot };
        disk = [...disk, { ...folder(id, 0), name, board: spot }];
        return undefined;
      }
      return serveDisk(cmd, args);
    });
    show(placed());
    const surface = document.querySelector<HTMLElement>("[data-board-surface]")!;
    fireEvent.contextMenu(surface, { clientX: 600, clientY: 500 });
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Canvas" })).getByRole("menuitem", {
        name: "New project",
      }),
    );
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    act(() => {
      openDocument(makeDoc([], [], "Other"), { projectId: "other" });
    });
    await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "New project" })).toBeInTheDocument(),
    );
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(useBoardStore.getState().renaming).toBeNull();
    // the tab this test opened goes, for the tests after it
    act(() => resetTabsForTests());
  });

  it("project menu = folder menu + Expand/Collapse: New diagram · New folder · Rename · Expand/Collapse · Delete — no collapse with fewer than 2 (#231 D13, T27)", () => {
    const solo = { ...folder("solo", 1, { board: { x: 0, y: 900 } }), name: "Solo" };
    show([...placed(), solo]);
    fireEvent.click(screen.getByRole("button", { name: "More for Infrastructure" }));
    expect(
      within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["New diagram", "New folder", SHOW_IN, "Copy Path", "Rename", "Expand", "Delete"]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "More for Payments" }));
    expect(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Collapse" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "More for Solo" }));
    expect(
      within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["New diagram", "New folder", SHOW_IN, "Copy Path", "Rename", "Delete"]);
  });

  it("the frame ⋯ collapse hides when pressing it would not change the drawing — opening a folder in a pair leaves no entry collapsed or expanded, closed into a stack is Expand, opened while expanded with three or more is Collapse (#231 D13)", () => {
    const two = (collapsed: boolean, diagrams = 1): FolderMeta => ({
      ...folder("pay", diagrams, { board: { x: 0, y: 0, collapsed } }),
      name: "Payments",
      folders: [{ ...folder("chk", 3), name: "Checkout" }],
    });
    const frameMenu = () => {
      fireEvent.click(screen.getByRole("button", { name: "More for Payments" }));
      const items = within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((i) => i.textContent);
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      return items;
    };
    const { unmount } = show([two(true), onb], { kind: "folder", folder: "chk" });
    expect(screen.getByRole("button", { name: "Payments, 2 items" })).toBeInTheDocument();
    expect(frameMenu()).toEqual([
      "New diagram",
      "New folder",
      SHOW_IN,
      "Copy Path",
      "Rename",
      "Delete",
    ]);
    // the folder closed: a stack of two again
    act(() => useAppStore.getState().setHomeView({ kind: "folder", folder: "pay" }));
    expect(
      screen.getByRole("button", { name: "Payments, 2 items, collapsed" }),
    ).toBeInTheDocument();
    expect(frameMenu()).toEqual([
      "New diagram",
      "New folder",
      SHOW_IN,
      "Copy Path",
      "Rename",
      "Expand",
      "Delete",
    ]);
    unmount();
    resetBoardForTests();
    // expanded, a folder open beside one: collapsed it would stay a card, so no item
    const expanded = show([two(false), onb], { kind: "folder", folder: "chk" });
    expect(screen.getByRole("button", { name: "Payments, 2 items" })).toBeInTheDocument();
    expect(frameMenu()).toEqual([
      "New diagram",
      "New folder",
      SHOW_IN,
      "Copy Path",
      "Rename",
      "Delete",
    ]);
    expanded.unmount();
    resetBoardForTests();
    // expanded, a folder open beside two: Collapse stacks them beside it
    show([two(false, 2), onb], { kind: "folder", folder: "chk" });
    expect(frameMenu()).toEqual([
      "New diagram",
      "New folder",
      SHOW_IN,
      "Copy Path",
      "Rename",
      "Collapse",
      "Delete",
    ]);
  });

  it("frame + → New menu (six START + New folder), closes on a second press — New folder edits the name on the frame's new folder card (#231 D9·D13, T27)", async () => {
    show(placed());
    const plus = screen.getByRole("button", { name: "New in Payments" });
    fireEvent.click(plus);
    const menu = screen.getByRole("menu", { name: "New in Payments" });
    expect(board().contains(menu)).toBe(true);
    expect(menu.closest("[data-board-layer]")).toBeNull();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual([
      "Blank diagram",
      "Flowchart",
      "Sequence",
      "Class",
      "ERD",
      "From Mermaid…",
      "New folder",
    ]);
    fireEvent.pointerDown(plus);
    fireEvent.click(plus);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(plus);
    fireEvent.click(
      within(screen.getByRole("menu", { name: "New in Payments" })).getByRole("menuitem", {
        name: "New folder",
      }),
    );
    await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
    expect(calls("create_folder")[0]![1]).toMatchObject({ name: "New folder", parent: "pay" });
    const input = await within(screen.getByRole("region", { name: "Payments" })).findByRole(
      "textbox",
      { name: "Folder name" },
    );
    expect(input).toHaveFocus();
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
  });

  it("going to another tab while New folder is being created — the new card does not open the name input (screenStamp)", async () => {
    const serveDisk = mockedInvoke.getMockImplementation()!;
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "create_folder") await new Promise((r) => setTimeout(r, 30));
      return serveDisk(cmd, args);
    });
    show(placed());
    fireEvent.click(screen.getByRole("button", { name: "New in Payments" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "New in Payments" })).getByRole("menuitem", {
        name: "New folder",
      }),
    );
    act(() => {
      openDocument(makeDoc([], [], "Other"), { projectId: "other" });
    });
    await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^New folder, folder/ })).toBeInTheDocument(),
    );
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
    act(() => resetTabsForTests());
  });

  it("frame + → New folder in a 6-item project: the new folder goes to the front of the collapsed stack — no name field and no leftover request, even after expanding (#231 C1, D13)", async () => {
    const ledger = { ...folder("led", 6, { board: { x: 0, y: 0 } }), name: "Ledger" };
    show([ledger]);
    fireEvent.click(screen.getByRole("button", { name: "New in Ledger" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "New in Ledger" })).getByRole("menuitem", {
        name: "New folder",
      }),
    );
    await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
    // seven items: the project folds into its stack, the new folder in front
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^Ledger, 7 items, 6 diagrams/ }),
      ).toBeInTheDocument(),
    );
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
    // unfolded later, its card is drawn — and takes nothing
    fireEvent.click(screen.getByRole("button", { name: "Expand Ledger" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^New folder, folder/ })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(useBoardStore.getState().renaming).toBeNull();
  });

  it("if focus leaves the board (a tree name field) while New folder is being created — the new card takes neither focus nor the name field (#231 W1)", async () => {
    const serveDisk = mockedInvoke.getMockImplementation()!;
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "create_folder") await new Promise((r) => setTimeout(r, 30));
      return serveDisk(cmd, args);
    });
    show(placed());
    fireEvent.click(screen.getByRole("button", { name: "New in Payments" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "New in Payments" })).getByRole("menuitem", {
        name: "New folder",
      }),
    );
    const field = document.createElement("input");
    document.body.append(field);
    act(() => field.focus());
    await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^New folder, folder/ })).toBeInTheDocument(),
    );
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(within(board()).queryByRole("textbox")).toBeNull();
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
    expect(field).toHaveFocus();
    field.remove();
  });

  /**
   * A focused field taken off the page sends no blur (jsdom; WebKit's focus
   * fixup sends none either), so its `onDone` never runs — the rename must
   * go with the screen, or the field opens again later and takes the focus.
   */
  describe("a name field that left the screen clears renaming — it does not reopen on redraw (#231 D8·D13)", () => {
    const newFolderIn = (project: string) => {
      fireEvent.click(screen.getByRole("button", { name: `New in ${project}` }));
      fireEvent.click(
        within(screen.getByRole("menu", { name: `New in ${project}` })).getByRole("menuitem", {
          name: "New folder",
        }),
      );
      return screen.findByRole("textbox", { name: "Folder name" });
    };
    /** where the focus is when the user comes back */
    const elsewhere = () => {
      const el = document.createElement("button");
      document.body.append(el);
      act(() => el.focus());
      return el;
    };
    const noBlurOn = (input: HTMLElement) => {
      const seen = { blurred: false };
      input.addEventListener("blur", () => {
        seen.blurred = true;
      });
      return seen;
    };

    it("if the board unmounts with focus in the new folder's name field (⌘2·a tab opened by the agent) — it does not reopen or take focus on return", async () => {
      const first = show(placed());
      const input = await newFolderIn("Payments");
      expect(input).toHaveFocus();
      const seen = noBlurOn(input);
      first.unmount();
      expect(seen.blurred).toBe(false);
      expect(useBoardStore.getState().renaming).toBeNull();
      const other = elsewhere();
      render(<LibraryBoard />);
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(other).toHaveFocus();
      other.remove();
    });

    it("if the agent adds items while the name field is open and the project collapses into a stack — it does not reopen on Expand", async () => {
      const ledger = { ...folder("led", 5, { board: { x: 0, y: 0 } }), name: "Ledger" };
      show([ledger]);
      const input = await newFolderIn("Ledger");
      expect(input).toHaveFocus();
      // a seventh item: the project folds, the new folder's card into the stack
      disk = disk.map((f) => ({
        ...f,
        diagrams: [{ id: "x", title: "X", updatedAt: 5000, readable: true }, ...f.diagrams],
      }));
      await act(async () => {
        await useLibraryStore.getState().refresh();
      });
      expect(screen.getByRole("button", { name: /^Ledger, 7 items, 6 diagrams/ })).toBeVisible();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(useBoardStore.getState().renaming).toBeNull();
      const other = elsewhere();
      fireEvent.click(screen.getByRole("button", { name: "Expand Ledger" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /^New folder, folder/ })).toBeInTheDocument(),
      );
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(other).toHaveFocus();
      other.remove();
    });

    it("the frame F2 name field too — clears renaming when the board unmounts, does not reopen on return (#221)", () => {
      const first = show(placed());
      const head = screen.getByRole("button", { name: /^Payments, 3 items/ });
      act(() => head.focus());
      fireEvent.keyDown(head, { key: "F2" });
      const input = screen.getByRole("textbox", { name: "Project name" });
      expect(input).toHaveFocus();
      const seen = noBlurOn(input);
      first.unmount();
      expect(seen.blurred).toBe(false);
      expect(useBoardStore.getState().renaming).toBeNull();
      const other = elsewhere();
      render(<LibraryBoard />);
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(other).toHaveFocus();
      other.remove();
    });

    it("if the project disappears while the frame F2 name field is open — clears renaming", async () => {
      show(placed());
      const head = screen.getByRole("button", { name: /^Onboarding, 2 items/ });
      act(() => head.focus());
      fireEvent.keyDown(head, { key: "F2" });
      expect(screen.getByRole("textbox", { name: "Project name" })).toHaveFocus();
      disk = disk.filter((f) => f.id !== "onb");
      await act(async () => {
        await useLibraryStore.getState().refresh();
      });
      expect(screen.queryByRole("region", { name: "Onboarding" })).toBeNull();
      expect(useBoardStore.getState().renaming).toBeNull();
    });
  });

  it("pressing ⋯ again on an open project menu closes it — not an outside press (#220)", () => {
    show(placed());
    const more = screen.getByRole("button", { name: "More for Payments" });
    fireEvent.pointerDown(more);
    fireEvent.click(more);
    expect(screen.getByRole("menu", { name: "More for Payments" })).toBeInTheDocument();
    expect(more).toHaveAttribute("aria-expanded", "true");
    // the second press: its pointerdown must not close the menu for its click to reopen it
    fireEvent.pointerDown(more);
    expect(screen.getByRole("menu", { name: "More for Payments" })).toBeInTheDocument();
    fireEvent.click(more);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(more).toHaveAttribute("aria-expanded", "false");
    // a press anywhere else still closes it
    fireEvent.pointerDown(more);
    fireEvent.click(more);
    fireEvent.pointerDown(board());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("loading: only the islands without a list, pulsing frames after 300ms", () => {
    vi.useFakeTimers();
    show(null);
    expect(hint()).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Zoom" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading projects" })).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("status", { name: "Loading projects" })).toBeInTheDocument();
  });

  it("Fit to screen: fits the whole board with the top frame 36 from the board top — the same spot as the initial view (#231 D12)", () => {
    show(placed());
    act(() => useBoardStore.getState().setViewport({ x: -500, y: -500, zoom: 1.5 }));
    fireEvent.click(screen.getByRole("button", { name: "Fit to screen" }));
    const fit = useBoardStore.getState().viewport!;
    // Payments (0, 0) to Infrastructure's right and Onboarding's bottom: as wide as fits, shorter than the area
    expect(fit.zoom).toBeLessThan(1);
    expect(fit.y).toBeCloseTo(FIT_TOP.board);
  });

  it("failure: box + Try again, zoom buttons turn off", () => {
    useLibraryStore.setState({ folders: [], readFailed: true });
    useAppStore.setState({ homeView: DASHBOARD });
    render(<LibraryBoard />);
    expect(screen.getByText("Couldn't load your projects")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fit to screen" })).toBeDisabled();
  });

  it("empty library: 'No projects yet' + New project button", async () => {
    show([]);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(
      screen.getByText("Right-click the canvas to make one, or use + in the sidebar."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    await waitFor(() => expect(calls("create_folder")).toHaveLength(1));
  });

  it("arrows navigate spatially, Home·End go to first·last", () => {
    show(placed());
    const first = screen.getByRole("button", { name: /^Payments, 3 items/ });
    act(() => first.focus());
    // the name's centre is over the middle card
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /^PAY- 1,/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.getByRole("button", { name: /^Checkout,/ })).toHaveFocus();
    // last in reading order: Onboarding, the frame lowest on the board
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("button", { name: /^ONB- 1,/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(first).toHaveFocus();
  });

  it("toasts sit above the bottom islands — Home's 16 would be covered by the hint pill·zoom island, so 8 above them (56), only while the board is shown (#231 D18)", () => {
    const view = show(placed());
    expect(noticeLift()).toBe(40);
    // the zoom island, the taller of the two, ends 12 + 36 up; the hint pill spans most of the row
    expect(TOAST_BOTTOM + noticeLift()).toBe(ISLAND_INSET + ZOOM_ISLAND_HEIGHT + ISLAND_GAP);
    view.unmount();
    expect(noticeLift()).toBe(0);
  });

  it("coming to Home (Canvas) from an editor with a selection — the lift stays even if the edit bar unmounts in the same commit (#221)", () => {
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "a", label: "A" })], []), null);
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
    useLibraryStore.setState({ folders: structuredClone(placed()), readFailed: false });
    useAppStore.setState({ homeView: DASHBOARD });
    let goHome: () => void = () => {};
    // Workspace (with its edit bar) gives way to Home in one commit
    const Sheet = () => {
      const [home, setHome] = useState(false);
      goHome = () => setHome(true);
      return home ? <LibraryBoard /> : <EditBar />;
    };
    render(<Sheet />);
    expect(noticeLift()).toBeGreaterThan(0);
    act(() => goHome());
    expect(noticeLift()).toBe(40);
  });

  it("a frame starting a rename comes into view — a new project placed aside", () => {
    const far = { ...folder("far", 0, { board: { x: 4000, y: 3000 } }), name: "Far" };
    show([...placed(), far]);
    const before = useBoardStore.getState().viewport!;
    act(() => useBoardStore.getState().setRenaming("far"));
    const after = useBoardStore.getState().viewport!;
    expect(after.zoom).toBe(before.zoom);
    // the frame's corner is inside the clear area now
    const x = 4000 * after.zoom + after.x;
    const y = 3000 * after.zoom + after.y;
    expect(x).toBeGreaterThanOrEqual(24);
    expect(x + 280 * after.zoom).toBeLessThanOrEqual(1000 - 24);
    expect(y).toBeGreaterThanOrEqual(60);
    expect(screen.getByRole("textbox", { name: "Project name" })).toBeInTheDocument();
  });

  it("roving: one tab stop, initially the first item in reading order", () => {
    show(placed());
    const stops = [...document.querySelectorAll("[data-board-key]")].filter(
      (el) => el.getAttribute("tabindex") === "0",
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAccessibleName(/^Payments, 3 items/);
  });
});

describe("focus does not scroll the board (#221)", () => {
  beforeEach(() => {
    resetBoardForTests();
    resetBoardActionsForTests();
    useHomeMode.setState({ mode: "canvas" });
    mockedInvoke.mockReset();
    serve();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** every focus the board itself gave since `spy` was made — each must keep the scroll */
  const given = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map(([options]) => options);

  it("the board root and surface are overflow: clip — not scroll boxes, so focusing an off-screen item cannot push them", () => {
    show(placed());
    const surface = document.querySelector("[data-board-surface]")!;
    for (const el of [board(), surface]) {
      expect(el).toHaveClass("supports-[overflow:clip]:overflow-clip");
      // a WebKit before 16 has no clip: its own box, put back at 0 on any scroll (S2) — not the sheet
      expect(el).toHaveClass("overflow-hidden");
    }
  });

  it("resets to 0 right away when the board root scrolls — a safety net for WebKit without clip (#221)", () => {
    show(placed());
    board().scrollLeft = 120;
    board().scrollTop = 80;
    fireEvent.scroll(board());
    expect(board().scrollLeft).toBe(0);
    expect(board().scrollTop).toBe(0);
  });

  it("focus moved by arrows·Home·End uses preventScroll", () => {
    show(placed());
    const first = screen.getByRole("button", { name: /^Payments, 3 items/ });
    act(() => first.focus());
    const spy = vi.spyOn(HTMLElement.prototype, "focus");
    fireEvent.keyDown(first, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(given(spy)).toEqual([
      { preventScroll: true },
      { preventScroll: true },
      { preventScroll: true },
    ]);
  });

  it("focus given when pressing a card·stack also uses preventScroll", () => {
    show(placed(), { kind: "folder", folder: "pay" });
    const spy = vi.spyOn(HTMLElement.prototype, "focus");
    fireEvent.click(screen.getByRole("button", { name: /^ONB- 0,/ }), { detail: 1 });
    fireEvent.click(
      screen.getByRole("button", { name: /^Infrastructure, 9 items, 9 diagrams, latest/ }),
      {
        detail: 1,
      },
    );
    expect(given(spy).length).toBeGreaterThanOrEqual(2);
    expect(given(spy).every((o) => (o as FocusOptions | undefined)?.preventScroll === true)).toBe(
      true,
    );
  });

  it("the name input also takes focus without scrolling — the camera brings it into view", () => {
    show(placed());
    const spy = vi.spyOn(HTMLElement.prototype, "focus");
    act(() => useBoardStore.getState().setRenaming("onb"));
    const input = screen.getByRole("textbox", { name: "Project name" });
    expect(input).toHaveFocus();
    expect(given(spy)).toContainEqual({ preventScroll: true });
    expect(given(spy).every((o) => (o as FocusOptions | undefined)?.preventScroll === true)).toBe(
      true,
    );
  });
});

describe("a card dropped on a bottom island does not move (#221)", () => {
  beforeEach(() => {
    resetBoardForTests();
    resetBoardActionsForTests();
    useHomeMode.setState({ mode: "canvas" });
    mockedInvoke.mockReset();
    serve();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Checkout dragged from Payments to (60, 500) — over Onboarding's frame at 100% */
  const dragCheckout = () => {
    act(() => useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 1 }));
    const card = screen.getByRole("button", { name: /^Checkout,/ }).parentElement!;
    fireEvent.pointerDown(card, { button: 0, clientX: 30, clientY: 70 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 500 });
    fireEvent.pointerUp(window, { clientX: 60, clientY: 500 });
  };
  /** an island drawn over the drop point */
  const over = (el: Element) =>
    vi
      .spyOn(el, "getBoundingClientRect")
      .mockReturnValue(DOMRect.fromRect({ x: 0, y: 450, width: 200, height: 100 }));

  it("moves when dropped in open space — the baseline for the test", async () => {
    show(placed());
    dragCheckout();
    await waitFor(() => expect(calls("move_project")).toHaveLength(1));
  });

  it("over the zoom island — does not move to the frame underneath", async () => {
    show(placed());
    over(screen.getByRole("group", { name: "Zoom" }));
    dragCheckout();
    await act(async () => {});
    expect(calls("move_project")).toHaveLength(0);
  });

  it("over the hint pill — does not move", async () => {
    show(placed());
    over(hint());
    dragCheckout();
    await act(async () => {});
    expect(calls("move_project")).toHaveLength(0);
  });
});

describe("after deleting via a menu, focus goes to a neighbor item (#221)", () => {
  beforeEach(() => {
    resetBoardForTests();
    resetBoardActionsForTests();
    useHomeMode.setState({ mode: "canvas" });
    mockedInvoke.mockReset();
    serve();
    vi.mocked(ask).mockResolvedValue(true);
  });
  afterEach(() => {
    vi.mocked(ask).mockReset();
  });

  const menuOn = (name: RegExp) => {
    const item = screen.getByRole("button", { name });
    act(() => item.focus());
    fireEvent.keyDown(item, { key: "F10", shiftKey: true });
    return screen.getByRole("menu");
  };

  it("project Delete → the next project item in reading order", async () => {
    show(placed());
    fireEvent.click(within(menuOn(/^Payments, 3 items/)).getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(calls("delete_folder")).toHaveLength(1));
    // Payments was first; Infrastructure's frame comes next (y 0, x 900)
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^Infrastructure, 9 items, collapsed$/ }),
      ).toHaveFocus(),
    );
  });

  it("diagram Delete → the next card in the same frame", async () => {
    show(placed());
    fireEvent.click(within(menuOn(/^Checkout,/)).getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(calls("delete_project")).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /^PAY- 1,/ })).toHaveFocus());
    expect(screen.queryByRole("button", { name: /^Checkout,/ })).toBeNull();
  });

  it("if the user goes to a field outside the board while deleting — does not pull focus to the neighbor when done (#229, #218 D15)", async () => {
    const serveDisk = mockedInvoke.getMockImplementation()!;
    mockedInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "delete_project") await new Promise((r) => setTimeout(r, 30));
      return serveDisk(cmd, args);
    });
    show(placed());
    fireEvent.click(within(menuOn(/^Checkout,/)).getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(calls("delete_project")).toHaveLength(1));
    const field = document.createElement("input");
    document.body.appendChild(field);
    act(() => field.focus());
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Checkout,/ })).toBeNull());
    await act(() => new Promise((r) => setTimeout(r, 40)));
    expect(field).toHaveFocus();
    field.remove();
  });

  it("Cancel in the confirm dialog keeps focus on that item", async () => {
    vi.mocked(ask).mockResolvedValue(false);
    show(placed());
    fireEvent.click(within(menuOn(/^Checkout,/)).getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(vi.mocked(ask)).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByRole("button", { name: /^Checkout,/ })).toHaveFocus();
  });

  it("if Rename cannot open the diagram, focus goes to that card", async () => {
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_library") return structuredClone(disk);
      if (cmd === "load_project") throw new Error("gone");
      return undefined;
    });
    show(placed());
    fireEvent.click(within(menuOn(/^Checkout,/)).getByRole("menuitem", { name: "Rename" }));
    await waitFor(() => expect(calls("load_project").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Checkout,/ })).toHaveFocus());
  });
});

describe("expanding and moving by keyboard keeps focus on board items (#221, D2·D20)", () => {
  beforeEach(() => {
    resetBoardForTests();
    resetBoardActionsForTests();
    useHomeMode.setState({ mode: "canvas" });
    mockedInvoke.mockReset();
    serve();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** the board's one Tab stop */
  const stops = () =>
    [...document.querySelectorAll("[data-board-key]")].filter(
      (el) => el.getAttribute("tabindex") === "0",
    );
  const focusOn = (name: RegExp) => {
    const item = screen.getByRole("button", { name });
    act(() => item.focus());
    return item;
  };
  const infraStack = /^Infrastructure, 9 items, 9 diagrams, latest/;

  it("Enter on a stack → the expanded project's front card", () => {
    show(placed());
    fireEvent.keyDown(focusOn(infraStack), { key: "Enter" });
    const front = screen.getByRole("button", { name: /^INFRA- 0,/ });
    expect(front).toHaveFocus();
    expect(stops()).toEqual([front]);
  });

  it("Space on a stack too → the front card", () => {
    show(placed());
    fireEvent.keyDown(focusOn(infraStack), { key: " " });
    expect(screen.getByRole("button", { name: /^INFRA- 0,/ })).toHaveFocus();
  });

  it("Expand from the stack menu (Shift+F10) → the front card", () => {
    show(placed());
    fireEvent.keyDown(focusOn(infraStack), { key: "F10", shiftKey: true });
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Expand" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: /^INFRA- 0,/ })).toHaveFocus();
  });

  /** Checkout › Shift+F10 › Move to… › `to` */
  const moveCheckout = (to: string) => {
    fireEvent.keyDown(focusOn(/^Checkout,/), { key: "F10", shiftKey: true });
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /Move to/ }));
    const picker = screen.getByRole("tree", { name: "Move to" });
    const row = within(picker).getByRole("treeitem", { name: `${to}, project` });
    fireEvent.click(row.querySelector("[data-row]")!);
  };

  it("Move to… → that card redrawn in the new frame", async () => {
    show(placed());
    moveCheckout("Onboarding");
    await waitFor(() => expect(calls("move_project")).toHaveLength(1));
    const moved = within(screen.getByRole("region", { name: "Onboarding" })).getByRole("button", {
      name: /^Checkout,/,
    });
    expect(moved).toHaveFocus();
    expect(stops()).toEqual([moved]);
  });

  it("Move to… into a folder of the same project → focus on the folder card holding that card (#229, #231 D13)", async () => {
    const withSub = { ...pay, folders: [{ ...folder("sub", 0), name: "Sub" }] };
    show([withSub, onb, infra]);
    fireEvent.keyDown(focusOn(/^Checkout,/), { key: "F10", shiftKey: true });
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /Move to/ }));
    const picker = screen.getByRole("tree", { name: "Move to" });
    fireEvent.click(
      within(picker).getByRole("treeitem", { name: "Sub, folder" }).querySelector("[data-row]")!,
    );
    await waitFor(() => expect(calls("move_project")).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sub, folder, 1 item" })).toHaveFocus(),
    );
    expect(screen.queryByRole("button", { name: /^Checkout,/ })).toBeNull();
  });

  it("Move to… into a collapsed project → the stack holding that card", async () => {
    show(placed());
    moveCheckout("Infrastructure");
    await waitFor(() => expect(calls("move_project")).toHaveLength(1));
    expect(
      screen.getByRole("button", { name: /^Infrastructure, 10 items, 10 diagrams, latest/ }),
    ).toHaveFocus();
  });

  it("if focus is outside the board — does not pull it back when an item vanishes, nor when something outside vanishes afterwards", () => {
    const Page = ({ sidebar }: { sidebar: boolean }) => (
      <>
        {sidebar ? <button type="button">Sidebar row</button> : null}
        <LibraryBoard />
      </>
    );
    useLibraryStore.setState({ folders: structuredClone(placed()), readFailed: false });
    useAppStore.setState({ homeView: DASHBOARD });
    const view = render(<Page sidebar />);
    focusOn(/^Checkout,/);
    const outside = screen.getByRole("button", { name: "Sidebar row" });
    act(() => outside.focus());
    act(() => useAppStore.getState().setHomeView({ kind: "folder", folder: "pay" }));
    expect(outside).toHaveFocus();
    // what had the focus goes too: the board does not reach back for its old item
    view.rerender(<Page sidebar={false} />);
    expect(document.body).toHaveFocus();
  });
});

describe("pin commits and idempotence (#221 D8·D9, T39)", () => {
  beforeEach(() => {
    resetBoardForTests();
    resetBoardActionsForTests();
    mockedInvoke.mockReset();
    serve();
  });

  it("projects without a position are pinned all at once on first draw — rereading writes nothing more", async () => {
    show([folder("a", 1), folder("b", 2), folder("c", 3)]);
    await waitFor(() => expect(calls("set_folder_boards")).toHaveLength(1));
    const sent = (calls("set_folder_boards")[0]![1] as { boards: { id: string }[] }).boards;
    expect(sent.map((e) => e.id).sort()).toEqual(["a", "b", "c"]);
    await act(() => useLibraryStore.getState().refresh());
    await act(async () => {});
    expect(calls("set_folder_boards")).toHaveLength(1);
    expect(useBoardStore.getState().overlay).toEqual({});
  });

  it("when a project grows from outside, the neighbors' displaced positions are written", async () => {
    show([folder("a", 1, { board: { x: 0, y: 0 } }), folder("b", 1, { board: { x: 0, y: 400 } })]);
    await act(async () => {});
    expect(calls("set_folder_boards")).toHaveLength(0);
    disk = disk.map((f) => (f.id === "a" ? { ...f, diagrams: diagrams(4, "a-") } : f));
    await act(() => useLibraryStore.getState().refresh());
    await waitFor(() => expect(calls("set_folder_boards")).toHaveLength(1));
    expect((calls("set_folder_boards")[0]![1] as { boards: unknown[] }).boards).toEqual([
      { id: "b", board: { x: 0, y: 528 } },
    ]);
  });
});

describe("names and roles (#221 D20, T40)", () => {
  beforeEach(() => {
    resetBoardForTests();
    mockedInvoke.mockReset();
    serve();
  });

  it("board section, frame region, stack·card buttons, zoom island group", () => {
    show(placed());
    expect(board().tagName).toBe("SECTION");
    for (const name of ["Payments", "Onboarding", "Infrastructure"]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Expand Infrastructure" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: "New in Payments" })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );
    expect(screen.getByRole("button", { name: "More for Payments" })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );
  });
});
