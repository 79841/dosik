import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { badgeColour } from "../../../shared/lib/projectBadge";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import type { DiagramDoc } from "../../../shared/lib/types";
import { badgeIn, spoken } from "../../../test/badges";
import { useAppStore } from "../../library/appStore";
import { blankDoc, type FolderMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { openDocument, resetTabsForTests, showHomeTab } from "../../library/tabActions";
import { resetAutosaveForTests } from "../../library/useAutosave";
import { Dashboard } from "../Dashboard";
import { resetPreviewCacheForTests } from "../diagramPreview";
import { CARD_SIZES, cardGrid, RECENT_WIDE_AT, recentShowClass } from "../homeGrid";
import { useHomeMode } from "../homeMode";
import { useStartingStore } from "../newDiagram";

const mockedInvoke = vi.mocked(invoke);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const now = Date.now();
const MIN = 60_000;

const diagram = (id: string, title: string, minutesAgo: number, readable = true) => ({
  id,
  title,
  updatedAt: now - minutesAgo * MIN,
  readable,
});

/** six diagrams: Checkout newest, then five more across two projects */
const library = (): FolderMeta[] => [
  {
    folders: [],
    id: "pay",
    name: "Payments",
    updatedAt: now - 2 * MIN,
    diagrams: [
      diagram("co", "Checkout service", 2),
      diagram("le", "Ledger schema", 30),
      diagram("rf", "Refund flow", 300),
    ],
  },
  {
    folders: [],
    id: "ob",
    name: "Onboarding",
    updatedAt: now - 10 * MIN,
    diagrams: [
      diagram("lo", "Login sequence", 10),
      diagram("si", "Signup", 60),
      diagram("old", "Old notes", 9000),
    ],
  },
];

const book = (title: string): DiagramDoc => ({ version: 1, title, nodes: [], edges: [] });

/** a recent card's meta line — "{path} · {time}" (#231 D10) */
const metaOf = (card: HTMLElement) => card.lastElementChild as HTMLElement;
/** the Continue card's path chip, found by its first name */
const chipOf = (card: HTMLElement, first: string) =>
  within(card).getByText(first).parentElement as HTMLElement;

const serve = (folders: () => FolderMeta[] = library) =>
  mockedInvoke.mockImplementation(async (cmd, args) => {
    if (cmd === "list_library") return folders();
    if (cmd === "load_project") {
      const { id } = args as { id: string };
      const found = folders()
        .flatMap((f) => f.diagrams)
        .find((d) => d.id === id);
      if (!found) throw new Error(`no such diagram: ${id}`);
      return JSON.stringify(book(found.title));
    }
    return undefined;
  });

describe("Home dashboard (#220 D5·D6·D9·D10, T24)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetPreviewCacheForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    useStartingStore.setState({ starting: [] });
    useAppStore.setState({ newDiagramTarget: null });
    useLibraryStore.setState({ folders: library(), readFailed: false });
    serve();
  });

  it("starts at START without a big title row — section order START → CONTINUE → RECENT (#231 D5, T22)", () => {
    const { container } = render(<Dashboard />);
    // "Home" is the header row's (HomeHeader), not the dashboard's
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    const start = container.firstElementChild!;
    expect(start.tagName).toBe("SECTION");
    expect(start).toHaveAccessibleName("Start");
    expect(start).not.toHaveClass("mt-5");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Start", "Continue", "Recent"]);
  });

  it("START — six tiles, named by their visible text, target row", () => {
    render(<Dashboard />);
    const tiles = within(screen.getByRole("list", { name: "New diagram" })).getAllByRole("button");
    expect(tiles.map((t) => t.getAttribute("aria-label") ?? t.textContent)).toEqual([
      "Blank diagram, Empty canvas",
      "Flowchart",
      "Sequence",
      "Class",
      "ERD",
      "From Mermaid…, Paste text",
    ]);
    expect(screen.getByText(/New diagrams go to/)).toHaveTextContent("Payments");
  });

  it("Blank → empty diagram in the target project, new tab", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await user.click(screen.getByRole("button", { name: "Blank diagram, Empty canvas" }));
    await waitFor(() => expect(useAppStore.getState().view).toBe("editor"));
    const [, args] = calls("save_project")[0]!;
    expect(args).toMatchObject({ folder: "pay" });
    expect(JSON.parse((args as { contents: string }).contents)).toEqual(blankDoc());
  });

  it("that tile is aria-busy while creating", () => {
    useStartingStore.setState({ starting: ["flowchart"] });
    render(<Dashboard />);
    expect(screen.getByRole("button", { name: "Flowchart" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Sequence" })).not.toHaveAttribute("aria-busy");
  });

  it("From Mermaid… → dialog", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    await user.click(screen.getByRole("button", { name: "From Mermaid…, Paste text" }));
    expect(screen.getByRole("dialog", { name: "New diagram from Mermaid" })).toBeInTheDocument();
  });

  it("closing the From Mermaid… dialog returns focus to that tile — even in WebKit, where a mouse click does not give focus (#220)", async () => {
    const user = userEvent.setup();
    render(<Dashboard />);
    const tile = screen.getByRole("button", { name: "From Mermaid…, Paste text" });
    // WebKit: a mouse click does not focus a button — the focus stays on <body>
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(tile);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(tile).toHaveFocus();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(tile);
    await user.keyboard("{Escape}");
    expect(tile).toHaveFocus();
  });

  it("cards got bigger — START tile 112·art 76, Continue 280·well 260 (#236 R7, T14)", () => {
    render(<Dashboard />);
    const tiles = within(screen.getByRole("list", { name: "New diagram" })).getAllByRole("button");
    for (const tile of tiles) expect(tile).toHaveClass("h-[112px]");
    const picture = screen.getByRole("button", { name: "Flowchart" }).firstElementChild;
    expect(picture).toHaveClass("h-[76px]", "w-full");
    const card = screen.getByRole("article", { name: "Checkout service" });
    expect(card).toHaveClass("min-h-[280px]");
    expect(within(card).getByRole("img", { name: "Preview of Checkout service" })).toHaveClass(
      "h-[260px]",
    );
  });

  describe("CONTINUE (D9)", () => {
    it("most recent diagram — path chip, title, 'Edited …', Resume — no page chip (#229 D5)", () => {
      render(<Dashboard />);
      const card = screen.getByRole("article", { name: "Checkout service" });
      const c = within(card);
      // a diagram at the top of its project: the chip is the project alone (#231 D10)
      expect(spoken(chipOf(card, "Payments"))).toBe("Payments");
      // the project's badge first; the chip's left padding tightens to 4 (#236 R4, T15)
      const badge = badgeIn(chipOf(card, "Payments"))!;
      expect(badge).toBe(chipOf(card, "Payments").firstElementChild);
      expect(badge).toHaveTextContent("P");
      expect(badge).toHaveClass(`bg-badge-${badgeColour("pay")}-soft`, "h-3.5", "w-3.5");
      expect(chipOf(card, "Payments")).toHaveClass(
        "h-[22px]",
        "pl-1",
        "pr-2",
        "gap-1.5",
        "rounded-full",
        "bg-hover",
        "text-[11px]",
        "font-medium",
        "text-icon",
      );
      expect(c.getByText("Edited 2 min ago")).toBeInTheDocument();
      expect(c.getByRole("img", { name: "Preview of Checkout service" })).toBeInTheDocument();
      expect(c.queryByRole("list")).toBeNull();
      expect(c.getByRole("button", { name: "Resume Checkout service" })).toBeInTheDocument();
      // the project pill has no dot (#229 D19)
      expect(card.querySelector(".bg-project-grey")).toBeNull();
    });

    it("Resume — opens it, and if already a tab just switches without rereading", async () => {
      const user = userEvent.setup();
      openDocument(book("Checkout service"), { projectId: "co" });
      useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
      showHomeTab();
      render(<Dashboard />);
      // the thumbnails read their files; let them land first
      await act(async () => {});
      const reads = calls("load_project").length;
      await user.click(screen.getByRole("button", { name: "Resume Checkout service" }));
      expect(useAppStore.getState().view).toBe("editor");
      expect(useDiagramStore.getState().projectId).toBe("co");
      // the same document, history and all — not read again
      expect(useDiagramStore.getState().past).toHaveLength(1);
      expect(calls("load_project")).toHaveLength(reads);
      expect(useAppStore.getState().tabs).toHaveLength(1);
    });
  });

  describe("RECENT (D10)", () => {
    it("the 4 next most recent after Continue — project·time, pressing opens", async () => {
      const user = userEvent.setup();
      render(<Dashboard />);
      const list = within(screen.getByRole("list", { name: "Recent diagrams" }));
      expect(list.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
        "Open Login sequence in Onboarding",
        "Open Ledger schema in Payments",
        "Open Signup in Onboarding",
        "Open Refund flow in Payments",
      ]);
      const login = metaOf(list.getByRole("button", { name: "Open Login sequence in Onboarding" }));
      expect(spoken(login)).toBe("Onboarding\u00a0· 10 min ago");
      // the path line starts with the project's badge, 6 under the title (#236 R4, T15)
      expect(login).toHaveClass("mt-1.5");
      expect(login.firstElementChild).toBe(badgeIn(login));
      expect(badgeIn(login)).toHaveTextContent("O");
      expect(badgeIn(login)).toHaveClass(`bg-badge-${badgeColour("ob")}-soft`, "mr-[5px]");
      await user.click(list.getByRole("button", { name: "Open Ledger schema in Payments" }));
      await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("le"));
    });

    it("the card cell is a container — well height·title-row date·bottom-row time switch via container query classes at the card's own width threshold (RECENT_WIDE_AT) (#231 D10, jsdom does not measure width)", () => {
      const wide = `@min-[${RECENT_WIDE_AT}px]:`;
      render(<Dashboard />);
      const card = within(screen.getByRole("list", { name: "Recent diagrams" })).getByRole(
        "button",
        { name: "Open Login sequence in Onboarding" },
      );
      expect(card.parentElement).toHaveClass("@container");
      const [well, titleRow] = [...card.children] as HTMLElement[];
      // every card's well is 15:8, whatever its width (#236 R5)
      expect(well).toHaveClass("aspect-[15/8]");
      expect(well.className).not.toMatch(/\bh-\[\d+px\]/);
      const date = titleRow!.lastElementChild as HTMLElement;
      expect(date).toHaveTextContent(/^10 min ago$/);
      expect(date).toHaveClass("hidden", `${wide}block`);
      const time = metaOf(card).lastElementChild as HTMLElement;
      expect(time).toHaveTextContent(/^· 10 min ago$/);
      expect(time).toHaveClass(`${wide}hidden`);
    });

    it("the RECENT row is a grid at the chosen size, showing only what fits in one row — draws 4 cards and hides the overflow (#236 R5·R7, T13)", () => {
      try {
        for (const size of [null, ...CARD_SIZES] as const) {
          act(() => useHomeMode.setState({ size }));
          const { unmount } = render(<Dashboard />);
          const list = screen.getByRole("list", { name: "Recent diagrams" });
          // until one is picked, Medium
          expect(list).toHaveClass(...cardGrid(size ?? "medium").split(" "));
          const cards = [...list.children] as HTMLElement[];
          expect(cards).toHaveLength(4);
          cards.forEach((card, i) => {
            const show = recentShowClass(size ?? "medium", i);
            if (show) expect(card).toHaveClass(...show.split(" "));
            else expect(card).not.toHaveClass("hidden");
          });
          unmount();
        }
      } finally {
        useHomeMode.setState({ size: null });
      }
    });

    it("See all → Recent view, requests title focus", async () => {
      const user = userEvent.setup();
      render(<Dashboard />);
      const focus = useAppStore.getState().homeFocus;
      await user.click(screen.getByRole("button", { name: "See all recent diagrams" }));
      expect(useAppStore.getState().homeView).toEqual({ kind: "recent" });
      expect(useAppStore.getState().homeFocus).toBe(focus + 1);
    });
  });
});

