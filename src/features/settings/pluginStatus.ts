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
  appVersion: string;
  claudeCode: { cli: boolean; registered: Registration | null };
  claudeDesktop: { app: boolean; installedVersion: string | null };
  /** `config`: where its config.toml is, as Settings names it — `~/…` on macOS, whole on Windows */
  codex: { config: string; registered: Registration | null };
}

export type PluginTarget = "claude-code" | "claude-desktop" | "codex";

export interface PluginAction {
  label: string;
  kind: "primary" | "secondary" | "ghost";
  does: "install" | "remove" | "open" | "get-node";
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
const DESC_DESKTOP = "A Dosik extension in Claude Desktop";
const descCodex = (config: string) => `The ChatGPT desktop app and Codex CLI share ${config}`;
const descNode = (mac: boolean) =>
  `The MCP server runs on Node.js, which ${platformCopy(mac).machine} does not have`;
const DESC_NO_SERVER = "This build of Dosik carries no MCP server.";

const INSTALL: PluginAction = { label: "Install", kind: "primary", does: "install" };

/** `a` is an older semver than `b` */
export const olderVersion = (a: string, b: string): boolean => {
  const parts = (v: string) =>
    v
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  }
  return false;
};

const nodeReady = (node: PluginFacts["node"]): boolean =>
  node !== null && (Number.parseInt(node.version.replace(/^v/, ""), 10) || 0) >= MIN_NODE_MAJOR;

/** a row for an app Dosik registers by node + server path (Claude Code, ChatGPT and Codex) */
const nodeRow = (
  facts: PluginFacts,
  target: "claude-code" | "codex",
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
  if (registered) {
    return {
      target,
      title,
      description,
      tone: "warn",
      status: "Old path",
      action: { label: "Update", kind: "secondary", does: "install" },
    };
  }
  return { target, title, description, tone: "off", status: "Not installed", action: INSTALL };
};

const desktopRow = ({ claudeDesktop, appVersion }: PluginFacts): PluginRow => {
  const base = { target: "claude-desktop" as const, title: "Claude Desktop" };
  if (!claudeDesktop.app) {
    return {
      ...base,
      description: "Install Claude Desktop first, then come back",
      tone: "off",
      status: "Claude Desktop not found",
      action: { label: "Install…", kind: "primary", does: "install" },
      disabled: true,
    };
  }
  const installed = claudeDesktop.installedVersion;
  if (installed === null) {
    return {
      ...base,
      description: `${DESC_DESKTOP} — it asks you to confirm`,
      tone: "off",
      status: "Not installed",
      action: { label: "Install…", kind: "primary", does: "install" },
    };
  }
  if (olderVersion(installed, appVersion)) {
    return {
      ...base,
      description: `Version ${installed} is installed; this Dosik has ${appVersion}`,
      tone: "warn",
      status: "Update available",
      action: { label: "Update…", kind: "secondary", does: "install" },
    };
  }
  return {
    ...base,
    description: "Remove or turn it off in Claude ▸ Settings ▸ Extensions",
    tone: "ok",
    status: "Installed",
    action: { label: "Open Claude", kind: "ghost", does: "open", external: true },
  };
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
    desktopRow(facts),
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
