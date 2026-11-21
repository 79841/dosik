import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const crash = vi.hoisted(() => ({ home: false, sidebar: false }));
vi.mock("../features/home/Home", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/home/Home")>();
  return {
    ...actual,
    Home: () => {
      if (crash.home) throw new Error("boom: home failed");
      return actual.Home();
    },
  };
});
vi.mock("../features/sidebar/LibrarySidebar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/sidebar/LibrarySidebar")>();
  return {
    ...actual,
    LibrarySidebar: () => {
      if (crash.sidebar) throw new Error("boom: sidebar failed");
      return actual.LibrarySidebar();
    },
  };
});

/** how many times the canvas mounted — a tab switch must not remount it (#218 D23) */
const canvas = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("../features/canvas/DiagramCanvas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/canvas/DiagramCanvas")>();
  const { useEffect } = await import("react");
  return {
    ...actual,
    DiagramCanvas: () => {
      useEffect(() => {
        canvas.mounts += 1;
      }, []);
      return actual.DiagramCanvas();
    },
  };
});

import { App } from "../App";
import { useAppStore } from "../features/library/appStore";
import {
  activateTab,
  openDocument,
  resetTabsForTests,
  showHomeTab,
} from "../features/library/tabActions";
import { useLibraryStore } from "../features/library/libraryStore";
import { resetTreeForTests } from "../features/sidebar/treeStore";
import { makeDoc } from "../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../shared/lib/store";
import { useSidebarStore } from "../shared/lib/sidebarLayout";
import { useToastStore } from "../shared/lib/toastStore";

const band = () => document.querySelector("[data-chrome-band]") as HTMLElement | null;
/** the document tabs' tabpanel — the editor has the page tabs' one inside it too (#219) */
const sheet = () => document.getElementById("doc-panel") as HTMLElement;
const tabs = () =>
  within(screen.getByRole("tablist", { name: "Open documents" })).getAllByRole("tab");
/** classes that start a stacking context of their own */
const STARTS_STACKING = /(^|\s)(isolate|z-\S+|transform|-?translate-\S+|opacity-\S+)(\s|$)/;
const quietly = (run: () => void) => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    run();
  } finally {
    quiet.mockRestore();
  }
};

