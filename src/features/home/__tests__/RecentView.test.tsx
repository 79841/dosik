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
import { cardGrid } from "../homeGrid";
import { useHomeMode } from "../homeMode";
import { RecentView } from "../RecentView";
import { likeRust } from "../../../test/rustAnswers";

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

/** a recent card's path line — "{path} · {time}" (#231 D10), first in its caption block (#265) */
const metaOf = (card: Element) => card.lastElementChild!.firstElementChild!;

describe("Recent view (#220 D10, T26)", () => {
  beforeEach(() => {
    resetPreviewCacheForTests();
    resetTabsForTests();
    useHomeMode.setState({ size: null });
    useLibraryStore.setState({ folders: library(), readFailed: false });
    mockedInvoke.mockImplementation(
      likeRust(async (cmd) =>
        cmd === "load_project" ? JSON.stringify({ ...blankDoc(), title: "Beta" }) : undefined,
      ),
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
    expect(spoken(metaOf(cards[0]!))).toBe("Onboarding / Auth\u00a0· Just now");
    // a diagram at the top of its project: the project alone
    expect(cards[1]).toHaveAttribute("aria-label", "Open Alpha in Payments");
    expect(spoken(metaOf(cards[1]!))).toBe("Payments\u00a0· Just now");
  });

  it("the time in the description is its own segment, so it starts uppercase — '· Yesterday' (#231 D10, Main)", () => {
    const folders = library();
    folders[1]!.diagrams[0] = { ...folders[1]!.diagrams[0]!, updatedAt: now - 30 * 3_600_000 };
    useLibraryStore.setState({ folders });
    render(<RecentView />);
    const beta = screen.getByRole("button", { name: "Open Beta in Onboarding" });
    expect(spoken(metaOf(beta))).toBe("Onboarding\u00a0· Yesterday");
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
        // card C: the 15:8 well, then the caption block's 56 (a hairline + 8 + 15 + 8 + 16 + 8)
        expect(cell).toHaveClass("animate-pulse", "pb-[56px]");
        expect(cell.className).not.toMatch(/\b(pt-2|px-2)\b/);
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

  it("one shape at every width — the path line first, the title below, on one left edge (#265, Main)", () => {
    const folders = library();
    folders[1]!.diagrams[0] = { ...folders[1]!.diagrams[0]!, updatedAt: now - 30 * 3_600_000 };
    useLibraryStore.setState({ folders });
    render(<RecentView />);
    const card = screen.getByRole("button", { name: "Open Beta in Onboarding" });
    expect(card.parentElement).not.toHaveClass("@container");
    // card C (#265): the well, then the caption block under a hairline
    const [well, caption] = [...card.children] as HTMLElement[];
    expect(well).toHaveClass("aspect-[15/8]");
    expect(caption).toHaveClass(
      "border-t-[0.5px]",
      "border-edge",
      "px-3",
      // one step all round: 8 above, between the two rows and below (Main)
      "py-2",
      "gap-2",
    );
    expect(caption!.className).not.toMatch(/\b(pt|pb)-/);
    const [meta, titleRow] = [...caption!.children] as HTMLElement[];
    expect(meta).toHaveClass("text-muted-strong");
    // the path line: the badge in a 16px slot, the path (it gives way), then its time
    const [slot, path, time] = [...meta!.children] as HTMLElement[];
    expect(slot).toHaveClass("w-4", "flex-none");
    expect(slot!.firstElementChild!.className).toMatch(/\bbg-badge-\w+-soft\b/);
    expect(slot).toHaveTextContent("O");
    expect(path).toHaveTextContent(/^Onboarding$/);
    expect(path).toHaveClass("min-w-0", "truncate");
    expect(time).toHaveTextContent(/^· Yesterday$/);
    expect(time).toHaveClass("flex-none");
    // the title line: the glyph in the same 16px column, then the title
    const [glyph, title] = [...titleRow!.children] as HTMLElement[];
    expect(glyph).toHaveClass("text-glyph-diagram");
    expect(glyph).toHaveAttribute("width", "16");
    expect(title).toHaveTextContent(/^Beta$/);
    expect(title).toHaveClass("min-w-0", "flex-auto", "truncate");
    expect(meta).toHaveClass("gap-2");
    expect(titleRow).toHaveClass("gap-2");
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
    expect(
      screen.getByText("Start one from Home, open a .dosik file, or send ops to the bridge."),
    ).toBeInTheDocument();
    unmount();
    useLibraryStore.setState({ folders: [], readFailed: true });
    render(<RecentView />);
    expect(screen.getByText("Couldn't load your projects")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Dosik couldn't read its library folder. Try again, or open a .dosik file from the sidebar.",
      ),
    ).toBeInTheDocument();
  });
});
