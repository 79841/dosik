import { Copy, ExternalLink, LoaderCircle, type LucideIcon } from "lucide-react";
import {
  Children,
  Fragment,
  isValidElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { ACCENT_BUTTON, FOCUS_RING } from "../../shared/lib/palette";
import { writeClipboardText } from "../../shared/lib/systemClipboard";
import { toastError, useToastStore } from "../../shared/lib/toastStore";
import { IconButton } from "../../shared/ui/IconButton";

/**
 * The building blocks of the Settings dialog (#252), drawn to the canvas's
 * Settings-* boards: groups of 52px rows split by hairlines, segmented
 * controls, 28px buttons and dot-and-word statuses. The rows sit straight on
 * the pane — no card around them: the dialog is already one layer over the
 * window, and cards inside it read as a second.
 */

/** a section's groups, one under another */
export const Groups = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col gap-5">{children}</div>
);

/**
 * One group of rows. A group with a `title` is named by that head, so a screen
 * reader says it once; one without — or headed by a block of its own, like
 * About's mark — is named by `label`, which is not the section's title (that
 * is read just before it).
 */
export const Group = ({
  title,
  aside,
  label,
  head,
  children,
}: (
  | { title: string; aside?: string; label?: never; head?: never }
  | { title?: never; aside?: never; label: string; head?: ReactNode }
) & {
  /** its rows — nested arrays flatten, empty slots drop */
  children: ReactNode;
}) => {
  const headId = useId();
  const rows = Children.toArray(children);
  return (
    <section
      aria-label={title ? undefined : label}
      aria-labelledby={title ? headId : undefined}
      className="flex flex-col"
    >
      {title ? (
        <GroupHead id={headId} aside={aside}>
          {title}
        </GroupHead>
      ) : (
        head
      )}
      {rows.map((row, i) => (
        // toArray gave each row a key; the hairline rides with it
        <Fragment key={isValidElement(row) ? row.key : i}>
          {i > 0 ? <Hairline /> : null}
          {row}
        </Fragment>
      ))}
    </section>
  );
};

/** the line between a group's rows — `Group` draws it; a component that returns two rows draws its own */
export const Hairline = () => <div aria-hidden="true" className="h-px flex-none bg-line" />;

