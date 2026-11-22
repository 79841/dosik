import { FolderOpen } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { focusStillWith } from "../../../shared/lib/focusGuard";

import { type ThemePreference, useThemeStore } from "../../../shared/lib/theme";
import { toastError } from "../../../shared/lib/toastStore";
import { showNamedInLabel } from "../../library/fileManager";
import {
  addFolderToLibrary,
  changeDefaultLocation,
  locateProjectAsking,
  plural,
  removeFromLibrary,
  showItemInFinder,
} from "../../library/libraryActions";
import { type FolderMeta, libraryRoot, showLibraryInFinder } from "../../library/libraryApi";
import { refreshLibraryQuietly, useLibraryStore } from "../../library/libraryStore";
import {
  Button,
  Group,
  Groups,
  IconAction,
  Mono,
  Pill,
  Row,
  Segmented,
  Status,
  useLoaded,
} from "../parts";
import { platformCopy } from "../platformCopy";

const THEMES = ["Light", "Dark", "System"] as const;
type ThemeLabel = (typeof THEMES)[number];
const LABEL: Record<ThemePreference, ThemeLabel> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};
const PREFERENCE: Record<ThemeLabel, ThemePreference> = {
  Light: "light",
  Dark: "dark",
  System: "system",
};

/** a folder's own name, the last of its path — `/` or `\` between names */
const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/**
 * Settings ▸ General (#252): Appearance (the theme), and Library (#256 R2) —
 * where new projects go, then every folder in the library.
 */
export const GeneralSection = () => {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  return (
    <Groups>
      <Group title="Appearance">
        <Row title="Theme" description={platformCopy().theme}>
          <Segmented
            label="Theme"
            value={LABEL[preference]}
            options={THEMES}
            onChange={(label) => setPreference(PREFERENCE[label])}
          />
        </Row>
      </Group>
      <LibraryGroups />
    </Groups>
  );
};

/**
 * Library (#256 R2, `Settings-Panes`): Default location — where New project
 * makes its folder, Change… picks another — then Folders in the library: the
 * default location first, with how many projects are in it (every folder in
 * it is one); each folder added from elsewhere, one project each, with Show
 * in Finder and Remove (it leaves the library, its files stay); each one
 * that cannot be found, with Locate…; and Add folder…, as in the sidebar.
 * The rows follow the library while Settings is open. A value still on its
 * way keeps its line empty, so nothing jumps when it comes.
 */
const LibraryGroups = () => {
  /** read again once Change… has moved the default location */
  const [moves, setMoves] = useState(0);
  const root = useLoaded(libraryRoot, moves);
  const folders = useLibraryStore((s) => s.folders);
  const addButton = useRef<HTMLDivElement>(null);
  /** each row's Show in Finder, by folder id: `${showId}${id}` */
  const showId = useId();
  /**
   * Where the focus goes once the rows show what a Remove or a Locate… came
   * to — the row the folder moved to, or Add folder… — its button gone
   * with the row it was on.
   */
  const [focusNext, setFocusNext] = useState<{ show?: string } | null>(null);

  useEffect(() => {
    if (!focusNext) return;
    setFocusNext(null);
    const add = addButton.current?.querySelector("button");
    // only while the focus is nowhere or still in the group — not taken from
    // where the user went meanwhile (#218 D15)
    if (!add || !focusStillWith(add.closest("section"))) return;
    const show = focusNext.show ? document.getElementById(`${showId}${focusNext.show}`) : null;
    (show ?? add).focus();
  }, [focusNext, showId]);

  useEffect(() => {
    // nothing has listed the library yet (Settings opened from the editor first)
    if (useLibraryStore.getState().folders === null) refreshLibraryQuietly();
  }, []);

  const projects = folders ?? [];
  // the default location's projects it finds — none of one that is not found
  const inDefault = projects.filter((f) => !f.added && !f.missing).length;
  const added = projects.filter((f) => f.added && !f.missing);
  const lost = projects.filter((f) => f.added && f.missing);

  const change = () => {
    void changeDefaultLocation().then((changed) => {
      if (changed) setMoves((n) => n + 1);
    });
  };
  const remove = (folder: FolderMeta) => {
    void removeFromLibrary(folder).then((removed) => {
      // its row went with the button: the focus stays in the group, on Add folder…
      if (removed) setFocusNext({});
    });
  };
  const locate = (folder: FolderMeta) => {
    void locateProjectAsking(folder).then((located) => {
      // its row moved among the folders added: the focus follows it
      if (located) setFocusNext({ show: folder.id });
    });
  };
  const place = (folder: FolderMeta) => <Mono>{folder.shown ?? folder.path ?? ""}</Mono>;

  return (
    <>
      <Group title="Library">
        <Row
          title="Default location"
          description={
            root ? (
              <>
                New projects go here — <Mono>{root.shown}</Mono>
              </>
            ) : (
              ""
            )
          }
        >
          <Button onClick={change}>Change…</Button>
        </Row>
      </Group>
      <Group title="Folders in the library">
        <Row
          key="default"
          title={root ? folderName(root.path) : ""}
          description={
            root ? (
              <>
                <Mono>{root.shown}</Mono>
                {folders ? ` · ${plural(inDefault, "project")}` : ""}
              </>
            ) : (
              ""
            )
          }
        >
          <Pill>Default</Pill>
          <IconAction
            icon={FolderOpen}
            label={showNamedInLabel(root ? folderName(root.path) : "the library folder")}
            onClick={() => void showLibraryInFinder().catch(toastError)}
          />
        </Row>
        {added.map((folder) => (
          <Row key={folder.id} title={folder.name} description={place(folder)}>
            <IconAction
              id={`${showId}${folder.id}`}
              icon={FolderOpen}
              label={showNamedInLabel(folder.name)}
              onClick={() => void showItemInFinder("folder", folder.id)}
            />
            <Button kind="ghost" label={`Remove ${folder.name}`} onClick={() => remove(folder)}>
              Remove
            </Button>
          </Row>
        ))}
        {lost.map((folder) => (
          <Row key={folder.id} title={folder.name} description={place(folder)}>
            <Status tone="warn">Not found</Status>
            <Button label={`Locate ${folder.name}`} onClick={() => locate(folder)}>
              Locate…
            </Button>
            <Button kind="ghost" label={`Remove ${folder.name}`} onClick={() => remove(folder)}>
              Remove
            </Button>
          </Row>
        ))}
        <div key="add" ref={addButton} className="py-2.5">
          <Button icon={FolderOpen} onClick={() => void addFolderToLibrary()}>
            Add folder…
          </Button>
        </div>
      </Group>
    </>
  );
};
