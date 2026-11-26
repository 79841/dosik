import { invoke } from "@tauri-apps/api/core";
import { nanoid } from "nanoid";
import { create } from "zustand";

import type { ChatAttachment } from "./attachments";
import { chatRoom, clampChatWidth, loadChatWidth, saveChatWidth } from "./panelWidth";
import { bindKeyStore, keychainAvailable, scheduleKeySave } from "./keychain";
import { loadPanelPrefs, savePanelPrefs } from "./panelPrefs";
import {
  type AiSettings,
  type AiVendor,
  activeAuth,
  loadAiSettings,
  saveAiSettings,
} from "./settings";

/** `notice`: a line the app adds about a message — a file that went by name only */
export type ChatRole = "user" | "assistant" | "activity" | "error" | "notice";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** What the chat shows — exactly what the user typed. */
  text: string;
  /**
   * What was actually sent to the provider: `text` with the selection block in
   * front. Only the API path needs it — that path rebuilds its history from
   * these messages, so without the block a later turn cannot tell what "it"
   * referred to (#55). The CLI path resumes its own transcript and ignores this.
   */
  payload?: string;
  /**
   * The files that went with a user message — the API paths replay them with
   * every later turn, as they replay `payload`.
   */
  attachments?: ChatAttachment[];
  /** the provider refused this turn: its files are no longer replayed */
  filesFailed?: true;
  /** the canvas selection a user message carried, as its chip read then (#277) */
  selection?: string;
}

/** what the right panel shows — the chat or the Mermaid preview (#194) */
export type PanelView = "chat" | "mermaid";

/** the docked side panel — the toolbar toggles' `aria-controls` while it is up (#219 D13) */
export const SIDE_PANEL_ID = "side-panel";
/** each view's toolbar toggle, where focus goes back when the panel closes */
export const panelToggleId = (view: PanelView): string => `toggle-${view}`;

/** the Mermaid view shows the drawing or its code, one at a time */
export type MermaidMode = "preview" | "code";

interface ChatState {
  open: boolean;
  /** one panel, two views: opening, width and position are shared (#194 D5) */
  view: PanelView;
  mermaidMode: MermaidMode;
  busy: boolean;
  messages: ChatMessage[];
  settings: AiSettings;
  /** CLI conversation id (Claude session / Codex thread), kept across turns for continuity. */
  cliSessionId: string | null;
  /** which conversation is on screen — New chat starts the next one; a turn out belongs to the one it began in */
  conversation: number;
  /** the conversation's id for its files on disk (`chat_files.rs`) — new with New chat */
  conversationId: string;
  /** the files waiting in the composer for the next message */
  attachments: ChatAttachment[];
  /** panel width in px, dragged by the left edge (#129) */
  width: number;

  toggleOpen: () => void;
  /** opens the panel on `view` (or switches to it while open) */
  showView: (view: PanelView) => void;
  /**
   * The toolbar's two toggles (#219 D13): `view` open closes the panel,
   * the other view open switches to it, closed opens on it.
   */
  togglePanel: (view: PanelView) => void;
  setMermaidMode: (mode: MermaidMode) => void;
  setBusy: (busy: boolean) => void;
  /** returns the new message's id */
  addMessage: (
    role: ChatRole,
    text: string,
    extra?: Pick<ChatMessage, "payload" | "attachments" | "selection">,
  ) => string;
  /**
   * A turn the provider refused: its files leave the replay (and `payload`
   * goes back to the words alone), or every later turn would send them again
   * and fail the same way. The message keeps them, to show what was sent.
   */
  forgetTurnFiles: (id: string, payload: string) => void;
  addAttachments: (attachments: ChatAttachment[]) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  clearMessages: () => void;
  setSettings: (settings: AiSettings) => void;
  setCliSessionId: (id: string | null) => void;
  /**
   * During a drag: state only — the pointer moves far more often than the disk
   * should be written. Clamped here so no caller can leave the panel out of
   * bounds.
   */
  setWidth: (width: number) => void;
  /** at the end of a drag: remember it for the next run */
  commitWidth: () => void;
}

/** open and view, as they are now — remembered whenever either changes (#219 D14) */
const panelPrefs = loadPanelPrefs();

export const useChatStore = create<ChatState>((set, get) => ({
  ...panelPrefs,
  mermaidMode: "preview",
  busy: false,
  messages: [],
  settings: loadAiSettings(),
  cliSessionId: null,
  conversation: 0,
  conversationId: nanoid(12),
  attachments: [],
  width: loadChatWidth(),

  toggleOpen: () => {
    set((s) => ({ open: !s.open }));
    savePanelPrefs({ open: get().open, view: get().view });
  },
  showView: (view) => {
    set({ open: true, view });
    savePanelPrefs({ open: true, view });
  },
  togglePanel: (view) => {
    const { open, view: showing } = get();
    const next = { open: !(open && showing === view), view };
    set(next);
    savePanelPrefs(next);
  },
  setMermaidMode: (mermaidMode) => set({ mermaidMode }),
  setBusy: (busy) => set({ busy }),
  addMessage: (role, text, extra = {}) => {
    const id = nanoid(6);
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id,
          role,
          text,
          ...(extra.payload ? { payload: extra.payload } : {}),
          ...(extra.attachments?.length ? { attachments: extra.attachments } : {}),
          ...(extra.selection ? { selection: extra.selection } : {}),
        },
      ],
    }));
    return id;
  },
  forgetTurnFiles: (id, payload) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        // the files stay on the message, to show what went; only the replay drops them
        return m.id === id ? { ...m, payload, filesFailed: true as const } : m;
      }),
    })),
  addAttachments: (attachments) =>
    set((s) => ({ attachments: [...s.attachments, ...attachments] })),
  removeAttachment: (id) => set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),
  clearAttachments: () => set({ attachments: [] }),
  clearMessages: () => {
    const old = get().conversationId;
    set((s) => ({
      messages: [],
      cliSessionId: null,
      conversation: s.conversation + 1,
      conversationId: nanoid(12),
    }));
    // the CLI's copies of that conversation's files are no longer needed
    invoke("discard_chat_files", { conversation: old }).catch(() => undefined);
  },
  setSettings: (settings) => {
    const previous = get().settings;
    for (const vendor of Object.keys(settings.keys) as AiVendor[]) {
      if (settings.keys[vendor] !== previous.keys[vendor]) {
        scheduleKeySave(vendor, settings.keys[vendor]);
      }
    }
    // the keys ride along only while the keychain is not (yet) holding them
    saveAiSettings(settings, { keepKeys: keychainAvailable() !== true });
    set((s) => ({
      settings,
      // a CLI session id belongs to one CLI; resuming it under another vendor
      // or connection would be wrong, so a change of either starts fresh. A
      // model change keeps it: both CLIs resume a session under another model
      cliSessionId:
        s.settings.vendor === settings.vendor && activeAuth(s.settings) === activeAuth(settings)
          ? s.cliSessionId
          : null,
    }));
  },
  setCliSessionId: (cliSessionId) => set({ cliSessionId }),
  setWidth: (width) => set({ width: clampChatWidth(width, chatRoom()) }),
  commitWidth: () => saveChatWidth(get().width),
}));

bindKeyStore({
  get: () => useChatStore.getState().settings,
  setKeys: (keys) => useChatStore.setState((s) => ({ settings: { ...s.settings, keys } })),
  persist: () =>
    saveAiSettings(useChatStore.getState().settings, { keepKeys: keychainAvailable() !== true }),
});
