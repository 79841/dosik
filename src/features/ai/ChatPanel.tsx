import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ArrowUp,
  Code,
  Info,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { base64ToBytes } from "../../shared/lib/base64";
import { elementAtDrop, TAKES_FILE_DROPS } from "../../shared/lib/fileDrops";
import { ACCENT_BUTTON, FOCUS_RING, TEXT_MUTED } from "../../shared/lib/palette";
import { useDiagramStore } from "../../shared/lib/store";
import { readClipboardPicture } from "../../shared/lib/systemClipboard";
import { toastError } from "../../shared/lib/toastStore";
import { ICON_STROKE, IconButton, SMALL_ICON_SIZE } from "../../shared/ui/IconButton";
import { PLAIN_TEXT } from "../../shared/ui/plainText";
import { MermaidPreview } from "../mermaid/MermaidPreview";
import { openSettings } from "../settings/settingsStore";
import { AttachmentChip } from "./AttachmentChip";
import {
  type ChatAttachment,
  fromFiles,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  pickFiles,
  readDroppedFiles,
  roomFor,
} from "./attachments";
import { sendChatTurn } from "./chatActions";
import { type ChatMessage, panelToggleId, SIDE_PANEL_ID, useChatStore } from "./chatStore";
import { ModelPicker } from "./ModelPicker";
import { chatRoom, clampChatWidth, MAX_CHAT_WIDTH, MIN_CHAT_WIDTH } from "./panelWidth";
import { selectionChipLabel, summarizeSelection } from "./selectionContext";
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
  return <SelectionChipView label={selectionChipLabel(summary)} onClear={clearSelection} />;
};

/**
 * The selection as a chip — in the composer with its x, and on a sent
 * message, without one, as the selection that message carried (#277).
 */
