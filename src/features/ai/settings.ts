import { isMacPlatform } from "../../shared/lib/windowChrome";

export type AiVendor = "claude" | "openai";
/** how the vendor is reached — the local CLI signed in with a subscription, or a pay-per-use key */
export type AiAuth = "subscription" | "api-key";

export interface AiSettings {
  /** the vendor the chat talks to — picked with a model in the composer's menu (#252) */
  vendor: AiVendor;
  /** how each vendor is reached, chosen in Settings ▸ AI assistant — each vendor keeps its own (#252) */
  auths: Record<AiVendor, AiAuth>;
  /** one key per vendor, so switching vendors does not throw the other key away */
  keys: Record<AiVendor, string>;
  models: Record<AiVendor, string>;
}

export const CLAUDE_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5 (recommended)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

export const OPENAI_MODELS = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol (recommended)" },
  { id: "gpt-6-astra", label: "GPT-6 Astra" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
];

export const MODELS_BY_VENDOR: Record<AiVendor, { id: string; label: string }[]> = {
  claude: CLAUDE_MODELS,
  openai: OPENAI_MODELS,
};

export const VENDOR_LABEL: Record<AiVendor, string> = { claude: "Claude", openai: "GPT" };
export const AUTH_LABEL: Record<AiAuth, string> = {
  subscription: "Subscription",
  "api-key": "API key",
};

const STORAGE_KEY = "dosik.ai-settings";
/** Pre-rename key (the app used to be called modern-diagram) — read once and migrate. */
const LEGACY_STORAGE_KEY = "modern-diagram.ai-settings";

export const DEFAULT_AI_SETTINGS: AiSettings = {
  vendor: "claude",
  auths: { claude: "subscription", openai: "subscription" },
  keys: { claude: "", openai: "" },
  models: { claude: "claude-opus-5", openai: "gpt-5.6-sol" },
};

/** the key and model the current vendor/auth pair actually uses */
export const activeKey = (s: AiSettings): string => s.keys[s.vendor];
export const activeModel = (s: AiSettings): string => s.models[s.vendor];
/**
 * Whether a connection can be used here: GPT's subscription goes through the
 * Codex CLI, which Dosik does not run off macOS (`codex.rs`).
 */
export const authAvailable = (
  vendor: AiVendor,
  auth: AiAuth,
  mac: boolean = isMacPlatform(),
): boolean => mac || vendor !== "openai" || auth !== "subscription";

/**
 * The connection a vendor uses here: the stored one, or the API key where it
 * cannot be used. The stored choice is not written over.
 */
export const effectiveAuth = (
  s: AiSettings,
  vendor: AiVendor,
  mac: boolean = isMacPlatform(),
): AiAuth => (authAvailable(vendor, s.auths[vendor], mac) ? s.auths[vendor] : "api-key");

export const activeAuth = (s: AiSettings, mac: boolean = isMacPlatform()): AiAuth =>
  effectiveAuth(s, s.vendor, mac);

/** a model's name without the "(recommended)" note — what the composer's button reads (#252) */
export const modelShortLabel = (vendor: AiVendor, id: string): string => {
  const label = MODELS_BY_VENDOR[vendor].find((m) => m.id === id)?.label;
  return label ? label.replace(/\s*\(recommended\)$/, "") : id;
};

/** v1 shape (#119 predecessor): a single provider switch that only knew Claude */
interface LegacySettings {
  provider?: "claude-cli" | "api-key";
  apiKey?: string;
  model?: string;
}

/** any v1 field counts — a partial v1 value (say `{apiKey}` alone) must keep its key */
const isLegacy = (raw: object): raw is LegacySettings =>
  !("vendor" in raw) && ("provider" in raw || "apiKey" in raw || "model" in raw);

/** only string values per vendor survive — anything else falls back to the default */
const perVendorStrings = (
  raw: unknown,
  defaults: Record<AiVendor, string>,
): Record<AiVendor, string> => {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    claude: typeof source.claude === "string" ? source.claude : defaults.claude,
    openai: typeof source.openai === "string" ? source.openai : defaults.openai,
  };
};

