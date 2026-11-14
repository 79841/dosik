/**
 * The app glyph (#231 D16): the app icon's four shapes — a square top-left,
 * a quarter top-right, a circle bottom-left, a diamond bottom-right — as a
 * Lucide-style outline icon, for the pinned Library tab. Lucide has none, so
 * it is drawn here, from the canvas's `parts/app-glyph.svg` as it is (the
 * arrangement is final). The real app icon (`src-tauri/icons`) is not this.
 */
export const AppGlyph = ({
  size = 24,
  strokeWidth = 1.75,
  className,
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <rect x="3" y="3" width="7.25" height="7.25" rx="1.25" />
    <path d="M15 3a6 6 0 0 1 6 6 1.25 1.25 0 0 1-1.25 1.25H15A1.25 1.25 0 0 1 13.75 9V4.25A1.25 1.25 0 0 1 15 3Z" />
    <circle cx="6.625" cy="17.375" r="3.85" />
    <path d="M16.98 13.53a.566 .566 0 0 1 .8 0l3.45 3.45a.566 .566 0 0 1 0 .8l-3.45 3.45a.566 .566 0 0 1-.8 0l-3.45-3.45a.566 .566 0 0 1 0-.8Z" />
  </svg>
);
