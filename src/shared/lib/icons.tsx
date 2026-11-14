import { ICON_IDS, type IconId, isIconId } from "./iconIds";

/**
 * Line-art glyphs on a 24×24 grid, stroke only, drawn in-house — no brand
 * marks, no licence to track (#9). Each entry is a list of path data strings
 * so the same drawing serves the canvas node, the palette thumbnail and the
 * exported SVG.
 */
export const ICON_PATHS: Record<IconId, string[]> = {
  database: [
    "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z",
    "M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6",
    "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  ],
  server: ["M3 5h18v6H3z", "M3 13h18v6H3z", "M7 8h.01", "M7 16h.01"],
  cloud: ["M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1 0 8.5H7z"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21a8 8 0 0 1 16 0"],
  queue: ["M3 7h10v4H3z", "M3 13h10v4H3z", "M16 12h5", "M19 9l3 3-3 3"],
  cache: ["M4 4h16v16H4z", "M13 7l-4 6h4l-1 4 4-6h-4z"],
  storage: ["M4 5h16l-1.5 14h-13z", "M4 5c0-1.1 3.6-2 8-2s8 .9 8 2"],
  function: ["M6 4h3l8 16", "M13 12l-5 8"],
  api: [
    "M9 4c-2 0-3 1-3 3v3c0 1-1 2-2 2 1 0 2 1 2 2v3c0 2 1 3 3 3",
    "M15 4c2 0 3 1 3 3v3c0 1 1 2 2 2-1 0-2 1-2 2v3c0 2-1 3-3 3",
  ],
  browser: ["M3 5h18v14H3z", "M3 9h18", "M6 7h.01", "M9 7h.01"],
  mobile: ["M7 3h10v18H7z", "M11 18h2"],
  lock: ["M6 11h12v9H6z", "M9 11V8a3 3 0 0 1 6 0v3"],
  mail: ["M3 6h18v12H3z", "M3 7l9 6 9-6"],
  scheduler: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  container: ["M12 3l8 4.5v9L12 21l-8-4.5v-9z", "M4 7.5l8 4.5 8-4.5", "M12 12v9"],
  balancer: [
    "M9 3h6v4H9z",
    "M12 7v4",
    "M12 11l-6 5",
    "M12 11l6 5",
    "M4 16h4v4H4z",
    "M16 16h4v4h-4z",
  ],
  service: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M12 2v3",
    "M12 19v3",
    "M2 12h3",
    "M19 12h3",
    "M4.9 4.9l2.1 2.1",
    "M17 17l2.1 2.1",
    "M4.9 19.1L7 17",
    "M17 7l2.1-2.1",
  ],
  document: ["M6 3h8l4 4v14H6z", "M14 3v4h4", "M9 12h6", "M9 16h6"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M21 21l-5-5"],
  internet: [
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
    "M3 12h18",
    "M12 3c3 3 3 15 0 18",
    "M12 3c-3 3-3 15 0 18",
  ],
  users: [
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    "M2 21a7 7 0 0 1 14 0",
    "M16 3.5a4 4 0 0 1 0 7.5",
    "M18 14.5a6 6 0 0 1 4 6.5",
  ],
  gateway: ["M8 5h8v14H8z", "M2 12h6", "M16 12h6", "M5 9l3 3-3 3", "M19 9l3 3-3 3"],
  firewall: [
    "M3 21V11h18v10",
    "M3 16h18",
    "M9 11v5",
    "M15 16v5",
    "M12 3c-2 2-3 3.5-3 5a3 3 0 0 0 6 0c0-1.5-1-3-3-5z",
  ],
  shield: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z", "M9 12l2 2 4-4"],
  key: ["M20 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0z", "M13.2 10.8L4 20", "M6 18l2 2", "M8.5 15.5l2 2"],
  certificate: ["M12 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10z", "M9 14l-2 7 5-2 5 2-2-7"],
  network: [
    "M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
    "M5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
    "M19 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
    "M12 8v4",
    "M12 12l-6 4.5",
    "M12 12l6 4.5",
  ],
  dns: ["M12 3v18", "M5 6h10l3 3-3 3H5z", "M19 14H9l-3 3 3 3h10z"],
  iot: ["M12 18h.01", "M8.5 14.5a5 5 0 0 1 7 0", "M5 11a10 10 0 0 1 14 0"],
  stream: ["M3 8c3-3 6 3 9 0s6-3 9 0", "M3 12c3-3 6 3 9 0s6-3 9 0", "M3 16c3-3 6 3 9 0s6-3 9 0"],
  pipeline: ["M4 7h11", "M12 4l3 3-3 3", "M20 17H9", "M12 14l-3 3 3 3"],
  backup: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"],
  disk: ["M3 12l2.5-7h13L21 12", "M3 12v6h18v-6H3z", "M17 15h.01"],
  cpu: [
    "M6 6h12v12H6z",
    "M9 9h6v6H9z",
    "M9 2v4",
    "M15 2v4",
    "M9 18v4",
    "M15 18v4",
    "M2 9h4",
    "M2 15h4",
    "M18 9h4",
    "M18 15h4",
  ],
  cluster: ["M4 5h7v6H4z", "M13 5h7v6h-7z", "M4 13h7v6H4z", "M13 13h7v6h-7z"],
  laptop: ["M5 5h14v10H5z", "M2 19h20"],
  desktop: ["M3 4h18v12H3z", "M8 20h8", "M12 16v4"],
  robot: ["M5 9h14v11H5z", "M12 4v5", "M9 14h.01", "M15 14h.01", "M9 17h6", "M2 13h3", "M19 13h3"],
  code: ["M8 7l-5 5 5 5", "M16 7l5 5-5 5", "M14 4l-4 16"],
  terminal: ["M3 5h18v14H3z", "M7 9l3 3-3 3", "M12 15h5"],
  git: [
    "M8 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
    "M8 20a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
    "M20 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
    "M6 6v12",
    "M18 9c0 3.3-2.7 6-6 6H6",
  ],
  bug: [
    "M9 8a3 3 0 0 1 6 0",
    "M7 11a5 5 0 0 1 10 0v5a5 5 0 0 1-10 0z",
    "M3 13h4",
    "M17 13h4",
    "M4 20l3.5-2.5",
    "M20 20l-3.5-2.5",
    "M4 6l3.5 2.5",
    "M20 6l-3.5 2.5",
  ],
  config: ["M4 7h16", "M4 12h16", "M4 17h16", "M8 5v4", "M16 10v4", "M11 15v4"],
  log: ["M5 3h14v18H5z", "M8 7h8", "M8 11h8", "M8 15h5"],
  folder: ["M3 6h6l2 2h10v11H3z"],
  table: ["M3 5h18v14H3z", "M3 10h18", "M3 15h18", "M9 5v14", "M15 5v14"],
  graph: [
    "M8 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
    "M20 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
    "M14 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
    "M7.8 5.6l8.4 2.8",
    "M17.2 10.8l-4.4 6.4",
    "M6.8 6.8l4.4 10.4",
  ],
  chart: ["M3 21h18", "M7 21v-8", "M12 21V6", "M17 21V10"],
  metrics: ["M3 20h18", "M4 15l5-5 4 4 7-8", "M15 6h5v5"],
  bell: ["M6 17v-6a6 6 0 0 1 12 0v6l2 2H4z", "M10 21h4"],
  chat: ["M4 4h16v11H9l-5 4z", "M8 9h8"],
  calendar: ["M3 5h18v16H3z", "M3 10h18", "M8 3v4", "M16 3v4"],
  card: ["M3 6h18v12H3z", "M3 10h18", "M7 15h4"],
  bank: ["M12 3l10 6H2z", "M4 9v10", "M9 9v10", "M15 9v10", "M20 9v10", "M2 21h20"],
  cart: [
    "M3 4h2l3 12h11l2-8H7",
    "M10 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
    "M17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  ],
  location: [
    "M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z",
    "M12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  ],
  image: ["M3 5h18v14H3z", "M3 15l5-5 4 4 3-3 6 6", "M16 9h.01"],
  video: ["M3 7h13v10H3z", "M16 10l5-3v10l-5-3"],
};

/** the question mark drawn for an id this build does not know (a newer file) */
const PLACEHOLDER_PATHS = ["M9 9a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.2-1.5 2.4", "M12 17h.01"];

// 1.25 on the 24-grid: thinner lines than the 1.75 first cut
const STROKE = 1.25;

/**
 * One icon as SVG children, sized to `size` and drawn in `color`. Unknown ids
 * render a placeholder rather than nothing, so a file from a newer build
 * still shows *something* where the icon belongs.
 *
 * The stroke is on the 24-grid, so it grows with the icon. A glyph drawn *in*
 * a diagram passes `strokePx` instead: its line then matches the shapes'
 * outlines at any icon size (#204) — a 40px icon node would otherwise draw
 * the heaviest line on the canvas, and a 12px chip icon a hairline.
 */
export const IconGlyph = ({
  icon,
  size,
  color,
  x = 0,
  y = 0,
  strokePx,
}: {
  icon: string;
  size: number;
  color: string;
  x?: number;
  y?: number;
  strokePx?: number;
}) => {
  const paths = isIconId(icon) ? ICON_PATHS[icon] : PLACEHOLDER_PATHS;
  const scale = size / 24;
  const strokeWidth = strokePx !== undefined && scale > 0 ? strokePx / scale : STROKE;
  return (
    <g
      transform={`translate(${x} ${y}) scale(${scale})`}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </g>
  );
};

export { ICON_IDS };
