import { describe, expect, it } from "vitest";

import { relativeTime, relativeTimeSegment } from "../relativeTime";

describe("relativeTime", () => {
  const now = Date.UTC(2026, 8, 14, 12, 0, 0);
  const ago = (ms: number) => relativeTime(now - ms, now);

  it("phrasing for each range", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(59_000)).toBe("just now");
    expect(ago(3 * 60_000)).toBe("3 min ago");
    expect(ago(60 * 60_000)).toBe("1 hour ago");
    expect(ago(5 * 3_600_000)).toBe("5 hours ago");
    expect(ago(30 * 3_600_000)).toBe("yesterday");
    expect(ago(3 * 86_400_000)).toBe("3 days ago");
  });

  it("past 7 days, a short month and day — 'Oct 24' this year, 'Oct 24, 2025' for other years (#220 D17, T14)", () => {
    // the user's own calendar: local dates, so the runner's timezone does not matter
    const today = new Date(2026, 9, 30, 12).getTime();
    expect(relativeTime(new Date(2026, 9, 21, 9).getTime(), today)).toBe("Oct 21");
    expect(relativeTime(new Date(2026, 0, 2, 9).getTime(), today)).toBe("Jan 2");
    expect(relativeTime(new Date(2025, 9, 24, 9).getTime(), today)).toBe("Oct 24, 2025");
  });

  it("a future time (clock skew) is just now", () => {
    expect(relativeTime(now + 60_000, now)).toBe("just now");
  });

  it("a time that opens its own segment capitalizes only the first letter — 'Yesterday', 'Just now', numbers and dates unchanged (#231 D10, Main)", () => {
    const seg = (ms: number) => relativeTimeSegment(now - ms, now);
    expect(seg(0)).toBe("Just now");
    expect(seg(3 * 60_000)).toBe("3 min ago");
    expect(seg(30 * 3_600_000)).toBe("Yesterday");
    expect(seg(3 * 86_400_000)).toBe("3 days ago");
    const today = new Date(2026, 9, 30, 12).getTime();
    expect(relativeTimeSegment(new Date(2026, 9, 21, 9).getTime(), today)).toBe("Oct 21");
    // the label itself stays lower case — "Edited yesterday", "edited just now"
    expect(ago(30 * 3_600_000)).toBe("yesterday");
  });
});
