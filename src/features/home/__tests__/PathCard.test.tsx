import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeClipboardText } from "../../../shared/lib/systemClipboard";
import { useToastStore } from "../../../shared/lib/toastStore";
import { DASHBOARD, type HomeView } from "../../library/homeView";
import type { FolderMeta, ItemPath } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { resetTabsForTests, showHomeTab } from "../../library/tabActions";
import { HomeHeader } from "../HomeHeader";
import { type HomeMode, useHomeMode } from "../homeMode";
import { showInLabel } from "../../library/fileManager";
import { CLOSE_DELAY_MS, OPEN_DELAY_MS } from "../PathCard";

vi.mock("../../../shared/lib/systemClipboard", () => ({
  readClipboardText: vi.fn(async () => null),
  writeClipboardText: vi.fn(async () => true),
}));

const mockedInvoke = vi.mocked(invoke);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const now = Date.now();
const BASE = "/Users/u/Library/Application Support/app.dosik.desktop/projects";
const pathOf = (id: string): ItemPath => ({
  path: `${BASE}/${id}`,
  shown: `~/Library/Application Support/app.dosik.desktop/projects/${id}`,
});

const library = (): FolderMeta[] => [
  {
    id: "pay",
    name: "Payments",
    updatedAt: now,
    diagrams: [],
    folders: [{ id: "chk", name: "Checkout", updatedAt: now, diagrams: [], folders: [] }],
  },
  {
    id: "my-diagrams",
    name: "My Diagrams",
    updatedAt: now,
    stray: true,
    diagrams: [{ id: "old", title: "Old", updatedAt: now, readable: true }],
    folders: [],
  },
];

const show = (view: HomeView, mode: HomeMode = "cards") => {
  useHomeMode.setState({ mode, size: null });
  showHomeTab(view);
  return render(<HomeHeader />);
};
const step = () => screen.getByRole("heading", { level: 1 });
const card = () => screen.queryByRole("dialog", { name: /^Path of / });
/** the timers, then the answer that was waiting on them */
const wait = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await act(async () => {});
};
const hover = async (el: HTMLElement = step()) => {
  fireEvent.pointerEnter(el);
  await wait(OPEN_DELAY_MS);
};

