import { describe, expect, it, vi } from "vitest";

import { checkApiKey } from "../keyCheck";

const answer = (status: number) => vi.fn(async () => new Response("{}", { status }));

describe("checkApiKey (#252)", () => {
  it("asks Anthropic for its model list with the key", async () => {
    const fetchMock = answer(200);
    expect(await checkApiKey("claude", "sk-ant-1", fetchMock)).toEqual({ state: "ok" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models/);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-1");
    expect(headers["anthropic-version"]).toBeTruthy();
  });

  it("asks OpenAI for its model list with a bearer key", async () => {
    const fetchMock = answer(200);
    await checkApiKey("openai", "sk-o", fetchMock);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-o");
  });

  it("the request gives up after a while, so a stalled network ends as a failed check", async () => {
    const fetchMock = answer(200);
    await checkApiKey("openai", "sk-o", fetchMock);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("401 and 403 are a rejected key", async () => {
    expect(await checkApiKey("claude", "k", answer(401))).toEqual({ state: "rejected" });
    expect(await checkApiKey("openai", "k", answer(403))).toEqual({ state: "rejected" });
  });

  it("another answer, or no answer, is a failed check with the reason", async () => {
    expect(await checkApiKey("openai", "k", answer(500))).toEqual({
      state: "error",
      message: "HTTP 500",
    });
    const offline = vi.fn(async () => {
      throw new TypeError("Load failed");
    });
    expect(await checkApiKey("claude", "k", offline)).toEqual({
      state: "error",
      message: "No connection",
    });
  });
});
