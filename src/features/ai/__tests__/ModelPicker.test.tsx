import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../chatStore";
import { ModelPicker } from "../ModelPicker";
import { MODELS_BY_VENDOR } from "../settings";

const settings = () => useChatStore.getState().settings;
const button = () => screen.getByRole("button", { name: /·/ });
const menu = () => screen.getByRole("menu", { name: "Model" });

/**
 * The composer's model picker (#219 D15): the connection, and with an API
 * key the model — what the header badge used to show, now one click from
 * changing it.
 */
describe("model picker (#219 D15, T25)", () => {
  beforeEach(() => {
    localStorage.clear();
    useChatStore.setState({
      cliSessionId: "session-1",
      settings: {
        vendor: "claude",
        auth: "subscription",
        keys: { claude: "", openai: "" },
        models: { claude: "claude-opus-5", openai: "gpt-5.6-sol" },
      },
    });
  });

  it("labels the button 'vendor · connection' and makes it a menu button", () => {
    render(<ModelPicker onSettings={() => {}} />);
    expect(button()).toHaveTextContent("Claude · Subscription");
    expect(button()).toHaveAttribute("aria-haspopup", "menu");
    expect(button()).toHaveAttribute("aria-expanded", "false");
  });

  it("marks the current one of the four connections as selected", async () => {
    const user = userEvent.setup();
    render(<ModelPicker onSettings={() => {}} />);
    await user.click(button());
    const radios = within(menu()).getAllByRole("menuitemradio");
    expect(radios.map((r) => r.textContent)).toEqual([
      "Claude · Subscription",
      "Claude · API key",
      "GPT · Subscription",
      "GPT · API key",
    ]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
  });

  it("updates settings and closes on pick — a connection change drops the CLI session", async () => {
    const user = userEvent.setup();
    render(<ModelPicker onSettings={() => {}} />);
    await user.click(button());
    await user.click(screen.getByRole("menuitemradio", { name: "GPT · Subscription" }));
    expect(settings()).toMatchObject({ vendor: "openai", auth: "subscription" });
    expect(useChatStore.getState().cliSessionId).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button()).toHaveTextContent("GPT · Subscription");
  });

  it("lists that vendor's models for API key — the picked model goes into settings", async () => {
    const user = userEvent.setup();
    useChatStore.setState({ settings: { ...settings(), auth: "api-key" } });
    render(<ModelPicker onSettings={() => {}} />);
    await user.click(button());
    const models = MODELS_BY_VENDOR.claude;
    for (const model of models) {
      expect(within(menu()).getByRole("menuitemradio", { name: model.label })).toBeInTheDocument();
    }
    expect(within(menu()).queryByRole("menuitemradio", { name: /GPT-/ })).toBeNull();
    const other = models.find((m) => m.id !== "claude-opus-5")!;
    await user.click(screen.getByRole("menuitemradio", { name: other.label }));
    expect(settings().models.claude).toBe(other.id);
    expect(settings().models.openai).toBe("gpt-5.6-sol");
  });

  it("has no model list for subscription connections", async () => {
    const user = userEvent.setup();
    render(<ModelPicker onSettings={() => {}} />);
    await user.click(button());
    expect(within(menu()).getAllByRole("menuitemradio")).toHaveLength(4);
  });

  it("opens settings from AI settings…", async () => {
    const user = userEvent.setup();
    const onSettings = vi.fn();
    render(<ModelPicker onSettings={onSettings} />);
    await user.click(button());
    await user.click(screen.getByRole("menuitem", { name: "AI settings…" }));
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape or an outside press", async () => {
    const user = userEvent.setup();
    render(<ModelPicker onSettings={() => {}} />);
    await user.click(button());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(button());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("menu keyboard — first item on open, ↑↓ Home End, Escape closes and returns to the button (#219)", async () => {
    const user = userEvent.setup();
    render(<ModelPicker onSettings={() => {}} />);
    await user.click(button());
    const items = () => [
      ...within(menu()).getAllByRole("menuitemradio"),
      within(menu()).getByRole("menuitem"),
    ];
    expect(items()[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items()[1]).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "AI settings…" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items()[0]).toHaveFocus();
    await user.keyboard("{ArrowUp}{Home}");
    expect(items()[0]).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button()).toHaveFocus();
  });

  it("returns focus to the button after a pick — it does not fall to the page (#219)", async () => {
    const user = userEvent.setup();
    render(<ModelPicker onSettings={() => {}} />);
    await user.click(button());
    await user.keyboard("{ArrowDown}{Enter}");
    expect(settings().auth).toBe("api-key");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button()).toHaveFocus();
  });
});
