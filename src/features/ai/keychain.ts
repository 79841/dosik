import { invoke } from "@tauri-apps/api/core";

import { useToastStore } from "../../shared/lib/toastStore";
import { type AiSettings, type AiVendor, loadClearedKeys, markKeyCleared } from "./settings";

/**
 * The AI API keys live in the OS credential store, not in `localStorage` (#17).
 *
 * `localStorage` is a plain-text file in the webview's data directory. The
 * Rust side (`secrets.rs`) files each key under the app's name in Keychain /
 * Credential Manager / Secret Service, and only these two names exist.
 *
 * Losing a key is worse than keeping it in plain text, so every step that
 * could lose one falls back instead: a store that cannot be reached leaves the
 * keys where they were, and `localStorage` is only emptied of a key once the
 * store holds it.
 */
export const SECRET_NAME: Record<AiVendor, string> = {
  claude: "ai-key-claude",
  openai: "ai-key-openai",
};
const VENDORS = Object.keys(SECRET_NAME) as AiVendor[];

/** typing fires a change per character; the store is written once the typing stops */
export const KEY_SAVE_DELAY_MS = 400;

/**
 * `null` until the first read answers. Until then nothing strips the keys from
 * `localStorage` — they have not been moved yet.
 */
let available: boolean | null = null;
export const keychainAvailable = (): boolean | null => available;

/** the settings store, bound by `chatStore` — this module must not import it (cycle) */
interface KeyStoreBinding {
  get: () => AiSettings;
  /** replace the keys in memory without saving them anywhere */
  setKeys: (keys: Record<AiVendor, string>) => void;
  /** write the non-secret settings (and the keys, while the store is unusable) */
  persist: () => void;
}
let binding: KeyStoreBinding | null = null;
export const bindKeyStore = (next: KeyStoreBinding): void => {
  binding = next;
};

const readKey = (vendor: AiVendor) =>
  invoke<string | null>("secret_get", { name: SECRET_NAME[vendor] });
const writeKey = (vendor: AiVendor, value: string) =>
  invoke<void>("secret_set", { name: SECRET_NAME[vendor], value });

const giveUp = (error: unknown, message: string): void => {
  available = false;
  // the keys are still in memory; writing them back keeps them across restarts
  binding?.persist();
  useToastStore
    .getState()
    .pushToast(`${message} ${String((error as Error)?.message ?? error)}`, "error");
};

/**
 * Once at startup: move any plain-text keys into the store, then load what the
 * store holds.
 *
 * **A plain-text key wins.** `localStorage` only ever holds a key the store has
 * not confirmed — a pre-#17 install, a write that failed and fell back, a key
 * typed before this ran — so where both have one, the plain-text copy is the
 * newer. Letting the store win lost the key a failed write had just saved
 * (#153). A key typed while this runs is newer still: its pending write
 * is left to land, not overwritten by the migration.
 */
let started: Promise<void> | null = null;
export const initAiKeys = (): Promise<void> => {
  // StrictMode runs the effect twice in development; one run is enough, and a
  // second would ask macOS for keychain access a second time
  started ??= run();
  return started;
};

const run = async (): Promise<void> => {
  if (!binding) return;
  const before = binding.get().keys;
  const fromStore: Partial<Record<AiVendor, string>> = {};
  try {
    for (const vendor of VENDORS) {
      const value = await readKey(vendor);
      if (value) fromStore[vendor] = value;
    }
  } catch (error) {
    giveUp(error, "API keys stay in local settings — the system keychain is not reachable:");
    return;
  }
  try {
    // cleared while the keychain was away: delete the stale entry now, unless
    // a key has been entered again since
    for (const vendor of loadClearedKeys()) {
      if (!before[vendor]) {
        await writeKey(vendor, "");
        delete fromStore[vendor];
      }
      markKeyCleared(vendor, false);
    }
    for (const vendor of VENDORS) {
      // typed since this started (written already, or waiting to be): that
      // key is newer than the plain-text one, and its own write carries it
      if (!before[vendor] || binding.get().keys[vendor] !== before[vendor]) continue;
      if (before[vendor] !== fromStore[vendor]) await writeKey(vendor, before[vendor]);
      fromStore[vendor] = before[vendor];
    }
  } catch (error) {
    giveUp(error, "API keys stay in local settings — moving them to the keychain failed:");
    return;
  }
  available = true;
  const now = binding.get().keys;
  binding.setKeys({
    // a key typed while this ran is newer than anything read above
    claude: now.claude !== before.claude ? now.claude : (fromStore.claude ?? ""),
    openai: now.openai !== before.openai ? now.openai : (fromStore.openai ?? ""),
  });
  // strips the moved keys out of localStorage
  binding.persist();
};

const pending = new Map<AiVendor, { timer: ReturnType<typeof setTimeout>; value: string }>();

const writeNow = async (vendor: AiVendor, value: string): Promise<void> => {
  try {
    await writeKey(vendor, value);
  } catch (error) {
    giveUp(
      error,
      "The API key could not be saved to the system keychain; it is kept in local settings:",
    );
  }
};

/** Saves a changed key once typing stops. While the store is unusable, `persist` covers it. */
export const scheduleKeySave = (vendor: AiVendor, value: string): void => {
  if (available === false) {
    // `persist` keeps a typed key; a cleared one has to be remembered, or the
    // keychain's old value comes back on the next run
    markKeyCleared(vendor, value === "");
    return;
  }
  const current = pending.get(vendor);
  if (current) clearTimeout(current.timer);
  const timer = setTimeout(() => {
    pending.delete(vendor);
    void writeNow(vendor, value);
  }, KEY_SAVE_DELAY_MS);
  pending.set(vendor, { timer, value });
};

/** Writes what is waiting — before the window closes. */
export const flushKeySaves = async (): Promise<void> => {
  const waiting = [...pending.entries()];
  pending.clear();
  for (const [vendor, { timer, value }] of waiting) {
    clearTimeout(timer);
    await writeNow(vendor, value);
  }
};

export const resetKeychainForTests = (): void => {
  available = null;
  started = null;
  for (const { timer } of pending.values()) clearTimeout(timer);
  pending.clear();
};
