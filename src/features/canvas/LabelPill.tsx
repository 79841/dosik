import { useRef } from "react";

import { useCommitDrafts } from "../../shared/lib/commitDrafts";
import type { Point } from "../../shared/lib/edgeGeometry";
import { THEME_CANVAS_BG } from "../../shared/lib/palette";
import { PLAIN_TEXT } from "../../shared/ui/plainText";

export interface LabelPillProps {
  point: Point;
  text: string;
  color: string;
  editing: boolean;
  draggable?: boolean;
  onStartDrag?: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
  /** ends the edit with this text */
  onCommitText: (text: string) => void;
  /** writes this text and keeps editing — Save's request (#219) */
  onWriteText: (text: string) => void;
}

/**
 * The label's inline editor. Enter and blur end the edit with what is typed,
 * Escape with the old text; Save writes what is typed and leaves it open.
 */
const LabelEditor = ({
  text,
  color,
  onCommitText,
  onWriteText,
}: Pick<LabelPillProps, "text" | "color" | "onCommitText" | "onWriteText">) => {
  const ref = useRef<HTMLInputElement>(null);
  useCommitDrafts(true, () => {
    if (ref.current) onWriteText(ref.current.value);
  });
  return (
    <input
      {...PLAIN_TEXT}
      ref={ref}
      autoFocus
      defaultValue={text}
      className="w-28 rounded border border-frame-dash bg-surface px-[5px] text-center text-[11px] font-medium outline-none"
      style={{ color }}
      onBlur={(e) => onCommitText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") onCommitText(text);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
};

/**
 * Edge label (#210 D7): the text sits on the line in the line's own colour, on
 * a canvas-coloured patch that cuts the line — no box, no border. Double-click
 * to edit inline (the editor keeps a visible box), optionally draggable.
 *
 * Never a Tailwind `ring` or `shadow` here (#138): both are box-shadows, and
 * `html-to-image` in WKWebView drops their border radius, exporting a square
 * block behind the label. `exportSafeChrome.test.ts` guards it.
 */
export const LabelPill = ({
  point,
  text,
  color,
  editing,
  draggable,
  onStartDrag,
  onDoubleClick,
  onCommitText,
  onWriteText,
}: LabelPillProps) => (
  // z-30: above the z-20 segment grips — the default label spot (t=0.5) can
  // coincide with a grip, which must not steal the label's double-click (#76)
  <div
    className="nodrag nopan absolute z-30"
    style={{
      transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`,
      pointerEvents: "all",
    }}
    onPointerDown={draggable && !editing ? onStartDrag : undefined}
    onDoubleClick={(e) => {
      e.stopPropagation();
      onDoubleClick();
    }}
  >
    {editing ? (
      <LabelEditor
        text={text}
        color={color}
        onCommitText={onCommitText}
        onWriteText={onWriteText}
      />
    ) : (
      <div
        // a canvas-coloured patch cuts the line under the label — no box (#210 D7)
        className={`rounded-[2px] px-[5px] text-[11px] font-medium ${draggable ? "cursor-move" : ""}`}
        style={{ color, backgroundColor: THEME_CANVAS_BG }}
      >
        {text}
      </div>
    )}
  </div>
);
