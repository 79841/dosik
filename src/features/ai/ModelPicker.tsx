import { Check, ChevronDown, Plug } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState } from "react";

import { FOCUS_ITEM } from "../../shared/lib/palette";
import { useMenuKeys } from "../../shared/lib/useMenuKeys";
import { useOutsideDismiss } from "../../shared/lib/useOutsideDismiss";
import { openSettings } from "../settings/settingsStore";
import { checkCli, isConnected, useAiStatusStore } from "./aiStatusStore";
import { useChatStore } from "./chatStore";
import {
  type AiVendor,
  AUTH_LABEL,
  effectiveAuth,
  MODELS_BY_VENDOR,
  modelShortLabel,
  VENDOR_LABEL,
} from "./settings";

const VENDORS: AiVendor[] = ["claude", "openai"];

const ITEM = `flex h-7 w-full flex-none items-center gap-2 whitespace-nowrap rounded-(--radius-button) px-2 text-left text-[12px] font-medium text-ink transition-colors hover:bg-hover ${FOCUS_ITEM}`;

/** a radio item's tick, held open when it is not the one */
const Tick = ({ on }: { on: boolean }) => (
  <Check
    size={13}
    strokeWidth={2}
    aria-hidden="true"
    className={`flex-none ${on ? "text-ink" : "invisible"}`}
  />
);

const GroupLabel = ({ id, children }: { id: string; children: string }) => (
  <div
    id={id}
    className="flex h-6 flex-none items-end px-2 pb-1 text-[10.5px] leading-[14px] font-semibold tracking-[0.06em] text-muted uppercase"
  >
    {children}
  </div>
);

/**
 * The composer's model menu (#252, the canvas's Composer-ModelPicker board):
 * the button reads the chosen model; the menu groups the models by vendor,
 * each group named by the connection Settings ▸ AI assistant holds for it. A
 * vendor that cannot be reached shows "Connect …" instead of its models.
 * Picking a model picks its vendor too. Opens upward, over the messages.
 */
export const ModelPicker = () => {
  const settings = useChatStore((s) => s.settings);
  const setSettings = useChatStore((s) => s.setSettings);
  const cli = useAiStatusStore((s) => s.cli);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const groupId = useId();
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
  // a CLI answer that swaps a group (its models ↔ Connect …) while the menu is
  // open removes the focused item — the keyboard stays in the menu, not on the page
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a CLI answer arrives
  useEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu || menu.contains(document.activeElement)) return;
    menu.querySelector<HTMLElement>("[role^=menuitem]")?.focus();
  }, [open, cli]);
  const pick = (change: () => void) => {
    close();
    change();
  };
  /** Settings at AI assistant; closing it brings the focus back to this button */
  const toAccounts = () => {
    setOpen(false);
    openSettings("AI assistant", { returnTo: buttonRef.current });
  };
  const toggle = () => {
    // a subscription's group shows its models until its CLI is known to be missing
    if (!open) {
      for (const v of VENDORS) {
        if (effectiveAuth(settings, v) === "subscription" && cli[v].state === "unknown") {
          void checkCli(v);
        }
      }
    }
    setOpen((v) => !v);
  };
  const { vendor } = settings;

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="flex h-6 min-w-0 items-center gap-1 rounded-(--radius-control) px-1.5 text-[10.5px] font-normal text-muted transition-colors hover:bg-hover hover:text-ink aria-expanded:bg-selected aria-expanded:text-ink"
      >
        <span className="truncate">{modelShortLabel(vendor, settings.models[vendor])}</span>
        <ChevronDown size={11} strokeWidth={2} aria-hidden="true" className="flex-none" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Model"
          onKeyDown={onMenuKeyDown}
          className="absolute bottom-full left-0 z-50 mb-1.5 flex w-[236px] flex-col rounded-(--radius-island) bg-surface p-1 shadow-popover"
        >
          {VENDORS.map((v) => {
            const connected = isConnected(settings, cli, v);
            return (
              <Fragment key={v}>
                {/* a group named by its label, so "GPT · Not connected" is read, not only seen */}
                {/* biome-ignore lint/a11y/useSemanticElements: a menu's group is role="group" — a fieldset is a form control's */}
                <div role="group" aria-labelledby={`${groupId}-${v}`} className="flex flex-col">
                  <GroupLabel id={`${groupId}-${v}`}>
                    {`${VENDOR_LABEL[v]} · ${connected ? AUTH_LABEL[effectiveAuth(settings, v)] : "Not connected"}`}
                  </GroupLabel>
                  {connected ? (
                    MODELS_BY_VENDOR[v].map((m) => {
                      const on = vendor === v && settings.models[v] === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={on}
                          tabIndex={-1}
                          onClick={() =>
                            pick(() =>
                              setSettings({
                                ...settings,
                                vendor: v,
                                models: { ...settings.models, [v]: m.id },
                              }),
                            )
                          }
                          className={ITEM}
                        >
                          <Tick on={on} />
                          {m.label}
                        </button>
                      );
                    })
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      onClick={toAccounts}
                      className={ITEM}
                    >
                      <Plug
                        size={13}
                        strokeWidth={2}
                        aria-hidden="true"
                        className="flex-none text-icon"
                      />
                      {`Connect ${VENDOR_LABEL[v]}…`}
                    </button>
                  )}
                </div>
                <hr className="my-1 h-px flex-none border-0 bg-line" />
              </Fragment>
            );
          })}
          <button type="button" role="menuitem" tabIndex={-1} onClick={toAccounts} className={ITEM}>
            <Tick on={false} />
            AI assistant settings…
          </button>
        </div>
      ) : null}
    </div>
  );
};
