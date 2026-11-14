import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import type { ChatMessage } from "../chatStore";
import { captureChatTarget } from "../chatTarget";
import {
  historyToInput,
  MAX_TOOL_ROUNDS,
  OPENAI_RESPONSES_URL,
  OPENAI_TOOLS,
  sendWithOpenAi,
} from "../openaiProvider";

const msg = (role: ChatMessage["role"], text: string, payload?: string): ChatMessage => ({
  id: text,
  role,
  text,
  ...(payload ? { payload } : {}),
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const textOutput = (id: string, text: string) => ({
  id,
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
});

describe("openaiProvider (#119)", () => {
  const callbacks = { onText: vi.fn(), onActivity: vi.fn() };
  beforeEach(() => {
    useDiagramStore
      .getState()
      .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
    callbacks.onText.mockReset();
    callbacks.onActivity.mockReset();
  });

  it("historyToInput: payload for user, text for assistant, everything else dropped", () => {
    const input = historyToInput([
      msg("user", "make it blue", "[Selection] n1\nmake it blue"),
      msg("activity", "Edited diagram"),
      msg("assistant", "Done."),
      msg("error", "boom"),
      msg("user", "again"),
    ]);
    expect(input).toEqual([
      { role: "user", content: "[Selection] n1\nmake it blue" },
      { role: "assistant", content: "Done." },
      { role: "user", content: "again" },
    ]);
  });

  it("first request: carries instructions, tools, history + the current turn, and text goes to onText", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(textOutput("r1", "Hello there")));
    await sendWithOpenAi(
      "sk-o",
      "gpt-5.6-sol",
      [msg("assistant", "earlier")],
      "hi",
      callbacks,
      fetchMock,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(OPENAI_RESPONSES_URL);
    expect(init.headers.Authorization).toBe("Bearer sk-o");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.instructions).toContain("read_diagram");
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual(["read_diagram", "apply_ops"]);
    expect(body.input).toEqual([
      { role: "assistant", content: "earlier" },
      { role: "user", content: "hi" },
    ]);
    expect(callbacks.onText).toHaveBeenCalledWith("Hello there");
  });

  it("function_call → tool run → only function_call_output goes in the next request, with previous_response_id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "r1",
          output: [
            { type: "function_call", name: "read_diagram", arguments: "{}", call_id: "c1" },
            {
              type: "function_call",
              name: "apply_ops",
              arguments: JSON.stringify({
                ops: [{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }],
              }),
              call_id: "c2",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(textOutput("r2", "Added a node.")));

    await sendWithOpenAi("sk-o", "gpt-5.6-sol", [], "add a node", callbacks, fetchMock);

    expect(useDiagramStore.getState().nodes.map((n) => n.id)).toEqual(["a"]);
    expect(useDiagramStore.getState().touched.a).toBeDefined();
    expect(callbacks.onActivity).toHaveBeenCalledWith("Edited diagram — 1 operation applied");
    const second = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(second.previous_response_id).toBe("r1");
    expect(second.input).toHaveLength(2);
    expect(second.input[0]).toMatchObject({ type: "function_call_output", call_id: "c1" });
    expect(JSON.parse(second.input[0].output).nodes).toEqual([]);
    expect(JSON.parse(second.input[1].output)).toEqual({ applied: 1, errors: [] });
    expect(callbacks.onText).toHaveBeenCalledWith("Added a node.");
  });

  it("stops editing and sends no further round once the user leaves the diagram (#167)", async () => {
    const target = captureChatTarget();
    // the user went Home while the model was thinking
    useDiagramStore.getState().loadDoc({ version: 1, title: "Other", nodes: [], edges: [] }, null);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        id: "r1",
        output: [
          {
            type: "function_call",
            name: "apply_ops",
            arguments: JSON.stringify({
              ops: [{ op: "add_node", node: { label: "A", x: 0, y: 0 } }],
            }),
            call_id: "c1",
          },
        ],
      }),
    );
    await sendWithOpenAi("k", "m", [], "draw", callbacks, fetchMock, target);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useDiagramStore.getState().nodes).toEqual([]);
    expect(target.stopped).toContain("you left the diagram");
    expect(callbacks.onText).not.toHaveBeenCalled();
  });

  it("returns placeholders instead of images from read_diagram — so base64 does not fill the context (#155)", async () => {
    const png = `data:image/png;base64,${"A".repeat(40_000)}`;
    useDiagramStore
      .getState()
      .applyOps([
        { op: "add_node", node: { id: "i", label: "shot", shape: "image", src: png, x: 0, y: 0 } },
      ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "r1",
          output: [{ type: "function_call", name: "read_diagram", arguments: "{}", call_id: "c1" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(textOutput("r2", "ok")));
    await sendWithOpenAi("sk-o", "gpt-5.6-sol", [], "look", callbacks, fetchMock);
    const output = JSON.parse(fetchMock.mock.calls[1]![1].body).input[0].output as string;
    expect(output).not.toContain(png);
    expect(JSON.parse(output).nodes[0].data.src).toBe("elided:image/png;29KB");
  });

  it("sends only the previous round's output in each request across two tool rounds — no resending", async () => {
    const call = (name: string, id: string) => ({
      type: "function",
      name,
      arguments: "{}",
      call_id: id,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "r1",
          output: [{ ...call("read_diagram", "c1"), type: "function_call" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "r2",
          output: [{ ...call("read_diagram", "c2"), type: "function_call" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(textOutput("r3", "ok")));
    await sendWithOpenAi("k", "m", [], "x", callbacks, fetchMock);
    const second = JSON.parse(fetchMock.mock.calls[1]![1].body);
    const third = JSON.parse(fetchMock.mock.calls[2]![1].body);
    expect(second.previous_response_id).toBe("r1");
    expect(second.input.map((i: { call_id: string }) => i.call_id)).toEqual(["c1"]);
    expect(third.previous_response_id).toBe("r2");
    expect(third.input.map((i: { call_id: string }) => i.call_id)).toEqual(["c2"]);
  });

  it("shows a refusal as is — it does not turn into Done.", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        id: "r1",
        output: [
          { type: "message", content: [{ type: "refusal", refusal: "I can't help with that." }] },
        ],
      }),
    );
    await sendWithOpenAi("k", "m", [], "x", callbacks, fetchMock);
    expect(callbacks.onText).toHaveBeenCalledWith("I can't help with that.");
    expect(callbacks.onText).not.toHaveBeenCalledWith("Done.");
  });

  it("reports a network failure in one line", async () => {
    await expect(
      sendWithOpenAi(
        "k",
        "m",
        [],
        "x",
        callbacks,
        vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")),
      ),
    ).rejects.toThrow("Could not reach the OpenAI API (Failed to fetch)");
  });

  it("says an incomplete response was cut off and stops", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        id: "r1",
        status: "incomplete",
        output: [{ type: "function_call", name: "read_diagram", arguments: "{}", call_id: "c1" }],
      }),
    );
    await sendWithOpenAi("k", "m", [], "x", callbacks, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(callbacks.onText).toHaveBeenCalledWith(expect.stringContaining("cut off"));
  });

  it("has no strict in the tool definitions, and read_diagram has required: []", () => {
    const [read, apply] = OPENAI_TOOLS as {
      name: string;
      strict?: boolean;
      parameters: { required?: string[] };
    }[];
    expect(read!.strict).toBeUndefined();
    expect(apply!.strict).toBeUndefined();
    expect(read!.parameters.required).toEqual([]);
  });

  it("reports a 200 with a non-JSON body in one line", async () => {
    await expect(
      sendWithOpenAi(
        "k",
        "m",
        [],
        "x",
        callbacks,
        vi.fn().mockResolvedValueOnce(new Response("<html>", { status: 200 })),
      ),
    ).rejects.toThrow("unreadable response");
  });

  it("shows both when text and refusal arrive together", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        id: "r1",
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: "Partly." },
              { type: "refusal", refusal: "Not that part." },
            ],
          },
        ],
      }),
    );
    await sendWithOpenAi("k", "m", [], "x", callbacks, fetchMock);
    expect(callbacks.onText).toHaveBeenCalledWith("Partly.\nNot that part.");
  });

  it("returns Done. when no text ever arrives", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ id: "r1", output: [] }));
    await sendWithOpenAi("sk-o", "m", [], "x", callbacks, fetchMock);
    expect(callbacks.onText).toHaveBeenCalledWith("Done.");
  });

  it("returns broken arguments as a tool error and keeps the loop going", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "r1",
          output: [{ type: "function_call", name: "apply_ops", arguments: "{oops", call_id: "c1" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(textOutput("r2", "Sorry.")));
    await sendWithOpenAi("sk-o", "m", [], "x", callbacks, fetchMock);
    const second = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(JSON.parse(second.input[0].output).errors[0]).toContain("not valid JSON");
  });

  it("maps 401 to a key hint, 429 to the limit, and anything else to status code and message", async () => {
    await expect(
      sendWithOpenAi(
        "bad",
        "m",
        [],
        "x",
        callbacks,
        vi.fn().mockResolvedValueOnce(jsonResponse({ error: { message: "nope" } }, 401)),
      ),
    ).rejects.toThrow("Invalid OpenAI API key");
    await expect(
      sendWithOpenAi(
        "k",
        "m",
        [],
        "x",
        callbacks,
        vi.fn().mockResolvedValueOnce(jsonResponse({ error: { message: "slow down" } }, 429)),
      ),
    ).rejects.toThrow("rate limit or quota reached: slow down");
    await expect(
      sendWithOpenAi(
        "k",
        "m",
        [],
        "x",
        callbacks,
        vi.fn().mockResolvedValueOnce(new Response("gateway", { status: 502 })),
      ),
    ).rejects.toThrow("OpenAI API error 502");
  });

  it("stops at the cap even when tool calls go on forever", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      jsonResponse({
        id: "r",
        output: [{ type: "function_call", name: "read_diagram", arguments: "{}", call_id: "c" }],
      }),
    );
    await sendWithOpenAi("k", "m", [], "x", callbacks, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
    expect(callbacks.onText).toHaveBeenCalledWith("Done.");
  });
});
