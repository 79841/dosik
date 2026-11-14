import { describe, expect, it } from "vitest";

import { isMacPlatform } from "../../../shared/lib/windowChrome";
import { showInLabel } from "../fileManager";

/** one set of words, the OS's name for its file manager (#238 D10) */
describe("Show in … — the operating system's file manager name", () => {
  it("macOS WKWebView → Show in Finder", () => {
    expect(
      showInLabel(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      ),
    ).toBe("Show in Finder");
  });

  it("Windows WebView2 → Show in File Explorer", () => {
    expect(
      showInLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      ),
    ).toBe("Show in File Explorer");
  });

  it("anything else (Linux WebKitGTK etc.) → Show in File Manager", () => {
    expect(
      showInLabel("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)"),
    ).toBe("Show in File Manager");
    expect(showInLabel("")).toBe("Show in File Manager");
  });

  it("defaults to the current webview's platform", () => {
    expect(showInLabel()).toBe(showInLabel(navigator.userAgent));
  });

  it("macOS detection matches the app's isMacPlatform — so it agrees with the traffic lights and shortcut labels", () => {
    for (const ua of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      "Mozilla/5.0 (X11; Linux x86_64)",
    ]) {
      expect(showInLabel(ua) === "Show in Finder").toBe(isMacPlatform(ua));
    }
  });
});
