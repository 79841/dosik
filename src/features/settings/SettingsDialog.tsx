import { Info, type LucideIcon, Plug, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useId, useLayoutEffect, useRef } from "react";

import { FOCUS_RING } from "../../shared/lib/palette";
import { DialogCaption } from "../../shared/ui/DialogCaption";
import { Toaster } from "../../shared/ui/Toaster";
import { IconAction } from "./parts";
import { AboutSection } from "./sections/AboutSection";
import { AiAssistantSection } from "./sections/AiAssistantSection";
import { GeneralSection } from "./sections/GeneralSection";
import { IntegrationsSection } from "./sections/IntegrationsSection";
import { SETTINGS_SECTIONS, type SettingsSection, useSettingsStore } from "./settingsStore";

const ICON: Record<SettingsSection, LucideIcon> = {
  General: SlidersHorizontal,
  "AI assistant": Sparkles,
  Integrations: Plug,
  About: Info,
};

const BODY: Record<SettingsSection, React.ComponentType> = {
  General: GeneralSection,
  "AI assistant": AiAssistantSection,
  Integrations: IntegrationsSection,
  About: AboutSection,
};

/**
 * Settings (#252, the canvas's Settings-* boards): a dialog over the window,
 * 880×600, the section list on the left and one section on the right.
 *
 * A native `<dialog>` opened with `showModal()` like From Mermaid… (#220):
 * the top layer, over the chrome band too, everything behind it inert, the
 * app's keys resting while it has them. Its closing is never left to the
 * browser: Escape is taken at keydown, a `cancel` is refused and handled
 * here, a click on the scrim (the dialog itself, outside its box) closes it.
 * It opens with the focus on the dialog itself, so nothing inside lights up
 * with a focus ring; Tab goes on to the section list. Focus goes back to
 * what opened it. The sheet's toasts would sit under the
 * top layer, so while it is open they show in here instead.
 */
const SettingsShell = () => {
  const section = useSettingsStore((s) => s.section);
  const showSection = useSettingsStore((s) => s.showSection);
  const close = useSettingsStore((s) => s.closeSettings);
  const shell = useRef<HTMLDialogElement>(null);
  /** the effect's own close() while it tears down — not a close the user asked for */
  const tearingDown = useRef(false);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = shell.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      // showModal focuses the first control inside — the dialog keeps it instead
      // (a section that asked for a field takes it after)
      dialog.focus();
    }
    // read at the close, not at the open: a second open keeps the first opener
    return () => {
      tearingDown.current = true;
      if (dialog?.open) dialog.close();
      tearingDown.current = false;
      const back = useSettingsStore.getState().returnTo;
      if (back?.isConnected) back.focus();
    };
  }, []);

  const Body = BODY[section];
  return (
    <dialog
      ref={shell}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClose={() => {
        // a close the browser forced is a close — but not the effect's own while it
        // tears down, nor one that lands after StrictMode's second run opened it again
        if (tearingDown.current || shell.current?.open) return;
        if (useSettingsStore.getState().open) close();
      }}
      onMouseDown={(e) => {
        // the scrim is the dialog element itself, outside its box
        if (e.target === shell.current) close();
      }}
      className="m-auto h-[600px] max-h-[calc(100vh-32px)] w-[880px] max-w-[calc(100vw-32px)] overflow-hidden rounded-(--radius-panel) border-0 bg-surface p-0 text-ink shadow-overlay outline-none backdrop:bg-scrim"
    >
      <div className="flex h-full">
        <div className="flex w-[200px] flex-none flex-col gap-2.5 bg-frame px-2 py-3.5">
          <h1 id={titleId} className="m-0 px-2 text-[14px] leading-6 font-semibold text-ink">
            Settings
          </h1>
          <nav aria-label="Settings sections">
            <ul className="m-0 flex list-none flex-col gap-px p-0">
              {SETTINGS_SECTIONS.map((name) => {
                const Icon = ICON[name];
                const on = name === section;
                return (
                  <li key={name}>
                    <button
                      type="button"
                      aria-current={on ? "page" : undefined}
                      onClick={() => showSection(name)}
                      className={`flex h-7 w-full items-center gap-2 rounded-(--radius-button) px-2 text-left text-[12px] text-ink transition-colors ${FOCUS_RING} ${
                        on ? "bg-selected font-semibold" : "font-medium hover:bg-hover"
                      }`}
                    >
                      <Icon size={15} strokeWidth={1.75} aria-hidden="true" className="text-icon" />
                      {name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[52px] flex-none items-center gap-2 pr-3 pl-6">
            <h2 className="m-0 flex-1 text-[14px] leading-5 font-semibold text-ink">{section}</h2>
            <IconAction icon={X} label="Close settings" onClick={close} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            <Body key={section} />
          </div>
        </div>
      </div>
      {/* the editor's lifts and the chat panel's offset are the sheet's, not this window's */}
      <div className="pointer-events-none fixed inset-0 [--dsk-toast-board-lift:0px] [--dsk-toast-editor-lift:0px] [--dsk-toast-lift:0px] [--dsk-toast-right:0px]">
        <Toaster />
      </div>
      {/* off macOS, the window's caption buttons above the scrim */}
      <DialogCaption />
    </dialog>
  );
};

/** mounted once at the frame; draws nothing while Settings is closed */
export const SettingsDialog = () => {
  const open = useSettingsStore((s) => s.open);
  return open ? <SettingsShell /> : null;
};
