import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../settingsStore";

const reset = () =>
  useSettingsStore.setState({
    open: false,
    section: "General",
    lastSection: "General",
    returnTo: null,
    focus: null,
  });

describe("settings dialog store (#252)", () => {
  beforeEach(reset);

  it("opens on General the first time", () => {
    useSettingsStore.getState().openSettings();
    expect(useSettingsStore.getState()).toMatchObject({ open: true, section: "General" });
  });

  it("opens on the section it was asked for", () => {
    useSettingsStore.getState().openSettings("AI assistant");
    expect(useSettingsStore.getState().section).toBe("AI assistant");
  });

  it("opens again on the section it was last on", () => {
    const s = useSettingsStore.getState();
    s.openSettings();
    s.showSection("Integrations");
    s.closeSettings();
    expect(useSettingsStore.getState().open).toBe(false);
    useSettingsStore.getState().openSettings();
    expect(useSettingsStore.getState().section).toBe("Integrations");
  });

  it("remembers what had focus when it opened, unless told", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    useSettingsStore.getState().openSettings();
    expect(useSettingsStore.getState().returnTo).toBe(button);
    const other = document.createElement("button");
    useSettingsStore.getState().closeSettings();
    useSettingsStore.getState().openSettings("AI assistant", { returnTo: other });
    expect(useSettingsStore.getState().returnTo).toBe(other);
    button.remove();
  });

  it("carries a focus request for the section to take, once", () => {
    useSettingsStore.getState().openSettings("AI assistant", { focus: "key-claude" });
    expect(useSettingsStore.getState().focus).toBe("key-claude");
    useSettingsStore.getState().takeFocus();
    expect(useSettingsStore.getState().focus).toBeNull();
  });
});
