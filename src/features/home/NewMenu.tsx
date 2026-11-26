import { FolderPlus } from "lucide-react";
import { type RefObject, useState } from "react";

import { focusStillWith } from "../../shared/lib/focusGuard";
import { Menu, type MenuItem } from "../../shared/ui/Menu";
import { useAppStore } from "../library/appStore";
import type { FolderMeta } from "../library/libraryApi";
import { newFolder } from "../library/libraryActions";
import { canHoldFolders } from "../library/libraryTree";
import { viewInHome } from "../library/navigation";
import { screenStamp, stillOnScreen } from "../library/screenStamp";
import { useHomeMode } from "./homeMode";
import { MermaidDialog } from "./MermaidDialog";
import { startDiagram } from "./newDiagram";
import { START_OPTIONS } from "./startOptions";

/**
 * Cards' focus rule for a slow New folder (#231 W1): the focus is nowhere or
 * still in Home's sheet — the `main` around `from`, found as it is asked.
 * The board's rule is its own `holdsFocus`.
 */
export const inSheet = (from: Element | null | undefined): (() => boolean) => {
  const sheet = from?.closest("main");
  return () => focusStillWith(sheet);
};

/**
 * New folder from Home, inside `parent` (#231 D8 — on Home it replaces #229
 * D11's "go into it and name it in the header"): once it is made, its card —
 * first in `parent`'s view (#230) — opens its name in the caption bar as
 * the name field, which takes the focus; the request waits in the app store for that card — on the
 * board too, where the card is in its frame (#231 D13), unless the new
 * folder went into a collapsed project's stack, where no field opens (the
 * board drops the request). Home stays where it is. `enter`: `parent` is
 * not on screen — a folder card's own menu makes it inside that card's
 * folder — so Home goes into `parent` first and its new card there takes
 * the name; its heading takes the focus, but not from the board
 * (`focusHeading: false`), where the move is the board's own (#221 D2).
 * Only while the screen and the mode are the ones it was asked from and
 * `mayFocus` says the focus is still where it was — Cards' `inSheet`, the
 * board's `holdsFocus` (#231 W1): the user may have gone on meanwhile
 * (#218 D15).
 */
export const newFolderFromHome = (
  parent: string,
  {
    enter = false,
    focusHeading = true,
    mayFocus,
  }: { enter?: boolean; focusHeading?: boolean; mayFocus: () => boolean },
): void => {
  const asked = screenStamp();
  const mode = useHomeMode.getState().mode;
  void newFolder({ parent }).then((id) => {
    if (!id || !stillOnScreen(asked) || useHomeMode.getState().mode !== mode || !mayFocus()) {
      return;
    }
    if (enter) viewInHome({ kind: "folder", folder: parent }, focusHeading);
    // stamped with the screen it is for — after `enter`, the folder's view
    useAppStore.getState().requestFolderRename(id);
  });
};

/**
 * The New menu (#231 D9, Q2, `Home-States` 1): what can be made in `folder`
 * — START's six, then a rule and New folder, which is not there at the
 * deepest level (#229 D9). The header's New ▾, the dashed card at the end
 * of a folder's cards and a board frame's + open it. From Mermaid… turns the
 * menu into its dialog; when that closes, the focus goes back to what opened
 * the menu.
 */
export const NewMenu = ({
  at,
  folder,
  folders,
  opener,
  mayFocus,
  onClose,
}: {
  at: { x: number; y: number };
  folder: FolderMeta;
  folders: readonly FolderMeta[];
  /** what opened it — gets focus back, and pressing it again closes the menu */
  opener: RefObject<HTMLElement | null>;
  /** New folder's focus rule (#231 W1) — the board's `holdsFocus`; else the sheet's */
  mayFocus?: () => boolean;
  onClose: () => void;
}) => {
  const [dialog, setDialog] = useState(false);
  if (dialog) {
    return <MermaidDialog folder={folder.id} returnTo={opener.current} onClose={onClose} />;
  }
  const items: MenuItem[] = START_OPTIONS.map(({ choice, label, icon }) => ({
    label,
    icon,
    takesFocus: choice === "mermaid",
    onSelect:
      choice === "mermaid" ? () => setDialog(true) : () => void startDiagram(choice, folder.id),
  }));
  if (canHoldFolders(folders, folder.id)) {
    // the opener keeps the focus until the new card's name field takes it
    items.push({
      label: "New folder",
      icon: FolderPlus,
      separatorBefore: true,
      onSelect: () =>
        newFolderFromHome(folder.id, { mayFocus: mayFocus ?? inSheet(opener.current) }),
    });
  }
  return (
    <Menu
      at={at}
      label={`New in ${folder.name}`}
      opener={opener}
      items={items}
      onSelect={(item) => {
        if (!item.takesFocus) {
          onClose();
          opener.current?.focus();
        }
        item.onSelect();
      }}
      onClose={(returnFocus) => {
        onClose();
        if (returnFocus) opener.current?.focus();
      }}
    />
  );
};
