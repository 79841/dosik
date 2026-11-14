import { useDiagramStore } from "../../shared/lib/store";
import type { DiagramDoc } from "../../shared/lib/types";

/** the document as the bridge serves it: the file — one canvas (#229 D15) */
export const bridgeSnapshot = (): DiagramDoc => useDiagramStore.getState().toDoc();
