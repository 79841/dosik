import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { SURFACE_DARK, SURFACE_LIGHT } from "../../../shared/lib/palette";
import { contrast } from "../../../test/designTokens";
import { renderVectorSvg } from "../../export/vectorSvg";
import { mountDiagramView, type ToolResult, type ViewHost } from "../diagramView";

/**
 * A host that shows the view but does not pass its tool calls on — Claude's
 * desktop app answers every one with a JSON-RPC internal error. The view's
 * own calls (Refresh, Open in Dosik, the redraw in the host's theme) all fail.
 */
const hostCantCall = () =>
  new McpError(ErrorCode.InternalError, "IPC not available for MCP tool call");

const DOC = makeDoc(
  [makeNode({ id: "a", label: "Build" }), makeNode({ id: "b", label: "Ship", y: 160 })],
  [makeEdge({ id: "e", source: "a", target: "b", label: "pass" })],
  "Flow",
);

/** what `render_diagram` sends the view today: drawn light (`theme: auto`), with no backdrop of its own */
const drawnLight = (): ToolResult => ({
  content: [{ type: "text", text: 'Showing "Flow" in the chat — 2 shapes, 1 connector.' }],
  structuredContent: {
    svg: renderVectorSvg(DOC, { theme: "light", responsive: true, background: false }),
    theme: "light",
    title: "Flow",
    shapes: 2,
    connectors: 1,
    target: { file: "/tmp/a.dosik.json" },
  },
});

const fakeHost = (theme: "light" | "dark") => {
  const callServerTool = vi.fn<ViewHost["callServerTool"]>(async () => {
    throw hostCantCall();
  });
  return { callServerTool, getHostContext: () => ({ theme }) };
};

/**
 * What the drawing is painted on: its own backdrop when it lays one
 * (`data-backdrop` names that backdrop's theme), otherwise the chat's page —
 * for a dark chat, the app's dark canvas stands in for it.
 */
const groundUnder = (view: HTMLElement, chat: "light" | "dark"): string => {
  const backdrop = view.getAttribute("data-backdrop");
  const theme = backdrop === "light" || backdrop === "dark" ? backdrop : chat;
  return (theme === "dark" ? SURFACE_DARK : SURFACE_LIGHT).canvasBg;
};

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
});

const settle = () => new Promise((r) => setTimeout(r, 0));
const alertText = () => root.querySelector('[role="alert"]')?.textContent ?? "";

describe("A host that shows the view but can't call tools", () => {
  it("Refresh says what went wrong and what to do — not the host's internal error", async () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult(drawnLight());
    (root.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement).click();
    await settle();
    // the drawing stays
    expect(root.querySelector(".dsk-stage > svg")).not.toBeNull();
    expect(alertText()).toMatch(/^Couldn't refresh — showing the last drawing\. /);
    expect(alertText()).not.toMatch(/MCP error|-32603|IPC/);
    // what to do instead, without naming a host — the view runs in any
    expect(alertText()).toMatch(/ask for it again in the chat/);
  });

  it("In a dark chat, the connectors and their arrowheads stand out from what they are painted on — not only the labels", async () => {
    const view = mountDiagramView(root, fakeHost("dark"));
    view.showResult(drawnLight());
    await settle();
    const shown = root.querySelector(".dsk-stage > svg");
    const line = shown?.querySelector("path.edge");
    const head = shown?.querySelector("marker path");
    expect(line?.getAttribute("stroke")).toBeTruthy();
    expect(head?.getAttribute("fill")).toBeTruthy();
    const ground = groundUnder(root, "dark");
    // non-text contrast (WCAG 1.4.11)
    expect(contrast(line?.getAttribute("stroke") as string, ground)).toBeGreaterThanOrEqual(3);
    expect(contrast(head?.getAttribute("fill") as string, ground)).toBeGreaterThanOrEqual(3);
  });

  it("A dark chat gets the dark drawing the result carries — on the chat's own page, no call (#251)", async () => {
    const host = fakeHost("dark");
    const view = mountDiagramView(root, host);
    const result = drawnLight();
    // what render_diagram sends a view now: the other theme alongside
    (result.structuredContent as Record<string, unknown>).alternate = {
      theme: "dark",
      svg: renderVectorSvg(DOC, { theme: "dark", responsive: true, background: false }),
    };
    view.showResult(result);
    await settle();
    expect(host.callServerTool).not.toHaveBeenCalled();
    expect(root.hasAttribute("data-backdrop")).toBe(false);
    const line = root.querySelector(".dsk-stage > svg path.edge");
    expect(
      contrast(line?.getAttribute("stroke") as string, SURFACE_DARK.canvasBg),
    ).toBeGreaterThanOrEqual(3);
    expect(alertText()).toBe("");
  });

  it("Open in Dosik says what went wrong and what to do — not the host's internal error", async () => {
    const view = mountDiagramView(root, fakeHost("light"));
    view.showResult(drawnLight());
    (root.querySelector('button[aria-label="Open in Dosik"]') as HTMLButtonElement).click();
    await settle();
    expect(alertText()).toBe(
      "Couldn't open in Dosik. The request didn't get through to Dosik; ask in the chat to open it.",
    );
  });
});
