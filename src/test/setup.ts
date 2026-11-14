import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

// React Flow measures nodes with ResizeObserver, which jsdom lacks.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverMock as unknown as typeof ResizeObserver;

/**
 * jsdom has `<dialog>` but none of its methods (#220) — enough of
 * them, as browsers behave: `showModal()` opens it, `close()` shuts it with a
 * `close` event, and an Escape nobody took (keydown not default-prevented)
 * becomes the top modal's cancelable `cancel`, which closes it unless prevented.
 * Inertness and the top layer are layout — not here.
 */
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  const modals: HTMLDialogElement[] = [];
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    if (this.open) return;
    this.open = true;
    modals.push(this);
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    const at = modals.indexOf(this);
    if (at >= 0) modals.splice(at, 1);
    this.dispatchEvent(new Event("close"));
  };
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const top = modals.filter((d) => d.isConnected && d.open).at(-1);
    if (top?.dispatchEvent(new Event("cancel", { cancelable: true }))) top.close();
  });
}

afterEach(() => {
  vi.clearAllMocks();
});
