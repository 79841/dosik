import type { LayoutDirection } from "../../shared/lib/autoLayout";

/**
 * The Layout menu's two rows and what flipping each one gives (#206). Four
 * directions as two rows with a flip each, not four rows.
 */
export type LayoutAxis = "vertical" | "horizontal";

export const LAYOUT_ROWS: readonly {
  axis: LayoutAxis;
  /** [as is, flipped] */
  directions: readonly [LayoutDirection, LayoutDirection];
}[] = [
  { axis: "vertical", directions: ["TB", "BT"] },
  { axis: "horizontal", directions: ["LR", "RL"] },
];

export const DIRECTION_LABEL: Record<LayoutDirection, string> = {
  TB: "Top to bottom",
  BT: "Bottom to top",
  LR: "Left to right",
  RL: "Right to left",
};

export type Reversed = Record<LayoutAxis, boolean>;

const STORAGE_KEY = "dosik.layout.reversed";
const NONE: Reversed = { vertical: false, horizontal: false };

/** the flips the user left on — a convenience, so a blocked or odd store reads as none */
export const loadReversed = (): Reversed => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (raw === null || typeof raw !== "object") return NONE;
    const { vertical, horizontal } = raw as Record<string, unknown>;
    return { vertical: vertical === true, horizontal: horizontal === true };
  } catch {
    return NONE;
  }
};

export const saveReversed = (reversed: Reversed): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reversed));
  } catch {
    // not remembered — the flip still applies until the app closes
  }
};