const SelectionChipView = ({ label, onClear }: { label: string; onClear?: () => void }) => (
  // the design's chip: 22 tall on the line tint, inside the composer (#219 D15)
  <div className="flex min-w-0">
    <span
      className={`flex h-[22px] min-w-0 items-center gap-1 rounded-(--radius-control) bg-line text-[10.5px] font-medium text-ink ${
        onClear ? "pr-[3px] pl-[7px]" : "px-[7px]"
      }`}
    >
      <span className="truncate">Selection · {label}</span>
      {onClear ? (
        <button
          type="button"
          title="Clear selection"
          onClick={onClear}
          aria-label="Clear selection"
          className={`flex h-4 w-4 flex-none items-center justify-center rounded-[3px] text-icon transition-colors hover:bg-hover ${FOCUS_RING}`}
        >
          <X size={11} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  </div>
);

/**
 * What went with a sent message (#277, Chat-States 6): the selection it
 * carried, then its files — as the composer showed them, without the x. A
 * selected image node's picture rides along unseen here: the selection chip
 * already stands for it.
 */
const SentChips = ({ message }: { message: ChatMessage }) => {
  const files = (message.attachments ?? []).filter((a) => !a.fromNode);
  if (!message.selection && files.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {message.selection ? <SelectionChipView label={message.selection} /> : null}
      {files.map((a) => (
        <AttachmentChip key={a.id} attachment={a} />
      ))}
    </div>
  );
};

/**
 * What a paste without files may still hold: a picture's own bytes on the
 * system clipboard, read through Rust (`clipboard_picture.rs`) as the canvas
 * reads it. Files copied in Finder or Explorer are left to the paste itself.
 */
const clipboardPicture = async (): Promise<File | null> => {
  const picture = await readClipboardPicture();
  if (picture?.kind !== "data") return null;
  return new File([base64ToBytes(picture.base64) as BlobPart], "", { type: picture.mime });
};

/** how many more files the composer takes right now */
const room = () => roomFor(useChatStore.getState().attachments.length);

/**
 * Files in: `load` reads at most `room` of them (the rest it names), and
 * whatever still does not fit when they arrive — or could not be read — is
 * said in toasts.
 */
const attach = async (
  load: (room: number) => Promise<{ attachments: ChatAttachment[]; errors: string[] }>,
) => {
  try {
    const loaded = await load(room());
    const fits = loaded.attachments.slice(0, room());
    const late = loaded.attachments.slice(fits.length).map((a) => a.name);
    if (fits.length > 0) useChatStore.getState().addAttachments(fits);
    const errors = [...loaded.errors];
    if (late.length > 0) {
      errors.push(`Up to ${MAX_ATTACHMENTS} files per message: ${late.join(", ")} not attached`);
    }
    for (const message of errors) toastError(new Error(message));
  } catch (error) {
    toastError(error);
  }
};

/** `File`s from a paste or a page drop, read in the webview */
const attachFiles = (files: File[]) => attach((space) => fromFiles(files, space));

/** the words only: the webview would carry the theme's colours along, unreadable pasted on white */
const copyAsPlainText = (event: React.ClipboardEvent) => {
  const text = document.getSelection()?.toString();
  if (!text) return;
  event.clipboardData.setData("text/plain", text);
  event.preventDefault();
};

/**
 * Focus moved elsewhere in the window (a shape, the composer): the words'
 * highlight goes too, so no selection is on show that Cmd+C would not copy.
 * Another app taking the focus leaves it.
 */
const dropSelection = (event: React.FocusEvent<HTMLElement>) => {
  if (!document.hasFocus()) return;
  const selection = document.getSelection();
  if (selection && event.currentTarget.contains(selection.anchorNode)) selection.removeAllRanges();
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
  const attachments = useChatStore((s) => s.attachments);
  /** files are being dragged over the panel (#275) */
  const [dropping, setDropping] = useState(false);
  /** whether the drag Tauri reports carries files (its `over` events do not say) */
  const dragFiles = useRef(false);
  const chipRowRef = useRef<HTMLDivElement>(null);
  /** where the focus goes once a chip is gone — another chip's x, or the message */
  const focusAfterRemove = useRef<string | null>(null);

  const width = useChatWidth();
  const setWidth = useChatStore((s) => s.setWidth);
  const commitWidth = useChatStore((s) => s.commitWidth);
  const titleId = useId();

  const [input, setInput] = useState("");
  const [resizing, setResizing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  /** ends the drag in flight, so an unmount mid-gesture cannot strand the cursor */
  const dragRef = useRef<(() => void) | null>(null);

  useEffect(() => () => dragRef.current?.(), []);

  // files dropped from Finder (#275): Tauri takes them before the page does
  // (macOS) and says where they landed — over this panel they attach, and the
  // canvas leaves them alone (`TAKES_FILE_DROPS`). Outside Tauri (and on
  // Windows, where the page keeps drops) the panel's own drop handlers do it.
  useEffect(() => {
    if (!open || view !== "chat") return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    const over = (position: { x: number; y: number }) =>
      asideRef.current?.contains(elementAtDrop(position)) ?? false;
    try {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          const { payload } = event;
          if (payload.type === "enter") dragFiles.current = payload.paths.length > 0;
          if (payload.type === "leave") setDropping(false);
          else if (payload.type === "enter" || payload.type === "over")
            setDropping(dragFiles.current && over(payload.position));
          else if (payload.type === "drop") {
            setDropping(false);
            if (over(payload.position)) {
              void attach((space) => readDroppedFiles(payload.paths, space));
            }
          }
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => undefined);
    } catch {
      // not in Tauri (`pnpm dev`): no webview to listen to
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [open, view]);

  // words selected while the focus is elsewhere (the Edit menu's Select All
  // with the canvas focused) would show a selection Cmd+C does not copy
  useEffect(() => {
    const onSelectionChange = () => {
      const list = listRef.current;
      const selection = document.getSelection();
      if (!list || !selection || selection.isCollapsed) return;
      if (list.contains(selection.anchorNode) && !list.contains(document.activeElement)) {
        selection.removeAllRanges();
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: input, width, open and view are the triggers — the text, the wrap and a remount of the composer all change the needed height
  useLayoutEffect(() => {
    if (inputRef.current) autoGrow(inputRef.current);
  }, [input, width, open, view]);

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

  /**
   * A chip's x: the file goes, and the focus with it would fall to the page,
   * where Backspace deletes the canvas selection (#219) — it goes to the next
   * chip's x, the previous one's, or the message.
   */
  const removeChip = useCallback((id: string) => {
    const { attachments: holding, removeAttachment } = useChatStore.getState();
    const at = holding.findIndex((a) => a.id === id);
    const next = holding[at + 1] ?? holding[at - 1];
    focusAfterRemove.current = next ? `Remove ${next.name}` : "";
    removeAttachment(id);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attachments is the trigger — the chip row changed
  useLayoutEffect(() => {
    const label = focusAfterRemove.current;
    if (label === null) return;
    focusAfterRemove.current = null;
    const chip = label
      ? chipRowRef.current?.querySelector<HTMLElement>(`button[aria-label="${CSS.escape(label)}"]`)
      : null;
    (chip ?? inputRef.current)?.focus();
  }, [attachments]);

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files];
    if (files.length > 0) {
      event.preventDefault();
      void attachFiles(files);
      return;
    }
    // a screenshot may sit on the clipboard as a picture the paste does not carry
    if (event.clipboardData.types.length === 0) {
      void clipboardPicture().then((file) => (file ? attachFiles([file]) : undefined));
    }
  };

  const carriesFiles = (event: React.DragEvent) => [...event.dataTransfer.types].includes("Files");

  const send = async () => {
    // an answer on its way: Enter must not throw away what was typed
    if (useChatStore.getState().busy) return;
    const text = input;
    setInput("");
    const result = await sendChatTurn(text);
    if (result === "needs-api-key") {
      // the draft stays; Settings opens on the key field, and closing it comes back here
      setInput(text);
      const { vendor } = useChatStore.getState().settings;
      openSettings("AI assistant", { returnTo: inputRef.current, focus: `key-${vendor}` });
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
      // the Mermaid view takes no files: a drop there stays the canvas's
      {...(chat ? { [TAKES_FILE_DROPS]: "" } : {})}
      onDragEnter={(e) => {
        if (chat && carriesFiles(e)) setDropping(true);
      }}
      onDragOver={(e) => {
        if (!chat || !carriesFiles(e)) return;
        // this panel takes the files: the page must not refuse them here
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!asideRef.current?.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!chat || !carriesFiles(e)) return;
        e.preventDefault();
        setDropping(false);
        void attachFiles([...e.dataTransfer.files]);
      }}
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
                label="AI assistant settings"
                size={28}
                popup="dialog"
                onClick={() => openSettings("AI assistant")}
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

      {/* the chat's state (what is typed) lives here, above the switch, so a
          look at the preview does not lose it */}
      {!chat ? (
        <MermaidPreview />
      ) : (
        <>
          {/* the words of the messages select and copy (the rest of the app
              does not). A press here focuses the list, so Cmd+C lands on it
              and the canvas leaves selected words to the webview (and every
              other key to itself) */}
          <div
            ref={listRef}
            aria-live="polite"
            tabIndex={-1}
            data-selectable-text=""
            onCopy={copyAsPlainText}
            onBlur={dropSelection}
            className="flex min-h-0 flex-1 select-text flex-col gap-4 overflow-y-auto px-3 pt-1 pb-3 text-[12px] leading-[1.6] text-ink outline-none"
          >
            {messages.length === 0 ? (
              <div
                className={`flex h-full select-none items-center justify-center px-2 text-center text-[12px] leading-relaxed text-balance ${TEXT_MUTED}`}
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
              if (m.role === "notice") {
                // a file that went by name only, under the message it went with
                return (
                  <p
                    key={m.id}
                    className="m-0 flex items-start gap-1.5 text-[11px] leading-[15px] text-muted"
                  >
                    <Info
                      size={12}
                      strokeWidth={2}
                      aria-hidden="true"
                      className="mt-px flex-none"
                    />
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
              if (m.role === "user") {
                const bubble = m.text ? (
                  // the design's bubble: its own corner tucked in toward the panel edge
                  <div className="ml-auto max-w-full whitespace-pre-wrap rounded-[10px_10px_3px_10px] bg-hover px-2.5 py-2">
                    {m.text}
                  </div>
                ) : null;
                return (
                  <div key={m.id} className="ml-auto flex max-w-[75%] flex-col items-end gap-1">
                    <SentChips message={m} />
                    {bubble}
                  </div>
                );
              }
              // an answer: plain text, no bubble
              return (
                <div key={m.id} className="mr-auto max-w-full whitespace-pre-wrap">
                  {m.text}
                </div>
              );
            })}
            {busy ? (
              <div className="mr-auto flex select-none items-center gap-1.5 py-1">
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
            {/* a filled field on the panel is `frame` (#216 Q2). In focus, the
                message field rings the whole composer in 1px `focus`; the
                buttons inside keep their own keyboard ring instead */}
            <div className="rounded-(--radius-island) bg-frame pt-2 pr-2 pb-1.5 pl-2.5 has-[textarea:focus]:ring-1 has-[textarea:focus]:ring-focus">
              {/* the selection and the files; empty, the row takes no room */}
              <div ref={chipRowRef} className="mb-1 flex min-w-0 flex-wrap gap-1 empty:hidden">
                <SelectionChip />
                {attachments.map((a) => (
                  <AttachmentChip key={a.id} attachment={a} onRemove={removeChip} />
                ))}
              </div>
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
                onPaste={onPaste}
                rows={2}
                aria-label="Message"
                placeholder="Ask the AI to draw or edit…"
                className="block max-h-32 w-full resize-none overflow-y-auto bg-transparent text-[12px] leading-normal text-ink outline-none placeholder:text-muted focus:outline-hidden"
              />
              <div className="mt-1 flex items-center gap-0.5">
                <IconButton
                  label="Attach files"
                  size={24}
                  tooltip="above"
                  align="start"
                  onClick={() => void attach(pickFiles)}
                >
                  <Paperclip size={14} strokeWidth={1.9} aria-hidden="true" />
                </IconButton>
                <ModelPicker />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={busy || (!input.trim() && attachments.length === 0)}
                  title="Send (Enter)"
                  aria-label="Send"
                  className={`ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] ${ACCENT_BUTTON} ${FOCUS_RING} disabled:bg-primary/35 disabled:text-primary-fg/70 disabled:hover:bg-primary/35`}
                >
                  <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {chat && dropping ? (
        // files over the panel: the frame tint says what a drop does — no outline (Chat-States 5)
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-10 bottom-0 z-[5] flex flex-col items-center justify-center gap-2 bg-frame text-icon"
        >
          <Paperclip size={22} strokeWidth={1.6} />
          <p className="m-0 text-[12px] leading-4 font-semibold text-ink">Drop files to attach</p>
          <p className="m-0 text-[11px] leading-[15px] text-muted">
            Up to {MAX_ATTACHMENTS} files, {MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB each
          </p>
        </div>
      ) : null}
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
