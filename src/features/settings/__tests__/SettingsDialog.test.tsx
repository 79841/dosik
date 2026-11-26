import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, openUrlMock, versionMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openUrlMock: vi.fn(async () => {}),
  versionMock: vi.fn(async () => "0.1.0"),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: versionMock }));
const { clipboardMock } = vi.hoisted(() => ({
  clipboardMock: vi.fn(async (_text: string) => true),
}));
vi.mock("../../../shared/lib/systemClipboard", () => ({ writeClipboardText: clipboardMock }));

const { forgetPlatform, pretendMac, pretendWindows } = await import("../../../test/platform");
const { SettingsDialog } = await import("../SettingsDialog");
const { useSettingsStore, openSettings } = await import("../settingsStore");
const { useChatStore } = await import("../../ai/chatStore");
const { useAiStatusStore } = await import("../../ai/aiStatusStore");
const { useThemeStore } = await import("../../../shared/lib/theme");
const { useIntegrationsStore } = await import("../sections/IntegrationsSection");
const { useDiagramStore } = await import("../../../shared/lib/store");
const { FOCUS_FIELD } = await import("../../../shared/lib/palette");
const { handleCanvasKeyDown } = await import("../../canvas/canvasKeymap");
const { makeDoc, makeNode } = await import("../../../shared/lib/__tests__/testFixtures");
const { useLibraryStore } = await import("../../library/libraryStore");
const { useToastStore } = await import("../../../shared/lib/toastStore");
const { showNamedInLabel } = await import("../../library/fileManager");
type FolderMeta = import("../../library/libraryApi").FolderMeta;

/** what the Rust side answers, per command */
const answers: Record<string, unknown> = {};
const answer = (command: string, value: unknown) => {
  answers[command] = value;
};

