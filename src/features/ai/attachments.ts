import { invoke } from "@tauri-apps/api/core";
import { nanoid } from "nanoid";

/**
 * Files that go with a chat message. Any file attaches; what each connection
 * can do with it depends on its kind:
 * - `image` — a picture the vendors read (png, jpeg, gif, webp — told by its
 *   bytes, not its name); other pictures the webview can decode (HEIC, TIFF,
 *   BMP, AVIF) become PNG
 * - `pdf` — a PDF, which both APIs read as a document
 * - `text` — bytes that decode as UTF-8 with no NUL: their words go along,
 *   up to `TEXT_INLINE_MAX`; a longer one goes by name like a `file`
 * - `file` — anything else: the API connections send its name only, the
 *   subscription CLIs get the file itself
 */
export type AttachmentKind = "image" | "pdf" | "text" | "file";

export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  /** bytes as sent — a big picture's after it was scaled down */
  size: number;
  kind: AttachmentKind;
  /** the bytes, base64 — what the API paths send and the CLI paths write to a file */
  base64: string;
  /** a text file's words, when short enough to go inside the message */
  text?: string;
  /** the image node this picture is, when it came from the diagram's selection */
  fromNode?: string;
}

const MB = 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 20 * MB;
/**
 * Past this a picture goes scaled down: the Anthropic API takes 5 MB an image,
 * counted in base64 — 3.75 MB of bytes.
 */
export const MAX_IMAGE_BYTES = (5 * MB * 3) / 4;
/** a picture whose longest side passes this goes scaled down to it — the vendors resize to less anyway */
export const MAX_IMAGE_SIDE = 2048;
/** a text file longer than this goes by name: its words would fill the model's window */
export const TEXT_INLINE_MAX = 200 * 1024;

/** pictures the vendors read as pictures */
export const VENDOR_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/** pictures the vendors do not read, which the webview may decode into a PNG */
const CONVERTIBLE = new Set(["heic", "heif", "tif", "tiff", "bmp", "avif"]);

const extension = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** "4 KB", "1.2 MB" — the size a chip's tooltip and a toast show */
export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / MB;
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, "") : Math.round(mb)} MB`;
};

const startsWith = (bytes: Uint8Array, sig: number[], at = 0): boolean =>
  sig.every((b, i) => bytes[at + i] === b);

/** a picture's type by its first bytes — a ".png" that is a JPEG is a JPEG */
export const sniffImage = (bytes: Uint8Array): string | null => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
};

const isPdf = (bytes: Uint8Array): boolean => startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);

/** UTF-8 all the way, and no NUL — what reads as words */
const asText = (bytes: Uint8Array): string | null => {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

/** what a file is — `convert` when it is a picture the vendors do not read */
export const classify = (
  name: string,
  mime: string,
  bytes: Uint8Array,
): { kind: AttachmentKind | "convert"; mime: string; text?: string } => {
  const sniffed = sniffImage(bytes);
  if (sniffed) return { kind: "image", mime: sniffed };
  if (isPdf(bytes)) return { kind: "pdf", mime: "application/pdf" };
  const ext = extension(name);
  if (CONVERTIBLE.has(ext) || (mime.startsWith("image/") && mime !== "image/svg+xml")) {
    return { kind: "convert", mime: mime || "application/octet-stream" };
  }
  const text = asText(bytes);
  if (text !== null) {
    return {
      kind: "text",
      mime: mime || "text/plain",
      ...(bytes.length <= TEXT_INLINE_MAX ? { text } : {}),
    };
  }
  return { kind: "file", mime: mime || "application/octet-stream" };
};

export const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
};

export const fromBase64 = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/**
 * A picture redrawn to go: longest side at most 2048, under 3.75 MB, PNG
 * unless it was a JPEG (a PNG still too big goes as JPEG). `keep` when it
 * already fits and need not change type; null when the webview cannot decode it.
 */
export type FitImage = (blob: Blob, mustRedraw: boolean) => Promise<Blob | "keep" | null>;

const canvasFit: FitImage = async (blob, mustRedraw) => {
  // a webview (or a test) without a decoder for it: no bitmap
  const bitmap = await Promise.resolve()
    .then(() => createImageBitmap(blob))
    .catch(() => null);
  if (!bitmap) return null;
  const side = Math.max(bitmap.width, bitmap.height);
  if (!mustRedraw && side <= MAX_IMAGE_SIDE && blob.size <= MAX_IMAGE_BYTES) {
    bitmap.close();
    return "keep";
  }
  const scale = Math.min(1, MAX_IMAGE_SIDE / side);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const type = blob.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const drawn = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (drawn && drawn.size > MAX_IMAGE_BYTES && type === "image/png") {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  }
  return drawn;
};

/**
 * A file as the chat holds it: a picture fitted (and one the vendors do not
 * read converted, or kept as a plain file when the webview cannot decode it).
 * `base64` is the bytes already encoded, kept when they do not change.
 */
export const toAttachment = async (
  name: string,
  mime: string,
  bytes: Uint8Array,
  fitImage: FitImage = canvasFit,
  base64?: string,
): Promise<ChatAttachment> => {
  const found = classify(name, mime, bytes);
  let data = bytes;
  let encoded = base64;
  let kind: AttachmentKind = found.kind === "convert" ? "file" : found.kind;
  let type = found.mime;
  if (found.kind === "image" || found.kind === "convert") {
    const fitted = await fitImage(
      new Blob([bytes as BlobPart], { type: found.mime }),
      found.kind === "convert",
    );
    if (fitted instanceof Blob) {
      if (fitted.size > MAX_IMAGE_BYTES)
        throw new Error(`${name} is too large to send as a picture`);
      data = new Uint8Array(await fitted.arrayBuffer());
      encoded = undefined;
      kind = "image";
      type = fitted.type || type;
    } else if (fitted === null && found.kind === "image" && bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(`${name} is too large to send as a picture`);
    }
    // null for a convertible picture: the webview cannot read it either — a plain file
  }
  return {
    id: nanoid(8),
    name,
    mime: type,
    size: data.length,
    kind,
    base64: encoded ?? toBase64(data),
    ...(found.text !== undefined ? { text: found.text } : {}),
  };
};

export const tooLarge = (name: string, bytes: number): string =>
  `${name} is too large (${Math.ceil(bytes / MB)} MB; the limit is ${MAX_ATTACHMENT_BYTES / MB} MB)`;

const tooMany = (names: string[]): string =>
  `Up to ${MAX_ATTACHMENTS} files per message: ${names.join(", ")} not attached`;

/** a `File` from a paste or a drop on the page */
export const fromFile = async (file: File, fitImage?: FitImage): Promise<ChatAttachment> => {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(tooLarge(file.name, file.size));
  // a pasted screenshot comes as "image.png" with no name of its own
  const name = file.name || `pasted.${file.type.split("/")[1] ?? "bin"}`;
  const bytes = await file
    .arrayBuffer()
    .then((buffer) => new Uint8Array(buffer))
    .catch(() => {
      throw new Error(`Couldn't read ${name}`);
    });
  return toAttachment(name, file.type, bytes, fitImage);
};

