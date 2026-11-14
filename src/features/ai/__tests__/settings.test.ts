import { beforeEach, describe, expect, it } from "vitest";

import {
  activeKey,
  activeModel,
  DEFAULT_AI_SETTINGS,
  loadAiSettings,
  saveAiSettings,
} from "../settings";

describe("AI settings storage (v2 — vendor × auth, #119)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to Claude · Subscription when nothing is stored", () => {
    expect(loadAiSettings()).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("reads back the same value after saving", () => {
    const s = {
      vendor: "openai" as const,
      auth: "api-key" as const,
      keys: { claude: "", openai: "sk-o" },
      models: { claude: "claude-opus-5", openai: "gpt-6-astra" },
    };
    saveAiSettings(s);
    expect(loadAiSettings()).toEqual(s);
    expect(activeKey(s)).toBe("sk-o");
    expect(activeModel(s)).toBe("gpt-6-astra");
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
    expect(s.auth).toBe("api-key");
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
    expect(s.auth).toBe("subscription");
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
    expect(s.auth).toBe("subscription");
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
    expect(s.auth).toBe("subscription");
  });
});
