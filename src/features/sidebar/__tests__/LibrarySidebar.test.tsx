import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSidebarStore } from "../../../shared/lib/sidebarLayout";
import { useDiagramStore } from "../../../shared/lib/store";
import { useThemeStore } from "../../../shared/lib/theme";
import { useToastStore } from "../../../shared/lib/toastStore";
import { useAppStore } from "../../library/appStore";
import { blankDoc, type FolderMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { useSettingsStore } from "../../settings/settingsStore";
import { openDocument, resetTabsForTests, showHomeTab } from "../../library/tabActions";
import { resetUnsavedGuardForTests } from "../../library/unsavedGuard";
import { resetAutosaveForTests } from "../../library/useAutosave";
import { HideSidebarButton, LibrarySidebar } from "../LibrarySidebar";
import { resetTreeForTests } from "../treeStore";

const mockedInvoke = vi.mocked(invoke);
const mockedOpen = vi.mocked(open);
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);

const library = (): FolderMeta[] => [
  {
    folders: [],
    id: "work",
    name: "Work",
    updatedAt: 1,
    diagrams: [{ id: "p1", title: "Login flow", updatedAt: 1, readable: true }],
  },
];
const sidebar = () => screen.getByRole("complementary", { name: "Library" });
const views = () => within(screen.getByRole("navigation", { name: "Views" }));