type Loaded = { attachments: ChatAttachment[]; errors: string[] };

/** `File`s, read in the webview — only as many as there is room for; the rest named */
export const fromFiles = async (
  files: File[],
  room: number,
  fitImage?: FitImage,
): Promise<Loaded> => {
  const attachments: ChatAttachment[] = [];
  const errors: string[] = [];
  const left = files.slice(room).map((f) => f.name);
  for (const file of files.slice(0, Math.max(0, room))) {
    try {
      attachments.push(await fromFile(file, fitImage));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (left.length > 0) errors.push(tooMany(left));
  return { attachments, errors };
};

/** what Rust read: the file, or why not (`chat_files.rs`) */
interface ReadFile {
  name: string;
  size: number;
  mime?: string;
  base64?: string;
  error?: string;
  /** past the room left: not read */
  left?: boolean;
}

const fromRead = async (files: ReadFile[], fitImage?: FitImage): Promise<Loaded> => {
  const attachments: ChatAttachment[] = [];
  const errors: string[] = [];
  const left: string[] = [];
  for (const file of files) {
    if (file.left) {
      left.push(file.name);
      continue;
    }
    if (file.error || file.base64 === undefined) {
      errors.push(file.error ?? `Couldn't read ${file.name}`);
      continue;
    }
    try {
      attachments.push(
        await toAttachment(
          file.name,
          file.mime ?? "",
          fromBase64(file.base64),
          fitImage,
          file.base64,
        ),
      );
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (left.length > 0) errors.push(tooMany(left));
  return { attachments, errors };
};

/** the system's file dialog — what the user picked, read up to `room` files */
export const pickFiles = async (room: number): Promise<Loaded> =>
  fromRead(await invoke<ReadFile[]>("pick_chat_files", { room }));

/** files Tauri took from a drop on the window (macOS) — only those paths, up to `room` */
export const readDroppedFiles = async (paths: string[], room: number): Promise<Loaded> =>
  fromRead(await invoke<ReadFile[]>("read_dropped_files", { paths, room }));

/** how many more files the composer takes */
export const roomFor = (holding: number): number => Math.max(0, MAX_ATTACHMENTS - holding);
