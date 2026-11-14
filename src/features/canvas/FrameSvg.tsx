import { FRAME_TITLE_H } from "../../shared/lib/palette";
import { CORNER_RADIUS } from "./cornerRadius";

/** the dashed outline — Cloudflare's groups (#210 D10) */
const FRAME_LINE_WIDTH = 1.5;
/** the invisible band along the outline that can be grabbed, like a resize band (#70) */
const GRAB_BAND = 10;

/**
 * A frame (#170): a titled area drawn behind other shapes — in the Studio
 * style (#210) no fill, a dashed outline in the frame's colour, the title set
 * into the top border by ShapeNode. Only the outline and the title strip are
 * hit targets; the body lets clicks through, so a drag started inside it draws
 * a selection box over its contents (D2).
 */
export const FrameSvg = ({
  width: w,
  height: h,
  line,
  interactive = true,
}: {
  width: number;
  height: number;
  /** the frame colour's `line` tone */
  line: string;
  /** the canvas's hit targets; a file written outside the app has no pointer */
  interactive?: boolean;
}) => {
  const i = FRAME_LINE_WIDTH / 2;
  const r = CORNER_RADIUS.frame;
  return (
    <>
      <rect
        x={i}
        y={i}
        width={Math.max(0, w - i * 2)}
        height={Math.max(0, h - i * 2)}
        rx={r}
        fill="none"
        stroke={line}
        strokeWidth={FRAME_LINE_WIDTH}
        strokeDasharray="4 3"
      />
      {interactive ? (
        <>
          {/* the grab targets: a band over the outline, and the title strip */}
          <rect
            className="pointer-events-auto"
            x={i}
            y={i}
            width={Math.max(0, w - i * 2)}
            height={Math.max(0, h - i * 2)}
            rx={r}
            fill="none"
            stroke="transparent"
            strokeWidth={GRAB_BAND}
          />
          <rect
            className="pointer-events-auto"
            x={0}
            y={0}
            width={w}
            height={Math.min(FRAME_TITLE_H, h)}
            fill="transparent"
          />
        </>
      ) : null}
    </>
  );
};
