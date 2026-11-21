/** a Mac's user agent — jsdom's own names no platform, so the app takes it for Windows */
export const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
/** a Windows user agent — where the app's words name Windows itself (File Explorer) */
export const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

const pretend = (userAgent: string): void => {
  Object.defineProperty(navigator, "userAgent", { value: userAgent, configurable: true });
};

/** from here on as on a Mac: `isMacPlatform()` reads the user agent at the call */
export const pretendMac = (): void => pretend(MAC_UA);
/** from here on as on Windows */
export const pretendWindows = (): void => pretend(WINDOWS_UA);
/** back to jsdom's own user agent */
export const forgetPlatform = (): void => {
  delete (navigator as { userAgent?: string }).userAgent;
};

/** runs `fn` as on a Mac */
export const onMac = <T>(fn: () => T): T => {
  pretendMac();
  try {
    return fn();
  } finally {
    forgetPlatform();
  }
};
