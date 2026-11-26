import { X } from "lucide-react";
import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { isImageOriginal } from "../../shared/lib/imageData";
import { FOCUS_RING } from "../../shared/lib/palette";
import { useDiagramStore } from "../../shared/lib/store";
import type { DiagramNode } from "../../shared/lib/types";
import { isMacPlatform } from "../../shared/lib/windowChrome";
import { DialogCaption } from "../../shared/ui/DialogCaption";
import { ICON_STROKE } from "../../shared/ui/IconButton";
import { Toaster } from "../../shared/ui/Toaster";
import { useCanvasUiStore } from "./canvasUiStore";
import { readImageFile } from "./imageFiles";
import { viewableImage } from "./openImageView";

/**
 * What the picture leaves around it when it fits the window: the sides,
 * above (the close button; off macOS also the caption band and its buttons,
 * Win-ImageViewer) and below (the bar). The view's classes repeat these.
 */
const MARGIN_X = 48;
const MARGIN_BOTTOM = 88;
const marginTop = (mac: boolean): number => (mac ? 64 : 104);
/** a press that moves farther than this before it lets go dragged the picture — no click */
const DRAG_SLOP = 4;

interface Size {
  width: number;
  height: number;
}

/**
 * What the view shows: the file the image was made from (`original`) once it
 * is read, the copy stored in the diagram until then and whenever the file
 * cannot be read — moved, renamed, deleted, or past `read_image_file`'s limits.
 * A read that finishes after the view closed (or the link changed) is dropped
 * and its URL let go.
 */
