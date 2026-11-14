import type { FolderMeta } from "./libraryApi";
import { findFolder } from "./libraryTree";

/**
 * What the Home tab shows (#220 D1) — one value, read by Home and by the
 * sidebar's selection alike, so the two can never disagree. The dashboard,
 * Recent, or a folder at any depth — a project is the top one (#229 D5).
 * There is no view of a diagram (#231 D1): a diagram opens in its tab, and a
 * card picked on Home is a selection, not a view (`homeSelection`, D7).
 */
export type HomeView =
  | { kind: "dashboard" }
  | { kind: "recent" }
  | { kind: "folder"; folder: string };

export const DASHBOARD: HomeView = { kind: "dashboard" };

/**
 * The view as the listing allows it: a folder that is gone is the
 * dashboard. Before the first listing there is nothing to check against, so
 * the view stands (Home shows its loading state).
 */
export const resolveHomeView = (view: HomeView, folders: FolderMeta[] | null): HomeView => {
  if (folders === null) return view;
  switch (view.kind) {
    case "dashboard":
    case "recent":
      return view;
    case "folder":
      return findFolder(folders, view.folder) ? view : DASHBOARD;
  }
};

/** the listed folder a view is about — a folder view's own; none for the dashboard and Recent */
export const homeFolderOf = (view: HomeView, folders: FolderMeta[] | null): string | null =>
  folders && view.kind === "folder" && findFolder(folders, view.folder) ? view.folder : null;

/** whether two views show the same thing — a fresh object for the same view is no change */
export const sameHomeView = (a: HomeView, b: HomeView): boolean =>
  a.kind === b.kind && (a.kind !== "folder" || a.folder === (b as typeof a).folder);