describe("docked sidebar (#217 R2, T28)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTreeForTests();
    resetTabsForTests();
    useLibraryStore.setState({ folders: library(), readFailed: false });
    useSidebarStore.setState({ hidden: false, width: 248, hinted: false, peek: false });
    useToastStore.getState().dismissAll();
    useThemeStore.getState().setTheme("light");
    mockedOpen.mockReset();
    mockedOpen.mockResolvedValue(null);
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_library") return library();
      if (cmd === "read_text_file") return JSON.stringify({ ...blankDoc(), title: "External" });
      return undefined;
    });
  });

  it("aside 'Library' — Views (Home·Recent), the PROJECTS tree, Open file… and theme at the bottom", () => {
    render(<LibrarySidebar />);
    const aside = sidebar();
    expect(
      views()
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Home", "Recent"]);
    expect(within(aside).getByRole("tree", { name: "Projects" })).toBeInTheDocument();
    expect(within(aside).getByRole("button", { name: "Add a project" })).toBeInTheDocument();
    expect(within(aside).getByRole("button", { name: "Open file…" })).toHaveAttribute(
      "aria-keyshortcuts",
    );
    expect(within(aside).getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
    // the gear between them opens Settings (#252)
    const gear = within(aside).getByRole("button", { name: /^Settings/ });
    expect(gear).toHaveAttribute("aria-haspopup", "dialog");
    expect(gear).toHaveAttribute("aria-keyshortcuts");
    fireEvent.click(gear);
    expect(useSettingsStore.getState().open).toBe(true);
    // keys from here must not reach the canvas (D27)
    expect(aside).toHaveClass("nodelete");
  });

  it("no brand row — the Views nav is the first child, starting 7 below the band (#231 D17, #236 D1, T3)", () => {
    render(<LibrarySidebar />);
    const aside = sidebar();
    expect(within(aside).queryByText("Dosik")).toBeNull();
    // the app icon is the brand: no mark or name row above the Views nav
    expect(aside.firstElementChild).toBe(screen.getByRole("navigation", { name: "Views" }));
    // 40 band + 7: the 30px Home row is y 47–77, centred on the Home header's axis (62)
    expect(aside).toHaveClass("pt-[7px]");
    expect(aside).not.toHaveClass("pt-2");
    const home = views().getByRole("button", { name: "Home" });
    expect(home).toHaveAttribute("aria-current", "page");
    // the house stays here (to the dashboard); the Library tab took the app glyph
    expect(home.querySelector("svg.lucide-house")).not.toBeNull();
    expect(home).toHaveTextContent(/^Home$/);
  });

  it("nav and Open file… rows are 30px·13px·icon 16, the theme button stays 28 (#236 R1, T6)", () => {
    render(<LibrarySidebar />);
    const aside = sidebar();
    for (const name of ["Home", "Recent", "Open file…"]) {
      const button = within(aside).getByRole("button", { name });
      expect(button).toHaveClass("h-[30px]", "text-[13px]");
      expect(button).not.toHaveClass("h-7");
      expect(button.querySelector("svg")).toHaveAttribute("width", "16");
    }
    // Open file… is an action: its icon stays grey, not a folder colour
    expect(
      within(aside).getByRole("button", { name: "Open file…" }).querySelector("svg"),
    ).toHaveClass("text-icon");
    expect(within(aside).getByRole("button", { name: "Switch to dark theme" })).toHaveClass("h-7");
  });

  it("sets no width and fills the space Frame gives — width is decided in one place only (D18)", () => {
    render(<LibrarySidebar />);
    expect(sidebar().style.width).toBe("");
    expect(sidebar()).toHaveClass("w-full");
  });

  describe("Views (D5·D6)", () => {
    it("the Home row is selected on the Home dashboard — not on a project screen or in the editor", () => {
      const { unmount } = render(<LibrarySidebar />);
      expect(views().getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
      expect(views().getByRole("button", { name: "Recent" })).not.toHaveAttribute("aria-current");
      unmount();
      showHomeTab({ kind: "folder", folder: "work" });
      render(<LibrarySidebar />);
      expect(views().getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");
    });

    it("Home row — from a project screen to the dashboard, from the editor to the Home tab (the document stays in its tab)", async () => {
      const user = userEvent.setup();
      showHomeTab({ kind: "folder", folder: "work" });
      render(<LibrarySidebar />);
      await user.click(views().getByRole("button", { name: "Home" }));
      expect(useAppStore.getState().homeView).toEqual({ kind: "dashboard" });
      act(() => {
        openDocument(blankDoc(), { projectId: "p1" });
      });
      await user.click(views().getByRole("button", { name: "Home" }));
      await waitFor(() => expect(useAppStore.getState().view).toBe("home"));
      expect(useDiagramStore.getState().projectId).toBeNull();
      expect(useAppStore.getState().tabs).toHaveLength(1);
    });

    it("Recent — goes to Home's Recent view and that row is selected (#220 D3·D10)", async () => {
      const user = userEvent.setup();
      showHomeTab({ kind: "folder", folder: "work" });
      render(<LibrarySidebar />);
      await user.click(views().getByRole("button", { name: "Recent" }));
      await waitFor(() =>
        expect(useAppStore.getState()).toMatchObject({
          view: "home",
          homeView: { kind: "recent" },
        }),
      );
      expect(views().getByRole("button", { name: "Recent" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(views().getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");
      // focus stays where the click left it — the sidebar (D16)
      expect(views().getByRole("button", { name: "Recent" })).toHaveFocus();
    });
  });

  it("Open file… — picks, opens, and says 'Diagram opened' (T23)", async () => {
    const user = userEvent.setup();
    mockedOpen.mockResolvedValue("/tmp/x.dosik.json");
    render(<LibrarySidebar />);
    await user.click(screen.getByRole("button", { name: "Open file…" }));
    await waitFor(() => expect(useAppStore.getState().view).toBe("editor"));
    expect(toasts()).toEqual(["Diagram opened"]);
  });

  it("toggles the theme", async () => {
    const user = userEvent.setup();
    render(<LibrarySidebar />);
    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(useThemeStore.getState().theme).toBe("dark");
  });
});

describe("Hide sidebar (#217 R4, D30)", () => {
  beforeEach(() => {
    localStorage.clear();
    useSidebarStore.setState({ hidden: false, hinted: false, peek: false, focusAfter: null });
    useToastStore.getState().dismissAll();
  });

  it("a tooltip with the shortcut; clicking hides it and toasts the first time — focus is handed to the Show button (T29)", async () => {
    const user = userEvent.setup();
    render(<HideSidebarButton />);
    const hide = screen.getByRole("button", { name: "Hide sidebar" });
    expect(hide).toHaveAttribute("aria-keyshortcuts", "Control+Backslash");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Hide sidebarCtrl+\\");
    await user.click(hide);
    expect(useSidebarStore.getState()).toMatchObject({ hidden: true, focusAfter: "show" });
    expect(toasts()).toEqual(["Sidebar hidden · Ctrl+\\ to show"]);
    expect(useToastStore.getState().toasts[0]?.keys).toBe("Ctrl+\\");
  });
});
