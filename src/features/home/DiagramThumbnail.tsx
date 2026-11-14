import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useThemeStore } from "../../shared/lib/theme";
import { loadPicture, peekPicture } from "./diagramPreview";

/**
 * How far beyond its scroller a lazy picture is still kept — a screen
 * either way, so scrolling back a little finds it there (#220).
 */
const KEEP_MARGIN = "100% 100%";

/**
 * What a lazy picture scrolls in: the nearest scroller (#220), else
 * Home's sheet.
 */
const scrollerOf = (el: HTMLElement): Element | null => {
  for (let up = el.parentElement; up && up.tagName !== "MAIN"; up = up.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(up);
    if (/auto|scroll/.test(`${overflowX} ${overflowY}`)) return up;
  }
  return el.closest("main");
};

/** `of`: the diagram and theme the picture is of — any edition of it */
type Preview =
  | { status: "loading" }
  | { status: "ready"; src: string | null; of: string }
  | { status: "error"; of: string };

/**
 * A diagram as a picture (#161, #220 D14), drawn from its file —
 * nothing is opened. Centred in its box and never drawn larger than itself,
 * so a diagram of one shape does not fill a card; the box decides the size.
 * A newer edition of the picture on show (the same diagram, edited since) keeps
 * the last picture up until it is drawn: back on Home the list in hand may be
 * a write behind, and a placeholder flashing between the two pictures is
 * worse than the last one for a moment (#220).
 *
 * A lazy one is read while it is within reach and let go of once it is out:
 * the picture cache is bounded (D14 ⑤), but a picture a card held would not
 * be, and a Recent view, a project or the library board has no cap on its
 * cards (#220, #221). Coming back, it is the cache's again
 * — up before paint, no placeholder flash — or read anew if the cache has let
 * go of it too. A picture drawn already shows at once, before the observer
 * first reports too; `defer` asks for no new one (the library canvas zoomed
 * far out, #221 D19).
 */
export const DiagramThumbnail = ({
  id,
  updatedAt,
  lazy = false,
  defer = false,
  labelClassName = "text-[11px]",
}: {
  id: string;
  updatedAt: number;
  /**
   * The reach of a lazy picture. `true`: within a screen of its scroller —
   * Home's sheet: a project or Recent of many cards (#161, #220).
   * `"visible"`: in view only — the library board, where a card once passed
   * over is no reason to draw it when the board is zoomed back in somewhere
   * else (#221)
   */
  lazy?: boolean | "visible";
  /** draw nothing new for now — what is drawn already still shows */
  defer?: boolean;
  /** the size of "No preview" / "Empty diagram" — a board card's text scales with the board */
  labelClassName?: string;
}) => {
  const theme = useThemeStore((s) => s.theme);
  const [preview, setPreview] = useState<Preview>(() => {
    const ready = peekPicture(id, updatedAt, theme);
    return ready === undefined
      ? { status: "loading" }
      : { status: "ready", src: ready, of: `${id}:${theme}` };
  });
  /** the same element whatever is shown — every state draws one `div` here */
  const box = useRef<HTMLDivElement>(null);
  const watching = lazy !== false && typeof IntersectionObserver !== "undefined";
  /** `null` until the observer first reports — a picture drawn already shows meanwhile */
  const [near, setNear] = useState<boolean | null>(watching ? null : true);

  useEffect(() => {
    const target = box.current;
    if (!watching || !target) return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.at(-1)?.isIntersecting ?? false),
      lazy === "visible"
        ? // the board: what is on screen now
          undefined
        : // the margin only reaches past the scroller with it as the root
          { root: scrollerOf(target), rootMargin: KEEP_MARGIN },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [watching, lazy]);
  const asked = near === true && !defer;

  // before paint: a picture the cache holds is up at once — a card coming
  // back within reach does not flash its placeholder
  useLayoutEffect(() => {
    if (near === false) {
      // out of reach: the picture goes — the cache keeps what fits its budget,
      // so a list scrolled or a board panned end to end holds no more
      setPreview((now) => (now.status === "loading" ? now : { status: "loading" }));
      return;
    }
    const of = `${id}:${theme}`;
    const ready = peekPicture(id, updatedAt, theme);
    setPreview((now) => {
      if (ready !== undefined) {
        return now.status === "ready" && now.src === ready && now.of === of
          ? now
          : { status: "ready", src: ready, of };
      }
      // a newer edition of the picture on show stays up until it is drawn
      return now.status === "loading" || now.of === of ? now : { status: "loading" };
    });
    if (!asked) return;
    if (ready !== undefined) {
      // shown again: it is the most recently shown picture now
      void loadPicture(id, updatedAt, theme).catch(() => undefined);
      return;
    }
    let alive = true;
    loadPicture(id, updatedAt, theme).then(
      (src) => alive && setPreview({ status: "ready", src, of }),
      () => alive && setPreview({ status: "error", of }),
    );
    return () => {
      alive = false;
    };
  }, [id, updatedAt, theme, near, asked]);

  const centred = "flex h-full w-full items-center justify-center";
  const label = `${centred} text-muted ${labelClassName}`;
  return (
    // one box in every state: a lazy picture that starts drawn is watched all
    // the same, so a later edit or theme still gets drawn (#221)
    <div
      ref={box}
      className={
        preview.status === "loading"
          ? // asked for nothing (deferred, out of reach): a still tone, not hundreds of pulses
            `h-full w-full bg-frame ${asked ? "animate-pulse" : ""}`
          : preview.status === "error" || preview.src === null
            ? label
            : centred
      }
    >
      {preview.status === "loading" ? null : preview.status === "error" ? (
        "No preview"
      ) : preview.src === null ? (
        "Empty diagram"
      ) : (
        // decorative: the title next to it names the diagram
        <img src={preview.src} alt="" className="max-h-full max-w-full" draggable={false} />
      )}
    </div>
  );
};