// the suite reads as on a Mac; the Windows blocks say Windows
beforeEach(() => {
  pretendMac();
  localStorage.clear();
  // a stored key is checked as its group shows: no test may reach a vendor — the ones that look at a check stub their own
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("no network in tests");
    }),
  );
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    const value = answers[command];
    if (value instanceof Error) throw value;
    return value;
  });
  for (const key of Object.keys(answers)) delete answers[key];
  answer("claude_cli_status", { version: "2.1.4 (Claude Code)", signed_in: true });
  answer("codex_cli_status", { version: null, signed_in: null });
  answer("library_root", { path: "/Users/a/Dosik", shown: "~/Dosik" });
  useLibraryStore.setState({ folders: [], readFailed: false });
  useToastStore.getState().dismissAll();
  answer("bridge_status", { port: 4517, listening: true });
  useSettingsStore.setState({
    open: false,
    section: "General",
    lastSection: "General",
    returnTo: null,
    focus: null,
  });
  useAiStatusStore.setState({
    cli: { claude: { state: "unknown" }, openai: { state: "unknown" } },
    cliChecking: { claude: false, openai: false },
    key: { claude: { state: "unknown" }, openai: { state: "unknown" } },
    keyChecking: { claude: false, openai: false },
  });
  useIntegrationsStore.setState({ facts: null, bridge: null, busy: [] });
  useChatStore.setState({
    settings: {
      vendor: "claude",
      auths: { claude: "subscription", openai: "api-key" },
      keys: { claude: "", openai: "sk-test-7Qa2" },
      models: { claude: "claude-opus-5", openai: "gpt-5.6-sol" },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  forgetPlatform();
});

const dialog = () => screen.getByRole("dialog", { name: "Settings" });

/** what Rust reports for Integrations */
const SERVER = "/data/mcp/server/server.mjs";
const facts = (over: Record<string, unknown> = {}) => ({
  server: SERVER,
  serverProblem: null,
  node: { path: "/usr/local/bin/node", version: "v22.18.0" },
  claudeCode: {
    cli: true,
    registered: { command: "/usr/local/bin/node", args: [SERVER], commandFound: true },
  },
  claudeDesktop: { app: true, registered: null },
  codex: {
    config: "~/.codex/config.toml",
    registered: { command: "node", args: ["/old/server.mjs"], commandFound: true },
  },
  ...over,
});

describe("Settings dialog (#252)", () => {
  it("draws nothing while closed", () => {
    render(<SettingsDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens as a modal with the section list and the section's title", () => {
    render(<SettingsDialog />);
    act(() => openSettings("About"));
    expect(dialog()).toHaveAttribute("open");
    const nav = within(dialog()).getByRole("navigation", { name: "Settings sections" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["General", "AI assistant", "Integrations", "About"]);
    expect(within(nav).getByRole("button", { name: "About" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(dialog()).getByRole("heading", { level: 2, name: "About" })).toBeInTheDocument();
  });

  it("opens with the focus on the dialog itself — no item lit by a focus ring; Tab goes on to the list", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog />);
    act(() => openSettings("Integrations"));
    expect(dialog()).toHaveFocus();
    await user.tab();
    const nav = within(dialog()).getByRole("navigation", { name: "Settings sections" });
    expect(within(nav).getByRole("button", { name: "General" })).toHaveFocus();
  });

  it("keys pressed inside it never reach the canvas behind — Backspace there kept deleting the selection", () => {
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "a" })], []), null);
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
    window.addEventListener("keydown", handleCanvasKeyDown);
    try {
      render(<SettingsDialog />);
      act(() => openSettings("General"));
      const nav = within(dialog()).getByRole("button", { name: "General" });
      nav.focus();
      fireEvent.keyDown(nav, { key: "Backspace" });
      expect(useDiagramStore.getState().nodes).toHaveLength(1);
    } finally {
      window.removeEventListener("keydown", handleCanvasKeyDown);
    }
  });

  it("the side list switches the section", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog />);
    act(() => openSettings());
    await user.click(within(dialog()).getByRole("button", { name: "About" }));
    expect(within(dialog()).getByRole("heading", { level: 2, name: "About" })).toBeInTheDocument();
    expect(useSettingsStore.getState().section).toBe("About");
  });

  it("Escape, × and a press on the scrim close it, and focus goes back to the opener", async () => {
    const user = userEvent.setup();
    const opener = document.createElement("button");
    document.body.append(opener);
    render(<SettingsDialog />);
    for (const how of ["escape", "close", "scrim"] as const) {
      opener.focus();
      act(() => openSettings());
      if (how === "escape") fireEvent.keyDown(dialog(), { key: "Escape" });
      if (how === "close") await user.click(screen.getByRole("button", { name: "Close settings" }));
      if (how === "scrim") fireEvent.mouseDown(dialog());
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(opener).toHaveFocus();
    }
    opener.remove();
  });

  it("its groups sit on the pane — no card: nothing drawn around the rows, nor inset from the head", async () => {
    answer("plugins_status", facts());
    answer("bridge_status", { port: 4517, listening: false });
    // signed out, so the install steps under the CLI row are drawn too
    answer("claude_cli_status", { version: "2.1.4 (Claude Code)", signed_in: false });
    render(<SettingsDialog />);
    // a card is a raised surface with the card radius — anywhere in the group, around all its rows or some
    const CARD = '[class*="shadow-raised"], [class*="radius-card"]';
    // nor any surface, radius or shadow, or side inset, between a group and its words or its hairlines
    const AROUND = /^(bg-|rounded|shadow-|-?(p|px|pl|pr|ps|pe|m|mx|ml|mr|ms|me)-(?!0$))/;
    const cardLook = (name: string) => {
      const group = within(dialog()).getByRole("region", { name });
      const found = group.matches(CARD) ? [group] : [...group.querySelectorAll(CARD)];
      const drawn = found.map((el) => el.className);
      for (const inner of group.querySelectorAll("p, h3, [aria-hidden='true'].bg-line")) {
        for (
          let el: Element | null = inner;
          el && el !== group.parentElement;
          el = el.parentElement
        ) {
          // a hairline is a bg-line rule; it is the only fill allowed on the way
          drawn.push(...[...el.classList].filter((c) => AROUND.test(c) && c !== "bg-line"));
        }
      }
      // groups stand 20 apart (About has one)
      if (group.parentElement?.querySelectorAll(":scope > section").length !== 1) {
        expect(group.parentElement).toHaveClass("gap-5");
      }
      return [...new Set(drawn)];
    };
    useLibraryStore.setState({ folders: shelf() });
    act(() => openSettings("General"));
    expect(cardLook("Appearance")).toEqual([]);
    expect(cardLook("Library")).toEqual([]);
    expect(cardLook("Folders in the library")).toEqual([]);
    act(() => openSettings("AI assistant"));
    const claude = within(dialog()).getByRole("region", { name: "Claude" });
    await within(claude).findByText("Not signed in");
    expect(cardLook("Claude")).toEqual([]);
    expect(cardLook("GPT")).toEqual([]);
    // a vendor's head is its name; the maker stands beside it
    expect(within(claude).getByRole("heading", { level: 3, name: "Claude" })).toBeInTheDocument();
    expect(claude).not.toHaveAttribute("aria-label");
    expect(within(claude).getByText("Anthropic")).toBeInTheDocument();
    act(() => openSettings("Integrations"));
    await within(dialog()).findByRole("region", { name: "AI apps" });
    expect(cardLook("Warning")).toEqual([]);
    expect(cardLook("AI apps")).toEqual([]);
    act(() => openSettings("About"));
    expect(cardLook("Dosik")).toEqual([]);
  });

  it("stays open under StrictMode — the effect's second run must not close it (#252)", () => {
    render(<SettingsDialog />, { reactStrictMode: true });
    act(() => openSettings("General"));
    expect(screen.getByRole("dialog", { name: "Settings" })).toHaveAttribute("open");
    expect(useSettingsStore.getState().open).toBe(true);
  });

  it("a press inside the box does not close it", () => {
    render(<SettingsDialog />);
    act(() => openSettings());
    fireEvent.mouseDown(within(dialog()).getByRole("heading", { level: 1, name: "Settings" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("General", () => {
  it("the theme segments set Light / Dark / System", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    const theme = within(dialog()).getByRole("radiogroup", { name: "Theme" });
    await user.click(within(theme).getByRole("radio", { name: "Dark" }));
    expect(useThemeStore.getState().preference).toBe("dark");
    expect(within(theme).getByRole("radio", { name: "Dark" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(within(theme).getByRole("radio", { name: "System" }));
    expect(useThemeStore.getState().preference).toBe("system");
  });

  it("a segmented control is one Tab stop; arrows move and pick", async () => {
    const user = userEvent.setup();
    useThemeStore.getState().setPreference("light");
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    const theme = within(dialog()).getByRole("radiogroup", { name: "Theme" });
    const radios = within(theme).getAllByRole("radio");
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    radios[0]!.focus();
    await user.keyboard("{ArrowRight}");
    expect(useThemeStore.getState().preference).toBe("dark");
    expect(within(theme).getByRole("radio", { name: "Dark" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(useThemeStore.getState().preference).toBe("system");
  });

  it("groups the theme under Appearance, the default location under Library, then the folders in the library (#256)", () => {
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    expect(
      within(dialog())
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(["Appearance", "Library", "Folders in the library"]);
    const appearance = within(dialog()).getByRole("region", { name: "Appearance" });
    expect(within(appearance).getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    const library = within(dialog()).getByRole("region", { name: "Library" });
    expect(within(library).getByText("Default location")).toBeInTheDocument();
    const folders = within(dialog()).getByRole("region", { name: "Folders in the library" });
    // named by its head, so a screen reader says the name once, not as a label and again as a heading
    for (const group of [appearance, library, folders]) {
      expect(group).not.toHaveAttribute("aria-label");
      const head = document.getElementById(group.getAttribute("aria-labelledby") ?? "");
      expect(head?.tagName).toBe("H3");
    }
  });
});

/** a library: two projects in the default location, one added from elsewhere, one added and not found */
const shelf = (): FolderMeta[] => [
  { id: "pay", name: "Payments", updatedAt: 1, diagrams: [], folders: [] },
  {
    id: "client",
    name: "client-diagrams",
    updatedAt: 1,
    diagrams: [],
    folders: [],
    added: true,
    path: "/Users/a/Work/client-diagrams",
    shown: "~/Work/client-diagrams",
  },
  { id: "sk", name: "Sketches", updatedAt: 1, diagrams: [], folders: [] },
  {
    id: "arc",
    name: "architecture",
    updatedAt: 0,
    diagrams: [],
    folders: [],
    added: true,
    missing: true,
    path: "/Users/a/Projects/platform/docs/architecture",
    shown: "~/Projects/platform/docs/architecture",
  },
];

describe("General ▸ Library (#256 R2)", () => {
  /** Show in Finder, as each row names it: the folder in it (#256) */
  const showIn = (name: string) => showNamedInLabel(name);
  const library = () => within(dialog()).getByRole("region", { name: "Library" });
  const folders = () => within(dialog()).getByRole("region", { name: "Folders in the library" });
  /** a row of a group by its title: the 52px line that holds it */
  const rowOf = (group: HTMLElement, title: string) =>
    within(group).getByText(title, { selector: "p" }).closest(".min-h-\\[52px\\]") as HTMLElement;
  /** what a row says under its title */
  const description = (row: HTMLElement) => row.querySelector("p + p")?.textContent;
  /** a row's controls, left to right, as their names and words */
  const controls = (row: HTMLElement) =>
    [...(row.lastElementChild?.children ?? [])].map(
      (el) => el.getAttribute("aria-label") ?? el.textContent,
    );
  const toasts = () => useToastStore.getState().toasts.map((t) => t.text);
  /** what the default location's row says, once it is there */
  const homeLine = async () => {
    await within(folders()).findByText("Dosik", { selector: "p" });
    return description(rowOf(folders(), "Dosik"));
  };

  beforeEach(() => {
    useLibraryStore.setState({ folders: shelf() });
  });

  it("Default location: where new projects go, with ~, and Change…", async () => {
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    const row = rowOf(library(), "Default location");
    await waitFor(() => expect(description(row)).toBe("New projects go here — ~/Dosik"));
    // the path in the diagram font
    expect(within(row).getByText("~/Dosik").tagName).toBe("CODE");
    expect(controls(row)).toEqual(["Change…"]);
  });

  it("the folders: the default location first with its projects, then each one added, then the ones not found, then Add folder…", async () => {
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    const group = folders();
    await within(group).findByText("Dosik", { selector: "p" });
    const titles = [...group.querySelectorAll(".min-h-\\[52px\\] > div > p:first-child")].map(
      (p) => p.textContent,
    );
    expect(titles).toEqual(["Dosik", "client-diagrams", "architecture"]);
    const home = rowOf(group, "Dosik");
    expect(description(home)).toBe("~/Dosik · 2 projects");
    expect(controls(home)).toEqual(["Default", showIn("Dosik")]);
    const added = rowOf(group, "client-diagrams");
    expect(description(added)).toBe("~/Work/client-diagrams");
    expect(controls(added)).toEqual([showIn("client-diagrams"), "Remove client-diagrams"]);
    const lost = rowOf(group, "architecture");
    expect(description(lost)).toBe("~/Projects/platform/docs/architecture");
    expect(controls(lost)).toEqual(["Not found", "Locate architecture", "Remove architecture"]);
    // Add folder… closes the group, after a hairline like every row
    const buttons = within(group).getAllByRole("button");
    expect(buttons.at(-1)).toHaveTextContent("Add folder…");
    expect(buttons.at(-1)?.parentElement?.previousElementSibling).toHaveClass("bg-line");
  });

  it("counts only the default location's projects it finds", async () => {
    useLibraryStore.setState({
      folders: [
        ...shelf(),
        { id: "lost", name: "Lost", updatedAt: 0, diagrams: [], folders: [], missing: true },
      ],
    });
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    expect(await homeLine()).toBe("~/Dosik · 2 projects");
  });

  it("Show in Finder opens the default location, or the folder by id", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    await within(folders()).findByText("Dosik", { selector: "p" });
    await user.click(within(folders()).getByRole("button", { name: showIn("Dosik") }));
    expect(invokeMock).toHaveBeenLastCalledWith("show_library_in_finder");
    await user.click(within(folders()).getByRole("button", { name: showIn("client-diagrams") }));
    expect(invokeMock).toHaveBeenLastCalledWith("show_in_finder", { kind: "folder", id: "client" });
  });

  it("Remove takes the folder out of the library at once — its files stay; the row goes and the focus stays in the group", async () => {
    const user = userEvent.setup();
    answer(
      "list_library",
      shelf().filter((f) => f.id !== "client"),
    );
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    await user.click(within(folders()).getByRole("button", { name: "Remove client-diagrams" }));
    await waitFor(() => expect(within(folders()).queryByText("client-diagrams")).toBeNull());
    expect(invokeMock).toHaveBeenCalledWith("remove_project", { id: "client" });
    expect(invokeMock).not.toHaveBeenCalledWith("delete_folder", expect.anything());
    expect(within(folders()).getByRole("button", { name: "Add folder…" })).toHaveFocus();
    expect(toasts()).toEqual([]);
  });

  it("Locate… goes to Rust by id; one already in the library says so", async () => {
    const user = userEvent.setup();
    answer("locate_project", "already");
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    await user.click(within(folders()).getByRole("button", { name: "Locate architecture" }));
    await waitFor(() => expect(toasts()).toEqual(["Already in the library"]));
    expect(invokeMock).toHaveBeenCalledWith("locate_project", { id: "arc" });
  });

  it("Locate… that found it — the focus goes to the row it moved to, its Show in Finder", async () => {
    const user = userEvent.setup();
    answer("locate_project", "located");
    answer(
      "list_library",
      shelf().map((f) =>
        f.id === "arc"
          ? {
              ...f,
              missing: false,
              path: "/Users/a/Found/architecture",
              shown: "~/Found/architecture",
            }
          : f,
      ),
    );
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    await user.click(within(folders()).getByRole("button", { name: "Locate architecture" }));
    await waitFor(() =>
      expect(within(folders()).getByRole("button", { name: showIn("architecture") })).toHaveFocus(),
    );
    expect(description(rowOf(folders(), "architecture"))).toBe("~/Found/architecture");
  });

  it("Locate… that found it, but the listing no longer has it — the focus goes to Add folder…", async () => {
    const user = userEvent.setup();
    answer("locate_project", "located");
    answer(
      "list_library",
      shelf().filter((f) => f.id !== "arc"),
    );
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    await user.click(within(folders()).getByRole("button", { name: "Locate architecture" }));
    await waitFor(() =>
      expect(within(folders()).getByRole("button", { name: "Add folder…" })).toHaveFocus(),
    );
  });

  it("Add folder… — as in the sidebar: the folder picked joins and shows as a row", async () => {
    const user = userEvent.setup();
    const joined: FolderMeta = {
      id: "repo",
      name: "dosik",
      updatedAt: 1,
      diagrams: [],
      folders: [],
      added: true,
      path: "/Users/a/code/dosik",
      shown: "~/code/dosik",
    };
    answer("add_library_folder", { kind: "added", id: "repo" });
    answer("list_library", [joined, ...shelf()]);
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    await user.click(within(folders()).getByRole("button", { name: "Add folder…" }));
    expect(await within(folders()).findByText("dosik", { selector: "p" })).toBeInTheDocument();
    expect(description(rowOf(folders(), "dosik"))).toBe("~/code/dosik");
    answer("add_library_folder", { kind: "invalid" });
    await user.click(within(folders()).getByRole("button", { name: "Add folder…" }));
    await waitFor(() => expect(toasts()).toEqual(["Choose another folder"]));
  });

  it("Change… — the new default location shows once Rust has it; the old one's projects stay as rows of their own", async () => {
    const user = userEvent.setup();
    answer("change_default_location", "changed");
    const moved = shelf().map((f) =>
      f.added ? f : { ...f, added: true, shown: `~/Dosik/${f.name}` },
    );
    answer("list_library", [
      { id: "n", name: "Notes", updatedAt: 1, diagrams: [], folders: [] },
      ...moved,
    ]);
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    expect(await homeLine()).toBe("~/Dosik · 2 projects");
    answer("library_root", { path: "/Users/a/Dropbox/Dosik", shown: "~/Dropbox/Dosik" });
    await user.click(within(library()).getByRole("button", { name: "Change…" }));
    await waitFor(() =>
      expect(description(rowOf(library(), "Default location"))).toBe(
        "New projects go here — ~/Dropbox/Dosik",
      ),
    );
    const home = rowOf(folders(), "Dosik");
    expect(description(home)).toBe("~/Dropbox/Dosik · 1 project");
    expect(within(folders()).getByText("Payments", { selector: "p" })).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("change_default_location");
  });

  it("Change… shows the new default location even when listing the library after it fails", async () => {
    const user = userEvent.setup();
    answer("change_default_location", "changed");
    answer("list_library", new Error("the library could not be read"));
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    expect(await homeLine()).toBe("~/Dosik · 2 projects");
    answer("library_root", { path: "/Users/a/Dropbox/Dosik", shown: "~/Dropbox/Dosik" });
    await user.click(within(library()).getByRole("button", { name: "Change…" }));
    await waitFor(() =>
      expect(description(rowOf(library(), "Default location"))).toBe(
        "New projects go here — ~/Dropbox/Dosik",
      ),
    );
    expect(toasts()).toContain("Error: the library could not be read");
  });

  it("Change… or Add folder… pressed while a folder picker is up opens no second one", async () => {
    const user = userEvent.setup();
    let close: (answer: unknown) => void = () => undefined;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "change_default_location") return new Promise((r) => (close = r));
      const value = answers[command];
      if (value instanceof Error) throw value;
      return value;
    });
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    await user.click(within(library()).getByRole("button", { name: "Change…" }));
    await user.click(within(library()).getByRole("button", { name: "Change…" }));
    await user.click(within(folders()).getByRole("button", { name: "Add folder…" }));
    const picks = (name: string) => invokeMock.mock.calls.filter(([c]) => c === name).length;
    expect(picks("change_default_location")).toBe(1);
    expect(picks("add_library_folder")).toBe(0);
    await act(async () => close("cancelled"));
    expect(toasts()).toEqual([]);
  });

  it("Change… cancelled leaves everything as it was", async () => {
    const user = userEvent.setup();
    answer("change_default_location", "cancelled");
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    expect(await homeLine()).toBe("~/Dosik · 2 projects");
    const reads = invokeMock.mock.calls.filter(([c]) => c === "library_root").length;
    await user.click(within(library()).getByRole("button", { name: "Change…" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("change_default_location"));
    expect(invokeMock.mock.calls.filter(([c]) => c === "library_root")).toHaveLength(reads);
    expect(invokeMock).not.toHaveBeenCalledWith("list_library");
  });

  it("a value still on its way keeps its line: the rows do not jump when it comes", () => {
    invokeMock.mockImplementation(
      (command: string) =>
        new Promise((resolve) => {
          if (command !== "library_root") resolve(answers[command]);
        }),
    );
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    const row = rowOf(library(), "Default location");
    expect(description(row)).toBe("");
    expect(row.querySelector("p + p")).toHaveClass("min-h-[15px]");
  });

  it("follows the library while open — a folder added or removed elsewhere shows", async () => {
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    await within(folders()).findByText("client-diagrams", { selector: "p" });
    act(() => useLibraryStore.setState({ folders: shelf().filter((f) => f.id !== "client") }));
    expect(within(folders()).queryByText("client-diagrams")).toBeNull();
    expect(await homeLine()).toBe("~/Dosik · 2 projects");
  });

  it("lists the library when nothing has listed it yet", async () => {
    useLibraryStore.setState({ folders: null });
    answer("list_library", shelf());
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    expect(
      await within(folders()).findByText("client-diagrams", { selector: "p" }),
    ).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("list_library");
  });
});

describe("AI assistant", () => {
  it("a signed-in CLI reads Signed in with its version; a missing one shows how to install it", async () => {
    useChatStore.setState((s) => ({
      settings: { ...s.settings, auths: { claude: "subscription", openai: "subscription" } },
    }));
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const claude = within(dialog()).getByRole("region", { name: "Claude" });
    expect(await within(claude).findByText("Signed in")).toBeInTheDocument();
    expect(within(claude).getByText("CLI 2.1.4 on this Mac")).toBeInTheDocument();
    const gpt = within(dialog()).getByRole("region", { name: "GPT" });
    expect(await within(gpt).findByText("Not installed")).toBeInTheDocument();
    expect(within(gpt).getByText("npm i -g @openai/codex")).toBeInTheDocument();
    expect(within(gpt).getByText("codex login")).toBeInTheDocument();
  });

  it("an install step's copy button copies the command and says so — or that it could not", async () => {
    const user = userEvent.setup();
    useChatStore.setState((s) => ({
      settings: { ...s.settings, auths: { claude: "subscription", openai: "subscription" } },
    }));
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const gpt = within(dialog()).getByRole("region", { name: "GPT" });
    await within(gpt).findByText("Not installed");
    clipboardMock.mockResolvedValueOnce(true);
    await user.click(within(gpt).getByRole("button", { name: "Copy npm i -g @openai/codex" }));
    expect(clipboardMock).toHaveBeenCalledWith("npm i -g @openai/codex");
    expect(await within(dialog()).findByText("Copied")).toBeInTheDocument();
    clipboardMock.mockResolvedValueOnce(false);
    await user.click(within(gpt).getByRole("button", { name: "Copy codex login" }));
    expect(await within(dialog()).findByText("Could not copy")).toBeInTheDocument();
  });

  it("a CLI found but signed out says so, with the sign-in command", async () => {
    answer("claude_cli_status", { version: "2.1.4", signed_in: false });
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const claude = within(dialog()).getByRole("region", { name: "Claude" });
    expect(await within(claude).findByText("Not signed in")).toBeInTheDocument();
    expect(within(claude).getByText("claude")).toBeInTheDocument();
  });

  it("a CLI not asked yet reads Checking…; checking again keeps the result and only the button turns busy", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    invokeMock.mockImplementation(async (command: string) =>
      command === "claude_cli_status" ? new Promise((r) => (finish = r)) : answers[command],
    );
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const claude = within(dialog()).getByRole("region", { name: "Claude" });
    expect(within(claude).getByText("Looking for Claude Code on this Mac")).toBeInTheDocument();
    expect(within(claude).getByRole("status")).toHaveTextContent("Checking…");
    await act(async () => finish({ version: "2.1.4", signed_in: false }));
    expect(within(claude).getByText("Not signed in")).toBeInTheDocument();
    await user.click(within(claude).getByRole("button", { name: "Check again" }));
    const checking = within(claude).getByRole("button", { name: "Checking…" });
    expect(checking).toHaveAttribute("aria-busy", "true");
    expect(within(claude).getByText("Not signed in")).toBeInTheDocument();
    await act(async () => finish({ version: "2.1.4", signed_in: true }));
    expect(within(claude).getByText("Signed in")).toBeInTheDocument();
  });

  it("a check again that changes the row's control hands the keyboard to the new one", async () => {
    const user = userEvent.setup();
    answer("claude_cli_status", { version: "2.1.4", signed_in: false });
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const claude = within(dialog()).getByRole("region", { name: "Claude" });
    await within(claude).findByText("Not signed in");
    answer("claude_cli_status", { version: "2.1.4", signed_in: true });
    await user.click(within(claude).getByRole("button", { name: "Check again" }));
    await within(claude).findByText("Signed in");
    // the text button became the icon button — the focus went with it, not to the page
    expect(within(claude).getByRole("button", { name: "Check again" })).toHaveFocus();
  });

  it("an answer that lands after the keyboard went elsewhere leaves it there", async () => {
    const user = userEvent.setup();
    answer("claude_cli_status", { version: "2.1.4", signed_in: false });
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const claude = within(dialog()).getByRole("region", { name: "Claude" });
    await within(claude).findByText("Not signed in");
    let finish: (value: unknown) => void = () => {};
    invokeMock.mockImplementation(async (command: string) =>
      command === "claude_cli_status" ? new Promise((r) => (finish = r)) : answers[command],
    );
    within(claude).getByRole("button", { name: "Check again" }).focus();
    await user.keyboard("{Enter}");
    const gpt = within(dialog()).getByRole("region", { name: "GPT" });
    within(gpt).getByRole("button", { name: "Replace" }).focus();
    await act(async () => finish({ version: "2.1.4", signed_in: true }));
    expect(within(claude).getByText("Signed in")).toBeInTheDocument();
    expect(within(gpt).getByRole("button", { name: "Replace" })).toHaveFocus();
  });

  it("the connection segment changes that vendor alone", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const claude = within(dialog()).getByRole("region", { name: "Claude" });
    await user.click(within(claude).getByRole("radio", { name: "API key" }));
    expect(useChatStore.getState().settings.auths).toEqual({
      claude: "api-key",
      openai: "api-key",
    });
    expect(within(claude).getByLabelText("Anthropic API key")).toBeInTheDocument();
  });

  it("the key field wears the 1px field ring in focus, as every filled field does", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const claude = within(dialog()).getByRole("region", { name: "Claude" });
    await user.click(within(claude).getByRole("radio", { name: "API key" }));
    expect(within(claude).getByLabelText("Anthropic API key")).toHaveClass(
      ...FOCUS_FIELD.split(" "),
    );
  });

  it("a stored key shows its end, Replace and Remove; Check asks the vendor", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const gpt = within(dialog()).getByRole("region", { name: "GPT" });
    expect(within(gpt).getByText("sk-…7Qa2")).toBeInTheDocument();
    // a key from before is checked once on its own
    expect(await within(gpt).findByText("Key works")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(within(gpt).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await within(gpt).findByText("Key works")).toBeInTheDocument();
    await user.click(within(gpt).getByRole("button", { name: "Remove" }));
    expect(useChatStore.getState().settings.keys.openai).toBe("");
    expect(within(gpt).getByLabelText("OpenAI API key")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("a stored key is checked each time its group shows — first with no result, then over the last one", async () => {
    const user = userEvent.setup();
    const answers: ((r: Response) => void)[] = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => answers.push(resolve)));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    let gpt = within(dialog()).getByRole("region", { name: "GPT" });
    // no result yet: the CLI's first-check pattern, no button to press
    expect(within(gpt).getByText("Asking OpenAI about this key")).toBeInTheDocument();
    expect(within(gpt).getByText("Checking…")).toBeInTheDocument();
    expect(within(gpt).queryByRole("button", { name: /Check/ })).toBeNull();
    await act(async () => answers[0]!(new Response("{}", { status: 200 })));
    expect(within(gpt).getByText("Key works")).toBeInTheDocument();
    // shown again: asked again, the result stays while it runs
    act(() => useSettingsStore.getState().closeSettings());
    act(() => openSettings("AI assistant"));
    gpt = within(dialog()).getByRole("region", { name: "GPT" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(within(gpt).getByText("Key works")).toBeInTheDocument();
    const busy = within(gpt).getByRole("button", { name: "Checking…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    // a press on a busy button waits
    await user.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => answers[1]!(new Response("{}", { status: 401 })));
    expect(within(gpt).getByText("Key rejected")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("a replaced key starts with no result — the old key's verdict is not shown for it", async () => {
    const user = userEvent.setup();
    const answers: ((r: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => answers.push(resolve))),
    );
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const gpt = within(dialog()).getByRole("region", { name: "GPT" });
    await act(async () => answers[0]!(new Response("{}", { status: 200 })));
    expect(within(gpt).getByText("Key works")).toBeInTheDocument();
    await user.click(within(gpt).getByRole("button", { name: "Replace" }));
    // Enter saves — and stays saved: the key's press must not go on to the Replace button the focus moved to
    await user.type(within(gpt).getByLabelText("OpenAI API key"), "sk-other-9zzz{Enter}");
    expect(within(gpt).getByRole("button", { name: "Replace" })).toHaveFocus();
    expect(within(gpt).getByText("Asking OpenAI about this key")).toBeInTheDocument();
    expect(within(gpt).queryByText("Key works")).toBeNull();
    await act(async () => answers[1]!(new Response("{}", { status: 401 })));
    expect(within(gpt).getByText("Key rejected")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("Replace and Remove hand the keyboard to the field; Cancel hands it back and keeps the key", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const gpt = within(dialog()).getByRole("region", { name: "GPT" });
    await within(gpt).findByText("Key works");
    await user.click(within(gpt).getByRole("button", { name: "Replace" }));
    expect(within(gpt).getByLabelText("OpenAI API key")).toHaveFocus();
    await user.type(within(gpt).getByLabelText("OpenAI API key"), "sk-half");
    await user.click(within(gpt).getByRole("button", { name: "Cancel" }));
    expect(useChatStore.getState().settings.keys.openai).toBe("sk-test-7Qa2");
    expect(within(gpt).getByRole("button", { name: "Replace" })).toHaveFocus();
    await user.click(within(gpt).getByRole("button", { name: "Remove" }));
    expect(within(gpt).getByLabelText("OpenAI API key")).toHaveFocus();
    // a first key has nothing to cancel back to
    expect(within(gpt).queryByRole("button", { name: "Cancel" })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("a check that cannot reach the vendor says so, and why", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Load failed");
      }),
    );
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const gpt = within(dialog()).getByRole("region", { name: "GPT" });
    expect(await within(gpt).findByText("Could not check")).toBeInTheDocument();
    expect(within(gpt).getByText("No connection")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("Save is off until a key is typed; saving stores it and checks it", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    useChatStore.setState((s) => ({
      settings: { ...s.settings, keys: { claude: "", openai: "" } },
    }));
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const gpt = within(dialog()).getByRole("region", { name: "GPT" });
    const save = within(gpt).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.type(within(gpt).getByLabelText("OpenAI API key"), "sk-new-abcd");
    // the typed key never sits in the page's markup
    expect(dialog().outerHTML).not.toContain("sk-new-abcd");
    await user.click(save);
    expect(useChatStore.getState().settings.keys.openai).toBe("sk-new-abcd");
    expect(await within(gpt).findByText("Key rejected")).toBeInTheDocument();
    expect(within(gpt).getByRole("button", { name: "Replace" })).toHaveFocus();
    vi.unstubAllGlobals();
  });

  it("asked to land on the key field, it takes the focus", async () => {
    useChatStore.setState((s) => ({
      settings: { ...s.settings, auths: { claude: "api-key", openai: "api-key" } },
    }));
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant", { focus: "key-claude" }));
    await waitFor(() => expect(screen.getByLabelText("Anthropic API key")).toHaveFocus());
    expect(useSettingsStore.getState().focus).toBeNull();
  });
});

describe("General — when the library location cannot be read", () => {
  it("says why at the bottom instead of leaving the row blank", async () => {
    answer("library_root", new Error("library unavailable"));
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    expect(await within(dialog()).findByText(/library unavailable/)).toBeInTheDocument();
  });
});

describe("About", () => {
  it("the version, the notices and the source", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog />);
    act(() => openSettings("About"));
    expect(await within(dialog()).findByText("Version 0.1.0")).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Third-party notices" }));
    expect(invokeMock).toHaveBeenCalledWith("open_notices");
    await user.click(within(dialog()).getByRole("button", { name: "Open" }));
    expect(openUrlMock).toHaveBeenCalledWith("https://github.com/79841/dosik");
  });
});

describe("Integrations", () => {
  it("another app holding the bridge's port shows a row above the others — the AI apps can't reach Dosik", async () => {
    answer("plugins_status", facts());
    answer("bridge_status", { port: 4517, listening: false });
    render(<SettingsDialog />);
    act(() => openSettings("Integrations"));
    const warning = await within(dialog()).findByRole("region", { name: "Warning" });
    expect(within(warning).getByText("AI apps can't reach Dosik")).toBeInTheDocument();
    expect(within(warning).getByText("Port in use")).toBeInTheDocument();
    expect(
      within(warning).getByText("Another app holds 127.0.0.1:4517. Quit it, then reopen Dosik."),
    ).toBeInTheDocument();
    // the rows are still there to use
    expect(within(dialog()).getByRole("region", { name: "AI apps" })).toBeInTheDocument();
  });

  it("a bridge that has its port, or cannot be read, shows no warning", async () => {
    answer("plugins_status", facts());
    render(<SettingsDialog />);
    act(() => openSettings("Integrations"));
    await within(dialog()).findByRole("region", { name: "AI apps" });
    expect(within(dialog()).queryByText("Port in use")).toBeNull();
    act(() => useSettingsStore.getState().closeSettings());
    answer("bridge_status", new Error("no bridge"));
    act(() => openSettings("Integrations"));
    await within(dialog()).findByRole("region", { name: "AI apps" });
    expect(within(dialog()).queryByText("Port in use")).toBeNull();
    expect(within(dialog()).queryByText(/no bridge/)).toBeNull();
  });

  it("draws a row per app from what Rust reports", async () => {
    answer("plugins_status", facts());
    render(<SettingsDialog />);
    act(() => openSettings("Integrations"));
    const rows = await within(dialog()).findByRole("region", { name: "AI apps" });
    await within(rows).findByText("Needs update");
    expect(within(rows).getByText("Installed")).toBeInTheDocument();
    expect(within(rows).getByText("Not installed")).toBeInTheDocument();
    expect(within(rows).getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(within(rows).getByRole("button", { name: "Install" })).toBeInTheDocument();
    expect(within(rows).getByRole("button", { name: "Update" })).toBeInTheDocument();
    expect(within(rows).queryByRole("button", { name: /…|Open Claude/ })).toBeNull();
    expect(within(rows).getByText("claude mcp add").tagName).toBe("CODE");
    expect(within(rows).getByText("claude_desktop_config.json").tagName).toBe("CODE");
    expect(
      within(dialog()).getByText(
        "Dosik keeps the MCP server in its app data and refreshes it when Dosik updates, so moving or updating Dosik keeps Claude Code, Claude Desktop, ChatGPT and Codex working. Quit and reopen the AI app after a change.",
      ),
    ).toBeInTheDocument();
  });

  it("draws no rows until the facts are in", async () => {
    let finish: (value: unknown) => void = () => {};
    invokeMock.mockImplementation(async (command: string) =>
      command === "plugins_status" ? new Promise((r) => (finish = r)) : answers[command],
    );
    render(<SettingsDialog />);
    act(() => openSettings("Integrations"));
    expect(within(dialog()).queryByRole("region", { name: "AI apps" })).toBeNull();
    await act(async () => finish(facts()));
    expect(within(dialog()).getByRole("region", { name: "AI apps" })).toBeInTheDocument();
  });

  it("Update runs the install for that app, shows Installing…, then reads the facts again", async () => {
    const user = userEvent.setup();
    answer("plugins_status", facts());
    let finish: () => void = () => {};
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "plugin_install") {
        expect(args).toEqual({ target: "codex" });
        await new Promise<void>((r) => (finish = r));
        answer(
          "plugins_status",
          facts({
            codex: {
              config: "~/.codex/config.toml",
              registered: { command: "/usr/local/bin/node", args: [SERVER], commandFound: true },
            },
          }),
        );
        return null;
      }
      return answers[command];
    });
    render(<SettingsDialog />);
    act(() => openSettings("Integrations"));
    const rows = await within(dialog()).findByRole("region", { name: "AI apps" });
    await user.click(await within(rows).findByRole("button", { name: "Update" }));
    // busy, not disabled: it keeps the keyboard and says it is working (Settings-States)
    const installing = within(rows).getByRole("button", { name: "Installing…" });
    expect(installing).toHaveAttribute("aria-disabled", "true");
    expect(installing).toHaveAttribute("aria-busy", "true");
    expect(within(rows).getByRole("button", { name: "Remove" })).not.toHaveAttribute("aria-busy");
    finish();
    await waitFor(() => expect(within(rows).getAllByText("Installed")).toHaveLength(2));
  });

  it("an action stays busy until the facts are read again — the old row never comes back for a second press", async () => {
    const user = userEvent.setup();
    answer("plugins_status", facts());
    let reread: (value: unknown) => void = () => {};
    let reads = 0;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "plugins_status" && ++reads > 1) return new Promise((r) => (reread = r));
      return answers[command] ?? null;
    });
    render(<SettingsDialog />);
    act(() => openSettings("Integrations"));
    const rows = await within(dialog()).findByRole("region", { name: "AI apps" });
    await user.click(await within(rows).findByRole("button", { name: "Update" }));
    await waitFor(() => expect(reads).toBe(2));
    expect(within(rows).getByRole("button", { name: "Installing…" })).toBeInTheDocument();
    expect(within(rows).queryByRole("button", { name: "Update" })).toBeNull();
    await act(async () =>
      reread(
        facts({
          codex: {
            config: "~/.codex/config.toml",
            registered: { command: "/usr/local/bin/node", args: [SERVER], commandFound: true },
          },
        }),
      ),
    );
    expect(within(rows).getAllByText("Installed")).toHaveLength(2);
  });

  it("an action under way survives leaving the section and coming back; its result lands in the new view", async () => {
    const user = userEvent.setup();
    answer("plugins_status", facts());
    let finish: () => void = () => {};
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "plugin_install") {
        await new Promise<void>((r) => (finish = r));
        answer(
          "plugins_status",
          facts({
            codex: {
              config: "~/.codex/config.toml",
              registered: { command: "/usr/local/bin/node", args: [SERVER], commandFound: true },
            },
          }),
        );
        return null;
      }
      return answers[command];
    });
    render(<SettingsDialog />);
    act(() => openSettings("Integrations"));
    let rows = await within(dialog()).findByRole("region", { name: "AI apps" });
    await user.click(await within(rows).findByRole("button", { name: "Update" }));
    await user.click(within(dialog()).getByRole("button", { name: "General" }));
    await user.click(within(dialog()).getByRole("button", { name: "Integrations" }));
    rows = await within(dialog()).findByRole("region", { name: "AI apps" });
    expect(within(rows).getByRole("button", { name: "Installing…" })).toBeInTheDocument();
    await act(async () => finish());
    await waitFor(() => expect(within(rows).getAllByText("Installed")).toHaveLength(2));
  });

  it("coming back to the window reads the facts again", async () => {
    answer("plugins_status", facts());
    render(<SettingsDialog />);
    act(() => openSettings("Integrations"));
    const rows = await within(dialog()).findByRole("region", { name: "AI apps" });
    await within(rows).findByText("Needs update");
    answer(
      "plugins_status",
      facts({
        codex: {
          config: "~/.codex/config.toml",
          registered: { command: "/usr/local/bin/node", args: [SERVER], commandFound: true },
        },
      }),
    );
    await act(async () => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(within(rows).getAllByText("Installed")).toHaveLength(2));
  });

  it("an install that fails after Settings closed says nothing (#218 D15)", async () => {
    const user = userEvent.setup();
    answer("plugins_status", facts());
    let fail: (e: Error) => void = () => {};
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "plugin_install") return new Promise((_r, reject) => (fail = reject));
      return answers[command];
    });
    render(<SettingsDialog />);
    act(() => openSettings("Integrations"));
    const rows = await within(dialog()).findByRole("region", { name: "AI apps" });
    await user.click(await within(rows).findByRole("button", { name: "Update" }));
    act(() => useSettingsStore.getState().closeSettings());
    await act(async () => fail(new Error("claude mcp failed: late")));
    expect(screen.queryByText(/claude mcp failed: late/)).toBeNull();
  });

  it("a failed install says why at the bottom", async () => {
    const user = userEvent.setup();
    answer("plugins_status", facts());
    answer("plugin_remove", new Error("claude mcp failed: nope"));
    render(<SettingsDialog />);
    act(() => openSettings("Integrations"));
    const rows = await within(dialog()).findByRole("region", { name: "AI apps" });
    await user.click(await within(rows).findByRole("button", { name: "Remove" }));
    expect(await within(dialog()).findByText(/claude mcp failed: nope/)).toBeInTheDocument();
  });
});

describe("Settings off macOS: the caption buttons ride above the scrim (the canvas's Win-Settings)", () => {
  beforeEach(pretendWindows);

  it("they are inside the dialog, and pressing one neither closes Settings nor moves its first focus", async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const close = vi.fn(async () => {});
    vi.mocked(getCurrentWindow).mockReturnValue({ close } as never);
    const user = userEvent.setup();
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    expect(dialog()).toHaveFocus();
    const caption = within(dialog()).getByRole("group", { name: "Window" });
    await user.click(within(caption).getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledTimes(1);
    // the press was on a button, not the scrim: Settings stays
    expect(useSettingsStore.getState().open).toBe(true);
    expect(dialog()).toHaveAttribute("open");
  });

  it("in a small window the dialog keeps 56 clear above and below — off the band and the caption buttons", () => {
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    expect(dialog()).toHaveClass("max-h-[calc(100vh-112px)]");
    expect(dialog()).not.toHaveClass("max-h-[calc(100vh-32px)]");
  });

  it("not on macOS", () => {
    pretendMac();
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    expect(within(dialog()).queryByRole("group", { name: "Window" })).toBeNull();
    // macOS keeps its 16 margin
    expect(dialog()).toHaveClass("max-h-[calc(100vh-32px)]");
  });
});

describe("Settings on Windows: Windows' words and paths (the canvas's Win-Settings, Win-Settings-States, Win-Settings-Panes)", () => {
  beforeEach(() => {
    pretendWindows();
    answer("library_root", {
      path: "C:\\Users\\someone\\Documents\\Dosik",
      shown: "C:\\Users\\someone\\Documents\\Dosik",
    });
  });

  it("General: follow Windows, the whole path, Show in File Explorer", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog />);
    act(() => openSettings("General"));
    expect(within(dialog()).getByText("Follow Windows, or pick one")).toBeInTheDocument();
    const library = within(dialog()).getByRole("region", { name: "Library" });
    expect(
      await within(library).findByText("C:\\Users\\someone\\Documents\\Dosik"),
    ).toBeInTheDocument();
    const folders = within(dialog()).getByRole("region", { name: "Folders in the library" });
    await user.click(within(folders).getByRole("button", { name: "Show Dosik in File Explorer" }));
    expect(invokeMock).toHaveBeenCalledWith("show_library_in_finder");
  });

  it("a found CLI is on this PC; the key is kept in Windows Credential Manager", async () => {
    useChatStore.setState((s) => ({
      settings: { ...s.settings, auths: { claude: "subscription", openai: "api-key" } },
    }));
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const claude = within(dialog()).getByRole("region", { name: "Claude" });
    expect(await within(claude).findByText("CLI 2.1.4 on this PC")).toBeInTheDocument();
    const gpt = within(dialog()).getByRole("region", { name: "GPT" });
    expect(within(gpt).getByText("Kept in Windows Credential Manager")).toBeInTheDocument();
  });

  it("Claude Code missing: install it in PowerShell with the native installer, then sign in", async () => {
    answer("claude_cli_status", { version: null, signed_in: null });
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const claude = within(dialog()).getByRole("region", { name: "Claude" });
    expect(await within(claude).findByText("Not found on this PC")).toBeInTheDocument();
    expect(
      within(claude).getByText(
        "In PowerShell, install it and sign in with your Claude plan, then check again.",
      ),
    ).toBeInTheDocument();
    expect(within(claude).getByText("irm https://claude.ai/install.ps1 | iex")).toBeInTheDocument();
    expect(within(claude).getByText("claude")).toBeInTheDocument();
    expect(within(claude).queryByText(/npm/)).toBeNull();
  });

  it("signed out: sign in in PowerShell", async () => {
    answer("claude_cli_status", { version: "2.1.4", signed_in: false });
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const claude = within(dialog()).getByRole("region", { name: "Claude" });
    expect(
      await within(claude).findByText(
        "In PowerShell, sign in with your Claude plan, then check again.",
      ),
    ).toBeInTheDocument();
  });

  it("GPT's Subscription cannot be picked, and a stored one works as the API key", async () => {
    useChatStore.setState((s) => ({
      settings: { ...s.settings, auths: { claude: "subscription", openai: "subscription" } },
    }));
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const gpt = within(dialog()).getByRole("region", { name: "GPT" });
    const subscription = within(gpt).getByRole("radio", { name: "Subscription" });
    expect(subscription).toBeDisabled();
    expect(within(gpt).getByRole("radio", { name: "API key" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      within(gpt).getByText(
        "Subscription is not available on Windows. API key is pay-per-use, billed by OpenAI.",
      ),
    ).toBeInTheDocument();
    expect(within(gpt).getByText("Kept in Windows Credential Manager")).toBeInTheDocument();
    expect(within(gpt).queryByText("Codex CLI")).toBeNull();
    // the stored choice is not written over
    expect(useChatStore.getState().settings.auths.openai).toBe("subscription");
    expect(invokeMock).not.toHaveBeenCalledWith("codex_cli_status");
  });

  it("the arrow keys do not land on the Subscription it cannot pick", async () => {
    const user = userEvent.setup();
    useChatStore.setState((s) => ({
      settings: { ...s.settings, auths: { claude: "subscription", openai: "api-key" } },
    }));
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const gpt = within(dialog()).getByRole("region", { name: "GPT" });
    within(gpt).getByRole("radio", { name: "API key" }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(useChatStore.getState().settings.auths.openai).toBe("api-key");
  });

  it("Claude's Subscription stays — Claude Code runs on Windows", async () => {
    render(<SettingsDialog />);
    act(() => openSettings("AI assistant"));
    const claude = within(dialog()).getByRole("region", { name: "Claude" });
    expect(within(claude).getByRole("radio", { name: "Subscription" })).toBeEnabled();
  });
});
