import { describe, expect, it } from "vitest";

import { type PluginFacts, pluginRows } from "../pluginStatus";

const SERVER = "/Users/a/Library/Application Support/app.dosik.desktop/mcp/server/server.mjs";
const facts = (over: Partial<PluginFacts> = {}): PluginFacts => ({
  server: SERVER,
  serverProblem: null,
  node: { path: "/usr/local/bin/node", version: "v22.18.0" },
  claudeCode: { cli: true, registered: null },
  claudeDesktop: { app: true, registered: null },
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

  it("not registered → Not installed + Install; ours → Installed + Remove; another → Needs update + Update", () => {
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
      status: "Needs update",
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

  it("no Node.js (or too old) → Needs Node.js + Get Node.js, for every row — all three run node", () => {
    for (const node of [null, { path: "/n", version: "v16.20.0" }]) {
      const f = facts({ node });
      for (const target of ["claude-code", "claude-desktop", "codex"]) {
        expect(row(f, target)).toMatchObject({
          tone: "bad",
          status: "Needs Node.js",
          description: "The MCP server runs on Node.js, which this Mac does not have",
          action: { label: "Get Node.js", does: "get-node", external: true },
        });
      }
    }
  });

  it("Claude Desktop: registered in its config like the others — one Install, no confirm step in Claude", () => {
    const desktop = (over: Partial<PluginFacts["claudeDesktop"]>) =>
      row(facts({ claudeDesktop: { app: true, registered: null, ...over } }), "claude-desktop");
    const description = "Registered in Claude Desktop's claude_desktop_config.json";
    expect(desktop({})).toMatchObject({
      tone: "off",
      status: "Not installed",
      description,
      action: { label: "Install", kind: "primary", does: "install" },
    });
    expect(desktop({ registered: ours })).toMatchObject({
      tone: "ok",
      status: "Installed",
      description,
      action: { label: "Remove", kind: "ghost", does: "remove" },
    });
    expect(desktop({ registered: repo })).toMatchObject({
      tone: "warn",
      status: "Needs update",
      action: { label: "Update", kind: "secondary", does: "install" },
    });
    expect(desktop({ app: false })).toMatchObject({
      tone: "off",
      status: "Claude Desktop not found",
      description: "Install Claude Desktop first, then come back",
      action: { label: "Install", kind: "primary", does: "install" },
      disabled: true,
    });
  });

  it("no row offers Open Claude, Update available or a … button any more", () => {
    const all = [
      facts(),
      facts({ claudeDesktop: { app: true, registered: ours } }),
      facts({ claudeDesktop: { app: false, registered: null } }),
    ].flatMap((f) => pluginRows(f, true));
    for (const r of all) {
      expect(r.action.label).not.toMatch(/…|Open Claude/);
      expect(r.status).not.toBe("Update available");
    }
  });

  it("a build without a server cannot install into any app — and says why", () => {
    const f = facts({ server: null });
    expect(row(f, "codex").disabled).toBe(true);
    expect(row(f, "claude-code").disabled).toBe(true);
    expect(row(f, "claude-desktop").disabled).toBe(true);
    expect(row(f, "codex").description).toBe("This build of Dosik carries no MCP server.");
    const failed = facts({
      server: null,
      serverProblem: "Copying the MCP server failed: disk full",
    });
    expect(row(failed, "codex").description).toBe("Copying the MCP server failed: disk full");
  });

  it("registered with Dosik's server but a Node that is gone → Needs update, so Update re-registers", () => {
    const gone = {
      ...ours,
      command: "/Users/a/.nvm/versions/node/v22.18.0/bin/node",
      commandFound: false,
    };
    expect(
      row(facts({ codex: { config: "~/.codex/config.toml", registered: gone } }), "codex"),
    ).toMatchObject({
      status: "Needs update",
      action: { label: "Update" },
    });
  });
});

describe("plugin rows on Windows (the canvas's Win-Settings-States)", () => {
  it("Claude Desktop without Node on Windows: this PC does not have it", () => {
    expect(
      pluginRows(facts({ node: null }), false).find((r) => r.target === "claude-desktop")
        ?.description,
    ).toBe("The MCP server runs on Node.js, which this PC does not have");
  });

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
