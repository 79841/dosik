import { Check, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";

import { FOCUS_ITEM } from "../../shared/lib/palette";
import { useMenuKeys } from "../../shared/lib/useMenuKeys";
import { useOutsideDismiss } from "../../shared/lib/useOutsideDismiss";
import { useChatStore } from "./chatStore";
import { type AiAuth, type AiVendor, AUTH_LABEL, MODELS_BY_VENDOR, VENDOR_LABEL } from "./settings";

const CONNECTIONS: { vendor: AiVendor; auth: AiAuth }[] = [
  { vendor: "claude", auth: "subscription" },
  { vendor: "claude", auth: "api-key" },
  { vendor: "openai", auth: "subscription" },
  { vendor: "openai", auth: "api-key" },
];

const connectionLabel = (vendor: AiVendor, auth: AiAuth): string =>
  `${VENDOR_LABEL[vendor]} · ${AUTH_LABEL[auth]}`;

const ITEM = `flex h-7 w-full items-center gap-2 whitespace-nowrap rounded-(--radius-button) px-2 text-left text-[12px] font-medium text-ink transition-colors hover:bg-hover ${FOCUS_ITEM}`;

/** a radio item's tick, held open when it is not the one */
const Tick = ({ on }: { on: boolean }) => (
  <Check
    size={13}
    strokeWidth={2}
    aria-hidden="true"
    className={`flex-none ${on ? "text-ink" : "invisible"}`}
  />
);

/**
 * The composer's model picker (#219 D15) — what the header's provider badge
 * used to read out, now where it can be changed: the four connections, the
 * models of the vendor when it is reached by API key, and the way to the
 * settings screen. A change goes through `setSettings`, which drops a CLI
 * session that no longer fits. Opens upward, over the messages.
 */
export const ModelPicker = ({ onSettings }: { onSettings: () => void }) => {
  const settings = useChatStore((s) => s.settings);
  const setSettings = useChatStore((s) => s.setSettings);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(ref, open, () => setOpen(false));

  // closed from inside — Escape or a choice — the focus goes back to the button (#219)
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const onMenuKeyDown = useMenuKeys(menuRef, open, {
    onEscape: close,
    onTab: () => setOpen(false),
  });
  const pick = (change: () => void) => {
    close();
    change();
  };
  const { vendor, auth } = settings;

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 min-w-0 items-center gap-1 rounded-(--radius-control) px-1.5 text-[10.5px] font-medium text-muted transition-colors hover:bg-hover hover:text-ink aria-expanded:bg-selected"
      >
        <span className="truncate">{connectionLabel(vendor, auth)}</span>
        <ChevronDown size={11} strokeWidth={2} aria-hidden="true" className="flex-none" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Model"
          onKeyDown={onMenuKeyDown}
          className="absolute bottom-full left-0 z-50 mb-1 flex w-56 flex-col rounded-(--radius-island) bg-surface p-1 shadow-popover"
        >
          {CONNECTIONS.map((c) => {
            const on = c.vendor === vendor && c.auth === auth;
            return (
              <button
                key={`${c.vendor}-${c.auth}`}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => pick(() => setSettings({ ...settings, ...c }))}
                className={ITEM}
              >
                <Tick on={on} />
                {connectionLabel(c.vendor, c.auth)}
              </button>
            );
          })}
          {auth === "api-key" ? (
            <>
              <hr className="my-1 h-px border-0 bg-line" />
              {MODELS_BY_VENDOR[vendor].map((m) => {
                const on = settings.models[vendor] === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    onClick={() =>
                      pick(() =>
                        setSettings({
                          ...settings,
                          models: { ...settings.models, [vendor]: m.id },
                        }),
                      )
                    }
                    className={ITEM}
                  >
                    <Tick on={on} />
                    {m.label}
                  </button>
                );
              })}
            </>
          ) : null}
          <hr className="my-1 h-px border-0 bg-line" />
          <button type="button" role="menuitem" onClick={() => pick(onSettings)} className={ITEM}>
            <span aria-hidden="true" className="w-[13px] flex-none" />
            AI settings…
          </button>
        </div>
      ) : null}
    </div>
  );
};
