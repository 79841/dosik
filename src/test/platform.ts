/** a Mac's user agent — jsdom's own names no platform, so the app takes it for Windows */
export const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

/** runs `fn` as on a Mac: `isMacPlatform()` reads the user agent at the call */
export const onMac = <T>(fn: () => T): T => {
  Object.defineProperty(navigator, "userAgent", { value: MAC_UA, configurable: true });
  try {
    return fn();
  } finally {
    delete (navigator as { userAgent?: string }).userAgent;
  }
};
