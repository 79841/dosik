import { isMacPlatform } from "../../shared/lib/windowChrome";
import type { StatusTone } from "./parts";
import { platformCopy } from "./platformCopy";

/** what Rust reports for Settings ▸ Integrations (`plugins.rs`, PluginFacts) */
export interface Registration {
  command: string;
  args: string[];
  /** the command it starts is still there — a Node removed with nvm is not */
  commandFound: boolean;
}
export interface PluginFacts {
  /** Dosik's server copy in the app data — null when it is not there */
  server: string | null;
  /** why it is not there, or why the last copy failed */
  serverProblem: string | null;
  node: { path: string; version: string } | null;
  claudeCode: { cli: boolean; registered: Registration | null };
  claudeDesktop: { app: boolean; registered: Registration | null };
  /** `config`: where its config.toml is, as Settings names it — `~/…` on macOS, whole on Windows */
  codex: { config: string; registered: Registration | null };
}

export type PluginTarget = "claude-code" | "claude-desktop" | "codex";

export interface PluginAction {
  label: string;
  kind: "primary" | "secondary" | "ghost";
  does: "install" | "remove" | "get-node";
  external?: boolean;
}

export interface PluginRow {
  target: PluginTarget;
  title: string;
  description: string;
  tone: StatusTone;
  status: string;
  action: PluginAction;
  disabled?: boolean;
}

export const NODE_URL = "https://nodejs.org";
const MIN_NODE_MAJOR = 18;

const DESC_CODE = "Registered with claude mcp add, for every project";
/** the file Claude Desktop keeps its MCP servers in — shown as code */
export const DESKTOP_CONFIG = "claude_desktop_config.json";
const DESC_DESKTOP = `Registered in Claude Desktop's ${DESKTOP_CONFIG}`;
const descCodex = (config: string) => `The ChatGPT desktop app and Codex CLI share ${config}`;
const descNode = (mac: boolean) =>
  `The MCP server runs on Node.js, which ${platformCopy(mac).machine} does not have`;
const DESC_NO_SERVER = "This build of Dosik carries no MCP server.";

const INSTALL: PluginAction = { label: "Install", kind: "primary", does: "install" };

const nodeReady = (node: PluginFacts["node"]): boolean =>
  node !== null && (Number.parseInt(node.version.replace(/^v/, ""), 10) || 0) >= MIN_NODE_MAJOR;

/** a row for an app Dosik registers by node + server path — all three */
const nodeRow = (
  facts: PluginFacts,
  target: PluginTarget,
  title: string,
  description: string,
  registered: Registration | null,
  mac: boolean,
): PluginRow => {
  if (registered?.commandFound && facts.server !== null && registered.args.includes(facts.server)) {
    return {
      target,
      title,
      description,
      tone: "ok",
      status: "Installed",
      action: { label: "Remove", kind: "ghost", does: "remove" },
    };
  }
  if (facts.server === null) {
    return {
      target,
      title,
      description: facts.serverProblem ?? DESC_NO_SERVER,
      tone: "off",
      status: "Not installed",
      action: INSTALL,
      disabled: true,
    };
  }
  if (!nodeReady(facts.node)) {
    return {
      target,
      title,
      description: descNode(mac),
      tone: "bad",
      status: "Needs Node.js",
      action: { label: "Get Node.js", kind: "secondary", does: "get-node", external: true },
    };
  }
  // registered, but not with this Dosik's copy (a repository checkout, another
  // Dosik build, a url entry) or with a Node.js that is gone: Update rewrites it
  if (registered) {
    return {
      target,
      title,
      description,
      tone: "warn",
      status: "Needs update",
      action: { label: "Update", kind: "secondary", does: "install" },
    };
  }
  return { target, title, description, tone: "off", status: "Not installed", action: INSTALL };
};

/** Claude Desktop: registered in its own config like the other two, once Claude Desktop is there */
const desktopRow = (facts: PluginFacts, mac: boolean): PluginRow =>
  facts.claudeDesktop.app
    ? nodeRow(
        facts,
        "claude-desktop",
        "Claude Desktop",
        DESC_DESKTOP,
        facts.claudeDesktop.registered,
        mac,
      )
    : {
        target: "claude-desktop",
        title: "Claude Desktop",
        description: "Install Claude Desktop first, then come back",
        tone: "off",
        status: "Claude Desktop not found",
        action: INSTALL,
        disabled: true,
      };

/** Settings ▸ Integrations, row by row (#252) — the facts decide; the section only draws */
export const pluginRows = (facts: PluginFacts, mac: boolean = isMacPlatform()): PluginRow[] => {
  const code = facts.claudeCode.cli
    ? nodeRow(facts, "claude-code", "Claude Code", DESC_CODE, facts.claudeCode.registered, mac)
    : {
        target: "claude-code" as const,
        title: "Claude Code",
        description: "Install Claude Code first, then come back",
        tone: "off" as const,
        status: "Claude Code not found",
        action: INSTALL,
        disabled: true,
      };
  return [
    code,
    desktopRow(facts, mac),
    nodeRow(
      facts,
      "codex",
      "ChatGPT and Codex",
      descCodex(facts.codex.config),
      facts.codex.registered,
      mac,
    ),
  ];
};
