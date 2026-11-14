// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";

import {
  DEFAULT_PORT,
  LAUNCH_COMMAND,
  LAUNCH_HINT,
  PROBE_TIMEOUT_MS,
  parseInvocation,
  parseOpsInput,
  probeBridge,
  resolvePort,
  sendOps,
  waitForBridge,
} from "../opsClient.mjs";

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe("terminal entry point (#63)", () => {
  it("takes the port from DOSIK_PORT and falls back to the default on garbage", () => {
    expect(resolvePort({})).toBe(DEFAULT_PORT);
    expect(resolvePort({ DOSIK_PORT: "4600" })).toBe(4600);
    expect(resolvePort({ DOSIK_PORT: "nope" })).toBe(DEFAULT_PORT);
    expect(resolvePort({ DOSIK_PORT: "0" })).toBe(DEFAULT_PORT);
    expect(resolvePort({ DOSIK_PORT: "99999" })).toBe(DEFAULT_PORT);
  });

  it("reuses a live bridge and tells a stranger's server apart", async () => {
    const ours = vi.fn(async () => jsonResponse({ name: "dosik agent bridge" }));
    expect(await probeBridge(DEFAULT_PORT, ours as never)).toEqual({ state: "ready" });

    const stranger = vi.fn(async () => jsonResponse({ name: "something else" }));
    expect((await probeBridge(DEFAULT_PORT, stranger as never)).state).toBe("foreign");

    const refused = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await probeBridge(DEFAULT_PORT, refused as never)).toEqual({ state: "down" });

    // a dev server on the same port answers with HTML: that is somebody, not
    // nothing — calling it "down" would start the app onto a port it cannot bind
    const html = {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
      text: async () => "<!doctype html>",
    };
    expect((await probeBridge(DEFAULT_PORT, (async () => html) as never)).state).toBe("foreign");
  });

  it("waits until the bridge is up and reports progress", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("ECONNREFUSED");
      return jsonResponse({ name: "dosik" });
    });
    const waits: number[] = [];
    let clock = 0;
    const result = await waitForBridge(DEFAULT_PORT, {
      fetchImpl: fetchImpl as never,
      sleep: async () => {
        clock += 500;
      },
      now: () => clock,
      onWait: (elapsed: number) => waits.push(elapsed),
    });
    expect(result).toEqual({ state: "ready" });
    expect(waits).toHaveLength(2);
  });

  it("gives a reason instead of dying silently when time runs out", async () => {
    let clock = 0;
    const result = await waitForBridge(DEFAULT_PORT, {
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as never,
      sleep: async () => {
        clock += 1000;
      },
      now: () => clock,
      timeoutMs: 2000,
    });
    expect(result.state).toBe("timeout");
    expect(result.detail).toContain("2s");
  });

  it("accepts both {ops:[…]} and […] and rejects empty input", () => {
    expect(parseOpsInput('{"ops":[{"op":"clear"}]}')).toEqual({ ops: [{ op: "clear" }] });
    expect(parseOpsInput('[{"op":"clear"}]')).toEqual({ ops: [{ op: "clear" }] });
    expect(() => parseOpsInput("")).toThrow(/No ops to send/);
    expect(() => parseOpsInput("{")).toThrow(/Cannot parse JSON/);
    expect(() => parseOpsInput('{"ops":[]}')).toThrow(/is empty/);
  });

  it("treats a peer that holds the port but never answers as not down — it must not wait forever", async () => {
    // an ssh forward to a dead remote, a stopped container: the socket is
    // accepted and then nothing comes back
    const stalled = vi.fn(async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    });
    const probe = await probeBridge(DEFAULT_PORT, stalled as never);
    expect(probe.state).toBe("foreign");
    expect(probe.detail).toContain("not responding");
    expect(PROBE_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });

  it("puts a time limit on the probe", async () => {
    const seen: RequestInit[] = [];
    const spy = vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init);
      return jsonResponse({ name: "dosik" });
    });
    await probeBridge(DEFAULT_PORT, spy as never);
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("decides from argv where the input comes from — including the --file=x form", () => {
    expect(parseInvocation([])).toEqual({ kind: "stdin" });
    expect(parseInvocation(["--file", "ops.json"])).toEqual({ kind: "file", path: "ops.json" });
    expect(parseInvocation(["--file=ops.json"])).toEqual({ kind: "file", path: "ops.json" });
    expect(parseInvocation(['{"ops":[]}'])).toEqual({ kind: "inline", json: '{"ops":[]}' });
    // npm swallows the separator, pnpm forwards it — both habits must work
    expect(parseInvocation(["--", '{"ops":[]}'])).toEqual({ kind: "inline", json: '{"ops":[]}' });
    expect(parseInvocation(["--", "--file", "ops.json"])).toEqual({
      kind: "file",
      path: "ops.json",
    });
    expect(() => parseInvocation(["--file"])).toThrow(/needs a path/);
    expect(() => parseInvocation(["--nope"])).toThrow(/Unknown option/);
    expect(() => parseInvocation(["a", "b"])).toThrow(/Too many arguments/);
  });

  it("launches the app with this repository's package manager", () => {
    // packageManager in package.json makes corepack refuse npm. If this drifts,
    // it breaks silently on a person's machine, not in CI (#59).
    expect(LAUNCH_COMMAND).toEqual(["pnpm", "tauri", "dev"]);
    expect(LAUNCH_HINT).toBe(LAUNCH_COMMAND.join(" "));
    // the thin shell (dosik-ops.mjs) has no tests — check that it really uses the constant
    const shell = readFileSync(new URL("../dosik-ops.mjs", import.meta.url), "utf8");
    expect(shell).toContain("LAUNCH_COMMAND");
    expect(shell).not.toMatch(/spawn\(\s*["'`]npm/);
  });

  it("sends in the shape the bridge requires", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const spy = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return jsonResponse({ ok: true, applied: 1 });
    });
    const result = await sendOps(DEFAULT_PORT, { ops: [{ op: "clear" }] }, spy as never);
    expect(result).toEqual({ status: 200, body: { ok: true, applied: 1 } });
    const sent = seen[0];
    expect(sent).toBeDefined();
    expect(sent?.url).toContain("/api/ops");
    expect(sent?.init.method).toBe("POST");
    // the bridge refuses anything without this header
    const headers = sent?.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(sent?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a non-JSON answer from the bridge as is", async () => {
    const html = { ok: false, status: 502, json: async () => ({}), text: async () => "<html>" };
    await expect(sendOps(DEFAULT_PORT, { ops: [] }, (async () => html) as never)).rejects.toThrow(
      /non-JSON response/,
    );
  });
});
