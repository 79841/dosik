import { nanoid } from "nanoid";
import { create } from "zustand";

export type ToastKind = "info" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  /** the whole sentence, shortcut included — what a screen reader reads */
  text: string;
  /** a shortcut inside `text` ("⌘\"), drawn apart as a `kbd` where it stands (#231 D18) */
  keys?: string;
  /**
   * the start of `text` that is read out but not drawn ("Error: ") — on
   * screen an error's alert icon says it (#231 D18, DS `.dsk-toast--error`)
   */
  prefix?: string;
}

export interface ToastOptions {
  keys?: string;
  prefix?: string;
}

/** why a toast is being kept open; each reason is released independently */
export type HoldReason = "pointer" | "focus";

/** how long a toast stays before it dismisses itself, per kind (ms) */
export const TOAST_DURATION: Record<ToastKind, number> = {
  info: 2500,
  // an error is something the user has to read, not just notice
  error: 5000,
};

/**
 * How many toasts stack at once. A burst (say, three exports in a row plus an
 * error) should stay readable; past this the oldest goes, since it is the one
 * closest to expiring anyway.
 */
export const MAX_TOASTS = 4;

interface ToastState {
  toasts: Toast[];
  /** shows a toast; it dismisses itself after TOAST_DURATION[kind] */
  pushToast: (text: string, kind?: ToastKind, options?: ToastOptions) => string;
  dismissToast: (id: string) => void;
  dismissAll: () => void;
  /** stops the clock for as long as at least one reason is held */
  holdToast: (id: string, reason: HoldReason) => void;
  /** drops one reason; the clock restarts from the full duration once none are left */
  releaseToast: (id: string, reason: HoldReason) => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** pointer and focus hold independently — a toast under the pointer must not expire because focus left it */
const holds = new Map<string, Set<HoldReason>>();

const forget = (id: string) => {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
};

const isHeld = (id: string) => (holds.get(id)?.size ?? 0) > 0;

/**
 * Which toasts to drop when a push overflows the cap: never one that is being
 * read or about to be clicked (held), and info before error — an error is the
 * one message in the stack the user cannot afford to miss.
 */
const overflowVictims = (toasts: Toast[], count: number): Toast[] => {
  const evictable = toasts.filter((t) => !isHeld(t.id));
  const infoFirst = [
    ...evictable.filter((t) => t.kind === "info"),
    ...evictable.filter((t) => t.kind === "error"),
  ];
  return infoFirst.slice(0, count);
};

/**
 * Transient notifications — "Saved", "Error: …". They live here rather than
 * in the component that raised them so the toolbar, exports and future
 * surfaces all notify the same way, and so the stack can be tested without
 * rendering.
 */
export const useToastStore = create<ToastState>((set, get) => {
  const remove = (ids: string[]) => {
    for (const id of ids) {
      forget(id);
      holds.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((t) => !ids.includes(t.id)) }));
  };
  const arm = (toast: Toast) => {
    forget(toast.id);
    timers.set(
      toast.id,
      setTimeout(() => remove([toast.id]), TOAST_DURATION[toast.kind]),
    );
  };
  return {
    toasts: [],
    pushToast: (text, kind = "info", { keys, prefix }: ToastOptions = {}) => {
      const toast: Toast = { id: nanoid(6), kind, text, keys, prefix };
      const excess = get().toasts.length + 1 - MAX_TOASTS;
      // the cap is soft: if everything on screen is held, nothing is taken away
      if (excess > 0) remove(overflowVictims(get().toasts, excess).map((t) => t.id));
      set((s) => ({ toasts: [...s.toasts, toast] }));
      arm(toast);
      return toast.id;
    },
    dismissToast: (id) => remove([id]),
    dismissAll: () => {
      for (const id of timers.keys()) forget(id);
      holds.clear();
      set({ toasts: [] });
    },
    holdToast: (id, reason) => {
      if (!get().toasts.some((t) => t.id === id)) return;
      const reasons = holds.get(id) ?? new Set<HoldReason>();
      reasons.add(reason);
      holds.set(id, reasons);
      forget(id);
    },
    releaseToast: (id, reason) => {
      const reasons = holds.get(id);
      reasons?.delete(reason);
      if (reasons?.size === 0) holds.delete(id);
      if (isHeld(id)) return;
      const toast = get().toasts.find((t) => t.id === id);
      if (toast) arm(toast);
    },
  };
});

/** what a caught error's toast is read out with — drawn as the alert icon instead */
const ERROR_PREFIX = "Error: ";

/**
 * `pushToast` for a caught error — the message is always prefixed so it reads
 * as one; the prefix stays in `text` and is only hidden from sight (#231 D18)
 */
export const toastError = (error: unknown): string =>
  useToastStore
    .getState()
    .pushToast(
      `${ERROR_PREFIX}${error instanceof Error ? error.message : String(error)}`,
      "error",
      { prefix: ERROR_PREFIX },
    );
