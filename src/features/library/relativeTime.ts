const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Edited 3 min ago" style label for a card or a tree row; past a week the date — "Oct 24", with the year when it is not this one (#220 D17) */
export const relativeTime = (thenMs: number, nowMs: number = Date.now()): string => {
  const diff = Math.max(0, nowMs - thenMs);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return h === 1 ? "1 hour ago" : `${h} hours ago`;
  }
  if (diff < 2 * DAY) return "yesterday";
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} days ago`;
  // the user's own calendar date, not UTC's (which is a day off before 9am KST)
  const then = new Date(thenMs);
  const sameYear = then.getFullYear() === new Date(nowMs).getFullYear();
  return then.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
};

/**
 * The label where it starts a segment of its own — after " · " in a meta
 * line (#231 D10, `Main`: "Onboarding / Auth · Yesterday"): its first letter
 * capitalised. After a word ("Edited yesterday") the label stays as it is.
 */
export const relativeTimeSegment = (thenMs: number, nowMs: number = Date.now()): string => {
  const label = relativeTime(thenMs, nowMs);
  return label.charAt(0).toUpperCase() + label.slice(1);
};
