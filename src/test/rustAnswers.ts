import type { InvokeArgs } from "@tauri-apps/api/core";

/**
 * What Rust answers the library's commands, for a test's `invoke` mock to
 * answer the same — the app takes no other shape (#253).
 */

/** a stamp as Rust makes one, `<mtime>-<length>-<hash>`: the same contents, the same tail */
const stampOf = (text: string): string => {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return `0-${text.length}-${(hash >>> 0).toString(16)}`;
};

/**
 * `load_project`'s answer for a file holding `contents` — a document, or its
 * text — named after the document's title, as its file would be.
 */
export const loadedFile = (
  contents: unknown,
  stamp?: string,
): { contents: string; name: string; stamp: string } => {
  const text = typeof contents === "string" ? contents : JSON.stringify(contents);
  let name = "Untitled Diagram";
  try {
    const title: unknown = (JSON.parse(text) as { title?: unknown } | null)?.title;
    if (typeof title === "string") name = title;
  } catch {
    // not JSON: the app throws on it before the name matters
  }
  return { contents: text, name, stamp: stamp ?? stampOf(text) };
};

/**
 * `save_project`'s answer for a write of `args` that went through: written
 * under the title the document carries — its file's name — with the stamp
 * of what it holds.
 */
export const savedFor = (args?: InvokeArgs): { kind: "saved"; name: string; stamp: string } => {
  const contents = (args as { contents?: unknown } | undefined)?.contents;
  const text = typeof contents === "string" ? contents : "";
  return { kind: "saved", name: loadedFile(text).name, stamp: stampOf(text) };
};

/**
 * An `invoke` mock's implementation answering in Rust's shapes: what `inner`
 * leaves `undefined` for `save_project` was written, and the text it gives
 * for `load_project` is the file's contents.
 */
export const likeRust =
  (inner?: (cmd: string, args?: InvokeArgs) => unknown) =>
  async (cmd: string, args?: InvokeArgs): Promise<unknown> => {
    const answer = await inner?.(cmd, args);
    if (cmd === "save_project" && answer === undefined) return savedFor(args);
    if (cmd === "load_project" && typeof answer === "string") return loadedFile(answer);
    return answer;
  };
