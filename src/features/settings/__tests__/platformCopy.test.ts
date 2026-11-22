import { describe, expect, it } from "vitest";

import { platformCopy } from "../platformCopy";

describe("Settings' words for the machine it runs on (the canvas's Win-Settings, Win-Settings-States)", () => {
  it("macOS: the Mac, its Keychain, Terminal and npm", () => {
    expect(platformCopy(true)).toEqual({
      machine: "this Mac",
      keyStore: "Kept in this Mac's Keychain",
      theme: "Follow macOS, or pick one",
      shell: "Terminal",
      claudeInstall: "npm i -g @anthropic-ai/claude-code",
    });
  });

  it("Windows: the PC, Credential Manager, PowerShell and the native installer — npm's .cmd shim is refused", () => {
    expect(platformCopy(false)).toEqual({
      machine: "this PC",
      keyStore: "Kept in Windows Credential Manager",
      theme: "Follow Windows, or pick one",
      shell: "PowerShell",
      claudeInstall: "irm https://claude.ai/install.ps1 | iex",
    });
  });
});