/** the window's assembly (#217 D19): band, sidebar │ sheet, peek */
describe("App — window (#217)", () => {
  beforeEach(() => {
    crash.home = false;
    crash.sidebar = false;
    canvas.mounts = 0;
    localStorage.clear();
    resetTreeForTests();
    // Home lists the library on mount; without this the shell under test
    // crashes on an undefined list instead of rendering
    vi.mocked(invoke).mockImplementation(async (cmd: string) =>
      cmd === "list_library" ? [] : undefined,
    );
    resetTabsForTests();
    useLibraryStore.setState({ folders: null, readFailed: false });
    useSidebarStore.setState({ hidden: false, width: 248, hinted: true, peek: false });
    useToastStore.getState().dismissAll();
  });

  it("Home: strip + docked sidebar + sheet — one Library tab, and the sheet is that tab's panel", async () => {
    render(<App />);
    expect(await screen.findByRole("main")).toBeInTheDocument();
    expect(band()).toHaveAttribute("data-tauri-drag-region", "deep");
    expect(screen.getByRole("complementary", { name: "Library" })).toBeInTheDocument();
    expect(tabs().map((t) => t.getAttribute("aria-label") ?? t.textContent)).toEqual(["Library"]);
    expect(sheet()).toHaveAttribute("aria-labelledby", "doc-tab-home");
    // the first tab is active: its fillet joins the sheet, whose corner stays square
    expect(sheet()).not.toHaveClass("rounded-tl-lg");
    // Home (features/home, #220) draws inside the Home tab's panel
    expect(within(sheet()).getByRole("main", { name: "Home" })).toBeInTheDocument();
    expect(within(sheet()).getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("off macOS the webview's own right-click menu never shows on Home — text fields keep theirs", async () => {
    render(<App />);
    await screen.findByRole("main");
    const onHome = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    within(sheet()).getByRole("main", { name: "Home" }).dispatchEvent(onHome);
    expect(onHome.defaultPrevented).toBe(true);
    const field = document.createElement("input");
    document.body.append(field);
    const onField = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    field.dispatchEvent(onField);
    expect(onField.defaultPrevented).toBe(false);
    field.remove();
  });

  it("Editor: Home + document tab; the sheet's top-left corner is rounded when docked and square when hidden (R7)", async () => {
    openDocument({ ...makeDoc([], []), title: "Orders flow" }, { projectId: "p1" });
    render(<App />);
    expect(await screen.findByRole("toolbar", { name: "Diagram actions" })).toBeInTheDocument();
    expect(tabs()).toHaveLength(2);
    expect(tabs()[1]).toHaveTextContent("Orders flow");
    // labelled by the active document's own tab (#218)
    expect(sheet()).toHaveAttribute("aria-labelledby", tabs()[1]!.id);
    expect(tabs()[1]!.id).toMatch(/^doc-tab-tab-\d+$/);
    expect(sheet()).toHaveClass("rounded-tl-lg");
    act(() => useSidebarStore.getState().hide());
    expect(sheet()).not.toHaveClass("rounded-tl-lg");
  });

  it("Switching between document tabs keeps the canvas; Home ↔ document unmounts and remounts the editor (#218 D23, T42)", async () => {
    openDocument({ ...makeDoc([], []), title: "Orders flow" }, { projectId: "p1" });
    openDocument({ ...makeDoc([], []), title: "Billing" }, { projectId: "p2" });
    render(<App />);
    expect(await screen.findByRole("toolbar", { name: "Diagram actions" })).toBeInTheDocument();
    expect(canvas.mounts).toBe(1);
    const [first] = useAppStore.getState().tabs;
    await act(() => activateTab(first!.id));
    // the toolbar has no title field since #219 — the active tab shows it
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[1]).toHaveTextContent("Orders flow");
    expect(canvas.mounts).toBe(1);
    act(() => showHomeTab());
    expect(screen.queryByRole("toolbar", { name: "Diagram actions" })).toBeNull();
    expect(tabs()).toHaveLength(3);
    await act(() => activateTab(first!.id));
    expect(await screen.findByRole("toolbar", { name: "Diagram actions" })).toBeInTheDocument();
    expect(canvas.mounts).toBe(2);
  });

  it("A tab change is saved to dosik.tabs — it comes back on relaunch (#218 D15)", async () => {
    render(<App />);
    await screen.findByRole("main");
    act(() => {
      openDocument({ ...makeDoc([], []), title: "Orders flow" }, { projectId: "p1" });
    });
    expect(JSON.parse(localStorage.getItem("dosik.tabs") ?? "null")).toEqual({
      v: 1,
      tabs: [{ projectId: "p1", title: "Orders flow" }],
      active: "p1",
    });
  });

  it("⌘\\ (Ctrl+\\ here) hides and shows the sidebar on Home too — a hidden sidebar leaves the DOM", async () => {
    render(<App />);
    await screen.findByRole("main");
    fireEvent.keyDown(window, { key: "\\", code: "Backslash", ctrlKey: true });
    expect(screen.queryByRole("complementary", { name: "Library" })).toBeNull();
    expect(screen.queryByRole("separator", { name: "Resize sidebar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show sidebar" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "\\", code: "Backslash", ctrlKey: true });
    expect(screen.getByRole("complementary", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize sidebar" })).toBeInTheDocument();
  });

  it("The sidebar slot is the visible width — the chosen width, as far as the window allows (D18)", async () => {
    // jsdom's window is 1024 wide: 1024 − 712 = 312 at most
    useSidebarStore.setState({ width: 300 });
    render(<App />);
    await screen.findByRole("main");
    const slot = () => screen.getByRole("complementary", { name: "Library" }).parentElement!;
    expect(slot().style.width).toBe("300px");
    act(() => useSidebarStore.setState({ width: 400 }));
    expect(slot().style.width).toBe("312px");
  });

  it("The editor's window drag handle is the strip only — not the toolbar row (#219 D21)", async () => {
    openDocument({ ...makeDoc([], []), title: "Orders flow" }, { projectId: "p1" });
    const { container } = render(<App />);
    expect(await screen.findByRole("toolbar", { name: "Diagram actions" })).toBeInTheDocument();
    const regions = [...container.querySelectorAll("[data-tauri-drag-region]")];
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) expect(band()?.contains(region)).toBe(true);
    // the docked width no longer rides down as a variable — nothing sizes by it (#219 D4)
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.style.getPropertyValue("--dsk-sidebar-room")).toBe("");
  });

  it("Docked sidebar row menus draw above the edge — only the sheet is isolated (#217)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) =>
      cmd === "list_library"
        ? [{ id: "work", name: "Work", updatedAt: 1, diagrams: [] }]
        : undefined,
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Work" }));
    const menu = screen.getByRole("menu", { name: "Work" });
    const edge = screen.getByRole("separator", { name: "Resize sidebar" }).parentElement!;
    // a menu opened at the row's `…` crosses the edge; both sit in the frame's
    // stacking context, so its z-50 beats the edge's z-30 — unless something
    // between them starts a context of its own and holds the menu under the edge
    expect(menu).toHaveClass("z-50");
    expect(edge).toHaveClass("z-30");
    for (let el = menu.parentElement; el && el !== edge.parentElement; el = el.parentElement) {
      expect(el.className).not.toMatch(STARTS_STACKING);
    }
    // the content's own layers (toolbar, chat, toasts) still stack inside the sheet
    expect(sheet()).toHaveClass("isolate");
  });

  it("There is only one toast, inside the sheet and outside the content boundary (T39)", async () => {
    render(<App />);
    await screen.findByRole("main");
    const regions = document.querySelectorAll("[aria-live=polite]");
    expect(regions).toHaveLength(1);
    expect(sheet()).toContainElement(regions[0] as HTMLElement);
  });

  it("When the content crashes, the strip, sidebar and toast remain so the window can still be dragged and closed (T5)", () => {
    crash.home = true;
    quietly(() => {
      render(<App />);
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      expect(band()).toHaveAttribute("data-tauri-drag-region", "deep");
      // jsdom's UA has no "Mac": this is the branch that draws the window's controls
      expect(within(band() as HTMLElement).getByRole("button", { name: "Close" })).toBeVisible();
      expect(screen.getByRole("complementary", { name: "Library" })).toBeInTheDocument();
      expect(document.querySelectorAll("[aria-live=polite]")).toHaveLength(1);
    });
  });

  describe("Data protection survives a content crash (#218)", () => {
    type CloseHandler = (event: { preventDefault: () => void }) => Promise<void>;
    let onClose: CloseHandler | null;
    const base = vi.mocked(getCurrentWindow).getMockImplementation()!;
    const baseListen = vi.mocked(listen).getMockImplementation()!;
    beforeEach(() => {
      onClose = null;
      vi.mocked(getCurrentWindow).mockImplementation(
        () =>
          ({
            ...base(),
            onCloseRequested: vi.fn(async (handler: CloseHandler) => {
              onClose = handler;
              return () => {};
            }),
          }) as never,
      );
    });
    afterEach(() => {
      vi.mocked(getCurrentWindow).mockImplementation(base);
      vi.mocked(listen).mockImplementation(baseListen);
    });

    it("Closing the window on the crash screen still asks about unsaved external tabs, and Cancel blocks it", async () => {
      openDocument(makeDoc([], []), { filePath: "/tmp/ext.dosik.json" });
      useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
      showHomeTab();
      crash.home = true;
      quietly(() => {
        render(<App />);
      });
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
      await waitFor(() => expect(onClose).not.toBeNull());
      const event = { preventDefault: vi.fn() };
      await onClose!(event);
      expect(vi.mocked(ask)).toHaveBeenCalledTimes(1);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });

    it("Bridge ops are still applied and answered on the crash screen — not dropped by a timeout", async () => {
      const handlers: Record<string, (event: { payload: unknown }) => void> = {};
      vi.mocked(listen).mockImplementation(async (name: string, handler: unknown) => {
        handlers[name] = handler as (event: { payload: unknown }) => void;
        return () => {};
      });
      crash.home = true;
      quietly(() => {
        render(<App />);
      });
      await waitFor(() => expect(handlers["agent:ops"]).toBeDefined());
      handlers["agent:ops"]!({
        payload: {
          requestId: "r1",
          ops: [{ op: "add_node", node: { id: "n1", label: "A", x: 0, y: 0 } }],
        },
      });
      await waitFor(() =>
        expect(vi.mocked(invoke)).toHaveBeenCalledWith(
          "agent_ops_result",
          expect.objectContaining({ requestId: "r1", applied: 1 }),
        ),
      );
      expect(useDiagramStore.getState().nodes.map((n) => n.id)).toEqual(["n1"]);
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });

    it("Tab changes are still saved to the session on the crash screen", () => {
      crash.home = true;
      quietly(() => {
        render(<App />);
      });
      act(() => {
        openDocument({ ...makeDoc([], []), title: "Orders flow" }, { projectId: "p1" });
      });
      expect(JSON.parse(localStorage.getItem("dosik.tabs") ?? "null")).toMatchObject({
        active: "p1",
      });
    });
  });

  it("Documents survive a sidebar crash — the sidebar has its own boundary", async () => {
    crash.sidebar = true;
    quietly(() => {
      render(<App />);
    });
    expect(await screen.findByRole("main")).toBeInTheDocument();
    // the crash screen stands in the sidebar's slot, beside the sheet — not in it
    const crashed = screen.getByText("Something went wrong");
    expect(sheet()).not.toContainElement(crashed);
    expect(sheet()).toContainElement(screen.getByRole("main"));
    expect(screen.queryByRole("complementary", { name: "Library" })).toBeNull();
    expect(band()).toBeInTheDocument();
  });
});