export const useViewedPicture = (
  src: string | undefined,
  original: string | undefined,
): { url: string | undefined; original: boolean; missing: boolean } => {
  const [read, setRead] = useState<{ url: string } | "missing" | null>(null);
  useEffect(() => {
    setRead(null);
    // only a link the document rules allow: a local picture file (`isImageOriginal`)
    if (!isImageOriginal(original)) return;
    let live = true;
    let url: string | null = null;
    readImageFile(original).then(
      (blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setRead({ url });
      },
      () => {
        if (live) setRead("missing");
      },
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [original]);
  if (read !== null && read !== "missing") return { url: read.url, original: true, missing: false };
  return { url: src, original: false, missing: read === "missing" };
};

const count = (n: number): string => n.toLocaleString("en-US");

/** the bar's words: which picture this is, and its size in pixels */
export const viewCaption = (
  size: Size,
  picture: { original: boolean; missing: boolean },
): string => {
  const pixels = `${count(size.width)} × ${count(size.height)}`;
  if (picture.original) return `Original · ${pixels}`;
  return picture.missing ? `${pixels} · Original not found` : pixels;
};

const useWindowSize = (): Size => {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
};

const ModeButton = ({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    aria-pressed={pressed}
    onClick={onClick}
    className={`flex h-8 items-center rounded-md px-2.5 text-[12px] font-semibold text-icon transition-colors hover:bg-hover aria-pressed:bg-selected aria-pressed:text-ink ${FOCUS_RING}`}
  >
    {children}
  </button>
);

/**
 * The image node `imageView` names, large over the whole window (#279 —
 * opened by double-click, a Space tap, View image on the shape menu or the
 * edit bar). A modal `<dialog>`: the top layer covers the chrome too, and the
 * canvas's keys stand down while it is open (`canvasKeymap`). An image that
 * lost its picture ("No image") opens nothing.
 */
export const ImageView = () => {
  const id = useCanvasUiStore((s) => s.imageView);
  const node = useDiagramStore((s) => (id ? s.nodes.find((n) => n.id === id) : undefined));
  const shown = id !== null && node !== undefined && viewableImage(node);
  // nothing to show is closed too: the notices go back to the window
  useEffect(() => {
    if (id !== null && !shown) useCanvasUiStore.getState().setImageView(null);
  }, [id, shown]);
  return shown ? <ImageViewDialog key={id} node={node} /> : null;
};

const ImageViewDialog = ({ node }: { node: DiagramNode }) => {
  const shell = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLElement>(null);
  /** what had focus when it opened — it gets it back */
  const opener = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const closed = useRef(false);
  /**
   * A press on the 100% picture: where it started, whether it has dragged
   * since, and whether it began on the picture — decided at the press, as the
   * captured pointer's release reports the scroller, not what was under it.
   */
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
    onPicture: boolean;
  } | null>(null);
  /** where a click asked for 100%, as a share of the picture — 100% opens there */
  const zoomAt = useRef({ x: 0.5, y: 0.5 });
  const picture = useViewedPicture(node.data.src, node.data.original);
  // a size measured for another URL (the stored copy, before the original came) is not this one's
  const [measured, setMeasured] = useState<{ url: string; size: Size } | null>(null);
  const natural = measured && measured.url === picture.url ? measured.size : null;
  const [actual, setActual] = useState(false);
  const win = useWindowSize();
  const mac = isMacPlatform();
  const alt = node.data.label.trim() || "Image";
  const larger =
    natural !== null &&
    (natural.width > win.width - 2 * MARGIN_X ||
      natural.height > win.height - marginTop(mac) - MARGIN_BOTTOM);
  const atActualSize = actual && larger;

  // modal before the first paint; StrictMode's second run finds it open. The
  // focus goes to the view itself, not its first button — a ring on Close
  // reads as a choice already made
  useLayoutEffect(() => {
    if (shell.current && !shell.current.open) shell.current.showModal();
    shell.current?.focus();
  }, []);
  // gone is closed too — StrictMode's second mount opens it again. Gone
  // without a close (the node deleted, another document on screen), the focus
  // still goes back to where it was
  useEffect(() => {
    closed.current = false;
    return () => {
      if (!closed.current && opener.current?.isConnected) opener.current.focus();
      closed.current = true;
    };
  }, []);
  // 100% opens on the spot that was clicked (the middle, from the bar) and
  // takes the focus, so the arrow keys scroll it; Fit gives it back to the view
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!atActualSize || !el) {
      if (shell.current?.open && shell.current.contains(document.activeElement) === false) {
        shell.current.focus();
      }
      return;
    }
    const at = zoomAt.current;
    const img = el.querySelector("img");
    el.scrollLeft = (img?.offsetLeft ?? 0) + (img?.offsetWidth ?? 0) * at.x - el.clientWidth / 2;
    el.scrollTop = (img?.offsetTop ?? 0) + (img?.offsetHeight ?? 0) * at.y - el.clientHeight / 2;
    zoomAt.current = { x: 0.5, y: 0.5 };
    el.focus();
  }, [atActualSize]);

  const close = () => {
    if (closed.current) return;
    closed.current = true;
    shell.current?.close();
    useCanvasUiStore.getState().setImageView(null);
    if (opener.current?.isConnected) opener.current.focus();
  };

  const measure = (e: { currentTarget: HTMLImageElement }) => {
    const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
    if (picture.url) setMeasured({ url: picture.url, size: { width, height } });
  };

  const zoomIn = (e: MouseEvent<HTMLImageElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) {
      zoomAt.current = {
        x: (e.clientX - box.left) / box.width,
        y: (e.clientY - box.top) / box.height,
      };
    }
    setActual(true);
  };

  const startDrag = (e: PointerEvent<HTMLElement>) => {
    const el = scroller.current;
    if (!el || e.button !== 0) return;
    // a press on the scrollbars is theirs
    const box = el.getBoundingClientRect();
    const onScrollbar =
      el.clientWidth > 0 &&
      (e.clientX - box.left >= el.clientWidth || e.clientY - box.top >= el.clientHeight);
    if (onScrollbar) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
      moved: false,
      onPicture: e.target instanceof HTMLImageElement,
    };
    el.setPointerCapture?.(e.pointerId);
  };
  const moveDrag = (e: PointerEvent<HTMLElement>) => {
    const el = scroller.current;
    const from = drag.current;
    if (!el || !from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) from.moved = true;
    el.scrollLeft = from.left - dx;
    el.scrollTop = from.top - dy;
  };
  /** a press that did not drag is a click: on the picture back to Fit, beside it closes */
  const endDrag = () => {
    const from = drag.current;
    drag.current = null;
    if (!from || from.moved) return;
    if (from.onPicture) setActual(false);
    else close();
  };

  return (
    // the dialog is the whole window's backdrop; ::backdrop stays clear, as it
    // reads no theme variables in older WebKit
    <dialog
      ref={shell}
      aria-modal="true"
      aria-label={alt}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== " ") return;
        // the canvas's own Space (a tap opens this view) must not see the key
        // that closed it, or its release would open it again
        e.stopPropagation();
        // on a button Space presses it; anywhere else it closes, as Escape does
        if (e.target instanceof Element && e.target.closest("button")) return;
        e.preventDefault();
        close();
      }}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClose={() => {
        // closed by the browser all the same
        if (!closed.current) close();
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 bg-frame/94 p-0 text-ink outline-none backdrop:bg-transparent"
    >
      {atActualSize && natural ? (
        <section
          ref={scroller}
          data-testid="image-view-scroller"
          aria-label={`${alt} at 100%`}
          // the arrow keys and Page Up/Down scroll it
          tabIndex={-1}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={() => {
            drag.current = null;
          }}
          className="absolute inset-0 cursor-grab overflow-auto outline-none active:cursor-grabbing"
        >
          <div
            className={`flex min-h-full w-max min-w-full items-center justify-center px-[48px] pb-[88px] ${mac ? "pt-[64px]" : "pt-[104px]"}`}
          >
            {/* one picture pixel is one point: its own size, unscaled */}
            <img
              src={picture.url}
              alt={alt}
              draggable={false}
              onLoad={measure}
              className="block max-w-none shadow-overlay ring-1 ring-line"
            />
          </div>
        </section>
      ) : (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop's click is a pointer shortcut — Escape, Space and the close button are the keyboard's
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          className={`absolute inset-0 flex items-center justify-center px-[48px] pb-[88px] ${mac ? "pt-[64px]" : "pt-[104px]"}`}
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: a click zooms; the bar's Fit and 100% are the keyboard's way */}
          <img
            src={picture.url}
            alt={alt}
            draggable={false}
            onLoad={measure}
            onClick={larger ? zoomIn : undefined}
            className={`block max-h-full max-w-full object-contain shadow-overlay ring-1 ring-line ${larger ? "cursor-zoom-in" : ""}`}
          />
        </div>
      )}
      <button
        type="button"
        aria-label="Close image"
        onClick={close}
        // off macOS below the caption band, clear of the window's own buttons
        className={`absolute right-3 flex h-10 w-10 items-center justify-center rounded-(--radius-island) bg-surface text-icon shadow-raised transition-colors hover:bg-hover ${mac ? "top-3" : "top-[52px]"} ${FOCUS_RING}`}
      >
        <X size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
      </button>
      {natural ? (
        <div
          role="toolbar"
          aria-label="Image view"
          className="absolute bottom-6 left-1/2 flex h-10 -translate-x-1/2 items-center gap-0.5 rounded-(--radius-island) bg-surface px-1 shadow-raised"
        >
          {larger ? (
            <>
              <ModeButton pressed={!actual} onClick={() => setActual(false)}>
                Fit
              </ModeButton>
              <ModeButton pressed={actual} onClick={() => setActual(true)}>
                100%
              </ModeButton>
              <span aria-hidden="true" className="mx-1.5 h-4 w-px bg-line" />
            </>
          ) : null}
          <span
            className={`whitespace-nowrap text-[12px] font-medium text-muted-strong tabular-nums ${larger ? "pr-2.5" : "px-2.5"}`}
          >
            {viewCaption(natural, picture)}
          </span>
        </div>
      ) : null}
      {/* notices stay readable over the view: above its bar (64 + 8), the sheet's lifts not this window's */}
      <div className="pointer-events-none fixed inset-0 [--dsk-toast-board-lift:0px] [--dsk-toast-editor-lift:56px] [--dsk-toast-lift:0px] [--dsk-toast-right:0px]">
        <Toaster />
      </div>
      {/* off macOS, the window's caption buttons above the view */}
      <DialogCaption />
    </dialog>
  );
};
