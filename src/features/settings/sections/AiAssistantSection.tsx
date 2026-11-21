import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FOCUS_RING } from "../../../shared/lib/palette";
import { PLAIN_TEXT } from "../../../shared/ui/plainText";
import {
  checkCli,
  checkKey,
  forgetKeyCheck,
  type KeyState,
  useAiStatusStore,
} from "../../ai/aiStatusStore";
import { useChatStore } from "../../ai/chatStore";
import {
  AUTH_LABEL,
  type AiAuth,
  type AiVendor,
  authAvailable,
  effectiveAuth,
} from "../../ai/settings";
import {
  Button,
  Caption,
  Group,
  Groups,
  Hairline,
  IconAction,
  Row,
  Segmented,
  Status,
  Steps,
} from "../parts";
import { platformCopy } from "../platformCopy";
import { useSettingsStore } from "../settingsStore";

const AUTHS = [AUTH_LABEL.subscription, AUTH_LABEL["api-key"]] as const;
const authOf = (label: string): AiAuth =>
  label === AUTH_LABEL["api-key"] ? "api-key" : "subscription";

interface VendorCopy {
  name: string;
  maker: string;
  cli: string;
  plan: string;
  install: string;
  login: string;
  keyLabel: string;
  placeholder: string;
}

const COPY: Record<AiVendor, VendorCopy> = {
  claude: {
    name: "Claude",
    maker: "Anthropic",
    cli: "Claude Code",
    plan: "Claude",
    install: platformCopy(true).claudeInstall,
    login: "claude",
    keyLabel: "Anthropic API key",
    placeholder: "sk-ant-…",
  },
  openai: {
    name: "GPT",
    maker: "OpenAI",
    cli: "Codex CLI",
    plan: "ChatGPT",
    install: "npm i -g @openai/codex",
    login: "codex login",
    keyLabel: "OpenAI API key",
    placeholder: "sk-…",
  },
};

/** the install step for the CLI on this machine — Claude Code's installer differs off macOS */
const installCommand = (vendor: AiVendor): string =>
  vendor === "claude" ? platformCopy().claudeInstall : COPY[vendor].install;

const connectionLine = (vendor: AiVendor, auth: AiAuth): string => {
  const line =
    auth === "subscription"
      ? `Subscription uses your ${COPY[vendor].plan} plan through ${vendor === "claude" ? "Claude Code" : "the Codex CLI"}.`
      : `API key is pay-per-use, billed by ${COPY[vendor].maker}.`;
  // GPT's subscription is the Codex CLI's, which Dosik does not run off macOS
  return authAvailable(vendor, "subscription")
    ? line
    : `Subscription is not available on Windows. ${line}`;
};

/**
 * The subscription CLI's row (the canvas's Settings-AI and Settings-States):
 * the first check, found and signed in, found but signed out, not found. A
 * check again keeps the last result on screen; only its button turns busy.
 * Signed in, the check is an icon button; otherwise a text button — when the
 * answer swaps one for the other, the keyboard goes to the new one.
 */
