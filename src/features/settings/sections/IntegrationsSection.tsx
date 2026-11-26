import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Fragment, useEffect } from "react";
import { create } from "zustand";

import { toastError } from "../../../shared/lib/toastStore";
import { Button, Caption, Group, Groups, Mono, Row, Status } from "../parts";
import {
  DESKTOP_CONFIG,
  NODE_URL,
  type PluginFacts,
  type PluginRow,
  type PluginTarget,
  pluginRows,
} from "../pluginStatus";
import { useSettingsStore } from "../settingsStore";

/** the paths and commands in a row's description, set as code like the board */
const withCode = (text: string, code: readonly string[]) =>
  text
    .split(new RegExp(`(${code.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`))
    .map((part, i) =>
      // the split alternates text and code; position is the identity
      // biome-ignore lint/suspicious/noArrayIndexKey: a fixed sentence's pieces
      code.includes(part) ? <Mono key={i}>{part}</Mono> : <Fragment key={i}>{part}</Fragment>,
    );

/** the agent bridge the AI apps reach Dosik through (`bridge_status`) — its port is fixed */
interface BridgeStatus {
  port: number;
  listening: boolean;
}

interface IntegrationsState {
  /** what Rust last reported — kept here, so the view showing now gets an answer a view that went asked for */
  facts: PluginFacts | null;
  /** whether the bridge has its port; null until read, or when it cannot be read */
  bridge: BridgeStatus | null;
  /** installs or removes under way — kept here too, so leaving and coming back cannot start a second */
  busy: PluginTarget[];
}

export const useIntegrationsStore = create<IntegrationsState>(() => ({
  facts: null,
  bridge: null,
  busy: [],
}));

const setBusy = (target: PluginTarget, on: boolean) =>
  useIntegrationsStore.setState((s) => ({
    busy: on ? [...s.busy, target] : s.busy.filter((t) => t !== target),
  }));

/** an error that lands after Settings closed says nothing (#218 D15) */
const sayError = (error: unknown) => {
  if (useSettingsStore.getState().open) toastError(error);
};

/** reads numbered as they start; an answer older than the one on screen is dropped */
let readRound = 0;
let shownRound = 0;

/** reads the facts again; `quiet` keeps a failure to itself (the read on coming back to the window) */
const readFacts = async (quiet = false): Promise<void> => {
  const round = ++readRound;
  try {
    const [facts, bridge] = await Promise.all([
      invoke<PluginFacts>("plugins_status"),
      // the warning is a hint, not a fact the rows need: a bridge that cannot be read shows none
      invoke<BridgeStatus>("bridge_status").catch(() => null),
    ]);
    // a newer read still out does not drop this one — only a newer answer already shown does
    if (round > shownRound) {
      shownRound = round;
      useIntegrationsStore.setState({ facts, bridge });
    }
  } catch (error) {
    if (!quiet) sayError(error);
  }
};

/**
 * Settings ▸ Integrations (#252): Dosik's MCP server in each AI app. Rust
 * reports the facts (`plugins_status`), `pluginRows` turns them into rows; an
 * action runs, then the facts are read again — the row stays busy until they
 * are in. Coming back to the window — from installing Claude Desktop, say —
 * reads them again too. The AI apps reach Dosik through the bridge on
 * its fixed port; when another app holds it, a row above the others says so.
 */
export const IntegrationsSection = () => {
  const facts = useIntegrationsStore((s) => s.facts);
  const bridge = useIntegrationsStore((s) => s.bridge);
  const busy = useIntegrationsStore((s) => s.busy);

  useEffect(() => {
    void readFacts();
    const onFocus = () => void readFacts(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const act = async (row: PluginRow) => {
    const { does } = row.action;
    if (does === "get-node") return void openUrl(NODE_URL).catch(toastError);
    if (useIntegrationsStore.getState().busy.includes(row.target)) return;
    setBusy(row.target, true);
    try {
      await invoke(does === "install" ? "plugin_install" : "plugin_remove", { target: row.target });
    } catch (error) {
      sayError(error);
    } finally {
      // the old row never comes back for a second press while the facts are read
      await readFacts();
      setBusy(row.target, false);
    }
  };

  return (
    <>
      <Caption>Let AI apps read and edit your diagrams through Dosik's MCP server.</Caption>
      <Groups>
        {bridge && !bridge.listening ? (
          // named by its row's title, which is read once — the group's own name stays short
          <Group label="Warning">
            <Row
              title="AI apps can't reach Dosik"
              description={`Another app holds 127.0.0.1:${bridge.port}. Quit it, then reopen Dosik.`}
            >
              <Status tone="bad">Port in use</Status>
            </Row>
          </Group>
        ) : null}
        {/* drawn once the facts are in — never an empty group */}
        {facts ? (
          <Group label="AI apps">
            {pluginRows(facts).map((row) => {
              // each row works on its own app: one under way leaves the others usable (Settings-States)
              const working = busy.includes(row.target);
              return (
                <Row
                  key={row.target}
                  title={row.title}
                  description={withCode(row.description, [
                    "claude mcp add",
                    DESKTOP_CONFIG,
                    facts.codex.config,
                  ])}
                >
                  {/* hidden while it works, but kept: its words changing is what gets read out */}
                  <Status tone={row.tone} hidden={working}>
                    {row.status}
                  </Status>
                  <Button
                    kind={row.action.kind}
                    external={row.action.external}
                    disabled={row.disabled}
                    busy={working}
                    onClick={() => void act(row)}
                  >
                    {working
                      ? row.action.does === "remove"
                        ? "Removing…"
                        : "Installing…"
                      : row.action.label}
                  </Button>
                </Row>
              );
            })}
          </Group>
        ) : null}
      </Groups>
      <p className="m-0 mt-3 text-[11px] leading-[15px] text-muted">
        Dosik keeps the MCP server in its app data and refreshes it when Dosik updates, so moving or
        updating Dosik keeps Claude Code, Claude Desktop, ChatGPT and Codex working. Quit and reopen
        the AI app after a change.
      </p>
    </>
  );
};