export const Row = ({
  title,
  description,
  children,
  below,
}: {
  title: string;
  /** "" while it loads: the line stays, empty, so the title does not jump when it comes */
  description?: ReactNode;
  children?: ReactNode;
  /** what hangs under the row inside the same block — install steps */
  below?: ReactNode;
}) => (
  <div className="flex flex-col">
    <div className="flex min-h-[52px] items-center gap-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[12px] leading-4 font-semibold text-ink">{title}</p>
        {description !== undefined ? (
          <p className="m-0 mt-0.5 min-h-[15px] text-[11px] leading-[15px] [overflow-wrap:anywhere] text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {children ? <div className="flex flex-none items-center gap-2">{children}</div> : null}
    </div>
    {below}
  </div>
);

/**
 * A segmented control — the design's segment, a radio group like Home's
 * Cards / Canvas switch: one Tab stop, ←→ (↑↓) move the focus and pick.
 */
export const Segmented = <T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) => {
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    const next = (options.indexOf(value) + step + options.length) % options.length;
    onChange(options[next] as T);
    group.current?.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus();
  };
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-flex flex-none gap-0.5 rounded-[7px] bg-frame p-0.5"
    >
      {options.map((option) => {
        const on = option === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a segmented control — a button that is a radio, the design's segment, not a native dot
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(option)}
            className={`flex h-6 items-center rounded-(--radius-control) px-2.5 text-[12px] transition-colors ${FOCUS_RING} ${
              on
                ? "bg-surface font-semibold text-ink shadow-segment"
                : "font-medium text-icon hover:text-ink"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
};

type ButtonKind = "secondary" | "primary" | "ghost" | "danger";

const BUTTON_LOOK: Record<ButtonKind, string> = {
  secondary: "bg-frame font-semibold text-ink hover:bg-hover",
  primary: `${ACCENT_BUTTON} font-semibold`,
  ghost: "font-medium text-ink hover:bg-hover",
  danger: "font-medium text-danger hover:bg-hover",
};

/** the spinner of an action under way (lucide loader-circle, as the board draws it) */
const Spinner = ({ size }: { size: number }) => (
  <LoaderCircle
    size={size}
    strokeWidth={1.75}
    aria-hidden="true"
    className="animate-spin motion-reduce:animate-none"
  />
);

export const Button = ({
  children,
  kind = "secondary",
  icon: Icon,
  external,
  onClick,
  disabled,
  busy,
  label,
}: {
  children: ReactNode;
  kind?: ButtonKind;
  icon?: LucideIcon;
  /** opens something outside Dosik — the external-link mark after the words */
  external?: boolean;
  onClick: () => void;
  disabled?: boolean;
  /**
   * An action under way: the spinner says so and a press waits. It stays
   * focusable (aria-disabled, not disabled), so the keyboard is not dropped
   * on the page while it works.
   */
  busy?: boolean;
  label?: string;
}) => (
  <button
    type="button"
    aria-label={label}
    aria-busy={busy || undefined}
    aria-disabled={busy || undefined}
    disabled={disabled}
    onClick={busy ? undefined : onClick}
    className={`flex h-7 flex-none items-center gap-1.5 rounded-(--radius-button) px-2.5 text-[12px] whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-35 ${FOCUS_RING} ${
      busy ? "cursor-default bg-frame font-semibold text-muted" : BUTTON_LOOK[kind]
    }`}
  >
    {busy ? (
      <Spinner size={14} />
    ) : Icon ? (
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
    ) : null}
    <span>{children}</span>
    {external && !busy ? (
      <ExternalLink size={12} strokeWidth={2} aria-hidden="true" className="text-muted" />
    ) : null}
  </button>
);

/**
 * An icon-only action — the app's IconButton (its tooltip, not the system's
 * `title`). Busy, its icon gives way to the spinner and a press waits.
 */
export const IconAction = ({
  id,
  icon: Icon,
  label,
  onClick,
  size = 28,
  busy,
}: {
  /** the button's DOM id — for the focus to go to it */
  id?: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  size?: 24 | 28;
  busy?: boolean;
}) => (
  <IconButton id={id} label={label} size={size} align="end" busy={busy} onClick={onClick}>
    {busy ? <Spinner size={15} /> : <Icon size={15} strokeWidth={1.75} aria-hidden="true" />}
  </IconButton>
);

export type StatusTone = "ok" | "bad" | "warn" | "off";

const DOT: Record<StatusTone, string> = {
  ok: "bg-success",
  bad: "bg-danger",
  warn: "bg-badge-orange",
  off: "bg-dash",
};

/**
 * The dot carries the colour; the word stays ink (11.5px orange would miss
 * 4.5:1). A live region: "Checking…" turning into "Signed in" is said, not
 * only shown — so a row keeps its status mounted and changes the words, and
 * one the board hides for a while (a plugin row under way) is `hidden`: off
 * screen, still in the page.
 */
export const Status = ({
  tone,
  children,
  hidden,
}: {
  tone: StatusTone;
  children: ReactNode;
  hidden?: boolean;
}) => (
  <span
    role="status"
    className={
      hidden
        ? "sr-only"
        : "flex flex-none items-center gap-1.5 text-[11.5px] font-semibold whitespace-nowrap text-ink"
    }
  >
    {hidden ? null : <span aria-hidden="true" className={`size-[7px] rounded-full ${DOT[tone]}`} />}
    {children}
  </span>
);

/** a word that marks a row — the default location's Default (#256) */
export const Pill = ({ children }: { children: ReactNode }) => (
  <span className="flex h-5 flex-none items-center rounded-full bg-frame px-[7px] text-[10.5px] font-semibold whitespace-nowrap text-muted-strong">
    {children}
  </span>
);

export const Mono = ({ children }: { children: ReactNode }) => (
  <code className="font-mono text-[11px] text-ink">{children}</code>
);

/** copies `text` and says so at the bottom */
export const copyText = async (text: string): Promise<void> => {
  const ok = await writeClipboardText(text);
  useToastStore.getState().pushToast(ok ? "Copied" : "Could not copy", ok ? "info" : "error");
};

/** a Terminal command with its copy button — the install steps under a missing CLI */
export const CommandLine = ({ command }: { command: string }) => (
  <div className="flex h-7 items-center gap-2 rounded-(--radius-button) bg-frame pr-1 pl-2.5">
    <span className="min-w-0 flex-1 truncate">
      <Mono>{command}</Mono>
    </span>
    <IconAction
      icon={Copy}
      label={`Copy ${command}`}
      size={24}
      onClick={() => void copyText(command)}
    />
  </div>
);

export const Steps = ({ intro, commands }: { intro: string; commands: string[] }) => (
  <div className="flex flex-col gap-1.5 pb-3.5">
    <p className="m-0 mb-0.5 text-[11px] leading-[15px] text-muted">{intro}</p>
    {commands.map((command) => (
      <CommandLine key={command} command={command} />
    ))}
  </div>
);

/**
 * What a section reads as it shows — a Tauri command's answer, say; null
 * until it comes — and again whenever `again` changes, the last answer kept
 * meanwhile. A failure keeps what it had and says why at the bottom. An
 * answer that lands after the section went, or after a newer read began, is
 * dropped (#218 D15).
 */
export const useLoaded = <T,>(load: () => Promise<T>, again: unknown = null): T | null => {
  const [value, setValue] = useState<T | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: read when the section shows and when `again` changes, not when `load` is made anew
  useEffect(() => {
    let live = true;
    load().then(
      (v) => live && setValue(v),
      (error) => live && toastError(error),
    );
    return () => {
      live = false;
    };
  }, [again]);
  return value;
};

/** a group's name — General's Appearance and Library, a vendor with its maker beside it */
const GroupHead = ({ id, children, aside }: { id: string; children: string; aside?: string }) => (
  <div className="mb-0.5 flex items-baseline gap-2">
    <h3
      id={id}
      className="m-0 text-[10.5px] leading-[14px] font-semibold tracking-[0.06em] text-muted uppercase"
    >
      {children}
    </h3>
    {aside ? (
      <span className="text-[11px] leading-[14px] font-medium text-muted">{aside}</span>
    ) : null}
  </div>
);

/** the line under a section's title */
export const Caption = ({ children }: { children: ReactNode }) => (
  <p className="m-0 mb-3 text-[11.5px] leading-4 text-muted">{children}</p>
);