const toAuth = (raw: unknown): AiAuth => (raw === "api-key" ? "api-key" : "subscription");

/**
 * The stored connections: per vendor (`auths`), or the one `auth` the app kept
 * before #252 — which both vendors take, so nobody's chat changes under them.
 */
const perVendorAuths = (
  raw: Partial<Record<"auth" | "auths", unknown>>,
): Record<AiVendor, AiAuth> => {
  if (raw.auths && typeof raw.auths === "object") {
    const auths = raw.auths as Record<string, unknown>;
    return { claude: toAuth(auths.claude), openai: toAuth(auths.openai) };
  }
  const one = toAuth(raw.auth);
  return { claude: one, openai: one };
};

/** a value written before #252: one connection for both vendors */
const hasSingleAuth = (raw: object): boolean => !("auths" in raw) && "auth" in raw;

/**
 * Merges a stored value into the defaults. v1 values (`provider`/`apiKey`/
 * `model`) become the equivalent Claude pair so nobody has to choose again.
 */
const normalize = (raw: unknown): AiSettings => {
  if (!raw || typeof raw !== "object") return DEFAULT_AI_SETTINGS;
  if (isLegacy(raw)) {
    const auth = toAuth(raw.provider);
    return {
      ...DEFAULT_AI_SETTINGS,
      vendor: "claude",
      auths: { claude: auth, openai: auth },
      keys: {
        ...DEFAULT_AI_SETTINGS.keys,
        claude: typeof raw.apiKey === "string" ? raw.apiKey : "",
      },
      models: {
        ...DEFAULT_AI_SETTINGS.models,
        claude: typeof raw.model === "string" ? raw.model : DEFAULT_AI_SETTINGS.models.claude,
      },
    };
  }
  const partial = raw as Partial<AiSettings> & { auth?: unknown };
  return {
    vendor: partial.vendor === "openai" ? "openai" : "claude",
    auths: perVendorAuths(partial),
    keys: perVendorStrings(partial.keys, DEFAULT_AI_SETTINGS.keys),
    models: perVendorStrings(partial.models, DEFAULT_AI_SETTINGS.models),
  };
};

export const loadAiSettings = (): AiSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const raw = stored ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return DEFAULT_AI_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    const settings = normalize(parsed);
    // write back whenever the stored shape is not the current one (legacy
    // key, v1 fields, or the single connection before #252) so the migration
    // happens once
    const migrated =
      !stored ||
      (typeof parsed === "object" &&
        parsed !== null &&
        (isLegacy(parsed) || hasSingleAuth(parsed)));
    if (migrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    return settings;
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
};

/**
 * Writes the settings to `localStorage`. The keys go too only when asked
 * (`keepKeys`) — once the system keychain holds them (#17), this file keeps
 * none. Keeping is the default, so a caller that does not know whether the
 * keys were moved yet cannot throw them away.
 */
export const saveAiSettings = (
  settings: AiSettings,
  { keepKeys = true }: { keepKeys?: boolean } = {},
): void => {
  const written = keepKeys ? settings : { ...settings, keys: { claude: "", openai: "" } };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(written));
};

/**
 * Keys the user cleared while the keychain could not be reached (#153).
 * The keychain still holds the old value, and the next run would otherwise
 * load it back — a deletion is the one change that must not wait to be lost.
 */
const CLEARED_KEY = "dosik.ai-keys-cleared";

export const markKeyCleared = (vendor: AiVendor, cleared: boolean): void => {
  try {
    const current = new Set(loadClearedKeys());
    if (cleared) current.add(vendor);
    else current.delete(vendor);
    if (current.size === 0) localStorage.removeItem(CLEARED_KEY);
    else localStorage.setItem(CLEARED_KEY, JSON.stringify([...current]));
  } catch {
    // storage unavailable — nothing more can be kept for the next run
  }
};

export const loadClearedKeys = (): AiVendor[] => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CLEARED_KEY) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((v): v is AiVendor => v === "claude" || v === "openai")
      : [];
  } catch {
    return [];
  }
};