/** the folder's real path, from Home's header row (#238 R3·R4, T7–T10, `Home-PathCard`) */
describe("header row path card (#238)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    useLibraryStore.setState({ folders: library(), readFailed: false });
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) =>
      cmd === "library_path" ? pathOf((args as { id: string }).id) : undefined,
    );
    vi.mocked(writeClipboardText).mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("card after resting 0.3s on the folder view's current name — the path is read when the rest starts (T7)", async () => {
    show({ kind: "folder", folder: "pay" });
    fireEvent.pointerEnter(step());
    expect(calls("library_path")).toEqual([["library_path", { kind: "folder", id: "pay" }]]);
    await wait(OPEN_DELAY_MS - 1);
    expect(card()).toBeNull();
    await wait(1);
    expect(card()).toHaveAccessibleName("Path of Payments");
    // the disk's names, from `~`; "/" in dash between the parts
    expect(card()).toHaveTextContent(
      "~/Library/Application Support/app.dosik.desktop/projects/pay",
    );
    expect(step()).toHaveClass("bg-hover");
  });

  it("the path wraps only after '/' — a segment (including '-' in an id) stays whole (R3)", async () => {
    show({ kind: "folder", folder: "pay" });
    await hover();
    const text = screen.getByRole("button", { name: showInLabel() }).querySelector("[id]")!;
    const parts = [...text.querySelectorAll(".whitespace-nowrap")].map((p) => p.textContent);
    expect(parts).toEqual([
      "~",
      "Library",
      "Application Support",
      "app.dosik.desktop",
      "projects",
      "pay",
    ]);
    // a break allowed after each "/", and nowhere else
    expect(text.querySelectorAll("wbr")).toHaveLength(parts.length - 1);
  });

  it("no card when leaving before 0.3s (T7)", async () => {
    show({ kind: "folder", folder: "pay" });
    fireEvent.pointerEnter(step());
    await wait(OPEN_DELAY_MS - 50);
    fireEvent.pointerLeave(step());
    await wait(500);
    expect(card()).toBeNull();
  });

  it("in nested folders·Canvas mode too — that folder's path (T7)", async () => {
    const { unmount } = show({ kind: "folder", folder: "chk" });
    await hover();
    expect(card()).toHaveAccessibleName("Path of Checkout");
    unmount();
    show({ kind: "folder", folder: "pay" }, "canvas");
    await hover();
    expect(card()).toHaveAccessibleName("Path of Payments");
  });

  it.each<[string, HomeView]>([
    ["dashboard", DASHBOARD],
    ["Recent", { kind: "recent" }],
    ["stray list — no folder on disk", { kind: "folder", folder: "my-diagrams" }],
  ])("no card on %s (T7)", async (_, view) => {
    show(view);
    expect(step()).not.toHaveClass("hover:bg-hover");
    await hover();
    expect(calls("library_path")).toEqual([]);
    expect(card()).toBeNull();
  });

  it("fixed on screen 4px below the name field, left-aligned", async () => {
    show({ kind: "folder", folder: "pay" });
    vi.spyOn(step(), "getBoundingClientRect").mockReturnValue(new DOMRect(300, 49, 90, 26));
    await hover();
    expect(card()).toHaveClass("fixed");
    expect(card()!.style.left).toBe("300px");
    expect(card()!.style.top).toBe("79px");
  });

  it("the path stays whole — not clipped at two lines, the button's description is the path (R3)", async () => {
    show({ kind: "folder", folder: "pay" });
    await hover();
    const open = screen.getByRole("button", { name: showInLabel() });
    expect(open.querySelector(".line-clamp-2")).toBeNull();
    // a screen reader hears the path too, not only the button's name
    expect(open).toHaveAccessibleDescription(
      "~/Library/Application Support/app.dosik.desktop/projects/pay",
    );
  });

  it("when the window lacks room on the right, the card shifts left to keep its width — 8 from the window edge (R3)", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    show({ kind: "folder", folder: "pay" });
    vi.spyOn(step(), "getBoundingClientRect").mockReturnValue(new DOMRect(700, 49, 90, 26));
    const box = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    box.mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "dialog"
        ? new DOMRect(0, 0, 600, 80)
        : new DOMRect(700, 49, 90, 26);
    });
    await hover();
    expect(card()!.style.left).toBe(`${1000 - 8 - 600}px`);
    expect(card()!.style.maxWidth).toBe("600px");
  });

  it("Windows paths (\\) also wrap only after the separator", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) =>
      cmd === "library_path"
        ? {
            path: "C:\\Users\\u\\AppData\\Roaming\\x\\projects\\pay",
            shown: "~/AppData\\Roaming\\x\\projects\\pay",
          }
        : undefined,
    );
    show({ kind: "folder", folder: "pay" });
    await hover();
    const text = screen.getByRole("button", { name: showInLabel() }).querySelector("[id]")!;
    expect([...text.querySelectorAll(".whitespace-nowrap")].map((p) => p.textContent)).toEqual([
      "~",
      "AppData",
      "Roaming",
      "x",
      "projects",
      "pay",
    ]);
    // each separator as the path wrote it
    expect(text.textContent).toBe("~/AppData\\Roaming\\x\\projects\\pay");
  });

  it("pressing the name field keeps the card (R3)", async () => {
    show({ kind: "folder", folder: "pay" });
    await hover();
    fireEvent.pointerDown(step());
    expect(card()).not.toBeNull();
  });

  it("moving onto the card keeps it, leaving both closes it after 0.15s (T8)", async () => {
    show({ kind: "folder", folder: "pay" });
    await hover();
    fireEvent.pointerLeave(step());
    await wait(CLOSE_DELAY_MS - 50);
    fireEvent.pointerEnter(card()!);
    await wait(500);
    expect(card()).not.toBeNull();
    fireEvent.pointerLeave(card()!);
    await wait(CLOSE_DELAY_MS);
    expect(card()).toBeNull();
    expect(step()).not.toHaveClass("bg-hover");
  });

  it("coming back to the name while open keeps it — no reread (T8)", async () => {
    show({ kind: "folder", folder: "pay" });
    await hover();
    fireEvent.pointerLeave(step());
    fireEvent.pointerEnter(step());
    await wait(500);
    expect(card()).not.toBeNull();
    expect(calls("library_path")).toHaveLength(1);
  });

  it("no card while editing the name — an open one closes too (R3)", async () => {
    show({ kind: "folder", folder: "pay" });
    await hover();
    fireEvent.click(screen.getByRole("button", { name: "More for Payments" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(card()).toBeNull();
    expect(screen.getByRole("textbox", { name: "Project name" })).toBeInTheDocument();
  });

  it("closes on Escape·outside press (T8)", async () => {
    show({ kind: "folder", folder: "pay" });
    await hover();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(card()).toBeNull();
    await hover();
    expect(card()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(card()).toBeNull();
  });

  it("closes when that folder is renamed while open — never shows the old name·path", async () => {
    show({ kind: "folder", folder: "pay" });
    await hover();
    const renamed = library().map((f) => (f.id === "pay" ? { ...f, name: "Billing" } : f));
    await act(async () => useLibraryStore.setState({ folders: renamed }));
    expect(card()).toBeNull();
  });

  it("closes when the window resizes — the position taken on open goes stale", async () => {
    show({ kind: "folder", folder: "pay" });
    await hover();
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(card()).toBeNull();
  });

  it("closes when going to another view (T8)", async () => {
    show({ kind: "folder", folder: "pay" });
    await hover();
    await act(async () => showHomeTab({ kind: "folder", folder: "chk" }));
    expect(card()).toBeNull();
  });

  it("the card's wording matches the menu, 'Show in …' — Show in Finder on macOS (D10)", async () => {
    const agent = vi
      .spyOn(navigator, "userAgent", "get")
      .mockReturnValue(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      );
    try {
      show({ kind: "folder", folder: "pay" });
      await hover();
      const open = screen.getByRole("button", { name: "Show in Finder" });
      expect(open).toHaveTextContent(/Show in Finder$/);
    } finally {
      agent.mockRestore();
    }
  });

  it("pressing the path shows that folder in Finder — the card closes (T9)", async () => {
    show({ kind: "folder", folder: "pay" });
    await hover();
    fireEvent.click(screen.getByRole("button", { name: showInLabel() }));
    expect(calls("show_in_finder")).toEqual([["show_in_finder", { kind: "folder", id: "pay" }]]);
    expect(card()).toBeNull();
  });

  it("Copy Path — absolute path to the clipboard, 'Path copied', the card closes (T9)", async () => {
    show({ kind: "folder", folder: "pay" });
    await hover();
    fireEvent.click(screen.getByRole("button", { name: "Copy Path" }));
    expect(card()).toBeNull();
    await act(async () => {});
    expect(writeClipboardText).toHaveBeenCalledWith(`${BASE}/pay`);
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(["Path copied"]);
  });

  it("when the path arrives late — no card if the user left or went to another folder meanwhile (T10)", async () => {
    let answer: (p: ItemPath) => void = () => {};
    mockedInvoke.mockImplementation((cmd: string) =>
      cmd === "library_path"
        ? new Promise<ItemPath>((r) => (answer = r))
        : Promise.resolve(undefined),
    );
    show({ kind: "folder", folder: "pay" });
    fireEvent.pointerEnter(step());
    await wait(OPEN_DELAY_MS);
    fireEvent.pointerLeave(step());
    await act(async () => answer(pathOf("pay")));
    await wait(500);
    expect(card()).toBeNull();
  });

  it("no stale card when going to another folder while the path is being read (T10)", async () => {
    let answer: (p: ItemPath) => void = () => {};
    mockedInvoke.mockImplementation((cmd: string) =>
      cmd === "library_path"
        ? new Promise<ItemPath>((r) => (answer = r))
        : Promise.resolve(undefined),
    );
    show({ kind: "folder", folder: "pay" });
    fireEvent.pointerEnter(step());
    await wait(OPEN_DELAY_MS);
    await act(async () => showHomeTab({ kind: "folder", folder: "chk" }));
    await act(async () => answer(pathOf("pay")));
    await wait(500);
    expect(card()).toBeNull();
  });

  it("no card and no toast when the path cannot be read (T10)", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "library_path") throw 'no such folder: "pay"';
      return undefined;
    });
    show({ kind: "folder", folder: "pay" });
    await hover();
    expect(card()).toBeNull();
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
