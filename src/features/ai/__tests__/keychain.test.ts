import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "../../../shared/lib/toastStore";
import { useChatStore } from "../chatStore";
import {
  flushKeySaves,
  initAiKeys,
  keychainAvailable,
  KEY_SAVE_DELAY_MS,
  resetKeychainForTests,
} from "../keychain";
import { DEFAULT_AI_SETTINGS, loadAiSettings, saveAiSettings } from "../settings";

const mockedInvoke = vi.mocked(invoke);
const STORAGE_KEY = "dosik.ai-settings";

/** an in-memory keychain behind the two commands */
const fakeKeychain = (initial: Record<string, string> = {}, { fail = false } = {}) => {
  const store = { ...initial };
  mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const { name, value } = (args ?? {}) as { name: string; value: string };
    if (fail) throw new Error("the system credential store is not available");
    if (cmd === "secret_get") return store[name] ?? null;
    if (cmd === "secret_set") {
      if (value === "") delete store[name];
      else store[name] = value;
      return undefined;
    }
    return undefined;
  });
  return store;
};

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
const setCalls = () => mockedInvoke.mock.calls.filter(([c]) => c === "secret_set");

const boot = async () => {
  useChatStore.setState({ settings: loadAiSettings() });
  await initAiKeys();
};

describe("API keys live in the OS keychain (#17)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetKeychainForTests();
    useChatStore.setState({ settings: DEFAULT_AI_SETTINGS });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves plaintext keys from localStorage to the keychain and deletes them only after the move", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_AI_SETTINGS, keys: { claude: "sk-ant-1", openai: "" } }),
    );
    const keychain = fakeKeychain();
    await boot();
    expect(keychain["ai-key-claude"]).toBe("sk-ant-1");
    expect(stored().keys).toEqual({ claude: "", openai: "" });
    // the key in memory stays — the user does not have to enter it again
    expect(useChatStore.getState().settings.keys.claude).toBe("sk-ant-1");
    expect(keychainAvailable()).toBe(true);
  });

  it("moves v1 keys under the old name (modern-diagram) too", async () => {
    localStorage.setItem(
      "modern-diagram.ai-settings",
      JSON.stringify({ provider: "api-key", apiKey: "sk-ant-legacy" }),
    );
    const keychain = fakeKeychain();
    await boot();
    expect(keychain["ai-key-claude"]).toBe("sk-ant-legacy");
    expect(JSON.stringify(localStorage)).not.toContain("sk-ant-legacy");
  });

  it("loads keys from the keychain", async () => {
    fakeKeychain({ "ai-key-openai": "sk-oa" });
    await boot();
    expect(useChatStore.getState().settings.keys).toEqual({ claude: "", openai: "sk-oa" });
  });

  it("treats a key left in localStorage as the newer value — only values the keychain never confirmed stay there", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_AI_SETTINGS, keys: { claude: "sk-new", openai: "" } }),
    );
    const keychain = fakeKeychain({ "ai-key-claude": "sk-old" });
    await boot();
    expect(useChatStore.getState().settings.keys.claude).toBe("sk-new");
    expect(keychain["ai-key-claude"]).toBe("sk-new");
    expect(stored().keys.claude).toBe("");
  });

  it("keeps a key left in localStorage after a failed write across a restart (#153)", async () => {
    const keychain = fakeKeychain({ "ai-key-claude": "sk-A" });
    await boot();
    // the key changes but the keychain write fails
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "secret_set") throw new Error("keychain locked");
      return keychain["ai-key-claude"] ?? null;
    });
    useChatStore.getState().setSettings({
      ...useChatStore.getState().settings,
      keys: { claude: "sk-B", openai: "" },
    });
    await flushKeySaves();
    expect(stored().keys.claude).toBe("sk-B");
    // restart — the keychain is writable now
    resetKeychainForTests();
    fakeKeychain(keychain);
    await boot();
    expect(useChatStore.getState().settings.keys.claude).toBe("sk-B");
  });

  it("does not overwrite a key typed during init with the old plaintext key (#153)", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_AI_SETTINGS, keys: { claude: "sk-old", openai: "" } }),
    );
    const keychain = fakeKeychain();
    let releaseRead = () => {};
    const slowRead = new Promise<void>((r) => (releaseRead = r));
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      const { name, value } = (args ?? {}) as { name: string; value: string };
      if (cmd === "secret_get") {
        // the store answers with what it held when asked, however late the answer lands
        const held = keychain[name] ?? null;
        await slowRead;
        return held;
      }
      if (cmd === "secret_set") keychain[name] = value;
      return undefined;
    });
    useChatStore.setState({ settings: loadAiSettings() });
    const init = initAiKeys();
    useChatStore.getState().setSettings({
      ...useChatStore.getState().settings,
      keys: { claude: "sk-new", openai: "" },
    });
    // the typed key's write goes out while the slow read is still pending —
    // then the migration must not write the older plain-text key over it
    await new Promise((r) => setTimeout(r, KEY_SAVE_DELAY_MS + 50));
    expect(keychain["ai-key-claude"]).toBe("sk-new");
    releaseRead();
    await init;
    await flushKeySaves();
    expect(keychain["ai-key-claude"]).toBe("sk-new");
    expect(useChatStore.getState().settings.keys.claude).toBe("sk-new");
  });

  it("does not revive a key deleted in a session that could not reach the keychain (#153)", async () => {
    const keychain = fakeKeychain({ "ai-key-claude": "sk-A" });
    // this session cannot reach the keychain
    mockedInvoke.mockImplementation(async () => {
      throw new Error("keychain locked");
    });
    useChatStore.setState({
      settings: { ...DEFAULT_AI_SETTINGS, keys: { claude: "sk-A", openai: "" } },
    });
    await initAiKeys();
    expect(keychainAvailable()).toBe(false);
    useChatStore.getState().setSettings({
      ...useChatStore.getState().settings,
      keys: { claude: "", openai: "" },
    });
    // next launch — the keychain is back
    resetKeychainForTests();
    const restarted = fakeKeychain(keychain);
    await boot();
    expect(useChatStore.getState().settings.keys.claude).toBe("");
    expect(restarted["ai-key-claude"]).toBeUndefined();
  });

  it("runs once even when called twice — so dev-mode StrictMode does not show the access prompt twice", async () => {
    fakeKeychain();
    useChatStore.setState({ settings: loadAiSettings() });
    await Promise.all([initAiKeys(), initAiKeys()]);
    expect(mockedInvoke.mock.calls.filter(([c]) => c === "secret_get")).toHaveLength(2);
  });

  it("leaves localStorage alone and reports it when the keychain is unreachable", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_AI_SETTINGS, keys: { claude: "sk-ant-1", openai: "" } }),
    );
    fakeKeychain({}, { fail: true });
    const before = useToastStore.getState().toasts.length;
    await boot();
    expect(stored().keys.claude).toBe("sk-ant-1");
    expect(useChatStore.getState().settings.keys.claude).toBe("sk-ant-1");
    expect(keychainAvailable()).toBe(false);
    expect(useToastStore.getState().toasts.length).toBe(before + 1);
    // later saves do not drop the key either — it stays in localStorage as before
    useChatStore.getState().setSettings({
      ...useChatStore.getState().settings,
      keys: { claude: "sk-ant-2", openai: "" },
    });
    expect(stored().keys.claude).toBe("sk-ant-2");
  });

  it("batches writes while typing and writes once — with the last value", async () => {
    fakeKeychain();
    await boot();
    vi.useFakeTimers();
    const type = (value: string) =>
      useChatStore.getState().setSettings({
        ...useChatStore.getState().settings,
        keys: { claude: value, openai: "" },
      });
    type("s");
    type("sk");
    type("sk-ant-9");
    expect(setCalls()).toHaveLength(0);
    // not a single character is left in localStorage
    expect(stored().keys.claude).toBe("");
    await vi.advanceTimersByTimeAsync(KEY_SAVE_DELAY_MS);
    expect(setCalls()).toEqual([["secret_set", { name: "ai-key-claude", value: "sk-ant-9" }]]);
  });

  it("deletes the key when cleared", async () => {
    const keychain = fakeKeychain({ "ai-key-claude": "sk-ant-1" });
    await boot();
    useChatStore.getState().setSettings({
      ...useChatStore.getState().settings,
      keys: { claude: "", openai: "" },
    });
    await flushKeySaves();
    expect(keychain["ai-key-claude"]).toBeUndefined();
  });

  it("finishes pending writes before the window closes", async () => {
    const keychain = fakeKeychain();
    await boot();
    useChatStore.getState().setSettings({
      ...useChatStore.getState().settings,
      keys: { claude: "", openai: "sk-oa" },
    });
    expect(keychain["ai-key-openai"]).toBeUndefined();
    await flushKeySaves();
    expect(keychain["ai-key-openai"]).toBe("sk-oa");
  });

  it("falls back to localStorage on a failed write so the key is not lost", async () => {
    fakeKeychain();
    await boot();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "secret_set") throw new Error("denied");
      return null;
    });
    useChatStore.getState().setSettings({
      ...useChatStore.getState().settings,
      keys: { claude: "sk-ant-3", openai: "" },
    });
    await flushKeySaves();
    expect(keychainAvailable()).toBe(false);
    expect(stored().keys.claude).toBe("sk-ant-3");
  });

  it("does not delete keys on a save before init finishes — they must not be lost before the move", () => {
    saveAiSettings({ ...DEFAULT_AI_SETTINGS, keys: { claude: "sk-ant-1", openai: "" } });
    expect(stored().keys.claude).toBe("sk-ant-1");
  });
});
