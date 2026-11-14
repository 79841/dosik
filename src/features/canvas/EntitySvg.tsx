import {
  ENTITY_COLUMN_FONT,
  ENTITY_HEADER_H,
  ENTITY_KEY_FONT,
  ENTITY_NAME_FONT,
  ENTITY_ROW_H,
  ENTITY_ROWS_PAD,
  ENTITY_TEXT_PAD,
  entityKeyGutter,
  parseColumn,
} from "../../shared/lib/entityShape";
import { cardHeaderPath } from "./ClassSvg";
import { CORNER_RADIUS } from "./cornerRadius";

/** the card's 1px edge sits half a pixel in, so it lands on whole pixels */
const EDGE = 0.5;

/**
 * An ERD entity (#5) as an object card (#210 D13): the name on a strip tinted
 * with the node's colour, then one row per column on the card's body — the key
 * in a quiet left gutter, the name, the type right-aligned. Pure — sizes and
 * colours in, SVG out — so the canvas and the windowless SVG export draw it
 * with this same component.
 */
export const EntitySvg = ({
  width: w,
  height: h,
  fill,
  body,
  border,
  text,
  ink,
  muted,
  name,
  columns,
}: {
  width: number;
  height: number;
  /** the header strip: the node colour's tile */
  fill: string;
  /** the card's body under the strip */
  body: string;
  /** the card's 1px edge and the rule under the strip */
  border: string;
  /** the name, on the strip */
  text: string;
  /** column names, on the body */
  ink: string;
  /** keys and types */
  muted: string;
  name: string;
  columns?: string[];
}) => {
  const rows = (columns ?? []).map(parseColumn);
  const header = Math.min(ENTITY_HEADER_H, h);
  const gutter = entityKeyGutter(columns);
  return (
    <>
      <rect width={w} height={h} rx={CORNER_RADIUS.card} fill={body} />
      <path d={cardHeaderPath(w, header, h)} fill={fill} />
      <rect
        x={EDGE}
        y={EDGE}
        width={w - EDGE * 2}
        height={h - EDGE * 2}
        rx={CORNER_RADIUS.card}
        fill="none"
        stroke={border}
        strokeWidth={1}
      />
      {rows.length > 0 ? (
        <line x1={0} x2={w} y1={header} y2={header} stroke={border} strokeWidth={1} />
      ) : null}
      <text
        x={ENTITY_TEXT_PAD}
        y={header / 2}
        textAnchor="start"
        dominantBaseline="central"
        fontSize={ENTITY_NAME_FONT}
        fontWeight={600}
        fill={text}
      >
        {name}
      </text>
      {rows.map((row, index) => {
        const cy = ENTITY_HEADER_H + ENTITY_ROWS_PAD + ENTITY_ROW_H * (index + 0.5);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <g key={index}>
            {row.keys.length > 0 ? (
              <text
                x={ENTITY_TEXT_PAD}
                y={cy}
                dominantBaseline="central"
                fontSize={ENTITY_KEY_FONT}
                fontWeight={600}
                fill={muted}
              >
                {row.keys.join(",")}
              </text>
            ) : null}
            <text
              x={gutter}
              y={cy}
              dominantBaseline="central"
              fontSize={ENTITY_COLUMN_FONT}
              fontWeight={row.keys.includes("PK") ? 600 : 400}
              fill={ink}
            >
              {row.name}
            </text>
            {row.type ? (
              <text
                x={w - ENTITY_TEXT_PAD}
                y={cy}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={ENTITY_COLUMN_FONT}
                fill={muted}
              >
                {row.type}
              </text>
            ) : null}
          </g>
        );
      })}
    </>
  );
};
