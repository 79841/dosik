import { isMacPlatform } from "../../shared/lib/windowChrome";

/** Settings' words for the machine it runs on (the canvas's Win-Settings and Win-Settings-States) */
export interface PlatformCopy {
  /** "CLI 2.1.4 on this Mac", "… which this PC does not have" */
  machine: string;
  /** where an API key is kept */
  keyStore: string;
  /** the theme row: System follows the OS */
  theme: string;
  /** where the install and sign-in commands are typed */
  shell: string;
  /**
   * How Claude Code gets installed. On Windows the native installer: npm's
   * global install leaves a `.cmd` shim, which the app cannot start (`chat.rs`).
   */
  claudeInstall: string;
}

const MAC: PlatformCopy = {
  machine: "this Mac",
  keyStore: "Kept in this Mac's Keychain",
  theme: "Follow macOS, or pick one",
  shell: "Terminal",
  claudeInstall: "npm i -g @anthropic-ai/claude-code",
};

const WINDOWS: PlatformCopy = {
  machine: "this PC",
  keyStore: "Kept in Windows Credential Manager",
  theme: "Follow Windows, or pick one",
  shell: "PowerShell",
  claudeInstall: "irm https://claude.ai/install.ps1 | iex",
};

export const platformCopy = (mac: boolean = isMacPlatform()): PlatformCopy => (mac ? MAC : WINDOWS);
