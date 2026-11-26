import {
  fitImageSize,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PIXELS,
  imageSrcError,
  isImageDataUrl,
} from "../../shared/lib/imageData";
import { useDiagramStore } from "../../shared/lib/store";
import { useToastStore } from "../../shared/lib/toastStore";

/**
 * Pictures on their way onto the canvas (#8) — from the clipboard, a dropped
 * file or the palette's file picker. Every path ends in `placeImage`, so a
 * picture is sized, shrunk and checked the same way whichever door it used.
 */
/**
 * Formats stored as they arrive. webp is read but always redrawn: an exported
 * SVG carries the picture as it is, and older PowerPoint and Keynote leave a
 * webp picture blank (#155).
 */
const KEPT_TYPES = ["image/png", "image/jpeg", "image/gif"];

export type ImagePlan =
  | { action: "keep" }
  | { action: "scale"; width: number; height: number; type: "image/png" | "image/jpeg" }
  | { action: "reject"; reason: string };

/**
 * What to do with a decoded picture. Kept as it is when it is small and in a
 * stored format — re-encoding only loses quality. Otherwise redrawn: to at
 * most IMAGE_MAX_PIXELS on the long side, as PNG for PNG/GIF sources (text in
 * a screenshot must stay sharp) and JPEG for photos. A PNG that still comes
 * out over the byte limit drops to JPEG — see `encodeWithin`.
 */
export const planImage = (input: {
  type: string;
  bytes: number;
  width: number;
  height: number;
}): ImagePlan => {
  if (!input.type.startsWith("image/") || input.width <= 0 || input.height <= 0) {
    return { action: "reject", reason: "Not an image" };
  }
  const longest = Math.max(input.width, input.height);
  const fits = longest <= IMAGE_MAX_PIXELS && input.bytes <= IMAGE_MAX_BYTES;
  if (fits && KEPT_TYPES.includes(input.type)) return { action: "keep" };
  const scale = Math.min(1, IMAGE_MAX_PIXELS / longest);
  return {
    action: "scale",
    width: Math.round(input.width * scale),
    height: Math.round(input.height * scale),
    // webp may be a photo or a transparent sticker — PNG keeps the transparency,
    // and a photo too big for PNG drops to JPEG anyway
    type: input.type === "image/jpeg" ? "image/jpeg" : "image/png",
  };
};

export interface DecodedImage {
  src: string;
  width: number;
  height: number;
}

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image"));
    reader.readAsDataURL(blob);
  });

type EncodeType = "image/png" | "image/jpeg";

/**
 * Draws in the preferred format, and again as JPEG when a PNG is over the
 * byte limit. A photo-like picture 1600px wide is several MB as PNG — refusing
 * it would make whether a screenshot can be pasted depend on what was on
 * screen (#155). JPEG only ever comes second, so text stays sharp
 * whenever it fits.
 */
export const encodeWithin = (
  drawAs: (type: EncodeType) => string,
  preferred: EncodeType,
): string => {
  const first = drawAs(preferred);
  return preferred === "image/jpeg" || imageSrcError(first) === null ? first : drawAs("image/jpeg");
};

const draw = (
  source: CanvasImageSource,
  width: number,
  height: number,
  type: EncodeType,
): string => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare the image");
  if (type === "image/jpeg") {
    // JPEG has no transparency — a transparent pixel would come out black
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL(type, 0.9);
};

/** A picture from a file or the clipboard, shrunk if needed and checked. */
export const imageFromBlob = async (blob: Blob): Promise<DecodedImage> => {
  if (!blob.type.startsWith("image/")) throw new Error("Not an image");
  const bitmap = await createImageBitmap(blob).catch(() => {
    throw new Error("This image format cannot be read");
  });
  const plan = planImage({
    type: blob.type,
    bytes: blob.size,
    width: bitmap.width,
    height: bitmap.height,
  });
  try {
    if (plan.action === "reject") throw new Error(plan.reason);
    if (plan.action === "keep") {
      return checked({
        src: await readAsDataUrl(blob),
        width: bitmap.width,
        height: bitmap.height,
      });
    }
    const { width, height } = plan;
    return checked({
      src: encodeWithin((type) => draw(bitmap, width, height, type), plan.type),
      width,
      height,
    });
  } finally {
    // a decoded 4000×3000 picture holds 48 MB until this
    bitmap.close();
  }
};

const checked = (image: DecodedImage): DecodedImage => {
  const error = isImageDataUrl(image.src) ? imageSrcError(image.src) : "Not an image";
  if (error) throw new Error(`The image cannot be added: ${error}`);
  return image;
};

/** what a picture on its way says when the diagram it was meant for is gone from the screen */
export const LEFT_BEFORE_PICTURE =
  "You left the diagram before the picture was added — add it again";

/**
 * The diagram on screen now, for a write that has to await first — a picture
 * being read or decoded, the clipboard being read. `left()` says whether
 * another one has come on screen since (a tab switch, Home: `docSession`
 * moved on) and, if so, says it in a toast; the caller stops there. What was
 * meant for one diagram never lands in another (#218).
 */
export const watchDocument = (message: string): { left: () => boolean } => {
  const session = useDiagramStore.getState().docSession;
  return {
    left: () => {
      if (useDiagramStore.getState().docSession === session) return false;
      useToastStore.getState().pushToast(message, "error");
      return true;
    },
  };
};

/** Adds the picture centred on `center` (flow coordinates). */
export const placeImage = (image: DecodedImage, center: { x: number; y: number }): string => {
  const size = fitImageSize(image.width, image.height);
  return useDiagramStore
    .getState()
    .addImage(image.src, { x: center.x - size.width / 2, y: center.y - size.height / 2 }, size);
};
