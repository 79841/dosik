import { describe, expect, it } from "vitest";

import { olderVersion, type PluginFacts, pluginRows } from "../pluginStatus";

const SERVER = "/Users/a/Library/Application Support/app.dosik.desktop/mcp/server/server.mjs";
const facts = (over: Partial<PluginFacts> = {}): PluginFacts => ({
  server: SERVER,
  serverProblem: null,
  node: { path: "/usr/local/bin/node", version: "v22.18.0" },
  appVersion: "0.2.0",
  claudeCode: { cli: true, registered: null },
  claudeDesktop: { app: true, installedVersion: null },
  codex: { config: "~/.codex/config.toml", registered: null },
  ...over,
});
/** a row as on a Mac — the Windows block asks for its own */
const row = (f: PluginFacts, target: string) =>
  pluginRows(f, true).find((r) => r.target === target)!;
const ours = { command: "/usr/local/bin/node", args: [SERVER], commandFound: true };
const repo = {
  command: "node",
  args: ["/Users/a/code/dosik/scripts/mcp/server.mjs"],
  commandFound: true,
};

describe("plugin rows (#252, the canvas's Settings-Plugins and Settings-States)", () => {
  it("three rows in the board's order", () => {
    expect(pluginRows(facts()).map((r) => r.title)).toEqual([
      "Claude Code",
      "Claude Desktop",
      "ChatGPT and Codex",
    ]);
  });

  it("not registered → Not installed + Install; ours → Installed + Remove; another → Old path + Update", () => {
    expect(row(facts(), "claude-code")).toMatchObject({
      tone: "off",
      status: "Not installed",
      action: { label: "Install", kind: "primary", does: "install" },
    });
    expect(
      row(facts({ claudeCode: { cli: true, registered: ours } }), "claude-code"),
    ).toMatchObject({
      tone: "ok",
      status: "Installed",
      action: { label: "Remove", kind: "ghost", does: "remove" },
    });
    expect(
      row(facts({ codex: { config: "~/.codex/config.toml", registered: repo } }), "codex"),
    ).toMatchObject({
      tone: "warn",
      status: "Old path",
      action: { label: "Update", kind: "secondary", does: "install" },
    });
  });

  it("Claude Code missing → its install waits", () => {
    expect(
      row(facts({ claudeCode: { cli: false, registered: null } }), "claude-code"),
    ).toMatchObject({
      tone: "off",
      status: "Claude Code not found",
      description: "Install Claude Code first, then come back",
      disabled: true,
    });
  });

  it("no Node.js (or too old) → Needs Node.js + Get Node.js, for the two rows that run node — not Claude Desktop", () => {
    for (const node of [null, { path: "/n", version: "v16.20.0" }]) {
      const f = facts({ node });
      expect(row(f, "codex")).toMatchObject({
        tone: "bad",
        status: "Needs Node.js",
        action: { label: "Get Node.js", does: "get-node", external: true },
      });
      expect(row(f, "claude-code").status).toBe("Needs Node.js");
      expect(row(f, "claude-desktop").status).toBe("Not installed");
    }
  });

  it("Claude Desktop: not installed → Install…; behind → Update available; current → Installed + Open Claude", () => {
    expect(row(facts(), "claude-desktop")).toMatchObject({
      status: "Not installed",
      description: "A Dosik extension in Claude Desktop — it asks you to confirm",
      action: { label: "Install…", kind: "primary", does: "install" },
    });
    expect(
      row(facts({ claudeDesktop: { app: true, installedVersion: "0.1.0" } }), "claude-desktop"),
    ).toMatchObject({
      tone: "warn",
      status: "Update available",
      description: "Version 0.1.0 is installed; this Dosik has 0.2.0",
      action: { label: "Update…", does: "install" },
    });
    expect(
      row(facts({ claudeDesktop: { app: true, installedVersion: "0.2.0" } }), "claude-desktop"),
    ).toMatchObject({
      tone: "ok",
      status: "Installed",
      description: "Remove or turn it off in Claude ▸ Settings ▸ Extensions",
      action: { label: "Open Claude", kind: "ghost", does: "open", external: true },
    });
    expect(
      row(facts({ claudeDesktop: { app: false, installedVersion: null } }), "claude-desktop"),
    ).toMatchObject({
      status: "Claude Desktop not found",
      disabled: true,
    });
  });

  it("a build without a server cannot install into Claude Code or Codex — and says why", () => {
    const f = facts({ server: null });
    expect(row(f, "codex").disabled).toBe(true);
    expect(row(f, "claude-code").disabled).toBe(true);
    expect(row(f, "codex").description).toBe("This build of Dosik carries no MCP server.");
    const failed = facts({
      server: null,
      serverProblem: "Copying the MCP server failed: disk full",
    });
    expect(row(failed, "codex").description).toBe("Copying the MCP server failed: disk full");
  });

  it("registered with Dosik's server but a Node that is gone → Old path, so Update re-registers", () => {
    const gone = {
      ...ours,
      command: "/Users/a/.nvm/versions/node/v22.18.0/bin/node",
      commandFound: false,
    };
    expect(
      row(facts({ codex: { config: "~/.codex/config.toml", registered: gone } }), "codex"),
    ).toMatchObject({
      status: "Old path",
      action: { label: "Update" },
    });
  });

  it("olderVersion compares semver numerically", () => {
    expect(olderVersion("0.1.0", "0.2.0")).toBe(true);
    expect(olderVersion("0.10.0", "0.9.0")).toBe(false);
    expect(olderVersion("1.0.0", "1.0.0")).toBe(false);
  });
});

describe("plugin rows on Windows (the canvas's Win-Settings-States)", () => {
  it("no Node: this PC does not have it", () => {
    expect(row(facts({ node: null }), "codex").description).toBe(
      "The MCP server runs on Node.js, which this Mac does not have",
    );
    expect(
      pluginRows(facts({ node: null }), false).find((r) => r.target === "codex")?.description,
    ).toBe("The MCP server runs on Node.js, which this PC does not have");
  });

  it("the Codex config is named where it is — Rust's shown path, C:\\Users\\… on Windows", () => {
    const windows = facts({
      codex: { config: "C:\\Users\\someone\\.codex\\config.toml", registered: null },
    });
    expect(pluginRows(windows, false).find((r) => r.target === "codex")?.description).toBe(
      "The ChatGPT desktop app and Codex CLI share C:\\Users\\someone\\.codex\\config.toml",
    );
    expect(row(facts(), "codex").description).toBe(
      "The ChatGPT desktop app and Codex CLI share ~/.codex/config.toml",
    );
  });
});
