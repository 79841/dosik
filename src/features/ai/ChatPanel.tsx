import {
  ArrowUp,
  Check,
  Code,
  MessageSquarePlus,
  Pencil,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { type Ref, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ACCENT_BUTTON, TEXT_MUTED, TEXT_MUTED_HOVER } from "../../shared/lib/palette";
import { useDiagramStore } from "../../shared/lib/store";
import { ICON_STROKE, IconButton, SMALL_ICON_SIZE } from "../../shared/ui/IconButton";
import { PLAIN_TEXT } from "../../shared/ui/plainText";
import { MermaidPreview } from "../mermaid/MermaidPreview";
import { sendChatTurn } from "./chatActions";
import { panelToggleId, SIDE_PANEL_ID, useChatStore } from "./chatStore";
import { checkClaudeCli } from "./cliProvider";
import { checkCodexCli } from "./codexProvider";
import { ModelPicker } from "./ModelPicker";
import { chatRoom, clampChatWidth, MAX_CHAT_WIDTH, MIN_CHAT_WIDTH } from "./panelWidth";
import { selectionChipLabel, summarizeSelection } from "./selectionContext";
import { type AiAuth, type AiVendor, MODELS_BY_VENDOR } from "./settings";
import { useChatWidth } from "./useChatWidth";

const headerIcon = {
  size: SMALL_ICON_SIZE,
  strokeWidth: ICON_STROKE,
  "aria-hidden": true,
} as const;

/**
 * Makes the implicit explicit: what the canvas has selected is what the next
 * turn carries as context. Tracks the canvas live rather than pinning.
 */
const SelectionChip = () => {
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const clearSelection = useDiagramStore((s) => s.clearSelection);
  const summary = useMemo(() => summarizeSelection(nodes, edges), [nodes, edges]);

  if (!summary) return null;
  return (
    // the design's chip: 22 tall on the line tint, inside the composer (#219 D15)
    <div className="mb-1 flex min-w-0">
      <span className="flex h-[22px] min-w-0 items-center gap-1 rounded-(--radius-control) bg-line pl-[7px] pr-[3px] text-[10.5px] font-medium text-ink">
        <span className="truncate">Selection · {selectionChipLabel(summary)}</span>
        <button
          type="button"
          title="Clear selection"
          onClick={clearSelection}
          aria-label="Clear selection"
          className="flex h-4 w-4 flex-none items-center justify-center rounded-[3px] text-icon transition-colors hover:bg-hover"
        >
          <X size={11} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
};

const Segmented = <T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) => (
  <fieldset className="m-0 border-0 p-0">
    <legend
      className={`mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] ${TEXT_MUTED}`}
    >
      {label}
    </legend>
    <div className="flex gap-0.5 rounded-[7px] bg-frame p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`h-6 flex-1 rounded-(--radius-control) px-2 text-[12px] transition-colors ${
            value === o.id
              ? "bg-surface font-semibold text-ink shadow-segment"
              : `font-medium ${TEXT_MUTED} ${TEXT_MUTED_HOVER}`
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  </fieldset>
);

type CliStatus = { version: string } | { error: string } | undefined;

/** one line about the local CLI the subscription connection would use */
const CliStatusLine = ({ status }: { status: CliStatus }) => {
  if (status === undefined) return <span className={`${TEXT_MUTED}`}>Checking CLI…</span>;
  if ("version" in status)
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <Check size={12} strokeWidth={2.5} aria-hidden="true" />
        {status.version}
      </span>
    );
  return <span className="text-danger">{status.error}</span>;
};

