import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { forgetPlatform, pretendMac } from "../../../test/platform";
import {
  activeAuth,
  activeKey,
  authAvailable,
  effectiveAuth,
  activeModel,
  DEFAULT_AI_SETTINGS,
  loadAiSettings,
  modelShortLabel,
  saveAiSettings,
} from "../settings";

// GPT's subscription is macOS's: these suites run as on a Mac (jsdom names no platform)
beforeEach(pretendMac);
afterEach(forgetPlatform);

describe("AI settings storage (vendor × auth per vendor, #119, #252)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to Claude · Subscription when nothing is stored", () => {
    expect(loadAiSettings()).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("reads back the same value after saving", () => {
    const s = {
      vendor: "openai" as const,
      auths: { claude: "subscription" as const, openai: "api-key" as const },
      keys: { claude: "", openai: "sk-o" },
      models: { claude: "claude-opus-5", openai: "gpt-6-astra" },
    };
    saveAiSettings(s);
    expect(loadAiSettings()).toEqual(s);
    expect(activeKey(s)).toBe("sk-o");
    expect(activeModel(s)).toBe("gpt-6-astra");
    expect(activeAuth(s)).toBe("api-key");
  });

  it("migrates v1 claude-cli to Claude · Subscription", () => {
    localStorage.setItem(
      "dosik.ai-settings",
      JSON.stringify({ provider: "claude-cli", apiKey: "", model: "claude-opus-5" }),
    );
    expect(loadAiSettings()).toEqual(DEFAULT_AI_SETTINGS);
    // written back in the new shape
    expect(JSON.parse(localStorage.getItem("dosik.ai-settings")!)).toHaveProperty(
      "vendor",
      "claude",
    );
  });

  it("migrates v1 api-key (key, model) to Claude · API key, with key and model in the claude slot", () => {
    localStorage.setItem(
      "dosik.ai-settings",
      JSON.stringify({ provider: "api-key", apiKey: "sk-x", model: "claude-sonnet-5" }),
    );
    const s = loadAiSettings();
    expect(s.vendor).toBe("claude");
    expect(s.auths).toEqual({ claude: "api-key", openai: "api-key" });
    expect(s.keys).toEqual({ claude: "sk-x", openai: "" });
    expect(s.models).toEqual({ claude: "claude-sonnet-5", openai: "gpt-5.6-sol" });
  });

  it("migrates v1 values under the old app name (modern-diagram) to the new key and shape", () => {
    localStorage.setItem(
      "modern-diagram.ai-settings",
      JSON.stringify({ provider: "api-key", apiKey: "sk-legacy" }),
    );
    const s = loadAiSettings();
    expect(s.keys.claude).toBe("sk-legacy");
    expect(localStorage.getItem("dosik.ai-settings")).toContain("sk-legacy");
    expect(localStorage.getItem("modern-diagram.ai-settings")).toBeNull();
  });

  it("silently replaces broken JSON with defaults", () => {
    localStorage.setItem("dosik.ai-settings", "{not-json");
    expect(loadAiSettings()).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("deep-merges partial stored values with defaults", () => {
    localStorage.setItem(
      "dosik.ai-settings",
      JSON.stringify({ vendor: "openai", keys: { openai: "sk-p" } }),
    );
    const s = loadAiSettings();
    expect(s.vendor).toBe("openai");
    expect(s.auths).toEqual({ claude: "subscription", openai: "subscription" });
    expect(s.keys).toEqual({ claude: "", openai: "sk-p" });
    expect(s.models.openai).toBe("gpt-5.6-sol");
  });

  it("migrates a partial v1 value without provider ({apiKey, model}) without losing the key", () => {
    localStorage.setItem(
      "dosik.ai-settings",
      JSON.stringify({ apiKey: "sk-p", model: "claude-sonnet-5" }),
    );
    const s = loadAiSettings();
    expect(s.vendor).toBe("claude");
    expect(s.auths.claude).toBe("subscription");
    expect(s.keys.claude).toBe("sk-p");
    expect(s.models.claude).toBe("claude-sonnet-5");
  });

  it("falls back to defaults when keys/models are not strings", () => {
    localStorage.setItem(
      "dosik.ai-settings",
      JSON.stringify({ vendor: "openai", keys: "abc", models: { openai: 7 } }),
    );
    const s = loadAiSettings();
    expect(s.keys).toEqual({ claude: "", openai: "" });
    expect(s.models).toEqual({ claude: "claude-opus-5", openai: "gpt-5.6-sol" });
  });

  it("falls back to defaults when a v1 apiKey/model is not a string", () => {
    localStorage.setItem(
      "dosik.ai-settings",
      JSON.stringify({ provider: "api-key", apiKey: 12345, model: null }),
    );
    const s = loadAiSettings();
    expect(s.keys.claude).toBe("");
    expect(s.models.claude).toBe("claude-opus-5");
  });

  it("falls back to defaults for unknown vendor/auth values", () => {
    localStorage.setItem("dosik.ai-settings", JSON.stringify({ vendor: "gemini", auth: "magic" }));
    const s = loadAiSettings();
    expect(s.vendor).toBe("claude");
    expect(s.auths).toEqual({ claude: "subscription", openai: "subscription" });
  });

  it("moves a single stored connection (auth) to both vendors, once", () => {
    localStorage.setItem(
      "dosik.ai-settings",
      JSON.stringify({
        vendor: "openai",
        auth: "api-key",
        keys: { claude: "", openai: "sk-o" },
        models: { claude: "claude-opus-5", openai: "gpt-6-astra" },
      }),
    );
    const s = loadAiSettings();
    expect(s.auths).toEqual({ claude: "api-key", openai: "api-key" });
    expect(activeAuth(s)).toBe("api-key");
    // written back in the per-vendor shape, without the old field
    const stored = JSON.parse(localStorage.getItem("dosik.ai-settings")!);
    expect(stored.auths).toEqual({ claude: "api-key", openai: "api-key" });
    expect(stored).not.toHaveProperty("auth");
  });

  it("keeps per-vendor connections apart", () => {
    localStorage.setItem(
      "dosik.ai-settings",
      JSON.stringify({ vendor: "claude", auths: { claude: "api-key", openai: "subscription" } }),
    );
    const s = loadAiSettings();
    expect(s.auths).toEqual({ claude: "api-key", openai: "subscription" });
    expect(activeAuth(s)).toBe("api-key");
    expect(activeAuth({ ...s, vendor: "openai" })).toBe("subscription");
  });

  it("an unknown per-vendor connection falls back to subscription for that vendor only", () => {
    localStorage.setItem(
      "dosik.ai-settings",
      JSON.stringify({ auths: { claude: "magic", openai: "api-key" } }),
    );
    expect(loadAiSettings().auths).toEqual({ claude: "subscription", openai: "api-key" });
  });
});

describe("modelShortLabel (#252)", () => {
  it("drops the (recommended) note the menus carry", () => {
    expect(modelShortLabel("claude", "claude-opus-5")).toBe("Claude Opus 5");
    expect(modelShortLabel("openai", "gpt-6-astra")).toBe("GPT-6 Astra");
  });

  it("falls back to the id for a model the list does not know", () => {
    expect(modelShortLabel("claude", "claude-next")).toBe("claude-next");
  });
});

describe("GPT's subscription off macOS — the Codex CLI does not run there (the canvas's Win-Settings)", () => {
  const gptSubscription = {
    ...DEFAULT_AI_SETTINGS,
    vendor: "openai" as const,
    auths: { claude: "subscription" as const, openai: "subscription" as const },
  };

  it("only GPT's subscription is out, and only off macOS", () => {
    expect(authAvailable("openai", "subscription", false)).toBe(false);
    expect(authAvailable("openai", "api-key", false)).toBe(true);
    expect(authAvailable("claude", "subscription", false)).toBe(true);
    expect(authAvailable("openai", "subscription", true)).toBe(true);
  });

  it("a stored GPT subscription works as the API key off macOS — the stored choice stays", () => {
    expect(effectiveAuth(gptSubscription, "openai", false)).toBe("api-key");
    expect(activeAuth(gptSubscription, false)).toBe("api-key");
    expect(effectiveAuth(gptSubscription, "claude", false)).toBe("subscription");
    expect(effectiveAuth(gptSubscription, "openai", true)).toBe("subscription");
    expect(gptSubscription.auths.openai).toBe("subscription");
  });
});
