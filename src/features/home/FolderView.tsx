import { useRef } from "react";

import type { FolderMeta, ItemKey } from "../library/libraryApi";
import { childKey, childrenOf } from "../library/libraryTree";
import { CARD_KEY_ATTR } from "./CardFrame";
import { columnsOf, gridMove, isGridKey } from "./cardGrid";
import { DiagramCard } from "./DiagramCard";
import { FolderCard } from "./FolderCard";
import { cardGrid } from "./homeGrid";
import { useCardSize } from "./homeMode";
import { selectedIn, useHomeSelection } from "./homeSelection";
import { NewCard } from "./NewCard";

/**
 * One folder on Home — a project or a folder at any depth (#161, #220 D11,
 * #229 D5, #231 D6): its folders and diagrams as cards in the tree's order
 * (#230 D2), as many to a row as fit at the size picked (#236 D5 — Medium
 * until one is), and the dashed card that opens the New menu (#231 D9). Its name, what it holds and its
 * actions are the header row's (#231 D2). A listing with no folder behind it
 * (stray) has no dashed card.
 *
 * The cards are one grid for the keyboard (#231 D7): one Tab stop — the
 * selected card, else the first — the arrows, Home and End move the focus
 * and the selection together, Escape lets the selection go. The dashed card
 * is a Tab stop of its own after the grid.
 */
export const FolderView = ({ folder, folders }: { folder: FolderMeta; folders: FolderMeta[] }) => {
  const grid = useRef<HTMLUListElement>(null);
  const size = useCardSize();
  const children = childrenOf(folder);
  const keys = children.map(childKey);
  const selected = useHomeSelection((s) => selectedIn(s, folder));
  /** the grid's one Tab stop */
  const stop = selected ?? keys[0] ?? null;

  // the grid's keys, on a card's main button — not in its menu or name field
  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const card = (e.target as Element).getAttribute(CARD_KEY_ATTR) as ItemKey | null;
    if (!card || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (isGridKey(e.key)) {
      e.preventDefault();
      const at = keys.indexOf(card);
      const next = keys[gridMove(keys.length, columnsOf(grid.current), at, e.key)];
      if (!next) return;
      useHomeSelection.getState().select(folder.id, next);
      grid.current?.querySelector<HTMLElement>(`[${CARD_KEY_ATTR}="${next}"]`)?.focus();
    } else if (e.key === "Escape" && selected) {
      // only a selection to let go makes it ours; the focus stays on the card
      e.preventDefault();
      e.stopPropagation();
      useHomeSelection.getState().clear();
    }
  };

  return (
    <ul
      ref={grid}
      aria-label={`Items in ${folder.name}`}
      onKeyDown={onGridKeyDown}
      className={`m-0 list-none p-0 ${cardGrid(size)} auto-rows-fr`}
    >
      {children.map((child, i) =>
        child.kind === "folder" ? (
          <FolderCard
            key={child.folder.id}
            folder={child.folder}
            parent={folder}
            folders={folders}
            selected={keys[i] === selected}
            stop={keys[i] === stop}
          />
        ) : (
          <DiagramCard
            key={child.diagram.id}
            diagram={child.diagram}
            folder={folder}
            folders={folders}
            selected={keys[i] === selected}
            stop={keys[i] === stop}
          />
        ),
      )}
      {folder.stray ? null : <NewCard folder={folder} folders={folders} />}
    </ul>
  );
};