const SettingsView = ({ onClose, ref }: { onClose: () => void; ref: Ref<HTMLDivElement> }) => {
  const settings = useChatStore((s) => s.settings);
  const setSettings = useChatStore((s) => s.setSettings);
  const [claudeStatus, setClaudeStatus] = useState<CliStatus>(undefined);
  const [codexStatus, setCodexStatus] = useState<CliStatus>(undefined);

  useEffect(() => {
    void checkClaudeCli().then((v) =>
      setClaudeStatus(
        v
          ? { version: v }
          : { error: "Claude Code CLI not found — install it and sign in with your subscription" },
      ),
    );
    void checkCodexCli().then(setCodexStatus);
  }, []);

  const vendor = settings.vendor;
  const cliStatus = vendor === "claude" ? claudeStatus : codexStatus;

  return (
    <div
      ref={ref}
      className="mx-auto flex w-full max-w-sm flex-col gap-4 overflow-y-auto px-3 pt-1 pb-3"
    >
      <Segmented<AiVendor>
        label="Provider"
        value={vendor}
        options={[
          { id: "claude", label: "Claude" },
          { id: "openai", label: "GPT" },
        ]}
        onChange={(v) => setSettings({ ...settings, vendor: v })}
      />
      <Segmented<AiAuth>
        label="Connection"
        value={settings.auth}
        options={[
          { id: "subscription", label: "Subscription" },
          { id: "api-key", label: "API key" },
        ]}
        onChange={(a) => setSettings({ ...settings, auth: a })}
      />

      {settings.auth === "subscription" ? (
        <div className="rounded-(--radius-card) bg-frame px-2.5 py-2">
          {cliStatus !== undefined && "error" in cliStatus ? null : (
            // the blurb describes the working case; an error line below says what is actually true
            <p className={`text-[11px] leading-snug ${TEXT_MUTED}`}>
              {vendor === "claude"
                ? "Uses your local Claude Code CLI signed in with a Claude Pro/Max subscription. No API key needed."
                : "Uses your local Codex CLI signed in with a ChatGPT subscription. No API key needed."}
            </p>
          )}
          <p className="mt-1 text-[10.5px] font-medium">
            <CliStatusLine status={cliStatus} />
          </p>
        </div>
      ) : (
        <>
          <div>
            <p
              className={`mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] ${TEXT_MUTED}`}
            >
              {vendor === "claude" ? "Anthropic API key" : "OpenAI API key"}
            </p>
            <input
              {...PLAIN_TEXT}
              type="password"
              aria-label={vendor === "claude" ? "Anthropic API key" : "OpenAI API key"}
              value={settings.keys[vendor]}
              onChange={(e) =>
                setSettings({ ...settings, keys: { ...settings.keys, [vendor]: e.target.value } })
              }
              placeholder={vendor === "claude" ? "sk-ant-..." : "sk-..."}
              className="h-7 w-full rounded-(--radius-button) bg-frame px-2 text-[12px] text-ink outline-none focus:ring-2 focus:ring-primary/40"
            />
            <p className={`mt-1 text-[10.5px] ${TEXT_MUTED}`}>
              Pay-per-use. The key is kept in this device's system keychain.
            </p>
          </div>
          <div>
            <p
              className={`mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] ${TEXT_MUTED}`}
            >
              Model
            </p>
            <select
              aria-label="Model"
              value={settings.models[vendor]}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  models: { ...settings.models, [vendor]: e.target.value },
                })
              }
              className="h-7 w-full rounded-(--radius-button) bg-frame px-1.5 text-[12px] text-ink outline-none"
            >
              {MODELS_BY_VENDOR[vendor].map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={onClose}
        className={`h-7 rounded-(--radius-button) px-3 text-[12px] font-semibold ${ACCENT_BUTTON}`}
      >
        Done
      </button>
    </div>
  );
};

/** grows the composer with its content, capped by the element's own max-height */
const autoGrow = (el: HTMLTextAreaElement): void => {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};

/**
 * The side panel, docked at the window's right edge (#219 D12): the body's
 * full height under the toolbar row, the canvas narrowed beside it — not
 * floating over it. One panel, two views, opened and switched by the
 * toolbar's Mermaid preview and Ask AI toggles (D13). Closed, it draws
 * nothing — but stays mounted, so what is typed and the settings view
 * survive a switch of view or a close.
 */
