import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const { useChatStore } = await import("../chatStore");
const { ModelPicker } = await import("../ModelPicker");
const { CLAUDE_MODELS, OPENAI_MODELS } = await import("../settings");
const { useAiStatusStore } = await import("../aiStatusStore");
const { useSettingsStore } = await import("../../settings/settingsStore");

const settings = () => useChatStore.getState().settings;
const button = () => screen.getByRole("button", { name: /Claude|GPT/ });
const menu = () => screen.getByRole("menu", { name: "Model" });

/**
 * The composer's model menu (#252, the canvas's Composer-ModelPicker board):
 * the button reads the chosen model; the menu groups the models by vendor
 * under each vendor's connection; a vendor that cannot be reached offers
 * Connect … instead; AI assistant settings… opens Settings.
 */
describe("composer model menu (#252)", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ version: "1.0.0", signed_in: true });
    useAiStatusStore.setState({
      cli: { claude: { state: "ok", version: "1.0.0" }, openai: { state: "ok", version: "1.0.0" } },
    });
    useSettingsStore.setState({ open: false, section: "General", lastSection: "General" });
    useChatStore.setState({
      cliSessionId: "session-1",
      settings: {
        vendor: "claude",
        auths: { claude: "subscription", openai: "api-key" },
        keys: { claude: "", openai: "sk-o" },
        models: { claude: "claude-opus-5", openai: "gpt-5.6-sol" },
      },
    });
  });

  it("the button reads the chosen model, without the (recommended) note", () => {
    render(<ModelPicker />);
    expect(button()).toHaveTextContent("Claude Opus 5");
    expect(button()).not.toHaveTextContent("recommended");
    expect(button()).toHaveAttribute("aria-haspopup", "menu");
  });

  it("groups the models by vendor under its connection and ticks the chosen one", async () => {
    const user = userEvent.setup();
    render(<ModelPicker />);
    await user.click(button());
    expect(within(menu()).getByText("Claude · Subscription")).toBeInTheDocument();
    expect(within(menu()).getByText("GPT · API key")).toBeInTheDocument();
    const radios = within(menu()).getAllByRole("menuitemradio");
    expect(radios.map((r) => r.textContent)).toEqual([
      ...CLAUDE_MODELS.map((m) => m.label),
      ...OPENAI_MODELS.map((m) => m.label),
    ]);
    expect(radios.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
  });

  it("each vendor's models sit in a group named by its label", async () => {
    const user = userEvent.setup();
    render(<ModelPicker />);
    await user.click(button());
    const gpt = within(menu()).getByRole("group", { name: "GPT · API key" });
    expect(
      within(gpt)
        .getAllByRole("menuitemradio")
        .map((r) => r.textContent),
    ).toEqual(OPENAI_MODELS.map((m) => m.label));
  });

  it("picking another vendor's model picks the vendor too — and drops the CLI session", async () => {
    const user = userEvent.setup();
    render(<ModelPicker />);
    await user.click(button());
    await user.click(screen.getByRole("menuitemradio", { name: "GPT-6 Astra" }));
    expect(settings()).toMatchObject({ vendor: "openai", models: { openai: "gpt-6-astra" } });
    expect(settings().models.claude).toBe("claude-opus-5");
    expect(useChatStore.getState().cliSessionId).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button()).toHaveTextContent("GPT-6 Astra");
  });

  it("another model of the same vendor keeps the CLI session", async () => {
    const user = userEvent.setup();
    render(<ModelPicker />);
    await user.click(button());
    await user.click(screen.getByRole("menuitemradio", { name: "Claude Sonnet 5" }));
    expect(settings().models.claude).toBe("claude-sonnet-5");
    expect(useChatStore.getState().cliSessionId).toBe("session-1");
  });

  it("an API key connection without a key is not connected — Connect opens AI assistant", async () => {
    const user = userEvent.setup();
    useChatStore.setState({ settings: { ...settings(), keys: { claude: "", openai: "" } } });
    render(<ModelPicker />);
    await user.click(button());
    expect(within(menu()).getByText("GPT · Not connected")).toBeInTheDocument();
    expect(within(menu()).queryByRole("menuitemradio", { name: /GPT-/ })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: "Connect GPT…" }));
    expect(useSettingsStore.getState()).toMatchObject({ open: true, section: "AI assistant" });
    expect(useSettingsStore.getState().returnTo).toBe(button());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a subscription whose CLI is missing or signed out is not connected", async () => {
    const user = userEvent.setup();
    useAiStatusStore.setState({
      cli: { claude: { state: "missing" }, openai: { state: "ok", version: "1" } },
    });
    render(<ModelPicker />);
    await user.click(button());
    expect(within(menu()).getByText("Claude · Not connected")).toBeInTheDocument();
    expect(within(menu()).getByRole("menuitem", { name: "Connect Claude…" })).toBeInTheDocument();
  });

  it("a subscription not checked yet shows its models and asks its CLI", async () => {
    const user = userEvent.setup();
    useAiStatusStore.setState({
      cli: { claude: { state: "unknown" }, openai: { state: "unknown" } },
    });
    render(<ModelPicker />);
    await user.click(button());
    expect(invokeMock).toHaveBeenCalledWith("claude_cli_status");
    // GPT is on an API key: no CLI to ask
    expect(invokeMock).not.toHaveBeenCalledWith("codex_cli_status");
    expect(
      within(menu()).getByRole("menuitemradio", { name: /Claude Opus 5/ }),
    ).toBeInTheDocument();
  });

  it("a CLI answer that swaps a group while the menu is open keeps the keyboard in the menu", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    invokeMock.mockReturnValue(new Promise((r) => (finish = r)));
    useAiStatusStore.setState({
      cli: { claude: { state: "unknown" }, openai: { state: "unknown" } },
    });
    render(<ModelPicker />);
    await user.click(button());
    expect(within(menu()).getByRole("menuitemradio", { name: /Claude Opus 5/ })).toHaveFocus();
    await act(async () => finish({ version: null, signed_in: null }));
    expect(within(menu()).getByRole("menuitem", { name: "Connect Claude…" })).toBeInTheDocument();
    expect(menu()).toContainElement(document.activeElement as HTMLElement);
  });

  it("AI assistant settings… opens Settings there", async () => {
    const user = userEvent.setup();
    render(<ModelPicker />);
    await user.click(button());
    await user.click(screen.getByRole("menuitem", { name: "AI assistant settings…" }));
    expect(useSettingsStore.getState()).toMatchObject({ open: true, section: "AI assistant" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape or an outside press", async () => {
    const user = userEvent.setup();
    render(<ModelPicker />);
    await user.click(button());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(button());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("menu keyboard — first item on open, ↓ End, Escape returns to the button (#219)", async () => {
    const user = userEvent.setup();
    render(<ModelPicker />);
    await user.click(button());
    const first = within(menu()).getAllByRole("menuitemradio")[0];
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(menu()).getAllByRole("menuitemradio")[1]).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "AI assistant settings…" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button()).toHaveFocus();
  });

  it("returns focus to the button after a pick (#219)", async () => {
    const user = userEvent.setup();
    render(<ModelPicker />);
    await user.click(button());
    await user.keyboard("{ArrowDown}{Enter}");
    expect(settings().models.claude).toBe("claude-sonnet-5");
    expect(button()).toHaveFocus();
  });
});
