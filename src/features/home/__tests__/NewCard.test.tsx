import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { FolderMeta } from "../../library/libraryApi";
import { findFolder } from "../../library/libraryTree";
import { NewCard } from "../NewCard";

vi.mock("../../../shared/lib/systemClipboard", () => ({
  readClipboardText: vi.fn(async () => null),
}));

/** Payments, and E1 … E10 — the deepest level, where no folder can go */
const library = (): FolderMeta[] => {
  let deepest: FolderMeta = { id: "e10", name: "E10", updatedAt: 1, diagrams: [], folders: [] };
  for (let k = 9; k >= 1; k--) {
    deepest = { id: `e${k}`, name: `E${k}`, updatedAt: 1, diagrams: [], folders: [deepest] };
  }
  return [{ id: "pay", name: "Payments", updatedAt: 5, diagrams: [], folders: [] }, deepest];
};

const KINDS = "Blank, Flowchart, Sequence, Class, ERD or paste Mermaid";

const show = (id: string) => {
  const folders = library();
  render(
    <ul>
      <NewCard folder={findFolder(folders, id)!.folder} folders={folders} />
    </ul>,
  );
};

/** the dashed card that ends a folder's cards (#231 D9, `Hybrid-Project-Cards`) */
describe("dashed New card (#231 D9, T20)", () => {
  it("canvas look — 1.5px dashed, Plus in a 36 circle, 'New diagram' and a description", () => {
    show("pay");
    const card = screen.getByRole("button", { name: `New diagram, ${KINDS} · or a new folder` });
    expect(card).toHaveClass("rounded-lg", "border-[1.5px]", "border-dashed", "border-dot");
    expect(card).toHaveAttribute("aria-haspopup", "menu");
    expect(card).toHaveAttribute("aria-expanded", "false");
    expect(within(card).getByText("New diagram")).toHaveClass("text-[12px]", "font-semibold");
    expect(within(card).getByText(`${KINDS} · or a new folder`)).toHaveClass(
      "text-[11px]",
      "text-muted",
    );
    expect(card.querySelector(".rounded-full.bg-frame svg")).toHaveClass("lucide-plus");
  });

  it("the card sets the row height — min height only when alone (empty folder), below 240 wide hides the second line and pads 16 (#236 R5, T14)", () => {
    show("pay");
    const card = screen.getByRole("button", { name: `New diagram, ${KINDS} · or a new folder` });
    const cell = card.parentElement!;
    expect(card).not.toHaveClass("min-h-[230px]");
    expect(cell).toHaveClass("@container", "only:min-h-[230px]");
    expect(card).toHaveClass("p-4", "@min-[240px]:p-5");
    expect(within(card).getByText(`${KINDS} · or a new folder`)).toHaveClass(
      "hidden",
      "@min-[240px]:block",
    );
  });

  it("deepest level where folders cannot be made — description has no new folder", () => {
    show("e10");
    expect(screen.getByRole("button", { name: `New diagram, ${KINDS}` })).toBeInTheDocument();
    expect(screen.queryByText(/or a new folder/)).toBeNull();
  });

  it("opens the New menu — same menu as the header New ▾, closes on a second press", async () => {
    const user = userEvent.setup();
    show("pay");
    const card = screen.getByRole("button", { name: /^New diagram/ });
    await user.click(card);
    expect(card).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "New in Payments" });
    expect(within(menu).getAllByRole("menuitem").at(-1)).toHaveTextContent("New folder");
    await user.click(card);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(card).toHaveAttribute("aria-expanded", "false");
  });
});
