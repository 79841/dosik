import { SHAPE_STROKE_WIDTH } from "../../shared/lib/palette";
import {
  cylinderCapRy,
  hexagonCut,
  parallelogramSkew,
  stickyFold,
} from "../../shared/lib/sideAttach";
import type { ShapeKind } from "../../shared/lib/types";
import { CORNER_RADIUS } from "./cornerRadius";

interface ShapeSvgProps {
  shape: ShapeKind;
  width: number;
  height: number;
  /** the tile's face */
  fill: string;
  /** one step deeper: a cylinder's lid, a sticky's fold, a preview's header band */
  cap: string;
  /** the deep tone — only the palette previews' details (dashes, rules) draw with it */
  stroke: string;
}

/**
 * SVG geometry for each shape kind, shared by the canvas node, the palette
 * previews and the vector SVG. Studio tiles (#210): the face is filled and
 * nothing is outlined — the colour is the tile. A tile fills its whole box:
 * lines end on the box's outline (`sideAttach`), and an inset would leave a
 * gap before every arrowhead (#210).
 */
export const ShapeSvg = ({ shape, width: w, height: h, fill, cap, stroke }: ShapeSvgProps) => {
  const detail = { stroke, strokeWidth: SHAPE_STROKE_WIDTH };

  switch (shape) {
    case "rect":
      return <rect width={w} height={h} rx={CORNER_RADIUS.rect} fill={fill} />;
    case "rounded":
      return <rect width={w} height={h} rx={Math.min(CORNER_RADIUS.rounded, h / 2)} fill={fill} />;
    case "sticky": {
      // The dog-ear has to be in the *silhouette*, not an overlay on a rounded
      // box: a translucent triangle inside a rounded rect read as a plain rounded
      // rectangle at node size and as a pill in the 30x20 palette preview.
      const fold = stickyFold({ width: w, height: h });
      const r = Math.min(CORNER_RADIUS.sticky, w * 0.12, h * 0.16);
      const body = [
        `M ${r} 0`,
        `H ${w - r}`,
        `Q ${w} 0 ${w} ${r}`,
        `V ${h - fold}`,
        `L ${w - fold} ${h}`,
        `H ${r}`,
        `Q 0 ${h} 0 ${h - r}`,
        `V ${r}`,
        `Q 0 0 ${r} 0`,
        "Z",
      ].join(" ");
      return (
        <>
          <path d={body} fill={fill} />
          {/* the flap folded back over the page, one tone deeper */}
          <path d={`M ${w - fold} ${h - fold} H ${w} L ${w - fold} ${h} Z`} fill={cap} />
        </>
      );
    }
    case "class": {
      // Palette preview only — a card with its header band. The canvas node
      // uses ClassSvg, which sizes the compartments from the real members.
      const head = Math.min(h, Math.max(8, h * 0.4));
      const mid = Math.min(h - 4, head + Math.max(6, h * 0.3));
      return (
        <>
          <rect width={w} height={h} rx={3} fill={fill} />
          <path d={`M 0 ${head} V 3 Q 0 0 3 0 H ${w - 3} Q ${w} 0 ${w} 3 V ${head} Z`} fill={cap} />
          <line x1={0} x2={w} y1={mid} y2={mid} {...detail} opacity={0.4} />
        </>
      );
    }
    case "ellipse":
      return <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} fill={fill} />;
    case "diamond":
      return <polygon points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`} fill={fill} />;
    case "parallelogram": {
      const skew = parallelogramSkew(w);
      return <polygon points={`${skew},0 ${w},0 ${w - skew},${h} 0,${h}`} fill={fill} />;
    }
    case "hexagon": {
      const cut = hexagonCut(w);
      return (
        <polygon
          points={`${cut},0 ${w - cut},0 ${w},${h / 2} ${w - cut},${h} ${cut},${h} 0,${h / 2}`}
          fill={fill}
        />
      );
    }
    case "cylinder": {
      const ry = cylinderCapRy(h);
      return (
        <>
          <path
            d={`M 0 ${ry} L 0 ${h - ry} A ${w / 2} ${ry} 0 0 0 ${w} ${h - ry} L ${w} ${ry} Z`}
            fill={fill}
          />
          {/* the lid, one tone deeper so the drum reads without an outline */}
          <ellipse cx={w / 2} cy={ry} rx={w / 2} ry={ry} fill={cap} />
        </>
      );
    }
    case "fragment":
    case "frame": {
      // preview-oriented geometry: a dashed area with its title set into the
      // top border; the canvas nodes render FragmentSvg / FrameSvg (#210)
      const titleW = Math.min(14, w * 0.4);
      return (
        <>
          <rect
            width={w}
            height={h}
            rx={Math.min(4, h / 4)}
            fill="none"
            {...detail}
            strokeDasharray="2.5 2"
          />
          <line
            x1={3}
            y1={0}
            x2={3 + titleW}
            y2={0}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH * 2}
            strokeLinecap="round"
          />
        </>
      );
    }
    case "lifeline": {
      // preview-oriented geometry; the canvas node renders LifelineSvg
      const headerH = Math.min(40, h * 0.35);
      return (
        <>
          <rect
            width={w}
            height={headerH}
            rx={Math.min(CORNER_RADIUS.lifeline, headerH / 3)}
            fill={fill}
          />
          <line x1={w / 2} y1={headerH + 2} x2={w / 2} y2={h} {...detail} strokeDasharray="4 3" />
        </>
      );
    }
    case "text":
      return null;
    case "entity": {
      // palette preview — the canvas node draws EntitySvg with its columns
      const band = Math.max(4, h * 0.32);
      const row = (at: number) => band + (h - band) * at;
      return (
        <>
          <rect width={w} height={h} rx={3} fill={fill} />
          <path d={`M 0 ${band} V 3 Q 0 0 3 0 H ${w - 3} Q ${w} 0 ${w} 3 V ${band} Z`} fill={cap} />
          <path
            d={`M ${w * 0.2} ${row(0.4)} L ${w * 0.8} ${row(0.4)} M ${w * 0.2} ${row(0.75)} L ${w * 0.65} ${row(0.75)}`}
            {...detail}
          />
        </>
      );
    }
    case "image": {
      // palette preview only — the canvas node shows the picture itself (#8):
      // a framed landscape, a hill and a sun
      const s = Math.min(w, h);
      return (
        <>
          <rect width={w} height={h} rx={3} fill={fill} />
          <path
            d={`M 1 ${h - 1} L ${w * 0.38} ${h * 0.45} L ${w * 0.62} ${h * 0.72} L ${w * 0.75} ${h * 0.6} L ${w - 1} ${h - 1} Z`}
            fill={stroke}
            opacity={0.35}
          />
          <circle cx={w * 0.72} cy={h * 0.32} r={s * 0.12} fill={stroke} />
        </>
      );
    }
  }
};
