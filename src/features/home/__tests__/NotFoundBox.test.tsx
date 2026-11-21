import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "../../../shared/lib/toastStore";
import { useAppStore } from "../../library/appStore";
import { DASHBOARD } from "../../library/homeView";
import type { FolderMeta } from "../../library/libraryApi";
import { useLibraryStore } from "../../library/libraryStore";
import { NotFoundBox, PATH_CHARS, shortPath } from "../NotFoundBox";

const mockedInvoke = vi.mocked(invoke);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);

const lost = (shown = "~/Projects/architecture"): FolderMeta => ({
  id: "arc",
  name: "architecture",
  updatedAt: 0,
  diagrams: [],
  folders: [],
  missing: true,
  path: "/Users/someone/Projects/architecture",
  shown,
});

describe("shortPath — a long path with its middle elided (#253 R7, Library-Missing)", () => {
  it("a path that fits stays whole", () => {
    expect(shortPath("~/Projects/architecture")).toBe("~/Projects/architecture");
    expect(shortPath("x".repeat(PATH_CHARS))).toBe("x".repeat(PATH_CHARS));
  });

  it("keeps the first folders that fit and the last name, … between — the canvas's ~/Projects/…/architecture", () => {
    expect(shortPath("~/Projects/clients/acme/2026/architecture")).toBe(
      "~/Projects/…/architecture",
    );
    expect(shortPath("/Volumes/Backup/old/projects/architecture")).toBe(
      "/Volumes/Backup/…/architecture",
    );
  });

  it("a last name too long to keep anything before it — the root and … before it; the box cuts the rest", () => {
    const name = "a-very-long-project-folder-name-indeed";
    expect(shortPath(`~/Work/deep/${name}`)).toBe(`~/…/${name}`);
  });

  it("a Windows path keeps its separators", () => {
    expect(shortPath("D:\\Archive\\clients\\acme\\2026\\architecture")).toBe(
      "D:\\Archive\\…\\architecture",
    );
  });
});

describe("the box that stands in for a project not found (#253 R7, Library-Missing)", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    useToastStore.getState().dismissAll();
    useLibraryStore.setState({ folders: [lost()], readFailed: false });
    useAppStore.setState({ view: "home", activeTab: null, homeView: DASHBOARD });
  });

  it("“Can't find this folder”, its last path in mono, and Locate…", () => {
    render(<NotFoundBox folder={lost()} size="cards" />);
    const title = screen.getByText("Can't find this folder");
    expect(title).toHaveClass("font-semibold", "text-ink", "text-[11px]");
    const path = screen.getByText("~/Projects/architecture");
    expect(path).toHaveClass("font-mono", "text-muted", "truncate", "text-[10px]");
    const box = title.parentElement!;
    expect(box).toHaveClass("bg-hover", "w-[212px]", "h-[92px]", "rounded-[6px]", "text-center");
    const locate = screen.getByRole("button", { name: "Locate…" });
    expect(locate).toHaveClass("bg-surface", "h-6", "text-[11px]", "font-semibold");
  });

  it("a long path is shown with its middle elided", () => {
    render(<NotFoundBox folder={lost("~/Projects/clients/acme/2026/architecture")} size="cards" />);
    expect(screen.getByText("~/Projects/…/architecture")).toBeInTheDocument();
  });

  it("on the board: board units, placed where its frame says, out of the Tab order", () => {
    render(
      <NotFoundBox
        folder={lost()}
        size="board"
        style={{ left: 20, top: 64, width: 304, height: 132 }}
        tabIndex={-1}
      />,
    );
    const box = screen.getByText("Can't find this folder").parentElement!;
    expect(box).toHaveClass("absolute", "rounded-[8px]");
    expect(box).toHaveStyle({ left: "20px", top: "64px", width: "304px", height: "132px" });
    expect(screen.getByText("Can't find this folder")).toHaveClass("text-[16px]");
    expect(screen.getByText("~/Projects/architecture")).toHaveClass("text-[14px]");
    expect(screen.getByRole("button", { name: "Locate…" })).toHaveAttribute("tabindex", "-1");
  });

  it("Locate… asks Rust for the folder picker; once located, the caller hears of it with the screen it was asked from", async () => {
    mockedInvoke.mockImplementation(async (cmd) =>
      cmd === "locate_project" ? "located" : cmd === "list_library" ? [] : undefined,
    );
    const onLocated = vi.fn();
    render(<NotFoundBox folder={lost()} size="cards" onLocated={onLocated} />);
    fireEvent.click(screen.getByRole("button", { name: "Locate…" }));
    await waitFor(() => expect(onLocated).toHaveBeenCalledTimes(1));
    expect(calls("locate_project")[0]![1]).toEqual({ id: "arc" });
    expect(onLocated.mock.calls[0]![0]).toMatchObject({ view: "home", homeView: DASHBOARD });
  });

  it("cancelled or already in the library — the caller hears nothing", async () => {
    mockedInvoke.mockImplementation(async (cmd) =>
      cmd === "locate_project" ? "already" : undefined,
    );
    const onLocated = vi.fn();
    render(<NotFoundBox folder={lost()} size="cards" onLocated={onLocated} />);
    fireEvent.click(screen.getByRole("button", { name: "Locate…" }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual([
        "Already in the library",
      ]),
    );
    expect(onLocated).not.toHaveBeenCalled();
  });
});
