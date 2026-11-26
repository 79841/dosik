import type { DiagramNode } from "../../shared/lib/types";
import { pickedShapes } from "../inspector/useSelectionEditing";
import { useCanvasUiStore } from "./canvasUiStore";

/** an image with a picture to show — not one that lost it ("No image") */
export const viewableImage = (node: DiagramNode): boolean =>
  node.data.shape === "image" && !!node.data.src;

/**
 * The one shape picked, when it is an image with its picture — what View image
 * (menu and edit bar) and a Space tap open the image view on. Several shapes,
 * or one that is not a picture, open nothing.
 */
export const soleImage = (nodes: DiagramNode[]): DiagramNode | null => {
  const picked = pickedShapes(nodes);
  return picked.length === 1 && viewableImage(picked[0]!) ? picked[0]! : null;
};

/** shows the image node `id` large, over the whole window (`ImageView`) */
export const openImageView = (id: string): void => useCanvasUiStore.getState().setImageView(id);
