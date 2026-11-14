import {
  DESTROY_MARK_R,
  BORDER_TITLE,
  LIFELINE_ACTIVATION_W,
  LIFELINE_HEADER_H,
  SHAPE_STROKE_WIDTH,
} from "../../shared/lib/palette";
import { visibleActivation, visibleDestroyY } from "../../shared/lib/store/opValidation";
import type { FragmentKind } from "../../shared/lib/types";
import { textWidth } from "../../shared/lib/textLayout";
import { CORNER_RADIUS } from "./cornerRadius";
import { MIN_FRAGMENT_BRANCHES } from "../../shared/lib/types";

/*
 * The sequence shapes' drawings, apart from `ShapeNode` (#148). They take
 * sizes and colours and nothing else — no store, no React Flow — so the
 * windowless SVG renderer draws a lifeline or a frame with these very
 * components rather than a second copy of them.
 */

/**
 * Lifeline body (#210 D12): a borderless header tile, a grey dashed line, flat
 * activation bars, and the destroy X in ink.
 */
export const LifelineSvg = ({
  width: w,
  height: h,
  fill,
  line,
  act,
  ink,
  activations,
  destroyY,
}: {
  width: number;
  height: number;
  /** the header tile */
  fill: string;
  /** the dashed line */
  line: string;
  /** an activation bar */
  act: string;
  /** the destroy marker */
  ink: string;
  activations?: { y0: number; y1: number }[];
  destroyY?: number;
}) => {
  const cx = w / 2;
  // the object stops existing at the marker, so the line stops there too
  const destroy = visibleDestroyY(destroyY, h);
  return (
    <>
      {/* the head fills its band, as a tile fills its box — no gap before a line's end */}
      <rect width={w} height={LIFELINE_HEADER_H} rx={CORNER_RADIUS.lifeline} fill={fill} />
      <line
        x1={cx}
        y1={LIFELINE_HEADER_H}
        x2={cx}
        y2={destroy ?? h}
        stroke={line}
        strokeWidth={1.25}
        strokeDasharray="4 4"
      />
      {(activations ?? []).map((raw, index) => {
        const a = visibleActivation(raw, h);
        if (!a) return null;
        return (
          <rect
            // bars are positional; spans can coincide mid-edit, so the index is
            // the stable identity here (a span key would collide)
            // biome-ignore lint/suspicious/noArrayIndexKey: positional bars
            key={index}
            x={cx - LIFELINE_ACTIVATION_W / 2}
            y={a.y0}
            width={LIFELINE_ACTIVATION_W}
            height={a.y1 - a.y0}
            rx={2}
            fill={act}
          />
        );
      })}
      {/* destroy marker last so the X reads on top of any bar it crosses */}
      {destroy !== null ? (
        <>
          <line
            x1={cx - DESTROY_MARK_R}
            y1={destroy - DESTROY_MARK_R}
            x2={cx + DESTROY_MARK_R}
            y2={destroy + DESTROY_MARK_R}
            stroke={ink}
            strokeWidth={2}
            strokeLinecap="round"
          />
          <line
            x1={cx - DESTROY_MARK_R}
            y1={destroy + DESTROY_MARK_R}
            x2={cx + DESTROY_MARK_R}
            y2={destroy - DESTROY_MARK_R}
            stroke={ink}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </>
      ) : null}
    </>
  );
};

/**
 * Combined fragment: a dashed box drawn behind the interaction with the
 * operator set into its top border (#210 D11, the frame's rule) and, for
 * `alt`, dashed dividers splitting the body into equal branches. Deliberately
 * a backdrop — moving it does not move the messages inside (issue #28
 * decision 1).
 */
export const FragmentSvg = ({
  width: w,
  height: h,
  line,
  text,
  patch,
  kind,
  branches,
  interactive = true,
}: {
  width: number;
  height: number;
  /** the dashes: the fragment colour's `line` tone */
  line: string;
  /** the operator's colour */
  text: string;
  /** the canvas colour under the operator — it cuts the dashes */
  patch: string;
  kind: FragmentKind;
  branches?: number;
  /** the canvas's hit targets; a file written outside the app has no pointer (#152) */
  interactive?: boolean;
}) => {
  const i = 0.75;
  const count = kind === "alt" ? (branches ?? MIN_FRAGMENT_BRANCHES) : 1;
  const hit = interactive ? "pointer-events-auto" : undefined;
  const opW = textWidth(kind, BORDER_TITLE.fontSize - 1) + BORDER_TITLE.padX * 2;
  return (
    <>
      {/* only the painted parts are hit targets: the <svg> root is a CSS box and
          would catch the whole empty interior, and the event would bubble to the
          React Flow wrapper anyway (this is why React Flow itself re-enables
          edges per-path, not on the edge svg root) */}
      <rect
        className={hit}
        x={i}
        y={i}
        width={w - i * 2}
        height={h - i * 2}
        rx={CORNER_RADIUS.fragment}
        fill="none"
        stroke={line}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
      <rect
        className={hit}
        x={BORDER_TITLE.inset}
        y={-BORDER_TITLE.height / 2}
        width={opW}
        height={BORDER_TITLE.height}
        fill={patch}
      />
      <text
        className={hit}
        x={BORDER_TITLE.inset + BORDER_TITLE.padX}
        y={0}
        dominantBaseline="central"
        fontSize={BORDER_TITLE.fontSize - 1}
        fontWeight={BORDER_TITLE.fontWeight}
        fill={text}
      >
        {kind}
      </text>
      {Array.from({ length: count - 1 }, (_, idx) => {
        const y = (h / count) * (idx + 1);
        return (
          <line
            // dividers are positional
            // biome-ignore lint/suspicious/noArrayIndexKey: positional dividers
            key={idx}
            x1={i}
            y1={y}
            x2={w - i}
            y2={y}
            stroke={line}
            strokeWidth={SHAPE_STROKE_WIDTH}
            strokeDasharray="4 3"
          />
        );
      })}
    </>
  );
};
