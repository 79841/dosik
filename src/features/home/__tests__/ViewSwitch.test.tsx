import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useAppStore } from "../../library/appStore";
import { useHomeMode } from "../homeMode";
import { ViewSwitch } from "../ViewSwitch";

const radio = (name: string) => screen.getByRole("radio", { name });

describe("view switch (#221 D1, T31 · #231 D4, T12)", () => {
  beforeEach(() => {
    localStorage.clear();
    useHomeMode.setState({ mode: "cards" });
    useAppStore.setState({ homeView: { kind: "folder", folder: "f" } });
  });

  it("radiogroup 'View' — Cards·Canvas, the chosen one is aria-checked", () => {
    render(<ViewSwitch />);
    expect(screen.getByRole("radiogroup", { name: "View" })).toBeInTheDocument();
    expect(radio("Cards")).toHaveAttribute("aria-checked", "true");
    expect(radio("Canvas")).toHaveAttribute("aria-checked", "false");
  });

  it("only the chosen one is a tab stop", () => {
    render(<ViewSwitch />);
    expect(radio("Cards")).toHaveAttribute("tabindex", "0");
    expect(radio("Canvas")).toHaveAttribute("tabindex", "-1");
  });

  it("pressing calls setMode — homeView unchanged", () => {
    render(<ViewSwitch />);
    fireEvent.click(radio("Canvas"));
    expect(useHomeMode.getState().mode).toBe("canvas");
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "f" });
  });

  it("←→ moves and chooses — focus follows to the chosen radio", () => {
    render(<ViewSwitch />);
    fireEvent.keyDown(radio("Cards"), { key: "ArrowRight" });
    expect(useHomeMode.getState().mode).toBe("canvas");
    expect(radio("Canvas")).toHaveFocus();
    fireEvent.keyDown(radio("Canvas"), { key: "ArrowLeft" });
    expect(useHomeMode.getState().mode).toBe("cards");
    expect(radio("Cards")).toHaveFocus();
    // wraps around
    fireEvent.keyDown(radio("Cards"), { key: "ArrowLeft" });
    expect(useHomeMode.getState().mode).toBe("canvas");
  });

  it("one look — frame track, chosen is surface·600·ink·shadow-segment, the rest 500·icon (D4)", () => {
    render(<ViewSwitch />);
    expect(screen.getByRole("radiogroup")).toHaveClass(
      "bg-frame",
      "p-0.5",
      "gap-0.5",
      "rounded-[7px]",
    );
    expect(radio("Cards")).toHaveClass(
      "h-6",
      "pl-2",
      "pr-2.5",
      "gap-1.5",
      "text-[12px]",
      "bg-surface",
      "font-semibold",
      "text-ink",
      "shadow-segment",
    );
    expect(radio("Canvas")).toHaveClass("font-medium", "text-icon", "hover:text-ink");
    expect(radio("Canvas")).not.toHaveClass("shadow-segment");
    // no island of its own any more (#231 D12)
    expect(document.querySelector("[data-board-island]")).toBeNull();
  });

  it("the chosen radio keeps focus — a re-render does not steal focus (#231 D4)", () => {
    const { rerender } = render(<ViewSwitch />);
    const canvas = radio("Canvas");
    canvas.focus();
    fireEvent.click(canvas);
    rerender(<ViewSwitch />);
    expect(radio("Canvas")).toBe(canvas);
    expect(canvas).toHaveFocus();
  });
});
