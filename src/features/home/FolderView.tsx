import { useRef, useState } from "react";

import type { FolderMeta, ItemKey } from "../library/libraryApi";
import { childKey, childrenOf } from "../library/libraryTree";
import { CARD_KEY_ATTR } from "./CardFrame";
import { columnsOf, gridMove, isGridKey } from "./cardGrid";
import { DiagramCard } from "./DiagramCard";
import { FolderCard } from "./FolderCard";
import { cardGrid } from "./homeGrid";
import { useCardSize } from "./homeMode";
import { NewCard } from "./NewCard";

/**
 * One folder on Home — a project or a folder at any depth (#161, #220 D11,
 * #229 D5, #231 D6): its folders and diagrams as cards in the tree's order
 * (#230 D2), as many to a row as fit at the size picked (#236 D5 — Medium
 * until one is), and the dashed card that opens the New menu (#231 D9). Its name, what it holds and its
 * actions are the header row's (#231 D2).
 *
 * The cards are one grid for the keyboard (#231 D7): one Tab stop — the
 * card the focus was on last, else the first — and the arrows, Home and End
 * move the focus. A click opens a card; there is no selection (#265). The
 * dashed card is a Tab stop of its own after the grid.
 */
export const FolderView = ({ folder, folders }: { folder: FolderMeta; folders: FolderMeta[] }) => {
  const grid = useRef<HTMLUListElement>(null);
  const size = useCardSize();
  const children = childrenOf(folder);
  const keys = children.map(childKey);
  /** the card the focus was on last — while it is still here */
  const [focused, setFocused] = useState<ItemKey | null>(null);
  /** the grid's one Tab stop */
  const stop = (focused && keys.includes(focused) ? focused : keys[0]) ?? null;
  const cardOf = (e: React.SyntheticEvent) =>
    (e.target as Element).getAttribute(CARD_KEY_ATTR) as ItemKey | null;

  // the grid's keys, on a card's main button — not in its menu or name field
  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const card = cardOf(e);
    if (!card || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || !isGridKey(e.key)) return;
    e.preventDefault();
    const next = keys[gridMove(keys.length, columnsOf(grid.current), keys.indexOf(card), e.key)];
    if (next) grid.current?.querySelector<HTMLElement>(`[${CARD_KEY_ATTR}="${next}"]`)?.focus();
  };

  return (
    <ul
      ref={grid}
      aria-label={`Items in ${folder.name}`}
      onKeyDown={onGridKeyDown}
      // the Tab stop follows the focus — the arrows, a move away, a name field closing
      onFocus={(e) => {
        const card = cardOf(e);
        if (card) setFocused(card);
      }}
      className={`m-0 list-none p-0 ${cardGrid(size)} auto-rows-fr`}
    >
      {children.map((child, i) =>
        child.kind === "folder" ? (
          <FolderCard
            key={child.folder.id}
            folder={child.folder}
            parent={folder}
            folders={folders}
            stop={keys[i] === stop}
          />
        ) : (
          <DiagramCard
            key={child.diagram.id}
            diagram={child.diagram}
            folder={folder}
            folders={folders}
            stop={keys[i] === stop}
          />
        ),
      )}
      <NewCard folder={folder} folders={folders} />
    </ul>
  );
};
