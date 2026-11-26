import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";

import { toastError } from "../../shared/lib/toastStore";
import { droppedImagePaths, readImageFile } from "./imageFiles";
import { imageFromBlob, LEFT_BEFORE_PICTURE, placeImage, watchDocument } from "./imageInput";

/** each further file of a multi-file drop lands this far down and right of the last */
export const DROP_STACK_OFFSET = 24;

/**
 * Places decoded pictures around `at`, reporting each failure without
 * stopping the rest — in the diagram they were dropped (or pasted) on: once
 * another is on screen, the rest are not read and none lands there, and
 * `leftMessage` says so.
 */
export const placeBlobs = async (
  blobs: (() => Promise<Blob>)[],
  at: { x: number; y: number },
  leftMessage = LEFT_BEFORE_PICTURE,
) => {
  const dropped = watchDocument(leftMessage);
  for (const [index, load] of blobs.entries()) {
    try {
      const image = await imageFromBlob(await load());
      if (dropped.left()) return;
      placeImage(image, {
        x: at.x + index * DROP_STACK_OFFSET,
        y: at.y + index * DROP_STACK_OFFSET,
      });
    } catch (error) {
      toastError(error);
    }
  }
};

/**
 * Picture files dropped from Finder (#8). Tauri takes file drops before the
 * webview sees them (the HTML5 drop never carries the files), so they arrive
 * as paths on the webview's drag-drop event. Outside Tauri there is no such
 * event, and the canvas's own `onDrop` handles dropped files instead.
 */
export const useImageFileDrop = (
  toFlow: (p: { x: number; y: number }) => { x: number; y: number },
) => {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return;
          const paths = droppedImagePaths(event.payload.paths);
          if (paths.length === 0) return;
          // physical pixels — the canvas speaks CSS pixels
          const scale = window.devicePixelRatio || 1;
          const at = toFlow({
            x: event.payload.position.x / scale,
            y: event.payload.position.y / scale,
          });
          void placeBlobs(
            paths.map((path) => () => readImageFile(path)),
            at,
          );
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => undefined);
    } catch {
      // not in Tauri (`pnpm dev`): no webview to listen to
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [toFlow]);
};