const CliRow = ({ vendor }: { vendor: AiVendor }) => {
  const status = useAiStatusStore((s) => s.cli[vendor]);
  const checking = useAiStatusStore((s) => s.cliChecking[vendor]);
  const copy = COPY[vendor];
  const { machine, shell } = platformCopy();
  const slot = useRef<HTMLSpanElement>(null);
  /** the check was pressed from the keyboard's place — give it back once the answer is in */
  const refocus = useRef(false);
  const again = () => {
    refocus.current = slot.current?.contains(document.activeElement) ?? false;
    void checkCli(vendor);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the answer changes the row
  useEffect(() => {
    if (checking || !refocus.current) return;
    refocus.current = false;
    // only a focus the swap dropped — one the user took elsewhere meanwhile stays there (#218 D15)
    const now = document.activeElement;
    if (now && now !== document.body && !slot.current?.contains(now)) return;
    slot.current?.querySelector("button")?.focus();
  }, [checking, status.state]);
  const checkAgain = (
    <span ref={slot} className="contents">
      <Button icon={RefreshCw} busy={checking} onClick={again}>
        {checking ? "Checking…" : "Check again"}
      </Button>
    </span>
  );
  switch (status.state) {
    case "ok":
      return (
        <Row title={copy.cli} description={`CLI ${status.version} on ${machine}`}>
          <Status tone="ok">Signed in</Status>
          <span ref={slot} className="contents">
            <IconAction icon={RefreshCw} label="Check again" busy={checking} onClick={again} />
          </span>
        </Row>
      );
    case "signed-out":
      return (
        <Row
          title={copy.cli}
          description={`CLI ${status.version} on ${machine}`}
          below={
            <Steps
              intro={`In ${shell}, sign in with your ${copy.plan} plan, then check again.`}
              commands={[copy.login]}
            />
          }
        >
          <Status tone="bad">Not signed in</Status>
          {checkAgain}
        </Row>
      );
    case "missing":
      return (
        <Row
          title={copy.cli}
          description={`Not found on ${machine}`}
          below={
            <Steps
              intro={`In ${shell}, install it and sign in with your ${copy.plan} plan, then check again.`}
              commands={[installCommand(vendor), copy.login]}
            />
          }
        >
          <Status tone="bad">Not installed</Status>
          {checkAgain}
        </Row>
      );
    default:
      return (
        <Row title={copy.cli} description={`Looking for ${copy.cli} on ${machine}`}>
          <Status tone="off">Checking…</Status>
        </Row>
      );
  }
};

const KEY_STATUS: Record<Exclude<KeyState["state"], "unknown">, string> = {
  ok: "Key works",
  rejected: "Key rejected",
  error: "Could not check",
};

/**
 * The API key rows: the stored key and its check, or the field to enter one
 * (the canvas's Settings-AI and Settings-States). A stored key is checked
 * each time its group shows — the first time with no result yet, after that
 * over the last one. Replace and Remove hand the keyboard to the field; Save
 * and Cancel hand it back to Replace. The field is not bound to state, so a
 * typed key never sits in the page's markup.
 */
const KeyRows = ({ vendor }: { vendor: AiVendor }) => {
  const settings = useChatStore((s) => s.settings);
  const setSettings = useChatStore((s) => s.setSettings);
  const result = useAiStatusStore((s) => s.key[vendor]);
  const checking = useAiStatusStore((s) => s.keyChecking[vendor]);
  const focus = useSettingsStore((s) => s.focus);
  const takeFocus = useSettingsStore((s) => s.takeFocus);
  const copy = COPY[vendor];
  const key = settings.keys[vendor];
  const [replacing, setReplacing] = useState(false);
  /** the field is empty — Save waits for a key */
  const [empty, setEmpty] = useState(true);
  /** where the keyboard goes once the rows have swapped */
  const [move, setMove] = useState<"field" | "replace" | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const replaceSlot = useRef<HTMLSpanElement>(null);
  const editing = key === "" || replacing;

  // asked to land here (Send without a key), or a press that swapped the rows
  useEffect(() => {
    if (editing && focus === `key-${vendor}`) {
      field.current?.focus();
      takeFocus();
    } else if (editing && move === "field") {
      field.current?.focus();
    } else if (!editing && move === "replace") {
      replaceSlot.current?.querySelector("button")?.focus();
    }
    if (move) setMove(null);
  }, [editing, focus, vendor, takeFocus, move]);

  // asked each time the group shows (and for a new key) — unless a check is already out
  useEffect(() => {
    if (key !== "" && !useAiStatusStore.getState().keyChecking[vendor]) void checkKey(vendor, key);
  }, [key, vendor]);

  const save = () => {
    const value = field.current?.value.trim() ?? "";
    if (!value) return;
    setSettings({ ...settings, keys: { ...settings.keys, [vendor]: value } });
    setReplacing(false);
    setEmpty(true);
    setMove("replace");
    // the old key's result is not this one's: a new key starts with no result
    forgetKeyCheck(vendor);
    void checkKey(vendor, value);
  };

  if (editing) {
    return (
      <Row title={copy.keyLabel} description={platformCopy().keyStore}>
        <input
          {...PLAIN_TEXT}
          ref={field}
          type="password"
          aria-label={copy.keyLabel}
          placeholder={copy.placeholder}
          onChange={(e) => setEmpty(e.target.value.trim() === "")}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // the focus moves to Replace as the rows swap; the key's own press must not follow it there
            e.preventDefault();
            save();
          }}
          className={`h-7 w-[200px] flex-none rounded-(--radius-button) border-0 bg-frame px-2.5 text-[12px] text-ink placeholder:text-muted ${FOCUS_RING}`}
        />
        <Button kind="primary" disabled={empty} onClick={save}>
          Save
        </Button>
        {replacing ? (
          <Button
            kind="ghost"
            onClick={() => {
              setReplacing(false);
              setEmpty(true);
              setMove("replace");
            }}
          >
            Cancel
          </Button>
        ) : null}
      </Row>
    );
  }

  return (
    <>
      <Row title={copy.keyLabel} description={platformCopy().keyStore}>
        <span className="text-[12px] font-medium tracking-[0.02em] text-icon tabular-nums">
          {`sk-…${key.slice(-4)}`}
        </span>
        <span ref={replaceSlot} className="contents">
          <Button
            onClick={() => {
              setReplacing(true);
              setMove("field");
            }}
          >
            Replace
          </Button>
        </span>
        <Button
          kind="danger"
          onClick={() => {
            setSettings({ ...settings, keys: { ...settings.keys, [vendor]: "" } });
            forgetKeyCheck(vendor);
            setEmpty(true);
            setMove("field");
          }}
        >
          Remove
        </Button>
      </Row>
      <Hairline />
      {result.state === "unknown" ? (
        // no result yet: the CLI's first-check pattern — nothing to press
        <Row title="Check" description={`Asking ${copy.maker} about this key`}>
          <Status tone="off">Checking…</Status>
        </Row>
      ) : (
        <Row
          title="Check"
          description={result.state === "error" ? result.message : "Last checked just now"}
        >
          <Status tone={result.state === "ok" ? "ok" : "bad"}>{KEY_STATUS[result.state]}</Status>
          <Button busy={checking} onClick={() => void checkKey(vendor, key)}>
            {checking ? "Checking…" : "Check again"}
          </Button>
        </Row>
      )}
    </>
  );
};

