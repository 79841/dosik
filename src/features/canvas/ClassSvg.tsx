import {
  CLASS_NAME_FONT,
  CLASS_NAME_H,
  CLASS_ROW_H,
  CLASS_SECTION_PAD,
  CLASS_TEXT_PAD,
  CLASS_STEREOTYPE_H,
  classDividerYs,
  splitVisibility,
} from "../../shared/lib/classShape";
import { DECOR } from "../../shared/lib/nodeDecor";
import { CORNER_RADIUS } from "./cornerRadius";

/** the card's 1px edge sits half a pixel in, so it lands on whole pixels */
const EDGE = 0.5;

interface ClassSvgProps {
  width: number;
  height: number;
  /** the header strip: the node colour's tile */
  fill: string;
  /** the card's body under the strip */
  body: string;
  /** the card's 1px edge and its compartment rules */
  border: string;
  /** the name, on the strip */
  text: string;
  /** member rows, on the body */
  ink: string;
  /** visibility marks */
  muted: string;
  name: string;
  stereotype?: string;
  isAbstract?: boolean;
  attributes?: string[];
  methods?: string[];
  /** the text an editor sits on in the canvas — left undrawn, never two copies (#174, #281) */
  editingPart?: string;
}

/**
 * One member row: the leading visibility mark is quiet, the rest is verbatim.
 * `xml:space` keeps the space after the mark — a rasteriser would drop it.
 */
const MemberRow = ({
  line,
  x,
  y,
  ink,
  muted,
}: {
  line: string;
  x: number;
  y: number;
  ink: string;
  muted: string;
}) => {
  const { mark, rest } = splitVisibility(line);
  return (
    // centred on its row as the entity's rows are (`central`) — where the
    // compartment's editor puts each line too (#281). WebKit does not hand
    // the baseline down to a <tspan>, so the parts say it again: without it a
    // member with a visibility mark sat on its alphabetic baseline, 4px above
    // the rows without one.
    <text x={x} y={y} fontSize={11.5} fill={ink} dominantBaseline="central" xmlSpace="preserve">
      {mark ? (
        <>
          <tspan fill={muted} dominantBaseline="central">
            {mark}
          </tspan>
          <tspan dominantBaseline="central"> {rest}</tspan>
        </>
      ) : (
        line
      )}
    </text>
  );
};

/**
 * The top of a card `h` tall filled to `bottom`, its upper corners rounded to
 * the card's — and its lower ones too when the strip is the whole card, or
 * they would stick out past the card's rounded edge (#210).
 */
export const cardHeaderPath = (w: number, bottom: number, h: number): string => {
  const r = CORNER_RADIUS.card;
  const top = `V ${r} Q 0 0 ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r}`;
  if (bottom < h) return `M 0 ${bottom} ${top} V ${bottom} Z`;
  return `M 0 ${h - r} ${top} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} Z`;
};

/**
 * UML classifier as an object card (#210 D13): the name on a strip tinted with
 * the node's colour, then attributes, then methods on the card's body.
 * Empty compartments are not drawn — UML allows omitting them, and an empty
 * strip would read as "no members" instead of "not shown".
 */
export const ClassSvg = ({
  width: w,
  height: h,
  fill,
  body,
  border,
  text,
  ink,
  muted,
  name,
  stereotype,
  isAbstract,
  attributes = [],
  methods = [],
  editingPart,
}: ClassSvgProps) => {
  const dividers = classDividerYs({ stereotype, attributes, methods });
  const nameTop = stereotype ? CLASS_STEREOTYPE_H : 0;
  let rowY = (dividers[0] ?? CLASS_NAME_H) + CLASS_SECTION_PAD + CLASS_ROW_H / 2;

  const attrRows = attributes.map((line, i) => ({ line, y: rowY + i * CLASS_ROW_H, key: `a${i}` }));
  rowY =
    (dividers[attributes.length > 0 ? 1 : 0] ?? CLASS_NAME_H) + CLASS_SECTION_PAD + CLASS_ROW_H / 2;
  const methodRows = methods.map((line, i) => ({ line, y: rowY + i * CLASS_ROW_H, key: `m${i}` }));

  return (
    <>
      <rect width={w} height={h} rx={CORNER_RADIUS.card} fill={body} />
      {/* the strip reaches the first rule — a class without members is all strip */}
      <path d={cardHeaderPath(w, dividers[0] ?? h, h)} fill={fill} />
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
      {stereotype && editingPart !== "stereotype" ? (
        <text
          x={CLASS_TEXT_PAD}
          y={CLASS_STEREOTYPE_H / 2 + 6}
          fontSize={10.5}
          fill={text}
          opacity={DECOR.descriptionOpacity}
          textAnchor="start"
          dominantBaseline="middle"
        >
          «{stereotype}»
        </text>
      ) : null}
      <text
        x={CLASS_TEXT_PAD}
        y={nameTop + CLASS_NAME_H / 2}
        fontSize={CLASS_NAME_FONT}
        fontWeight={600}
        fontStyle={isAbstract ? "italic" : undefined}
        fill={text}
        textAnchor="start"
        dominantBaseline="middle"
      >
        {editingPart === "label" ? "" : name}
      </text>
      {dividers.map((y) => (
        <line key={`d${y}`} x1={0} x2={w} y1={y} y2={y} stroke={border} strokeWidth={1} />
      ))}
      {(editingPart === "attributes" ? [] : attrRows).map((row) => (
        <MemberRow
          key={row.key}
          line={row.line}
          x={CLASS_TEXT_PAD}
          y={row.y}
          ink={ink}
          muted={muted}
        />
      ))}
      {(editingPart === "methods" ? [] : methodRows).map((row) => (
        <MemberRow
          key={row.key}
          line={row.line}
          x={CLASS_TEXT_PAD}
          y={row.y}
          ink={ink}
          muted={muted}
        />
      ))}
    </>
  );
};
