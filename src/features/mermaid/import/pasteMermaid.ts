import { useDiagramStore } from "../../../shared/lib/store";
import { toastError, useToastStore } from "../../../shared/lib/toastStore";
import { buildFragment } from "./buildFragment";
import { landingDelta } from "./landing";
import { parseMermaid } from "./parseMermaid";
import { MermaidImportError } from "./plan";

/** what the toast says after a draw (#200 D6, D7) */
export const drewMessage = (shapes: number, omitted: string[], blocks: number): string =>
  [
    `Drew ${shapes} ${shapes === 1 ? "shape" : "shapes"} from Mermaid`,
    ...(blocks > 1 ? [`the first of ${blocks} Mermaid blocks`] : []),
    ...(omitted.length > 0 ? [`not drawn: ${omitted.join(", ")}`] : []),
  ].join(" — ");

/**
 * ⌘V of Mermaid code (#200): parsed, built, and landed on the diagram on screen
 * around `center`, as one undo step. What happened is told in a toast —
 * including a diagram the canvas cannot draw, which leaves the diagram as it was.
 */
let drawing = false;

export const pasteMermaid = async (
  source: { code: string; blocks: number },
  center: { x: number; y: number },
): Promise<void> => {
  // a second ⌘V while the first is still loading mermaid.js would draw it twice
  if (drawing) {
    useToastStore
      .getState()
      .pushToast("Still drawing the previous Mermaid diagram — paste again when it is done");
    return;
  }
  drawing = true;
  try {
    await draw(source, center);
  } finally {
    drawing = false;
  }
};

const draw = async (
  source: { code: string; blocks: number },
  center: { x: number; y: number },
): Promise<void> => {
  const { pushToast } = useToastStore.getState();
  // the first paste loads mermaid.js (several MB): the diagram it was pressed
  // on may be gone by the time the Mermaid one is built
  const session = useDiagramStore.getState().docSession;
  try {
    const plan = await parseMermaid(source.code);
    if (useDiagramStore.getState().docSession !== session) {
      pushToast("The diagram changed before the Mermaid diagram was drawn — paste again", "error");
      return;
    }
    const fragment = buildFragment(plan);
    const shapes = fragment.nodes.filter((n) => n.data.shape !== "anchor").length;
    if (shapes === 0) {
      pushToast("The Mermaid diagram has no shapes to draw", "error");
      return;
    }
    const store = useDiagramStore.getState();
    // a sequence diagram grows sideways with each participant — it moves aside, not down
    const delta = landingDelta(fragment, center, store.nodes, plan.layout?.direction ?? "LR");
    store.insertFragment(fragment, delta);
    pushToast(drewMessage(shapes, plan.omitted, source.blocks));
  } catch (error) {
    if (error instanceof MermaidImportError) pushToast(error.message, "error");
    else toastError(error);
  }
};
