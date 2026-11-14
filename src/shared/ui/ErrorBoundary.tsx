import { Component, type ErrorInfo, type ReactNode } from "react";
import { ACCENT_BUTTON } from "../lib/palette";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort crash screen: a rendering error in any child no longer takes
 * down the whole window, and the document usually survives in the store —
 * "Try again" re-renders without reloading, losing nothing. The fallback
 * fills its container, not the viewport, and is a drag region itself. The
 * chrome band — the window's drag handle and, off macOS, its controls — sits
 * outside the content's and the sidebar's boundaries (#125, #127, #217), so
 * a crash leaves the window movable either way.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        // the outermost boundary's crash takes the chrome band with it — let this be the handle
        data-tauri-drag-region="deep"
        className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[var(--dsk-canvas-bg,#FFFFFF)]"
      >
        <div className="text-[15px] font-semibold text-ink">Something went wrong</div>
        <div className="max-w-xl overflow-auto rounded-lg bg-surface px-4 py-3 text-[12px] text-danger shadow-raised">
          {this.state.error.message}
        </div>
        <button
          type="button"
          className={`rounded-md px-4 py-2 text-[12.5px] font-medium ${ACCENT_BUTTON}`}
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}
