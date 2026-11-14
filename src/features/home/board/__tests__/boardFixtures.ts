import type { FolderMeta, ProjectMeta } from "../../../library/libraryApi";

/** `n` diagrams, newest first — `d0` is the latest; each one canvas, readable */
export const diagrams = (n: number, prefix = "d"): ProjectMeta[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    title: `${prefix.toUpperCase()} ${i}`,
    updatedAt: 1000 - i,
    readable: true,
  }));

/** a project `id` holding `n` diagrams (ids `${id}-0`…) */
export const folder = (id: string, n: number, extra: Partial<FolderMeta> = {}): FolderMeta => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  updatedAt: 1000,
  diagrams: diagrams(n, `${id}-`),
  folders: [],
  ...extra,
});
