import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import { isDiagramDocShape, isMultiPage, MULTI_PAGE_ERROR } from "../../shared/lib/store/document";
import type { DiagramDoc } from "../../shared/lib/types";

export interface FileFilter {
  name: string;
  extensions: string[];
}

export const saveTextFile = async (
  contents: string,
  filters: FileFilter[],
  defaultName: string,
  presetPath?: string | null,
): Promise<string | null> => {
  const path = presetPath ?? (await save({ filters, defaultPath: defaultName }));
  if (!path) return null;
  await invoke("write_text_file", { path, contents });
  return path;
};

export const saveBinaryFile = async (
  base64: string,
  filters: FileFilter[],
  defaultName: string,
): Promise<string | null> => {
  const path = await save({ filters, defaultPath: defaultName });
  if (!path) return null;
  await invoke("write_binary_file", { path, base64 });
  return path;
};

/**
 * Open…'s dialog: the path picked, not read yet — a file already open in a
 * tab is switched to, not read again (#218 D9). `null` when cancelled.
 */
export const pickDiagramPath = async (): Promise<string | null> => {
  const path = await open({
    multiple: false,
    filters: [{ name: "Dosik Diagram", extensions: ["dosik.json", "mdgram.json", "json"] }],
  });
  return typeof path === "string" ? path : null;
};

/** reads and checks a `.dosik.json` at a known path — a picked one, or the OS's (#149) */
export const readDiagramFile = async (path: string): Promise<DiagramDoc> => {
  const contents = await invoke<string>("read_text_file", { path });
  const doc: unknown = JSON.parse(contents);
  // a document with pages was never shipped: it does not open (#229 D2)
  if (isMultiPage(doc)) throw new Error(MULTI_PAGE_ERROR);
  if (!isDiagramDocShape(doc)) throw new Error("Not a valid diagram file");
  return doc;
};
