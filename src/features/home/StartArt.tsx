import type { ImportKind } from "../mermaid/import/plan";

/**
 * START's little pictures (#220 D6) — the Main board's four drawings, in
 * tokens: the same pairs of colour and shape as the templates they make.
 * Decoration only: the tile's text names it.
 */
const thin = { fill: "none", strokeWidth: 1 } as const;
const bar = { fill: "none", strokeWidth: 2.5, strokeLinecap: "round" } as const;

const Flowchart = () => (
  <>
    <rect x="6" y="25" width="28" height="14" rx="7" className="fill-ink-surface" />
    <path d="M34 32 H42.5 M74 32 H80 V16 H84.5 M80 32 V48 H84.5" {...thin} className="stroke-ink" />
    <polygon points="46,32 42,29.8 42,34.2" className="fill-ink" />
    <polygon points="88,16 84,13.8 84,18.2" className="fill-ink" />
    <polygon points="88,48 84,45.8 84,50.2" className="fill-ink" />
    <polygon points="60,19 74,32 60,45 46,32" className="fill-tile-violet" />
    <rect x="88" y="9" width="26" height="14" rx="3" className="fill-tile-green" />
    <rect x="88" y="41" width="26" height="14" rx="3" className="fill-tile-rose" />
  </>
);

const Sequence = () => (
  <>
    <rect x="8" y="5" width="28" height="11" rx="2.5" className="fill-tile-blue" />
    <rect x="46" y="5" width="28" height="11" rx="2.5" className="fill-tile-mono" />
    <rect x="84" y="5" width="28" height="11" rx="2.5" className="fill-tile-teal" />
    <path
      d="M22 16 V60 M60 16 V60 M98 16 V60"
      {...thin}
      strokeDasharray="2 2"
      className="stroke-dash"
    />
    <rect x="57.5" y="24" width="5" height="26" rx="1" className="fill-selected" />
    <path d="M22 28 H54 M62.5 35 H94" {...thin} className="stroke-ink" />
    <path d="M98 42 H66.5 M57.5 49 H26" {...thin} strokeDasharray="2.5 2" className="stroke-ink" />
    <polygon points="57.5,28 53.5,25.8 53.5,30.2" className="fill-ink" />
    <polygon points="98,35 94,32.8 94,37.2" className="fill-ink" />
    <polygon points="62.5,42 66.5,39.8 66.5,44.2" className="fill-ink" />
    <polygon points="22,49 26,46.8 26,51.2" className="fill-ink" />
  </>
);

const Class = () => (
  <>
    <rect x="8" y="4" width="50" height="56" rx="3" className="fill-surface" />
    <path d="M8 7 a3 3 0 0 1 3-3 H55 a3 3 0 0 1 3 3 V17 H8 Z" className="fill-tile-violet" />
    <path d="M20 10.5 H46" {...bar} className="stroke-tile-ink-muted" />
    <path d="M14 24 H44 M14 30 H38 M14 44 H48 M14 50 H40" {...bar} className="stroke-frame-dash" />
    <path d="M8 37 H58" {...thin} className="stroke-selected" />
    <rect x="76" y="16" width="36" height="34" rx="3" className="fill-surface" />
    <path d="M76 19 a3 3 0 0 1 3-3 H109 a3 3 0 0 1 3 3 V27 H76 Z" className="fill-tile-blue" />
    <path d="M84 21.5 H104" {...bar} className="stroke-tile-ink-muted" />
    <path d="M81 34 H103 M81 44 H99" {...bar} className="stroke-frame-dash" />
    <path d="M76 39 H112" {...thin} className="stroke-selected" />
    <path d="M64.5 33 H76" {...thin} className="stroke-ink" />
    <polygon
      points="58,33 64.5,29.5 64.5,36.5"
      strokeWidth={1}
      strokeLinejoin="round"
      className="fill-surface stroke-ink"
    />
  </>
);

const Erd = () => (
  <>
    <rect x="6" y="6" width="46" height="52" rx="3" className="fill-surface" />
    <path d="M6 9 a3 3 0 0 1 3-3 H49 a3 3 0 0 1 3 3 V18 H6 Z" className="fill-tile-teal" />
    <path d="M12 12 H34" {...bar} className="stroke-tile-ink-muted" />
    <path d="M12 26 H40 M12 34 H44 M12 42 H36 M12 50 H42" {...bar} className="stroke-frame-dash" />
    <rect x="70" y="14" width="44" height="40" rx="3" className="fill-surface" />
    <path d="M70 17 a3 3 0 0 1 3-3 H111 a3 3 0 0 1 3 3 V26 H70 Z" className="fill-tile-amber" />
    <path d="M76 20 H98" {...bar} className="stroke-tile-ink-muted" />
    <path d="M76 34 H104 M76 41 H96 M76 48 H100" {...bar} className="stroke-frame-dash" />
    <path
      d="M52 34 H70 M56 30 V38 M64 34 L70 29.5 M64 34 L70 38.5"
      {...thin}
      className="stroke-ink"
    />
  </>
);

const ART: Record<ImportKind, () => React.JSX.Element> = {
  flowchart: Flowchart,
  sequence: Sequence,
  class: Class,
  er: Erd,
};

export const StartArt = ({ kind }: { kind: ImportKind }) => {
  const Art = ART[kind];
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 120 64"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      className="block"
    >
      <Art />
    </svg>
  );
};