export const ChatPanel = () => {
  const open = useChatStore((s) => s.open);
  const toggleOpen = useChatStore((s) => s.toggleOpen);
  const view = useChatStore((s) => s.view);
  const busy = useChatStore((s) => s.busy);
  const messages = useChatStore((s) => s.messages);
  const clearMessages = useChatStore((s) => s.clearMessages);

  const width = useChatWidth();
  const setWidth = useChatStore((s) => s.setWidth);
  const commitWidth = useChatStore((s) => s.commitWidth);
  const titleId = useId();

  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [resizing, setResizing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  /** what had the keyboard when the settings view opened */
  const settingsOpenerRef = useRef<HTMLElement | null>(null);
  /** the next opening of the settings view lands on the API key field */
  const settingsKeyFirstRef = useRef(false);
  const settingsShownRef = useRef(showSettings);
  /** ends the drag in flight, so an unmount mid-gesture cannot strand the cursor */
  const dragRef = useRef<(() => void) | null>(null);

  useEffect(() => () => dragRef.current?.(), []);

  // toasts centre on the canvas, not the sheet: while the panel is up they
  // move left by its width (D16) — and back when it closes or the editor goes
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.style.setProperty("--dsk-toast-right", `${width}px`);
    return () => {
      root.style.removeProperty("--dsk-toast-right");
    };
  }, [open, width]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: messages/busy are intentional triggers — scroll to bottom whenever the list content changes
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // the composer's height follows its text, and the text rewraps when the panel
  // is resized — `onChange` alone leaves it stale after either
  // biome-ignore lint/correctness/useExhaustiveDependencies: input, width, showSettings, open and view are the triggers — the text, the wrap and a remount of the composer all change the needed height
  useLayoutEffect(() => {
    if (inputRef.current) autoGrow(inputRef.current);
  }, [input, width, showSettings, open, view]);

  // The settings view takes the composer's place, and the control that had
  // the keyboard can go with it — the model picker's button, the message box,
  // Done. The focus would fall to <body>, outside `.nodelete`, where the next
  // Backspace deletes the canvas selection (#219). So the switch
  // hands the focus on: into the settings view, and back out to what opened
  // it if that is still here (the header toggle), else to the message box.
  useLayoutEffect(() => {
    if (settingsShownRef.current === showSettings) return;
    settingsShownRef.current = showSettings;
    if (showSettings) {
      const field = settingsKeyFirstRef.current
        ? 'input[type="password"]'
        : "button, input, select";
      settingsKeyFirstRef.current = false;
      settingsRef.current?.querySelector<HTMLElement>(field)?.focus();
      return;
    }
    const opener = settingsOpenerRef.current;
    settingsOpenerRef.current = null;
    const back = opener?.isConnected && asideRef.current?.contains(opener) ? opener : null;
    (back ?? inputRef.current)?.focus();
  }, [showSettings]);

  /**
   * Every way into or out of the settings view goes through here, for the
   * focus. `toKey`: a send stopped for want of a key lands on the key field.
   */
  const showSettingsView = (show: boolean, toKey = false) => {
    if (show) settingsOpenerRef.current = document.activeElement as HTMLElement | null;
    settingsKeyFirstRef.current = show && toKey;
    setShowSettings(show);
  };

  const resizeBy = (delta: number) => {
    // from the store, not the render closure: key auto-repeat fires faster than
    // React re-renders, and a stale base would swallow the steps. Capped by what
    // is on screen, so the first press after the window shrank still moves.
    setWidth(Math.min(useChatStore.getState().width, width) + delta);
    commitWidth();
  };

  /** the panel grows to the left, so a leftward drag is a wider panel */
  const startResize = (event: React.PointerEvent) => {
    // same guard as the canvas drag helper: primary button, one pointer
    if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const pointerId = event.pointerId;
    setResizing(true);
    // the pointer leaves the 10px strip immediately — keep the cursor honest
    document.body.style.cursor = "col-resize";
    let frame = 0;
    let pending = startWidth;
    const flush = () => {
      frame = 0;
      setWidth(pending);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pending = startWidth + (startX - e.clientX);
      // one update per frame: the panel, the canvas beside it and the edit bar all follow it
      if (frame === 0) frame = requestAnimationFrame(flush);
    };
    const stop = (e?: PointerEvent) => {
      if (e && e.pointerId !== pointerId) return;
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        flush();
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = "";
      dragRef.current = null;
      setResizing(false);
      commitWidth();
    };
    dragRef.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const send = async () => {
    const text = input;
    setInput("");
    const result = await sendChatTurn(text);
    if (result === "needs-api-key") {
      setInput(text);
      showSettingsView(true, true);
    }
  };

  /** Close panel: closed, and the keyboard back on the toggle that opens this view */
  const close = () => {
    const shown = view;
    toggleOpen();
    document.getElementById(panelToggleId(shown))?.focus();
  };

  if (!open) return null;

  const chat = view === "chat";
  return (
    <aside
      ref={asideRef}
      id={SIDE_PANEL_ID}
      aria-labelledby={titleId}
      style={{ width }}
      // docked: no radius, no shadow, no border — flush with the window's
      // right edge (D12). nodelete, not nokey: Backspace on the resize handle
      // or a header button must not delete the canvas selection, but undo and
      // the clipboard should still reach the canvas from here. z-[35]: the
      // resize grip hangs over the canvas, above its islands (D17)
      className="nodelete relative z-[35] flex h-full min-h-0 flex-none flex-col bg-surface"
    >
      <div className="flex h-10 flex-none items-center gap-0.5 pl-3 pr-1.5">
        {chat ? (
          <Sparkles size={14} strokeWidth={1.9} aria-hidden="true" className="flex-none text-ink" />
        ) : (
          <Code size={14} strokeWidth={1.9} aria-hidden="true" className="flex-none text-ink" />
        )}
        <h2 id={titleId} className="m-0 ml-1 truncate text-[12px] font-semibold text-ink">
          {chat ? "Assistant" : "Mermaid preview"}
        </h2>
        <div className="ml-auto flex flex-none items-center gap-0.5">
          {chat ? (
            <>
              <IconButton label="New chat" size={28} onClick={clearMessages}>
                <MessageSquarePlus {...headerIcon} />
              </IconButton>
              <IconButton
                label="AI settings"
                size={28}
                pressed={showSettings}
                onClick={() => showSettingsView(!showSettings)}
              >
                <SlidersHorizontal {...headerIcon} />
              </IconButton>
            </>
          ) : null}
          <IconButton label="Close panel" size={28} align="end" onClick={close}>
            <X {...headerIcon} />
          </IconButton>
        </div>
      </div>

      {/* the chat's state (what is typed, the settings view) lives here, above
          the switch, so a look at the preview does not lose it */}
      {!chat ? (
        <MermaidPreview />
      ) : showSettings ? (
        <SettingsView ref={settingsRef} onClose={() => showSettingsView(false)} />
      ) : (
        <>
          <div
            ref={listRef}
            aria-live="polite"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pt-1 pb-3 text-[12px] leading-[1.6] text-ink"
          >
            {messages.length === 0 ? (
              <div
                className={`flex h-full items-center justify-center px-2 text-center text-[12px] leading-relaxed text-balance ${TEXT_MUTED}`}
              >
                <p className="max-w-[34ch]">
                  e.g. “Draw a login flow with error handling”.
                  <br />
                  The AI reads your selection and edits the canvas directly.
                </p>
              </div>
            ) : null}
            {messages.map((m) => {
              if (m.role === "activity") {
                return (
                  <p
                    key={m.id}
                    className="m-0 flex items-center gap-1.5 text-[11px] font-medium text-muted"
                  >
                    <Pencil size={12} strokeWidth={2} aria-hidden="true" className="flex-none" />
                    {m.text}
                  </p>
                );
              }
              if (m.role === "error") {
                return (
                  <p
                    key={m.id}
                    className="m-0 mr-auto max-w-[85%] rounded-(--radius-card) bg-danger/10 px-2.5 py-2 text-danger"
                  >
                    {m.text}
                  </p>
                );
              }
              return (
                <div
                  key={m.id}
                  className={`whitespace-pre-wrap ${
                    m.role === "user"
                      ? // the design's bubble: its own corner tucked in toward the panel edge
                        "ml-auto max-w-[75%] rounded-[10px_10px_3px_10px] bg-hover px-2.5 py-2"
                      : "mr-auto max-w-full"
                  }`}
                >
                  {m.text}
                </div>
              );
            })}
            {busy ? (
              <div className="mr-auto flex items-center gap-1.5 py-1">
                <span className="sr-only">Assistant is thinking…</span>
                {[0, 120, 240].map((delay) => (
                  <span
                    key={delay}
                    style={{ animationDelay: `${delay}ms` }}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted motion-reduce:animate-none"
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex-none px-2 pb-2">
            {/* a filled field on the panel is `frame` (#216 Q2) */}
            <div className="rounded-(--radius-island) bg-frame pt-2 pr-2 pb-1.5 pl-2.5 focus-within:ring-2 focus-within:ring-primary/40">
              <SelectionChip />
              <textarea
                {...PLAIN_TEXT}
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoGrow(e.currentTarget);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                aria-label="Message"
                placeholder="Ask the AI to draw or edit…"
                className="block max-h-32 w-full resize-none overflow-y-auto bg-transparent text-[12px] leading-normal text-ink outline-none placeholder:text-muted"
              />
              <div className="mt-1 flex items-center gap-2">
                <ModelPicker onSettings={() => showSettingsView(true)} />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={busy || !input.trim()}
                  title="Send (Enter)"
                  aria-label="Send"
                  className={`ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] ${ACCENT_BUTTON} disabled:bg-primary/35 disabled:text-primary-fg/70 disabled:hover:bg-primary/35`}
                >
                  <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {/* an <hr>, not a div: that is the semantic separator biome asks for and
          it carries the role implicitly. Last in the DOM so Tab reaches the
          panel's own controls first; it is positioned, so order is free. The
          panel grows leftward, so dragging this edge left widens it (#129).
          10px band, as #70 decided for every resize target in this app. */}
      <hr
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        aria-valuenow={width}
        aria-valuemin={MIN_CHAT_WIDTH}
        aria-valuemax={clampChatWidth(MAX_CHAT_WIDTH, chatRoom())}
        aria-valuetext={`${width} pixels`}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") resizeBy(16);
          else if (e.key === "ArrowRight") resizeBy(-16);
          // the separator convention: Home is the minimum, End the maximum
          else if (e.key === "Home") resizeBy(-MAX_CHAT_WIDTH);
          else if (e.key === "End") resizeBy(MAX_CHAT_WIDTH);
          else return;
          e.preventDefault();
        }}
        // h-auto: Tailwind's preflight gives every <hr> `height: 0`, which left
        // this band 0px tall — nothing to grab (#166). With top/bottom set it
        // runs the panel's edge, 16px short at each end, inside the panel and
        // unseen. Hovering it (or dragging, or keyboard focus) shows the grip:
        // one short bar just left of the panel, over the canvas. The bar is
        // ::before, so it is part of the handle — move onto it and keep
        // dragging. It is `invisible` the rest of the time, which also takes it
        // out of hit testing: nothing hangs over the canvas to steal clicks.
        // The 12px box keeps it easy to grab; only its middle 4px is painted.
        // overflow-visible: browsers clip an <hr>'s own content, the bar included.
        className={`absolute inset-y-4 left-0 z-10 m-0 h-auto w-2.5 cursor-col-resize overflow-visible border-0 outline-none before:absolute before:right-full before:top-1/2 before:box-border before:h-10 before:w-3 before:-translate-y-1/2 before:rounded-full before:bg-clip-content before:px-1 before:content-[''] ${
          // showing the bar is the feedback; it darkens only while dragging
          resizing
            ? "before:visible before:bg-primary"
            : "before:invisible before:bg-edge hover:before:visible focus-visible:before:visible"
        }`}
      />
    </aside>
  );
};