const VendorGroup = ({ vendor }: { vendor: AiVendor }) => {
  const settings = useChatStore((s) => s.settings);
  const setSettings = useChatStore((s) => s.setSettings);
  // where the stored connection cannot be used here, the API key stands in
  const auth = effectiveAuth(settings, vendor);
  const copy = COPY[vendor];
  // a subscription row shows what the CLI says — ask once it shows
  useEffect(() => {
    if (auth === "subscription" && useAiStatusStore.getState().cli[vendor].state === "unknown") {
      void checkCli(vendor);
    }
  }, [auth, vendor]);
  return (
    <Group title={copy.name} aside={copy.maker}>
      <Row title="Connection" description={connectionLine(vendor, auth)}>
        <Segmented
          label={`${copy.name} connection`}
          value={AUTH_LABEL[auth]}
          options={AUTHS}
          disabled={authAvailable(vendor, "subscription") ? [] : [AUTH_LABEL.subscription]}
          onChange={(label) =>
            setSettings({ ...settings, auths: { ...settings.auths, [vendor]: authOf(label) } })
          }
        />
      </Row>
      {auth === "subscription" ? <CliRow vendor={vendor} /> : <KeyRows vendor={vendor} />}
    </Group>
  );
};

/** Settings ▸ AI assistant (#252): how the chat reaches each vendor — models are the composer's */
export const AiAssistantSection = () => (
  <>
    <Caption>
      How the assistant reaches Claude and GPT. Pick the model in the chat composer.
    </Caption>
    <Groups>
      <VendorGroup vendor="claude" />
      <VendorGroup vendor="openai" />
    </Groups>
  </>
);
