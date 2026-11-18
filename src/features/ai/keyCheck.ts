import type { AiVendor } from "./settings";

/** how long a check waits for the vendor — a stalled network ends as "No connection" */
const KEY_CHECK_TIMEOUT_MS = 10_000;

export type KeyCheck =
  | { state: "ok" }
  | { state: "rejected" }
  | { state: "error"; message: string };

/**
 * Whether a key works (#252, Settings ▸ AI assistant ▸ Check): the cheapest
 * call each vendor has — its model list — and the answer's status. 401/403
 * mean the key; anything else (or no answer) says why it could not tell.
 */
export const checkApiKey = async (
  vendor: AiVendor,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyCheck> => {
  try {
    // built inside the try: nothing here may throw past it and leave a check hanging
    const request: [string, RequestInit] =
      vendor === "claude"
        ? [
            "https://api.anthropic.com/v1/models?limit=1",
            {
              signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
              headers: {
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                // the SDK's dangerouslyAllowBrowser says the same to the API
                "anthropic-dangerous-direct-browser-access": "true",
              },
            },
          ]
        : [
            "https://api.openai.com/v1/models",
            {
              signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
              headers: { Authorization: `Bearer ${key}` },
            },
          ];
    const response = await fetchImpl(...request);
    if (response.ok) return { state: "ok" };
    if (response.status === 401 || response.status === 403) return { state: "rejected" };
    return { state: "error", message: `HTTP ${response.status}` };
  } catch {
    // the webview's own wording ("Load failed") says less than this; a timeout lands here too
    return { state: "error", message: "No connection" };
  }
};
