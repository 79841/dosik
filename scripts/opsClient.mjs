/**
 * The terminal entry point's logic, without the process side effects (#63).
 *
 * Kept free of `spawn`/`process.exit` so the decisions — is the bridge up, is
 * it *our* bridge, how long to wait, what to say when it never comes — can be
 * tested. `dosik-ops.mjs` is the thin shell around it.
 */

export const DEFAULT_PORT = 4517;
/** a cold Rust build is minutes, not seconds */
export const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000;
export const POLL_INTERVAL_MS = 500;

/**
 * How the app is started when the bridge is down. `packageManager` in
 * package.json makes corepack refuse npm outright, so the wrong launcher here
 * fails only on the user's machine — CI never starts the app. It lives in this
 * module so a test can pin it (#59).
 */
export const LAUNCH_COMMAND = ["pnpm", "tauri", "dev"];
/** what to tell someone whose launch died — the same words they can retype */
export const LAUNCH_HINT = "pnpm tauri dev";

export const bridgeUrl = (port = DEFAULT_PORT) => `http://127.0.0.1:${port}`;

/** a loopback answer is instant or not coming — a stalled socket must not hang us */
export const PROBE_TIMEOUT_MS = 2000;
export const SEND_TIMEOUT_MS = 15_000;

export const resolvePort = (env = process.env) => {
  const raw = env.DOSIK_PORT;
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PORT;
};

/**
 * Is a *dosik* bridge answering on this port? A stranger holding 4517 must not
 * be mistaken for the app — the discovery document names itself, so ask.
 */
export const probeBridge = async (port, fetchImpl = fetch) => {
  let response;
  try {
    response = await fetchImpl(`${bridgeUrl(port)}/api`, {
      method: "GET",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    // Something accepted the connection and then went quiet — a forward to a
    // dead remote, a stopped container. That is somebody holding the port, not
    // an empty one: calling it "down" would wait forever with nothing on screen.
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return { state: "foreign", detail: "the port is not responding" };
    }
    // Only a transport failure means nothing is listening. Anything that
    // answers at all is somebody — a dev server returning HTML read as "down"
    // would start the app onto a port it can never bind.
    return { state: "down" };
  }
  if (!response.ok) return { state: "foreign", detail: `HTTP ${response.status}` };
  let body;
  try {
    body = await response.json();
  } catch {
    return { state: "foreign", detail: "a non-JSON response" };
  }
  return typeof body?.name === "string" && body.name.toLowerCase().includes("dosik")
    ? { state: "ready" }
    : { state: "foreign", detail: "another program is using this port" };
};

/**
 * Waits for the bridge, reporting progress so a multi-minute Rust build does
 * not look like a hang.
 *
 * @param {number} port
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   now?: () => number,
 *   timeoutMs?: number,
 *   onWait?: (elapsedMs: number) => void,
 * }} [options] `onWait` runs once per poll — the place to notice a build that
 *   already died, since this loop only sees a silent port.
 */
export const waitForBridge = async (
  port,
  {
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onWait,
  } = {},
) => {
  const started = now();
  for (;;) {
    const probe = await probeBridge(port, fetchImpl);
    if (probe.state !== "down") return probe;
    const elapsed = now() - started;
    if (elapsed >= timeoutMs) {
      return {
        state: "timeout",
        detail: `The bridge did not come up within ${Math.round(timeoutMs / 1000)}s`,
      };
    }
    onWait?.(elapsed);
    await sleep(POLL_INTERVAL_MS);
  }
};

/**
 * Where the payload comes from, decided from argv alone so it can be tested.
 * `--file x`, `--file=x` and a bare JSON argument are all accepted; anything
 * left over is reported rather than silently ignored.
 *
 * @param {string[]} argv
 * @returns {{ kind: "file", path: string } | { kind: "inline", json: string } | { kind: "stdin" }}
 */
export const parseInvocation = (argv) => {
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    // npm eats the `--` separator, pnpm passes it through — accept either habit
    if (token === "--") continue;
    if (token === "--file") {
      const path = argv[i + 1];
      if (path === undefined || path.startsWith("--")) {
        throw new Error("--file needs a path");
      }
      return { kind: "file", path };
    }
    if (token?.startsWith("--file=")) {
      const path = token.slice("--file=".length);
      if (path === "") throw new Error("--file needs a path");
      return { kind: "file", path };
    }
    if (token?.startsWith("--")) throw new Error(`Unknown option: ${token}`);
    rest.push(token);
  }
  if (rest.length > 1) throw new Error(`Too many arguments: ${rest.join(" ")}`);
  return rest.length === 1 ? { kind: "inline", json: rest[0] } : { kind: "stdin" };
};

/** Reads the ops payload a caller gave us: inline JSON, a file, or stdin. */
export const parseOpsInput = (raw) => {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("No ops to send — pass JSON as an argument, use --file, or pipe it to stdin");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Cannot parse JSON: ${error instanceof Error ? error.message : error}`);
  }
  // both shapes are accepted: the bridge body, or the bare array inside it
  const ops = Array.isArray(parsed) ? parsed : parsed?.ops;
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new Error('The ops array is empty — expected {"ops":[…]} or […]');
  }
  return { ops };
};

export const sendOps = async (port, body, fetchImpl = fetch) => {
  const response = await fetchImpl(`${bridgeUrl(port)}/api/ops`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `The bridge sent a non-JSON response (HTTP ${response.status}): ${text.slice(0, 200)}`,
    );
  }
  return { status: response.status, body: parsed };
};