describe("dashboard states (#220 D20, T25)", () => {
  beforeEach(() => {
    resetPreviewCacheForTests();
    resetTabsForTests();
    useAppStore.setState({ newDiagramTarget: null });
    serve();
  });
  afterEach(() => vi.useRealTimers());

  it("placeholders only when the list is more than 300ms late — START right away", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useLibraryStore.setState({ folders: null, readFailed: false });
    render(<Dashboard />);
    expect(screen.getByRole("list", { name: "New diagram" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading projects" })).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    const skeleton = screen.getByRole("status", { name: "Loading projects" });
    // the shapes to come (#236 R7): Continue 280, then RECENT's one row at the card size
    const [hero, row] = [...skeleton.children] as HTMLElement[];
    expect(hero).toHaveClass("h-[280px]");
    expect(row).toHaveClass(...cardGrid("medium").split(" "));
    expect([...row!.children].map((c) => c.classList.contains("hidden"))).toEqual([
      false,
      true,
      true,
      true,
    ]);
    act(() => useLibraryStore.setState({ folders: library() }));
    expect(screen.queryByRole("status", { name: "Loading projects" })).toBeNull();
  });

  it("list failed to load and is empty → 'Couldn't load your projects' + Try again — START stays", async () => {
    const user = userEvent.setup();
    useLibraryStore.setState({ folders: [], readFailed: true });
    render(<Dashboard />);
    expect(screen.getByText("Couldn't load your projects")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "New diagram" })).toBeInTheDocument();
    expect(screen.queryByText("No diagrams yet")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("Couldn't load your projects")).toBeNull());
    expect(screen.getByRole("article", { name: "Checkout service" })).toBeInTheDocument();
  });

  it("empty library → START + empty notice, no target row", () => {
    useLibraryStore.setState({ folders: [], readFailed: false });
    render(<Dashboard />);
    expect(screen.getByText("No diagrams yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Start one above, open a .dosik file, or send ops to the bridge — a diagram is created for them.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/New diagrams go to/)).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Start",
    ]);
  });

  it("diagrams only in nested folders — not an empty library, chip·meta are the diagram's path (#229 D5, #231 D10, T22)", () => {
    useLibraryStore.setState({
      folders: [
        {
          id: "pay",
          name: "Payments",
          updatedAt: now,
          diagrams: [],
          folders: [
            {
              id: "chk",
              name: "Checkout",
              updatedAt: now,
              diagrams: [diagram("deep", "Deep flow", 1)],
              folders: [
                {
                  id: "flw",
                  name: "Flows",
                  updatedAt: now,
                  diagrams: [diagram("deeper", "Deeper", 5)],
                  folders: [],
                },
              ],
            },
          ],
        },
      ],
      readFailed: false,
    });
    render(<Dashboard />);
    expect(screen.queryByText("No diagrams yet")).toBeNull();
    const card = screen.getByRole("article", { name: "Deep flow" });
    const chip = chipOf(card, "Payments");
    expect(spoken(chip)).toBe("Payments / Checkout");
    // the "/" between the names is the breadcrumb's: dash, not read out
    const rule = within(chip).getByText("/");
    expect(rule).toHaveAttribute("aria-hidden", "true");
    expect(rule).toHaveClass("text-dash");
    const recent = within(screen.getByRole("list", { name: "Recent diagrams" })).getByRole(
      "button",
      { name: "Open Deeper in Payments / Checkout / Flows" },
    );
    const meta = metaOf(recent);
    expect(spoken(meta)).toBe("Payments / Checkout / Flows\u00a0· 5 min ago");
    // only the path gives way when the card is narrow — the badge and the time stay whole
    const [badge, path, time] = [...meta.children] as HTMLElement[];
    expect(badge).toHaveClass("flex-none");
    expect(path).toHaveClass("min-w-0", "truncate");
    expect(path).toHaveTextContent(/^Payments \/ Checkout \/ Flows$/);
    expect(time).toHaveClass("flex-none");
    expect(within(path).getAllByText("/")).toHaveLength(2);
  });

  it("one diagram → Continue only", () => {
    useLibraryStore.setState({
      folders: [
        {
          folders: [],
          id: "pay",
          name: "Payments",
          updatedAt: now,
          diagrams: [diagram("co", "Checkout service", 1)],
        },
      ],
      readFailed: false,
    });
    render(<Dashboard />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Start",
      "Continue",
    ]);
    expect(screen.queryByRole("list", { name: "Recent diagrams" })).toBeNull();
  });

  it("an unreadable diagram card shows 'No preview', meta is time only", async () => {
    const folders = library();
    folders[0]!.diagrams[1] = diagram("le", "Ledger schema", 30, false);
    useLibraryStore.setState({ folders, readFailed: false });
    render(<Dashboard />);
    const card = within(screen.getByRole("list", { name: "Recent diagrams" })).getByRole("button", {
      name: "Open Ledger schema in Payments",
    });
    expect(spoken(metaOf(card))).toBe("Payments\u00a0· 30 min ago");
    expect(await within(card).findByText("No preview")).toBeInTheDocument();
  });
});
