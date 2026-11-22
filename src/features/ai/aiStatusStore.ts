import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import { checkApiKey } from "./keyCheck";
import { type AiSettings, type AiVendor, effectiveAuth } from "./settings";

export type CliState =
  | { state: "unknown" }
  | { state: "ok"; version: string }
  | { state: "signed-out"; version: string }
  | { state: "missing" };

export type KeyState =
  | { state: "unknown" }
  | { state: "ok" }
  | { state: "rejected" }
  | { state: "error"; message: string };

interface AiStatusState {
  /** the subscription CLIs as last checked this run (#252) */
  cli: Record<AiVendor, CliState>;
  /** a check is out — the last result stays on screen meanwhile */
  cliChecking: Record<AiVendor, boolean>;
  /** the API keys as last checked this run */
  key: Record<AiVendor, KeyState>;
  /** a key check is out — the last result stays on screen meanwhile */
  keyChecking: Record<AiVendor, boolean>;
}

export const useAiStatusStore = create<AiStatusState>(() => ({
  cli: { claude: { state: "unknown" }, openai: { state: "unknown" } },
  cliChecking: { claude: false, openai: false },
  key: { claude: { state: "unknown" }, openai: { state: "unknown" } },
  keyChecking: { claude: false, openai: false },
}));

const STATUS_COMMAND: Record<AiVendor, string> = {
  claude: "claude_cli_status",
  openai: "codex_cli_status",
};

/** "2.1.4 (Claude Code)" / "codex-cli 0.9.0" → the version number alone */
const versionOf = (raw: string): string => raw.match(/\d+(\.\d+)+/)?.[0] ?? raw.trim();

const setCli = (vendor: AiVendor, next: CliState) =>
  useAiStatusStore.setState((s) => ({
    cli: { ...s.cli, [vendor]: next },
    cliChecking: { ...s.cliChecking, [vendor]: false },
  }));

const inFlight: Partial<Record<AiVendor, Promise<void>>> = {};

/**
 * Asks Rust whether the vendor's CLI runs and is signed in. Calls that arrive
 * while one is out join it. Nothing here moves focus or raises a toast, so a
 * result that lands after Settings closed is harmless.
 */
export const checkCli = (vendor: AiVendor): Promise<void> => {
  const running = inFlight[vendor];
  if (running) return running;
  useAiStatusStore.setState((s) => ({ cliChecking: { ...s.cliChecking, [vendor]: true } }));
  const run = invoke<{ version: string | null; signed_in: boolean | null }>(STATUS_COMMAND[vendor])
    .then(({ version, signed_in }) => {
      if (version === null) setCli(vendor, { state: "missing" });
      else if (signed_in === false)
        setCli(vendor, { state: "signed-out", version: versionOf(version) });
      else setCli(vendor, { state: "ok", version: versionOf(version) });
    })
    .catch(() => setCli(vendor, { state: "missing" }))
    .finally(() => {
      delete inFlight[vendor];
    });
  inFlight[vendor] = run;
  return run;
};

/** the latest check per vendor — an answer to an older one is dropped */
const keyCheckRound: Record<AiVendor, number> = { claude: 0, openai: 0 };

/**
 * Checks a key and keeps the answer for this run — unless the key changed
 * meanwhile. The last result stays while the check is out, as a CLI's does.
 */
export const checkKey = async (vendor: AiVendor, key: string): Promise<void> => {
  const round = ++keyCheckRound[vendor];
  useAiStatusStore.setState((s) => ({ keyChecking: { ...s.keyChecking, [vendor]: true } }));
  const result = await checkApiKey(vendor, key);
  if (keyCheckRound[vendor] !== round) return;
  useAiStatusStore.setState((s) => ({
    key: { ...s.key, [vendor]: result },
    keyChecking: { ...s.keyChecking, [vendor]: false },
  }));
};

/** a changed or removed key is no longer the checked one — a check still out is dropped too */
export const forgetKeyCheck = (vendor: AiVendor): void => {
  keyCheckRound[vendor]++;
  useAiStatusStore.setState((s) => ({
    key: { ...s.key, [vendor]: { state: "unknown" } },
    keyChecking: { ...s.keyChecking, [vendor]: false },
  }));
};

/**
 * Whether the composer can offer the vendor's models (#252): an API key
 * connection with a key, or a subscription whose CLI is not known to be
 * missing or signed out — before a check it gets the benefit of the doubt.
 */
export const isConnected = (
  settings: AiSettings,
  cli: Record<AiVendor, CliState>,
  vendor: AiVendor,
): boolean => {
  if (effectiveAuth(settings, vendor) === "api-key") return settings.keys[vendor] !== "";
  const state = cli[vendor].state;
  return state !== "missing" && state !== "signed-out";
};
