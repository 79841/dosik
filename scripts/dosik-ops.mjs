#!/usr/bin/env node
/**
 * Send bridge ops from the terminal, starting the app if it is not up (#63).
 *
 *   pnpm ops '{"ops":[{"op":"add_node","node":{"label":"Hi","x":0,"y":0}}]}'
 *   pnpm ops --file ops.json
 *   cat ops.json | pnpm ops
 *
 * The bridge's answer goes to stdout and everything else to stderr, so it
 * pipes — but pnpm prints its own banner first: use `pnpm --silent ops`
 * (or `node scripts/dosik-ops.mjs`) when feeding `jq`.
 *
 * A live bridge is reused — the app is never started twice on the same port.
 * When it is down this launches `pnpm tauri dev` and waits; a cold Rust
 * build takes minutes, so the wait prints progress instead of hanging silently.
 * The app is left running: the next command reuses it, which is the point.
 *
 * Scope (#63): the development build. Launching an installed bundle would need
 * app-path discovery on three platforms and is deliberately out of scope.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  bridgeUrl,
  DEFAULT_TIMEOUT_MS,
  LAUNCH_COMMAND,
  LAUNCH_HINT,
  parseInvocation,
  parseOpsInput,
  probeBridge,
  resolvePort,
  sendOps,
  waitForBridge,
} from "./opsClient.mjs";

const readStdin = async () => {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

const main = async () => {
  let invocation;
  try {
    invocation = parseInvocation(process.argv.slice(2));
  } catch (error) {
    fail(error.message);
  }
  const raw =
    invocation.kind === "file"
      ? readFileSync(invocation.path, "utf8")
      : invocation.kind === "inline"
        ? invocation.json
        : await readStdin();

  let body;
  try {
    body = parseOpsInput(raw);
  } catch (error) {
    fail(error.message);
  }

  const port = resolvePort();
  let probe = await probeBridge(port);

  if (probe.state === "foreign") {
    fail(
      `Port ${port} is in use by something else (${probe.detail}). Set DOSIK_PORT to use another port`,
    );
  }

  if (probe.state === "down") {
    console.error(`· The app is not running — starting it (${bridgeUrl(port)})`);
    console.error(
      "  The first run, or a run after Rust dependencies change, takes a few minutes to compile",
    );
    const [launcher, ...launchArgs] = LAUNCH_COMMAND;
    const child = spawn(launcher, launchArgs, {
      detached: true,
      stdio: "ignore",
      // Windows has no pnpm.exe — the launcher is pnpm.cmd, which `spawn` only
      // finds through a shell. Every argument here is a literal.
      shell: process.platform === "win32",
    });
    child.unref();
    let spawnError = null;
    let exitedWith = null;
    child.on("error", (error) => {
      spawnError = error;
    });
    // a build that dies on a compile error leaves through `exit`, not `error` —
    // without this the poll would knock on a dead port for the full timeout and
    // then blame the clock
    child.on("exit", (code) => {
      exitedWith = code;
    });

    const stopChild = () => {
      try {
        if (child.pid === undefined) return;
        if (process.platform === "win32") child.kill();
        else process.kill(-child.pid, "SIGTERM");
      } catch {
        // already gone
      }
    };

    let lastReport = 0;
    probe = await waitForBridge(port, {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      onWait: (elapsed) => {
        if (spawnError) fail(`Could not start the app: ${spawnError.message}`);
        if (exitedWith !== null) {
          fail(
            `The app exited right away (exit ${exitedWith}) — run \`${LAUNCH_HINT}\` to see the build error`,
          );
        }
        if (elapsed - lastReport < 10_000) return;
        lastReport = elapsed;
        console.error(`  … waiting (${Math.round(elapsed / 1000)}s)`);
      },
    });
    if (probe.state !== "ready") {
      // we started it, so we clean it up — an orphan build would block the port
      // and the next run would start a second one on top of it
      stopChild();
      fail(
        `${probe.detail ?? "The bridge did not come up"}. Run \`${LAUNCH_HINT}\` yourself to see the build error`,
      );
    }
    console.error("· Ready");
  }

  const { status, body: result } = await sendOps(port, body);
  console.log(JSON.stringify(result, null, 2));
  if (status === 202 || result?.queued === true) {
    console.error(
      "· The app is up but its window has not received the ops yet — send them again in a moment",
    );
  }
  // exitCode, not exit(): a large answer is still draining out of stdout
  if (status >= 400 || status === 202 || result?.ok === false || result?.queued === true) {
    process.exitCode = 1;
  }
};

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
