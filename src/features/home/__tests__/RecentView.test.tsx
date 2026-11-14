import { invoke } from "@tauri-apps/api/core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { spoken } from "../../../test/badges";
import { blankDoc, type FolderMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { resetTabsForTests } from "../../library/tabActions";
import { resetPreviewCacheForTests } from "../diagramPreview";
import { RECENT_WIDE_AT } from "../homeGrid";
import { cardGrid } from "../homeGrid";
import { useHomeMode } from "../homeMode";
import { RecentView } from "../RecentView";

const mockedInvoke = vi.mocked(invoke);
const now = Date.now();
const library = (): FolderMeta[] => [
  {
    folders: [],
    id: "pay",
    name: "Payments",
    updatedAt: now,
    diagrams: [
      { id: "a", title: "Alpha", updatedAt: now - 1000, readable: true },
      { id: "c", title: "Gamma", updatedAt: now - 3000, readable: false },
    ],
  },
  {
    folders: [],
    id: "ob",
    name: "Onboarding",
    updatedAt: now,
    diagrams: [{ id: "b", title: "Beta", updatedAt: now - 2000, readable: true }],
  },
];

describe("Recent view (#220 D10, T26)", () => {
  beforeEach(() => {
    resetPreviewCacheForTests();
    resetTabsForTests();
    useHomeMode.setState({ size: null });
    useLibraryStore.setState({ folders: library(), readFailed: false });
    mockedInvoke.mockImplementation(async (cmd) =>
      cmd === "load_project" ? JSON.stringify({ ...blankDoc(), title: "Beta" }) : undefined,
    );
  });

  it("starts with the grid without a big title row, all diagrams newest first — unreadable ones too (#231 D5, T22)", () => {
    const { container } = render(<RecentView />);
    // "Recent" and "N diagrams" are the header row's (HomeHeader)
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByText("3 diagrams")).toBeNull();
    expect(container.firstElementChild).toBe(screen.getByRole("list", { name: "Recent diagrams" }));
    const cards = within(screen.getByRole("list", { name: "Recent diagrams" })).getAllByRole(
      "button",
    );
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Open Alpha in Payments",
      "Open Beta in Onboarding",
      "Open Gamma in Payments",
    ]);
    // no project dot (#229 D19), no page count (#229 D5)
    expect(document.querySelector(".bg-project-grey")).toBeNull();
    expect(screen.queryByText(/\bpages?\b/)).toBeNull();
  });

  it("diagrams in nested folders too — name, and the description is the diagram's path (#229 D5, #231 D10, T22)", () => {
    const folders = library();
    folders[1]!.folders = [
      {
        id: "auth",
        name: "Auth",
        updatedAt: now,
        diagrams: [{ id: "d", title: "Delta", updatedAt: now - 500, readable: true }],
        folders: [],
      },
    ];
    useLibraryStore.setState({ folders });
    render(<RecentView />);
    const cards = within(screen.getByRole("list", { name: "Recent diagrams" })).getAllByRole(
      "button",
    );
    expect(cards[0]).toHaveAttribute("aria-label", "Open Delta in Onboarding / Auth");
    expect(spoken(cards[0]!.lastElementChild!)).toBe("Onboarding / Auth\u00a0· Just now");
    // a diagram at the top of its project: the project alone
    expect(cards[1]).toHaveAttribute("aria-label", "Open Alpha in Payments");
    expect(spoken(cards[1]!.lastElementChild!)).toBe("Payments\u00a0· Just now");
  });

  it("the time in the description is its own segment, so it starts uppercase — '· Yesterday' (#231 D10, Main)", () => {
    const folders = library();
    folders[1]!.diagrams[0] = { ...folders[1]!.diagrams[0]!, updatedAt: now - 30 * 3_600_000 };
    useLibraryStore.setState({ folders });
    render(<RecentView />);
    const beta = screen.getByRole("button", { name: "Open Beta in Onboarding" });
    expect(spoken(beta.lastElementChild!)).toBe("Onboarding\u00a0· Yesterday");
  });

  it("four placeholders while the list is slow — grid at the chosen size, card shape (15:8 well + two lines) (#236 R5)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      useLibraryStore.setState({ folders: null, readFailed: false });
      useHomeMode.setState({ size: "large" });
      render(<RecentView />);
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      const skeleton = screen.getByRole("status", { name: "Loading projects" });
      expect(skeleton).toHaveClass(...cardGrid("large").split(" "));
      const cells = [...skeleton.children] as HTMLElement[];
      expect(cells).toHaveLength(4);
      for (const cell of cells) {
        expect(cell).toHaveClass("animate-pulse", "pt-2", "pb-[55px]");
        expect(cell).not.toHaveClass("hidden");
        expect(cell.firstElementChild).toHaveClass("aspect-[15/8]");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("card size — Medium if never chosen, otherwise a grid at that size (#236 R5, T13)", () => {
    render(<RecentView />);
    const list = screen.getByRole("list", { name: "Recent diagrams" });
    expect(list).toHaveClass(...cardGrid("medium").split(" "));
    act(() => useHomeMode.getState().setSize("small"));
    expect(list).toHaveClass(...cardGrid("small").split(" "));
    // every card is drawn: no row limit here
    for (const card of list.children) expect(card).not.toHaveClass("hidden");
  });

  it("two shapes by the card's own width — Main when narrow, HomeCollapse-Hidden at RECENT_WIDE_AT(368) or wider (#231 D10, #236)", () => {
    const wide = `@min-[${RECENT_WIDE_AT}px]:`;
    const folders = library();
    folders[1]!.diagrams[0] = { ...folders[1]!.diagrams[0]!, updatedAt: now - 30 * 3_600_000 };
    useLibraryStore.setState({ folders });
    render(<RecentView />);
    const card = screen.getByRole("button", { name: "Open Beta in Onboarding" });
    // the card's own width picks, not the window's: the cell is the container
    expect(card.parentElement).toHaveClass("@container");
    const [well, titleRow, meta] = [...card.children] as HTMLElement[];
    // every card's well is 15:8 (#236 R5): 168 at Main's 336, 208 at HomeCollapse-Hidden's 400
    expect(well).toHaveClass("aspect-[15/8]");
    expect(well.className).not.toMatch(/\bh-\[\d+px\]|@min-\[\d+px\]:aspect/);
    // the title row: the title gives way, the date waits at its right end for a wide card
    const [title, date] = [...titleRow!.children] as HTMLElement[];
    expect(titleRow).toHaveClass("flex", "items-baseline", "gap-2");
    expect(title).toHaveTextContent(/^Beta$/);
    expect(title).toHaveClass("min-w-0", "flex-auto", "truncate");
    expect(date).toHaveTextContent(/^Yesterday$/);
    expect(date).toHaveClass(
      "hidden",
      `${wide}block`,
      "flex-none",
      "text-[11px]",
      "leading-4",
      "text-muted",
    );
    // the line below: the path, and "· Yesterday" only while the card is narrow
    expect(meta).toBe(card.lastElementChild);
    // the project's badge first, outside the box that cuts the path (#236 R4)
    const [badge, path, time] = [...meta!.children] as HTMLElement[];
    expect(badge!.className).toMatch(/\bbg-badge-\w+-soft\b/);
    expect(badge).toHaveClass("flex-none");
    expect(badge).toHaveTextContent("O");
    expect(path).toHaveTextContent(/^Onboarding$/);
    expect(path).not.toHaveClass(`${wide}hidden`);
    expect(time).toHaveTextContent(/^· Yesterday$/);
    expect(time).toHaveClass("flex-none", `${wide}hidden`);
  });

  it("pressing a card opens it", async () => {
    const user = userEvent.setup();
    render(<RecentView />);
    await user.click(screen.getByRole("button", { name: "Open Beta in Onboarding" }));
    await waitFor(() => expect(useDiagramStore.getState().projectId).toBe("b"));
  });

  it("empty notice with no diagrams, failure box when reading fails", () => {
    useLibraryStore.setState({ folders: [{ ...library()[0]!, diagrams: [] }] });
    const { unmount } = render(<RecentView />);
    expect(screen.getByText("No diagrams yet")).toBeInTheDocument();
    unmount();
    useLibraryStore.setState({ folders: [], readFailed: true });
    render(<RecentView />);
    expect(screen.getByText("Couldn't load your projects")).toBeInTheDocument();
  });
});
