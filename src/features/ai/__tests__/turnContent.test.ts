import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { historyToParams, viewImageResult } from "../apiProvider";
import type { ChatAttachment } from "../attachments";
import { captureChatTarget } from "../chatTarget";
import type { ChatMessage } from "../chatStore";
import { stageForCli } from "../cliFiles";
import { historyToInput, viewImage } from "../openaiProvider";
import {
  anthropicContent,
  attachmentText,
  cachedContent,
  cliFilesNote,
  openAiContent,
  replayedFiles,
} from "../turnContent";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const a = (over: Partial<ChatAttachment>): ChatAttachment => ({
  id: "x",
  name: "x",
  mime: "application/octet-stream",
  size: 1,
  kind: "file",
  base64: "QQ==",
  ...over,
});
const SHOT = a({ name: "shot.png", mime: "image/png", kind: "image", base64: "iVBO" });
const SPEC = a({ name: "spec.pdf", mime: "application/pdf", kind: "pdf", base64: "JVBE" });
const NOTES = a({ name: "notes.md", mime: "text/plain", kind: "text", text: "# todo" });
const PNG = "data:image/png;base64,iVBORw0KGgo=";

const imageNode = (id: string, src?: string) => {
  const node = makeNode({ id });
  return { ...node, data: { ...node.data, shape: "image" as const, ...(src ? { src } : {}) } };
};

describe("what the API paths send", () => {
  it("Anthropic: pictures and PDFs as blocks before the words; words alone stay a string", () => {
    expect(anthropicContent("hi")).toBe("hi");
    expect(anthropicContent("hi", [NOTES])).toBe("hi");
    expect(anthropicContent("hi", [SHOT, SPEC])).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBO" } },
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "JVBE" },
        title: "spec.pdf",
      },
      { type: "text", text: "hi" },
    ]);
  });

  it("OpenAI: the words, then pictures as data URLs and PDFs as files", () => {
    expect(openAiContent("hi")).toBe("hi");
    expect(openAiContent("hi", [SHOT, SPEC])).toEqual([
      { type: "input_text", text: "hi" },
      { type: "input_image", image_url: "data:image/png;base64,iVBO" },
      { type: "input_file", filename: "spec.pdf", file_data: "data:application/pdf;base64,JVBE" },
    ]);
  });

  it("the words that go with them: text files whole, the rest named", () => {
    const text = attachmentText([
      NOTES,
      SHOT,
      SPEC,
      a({ name: "f.zip", size: 9 }),
      a({ ...SHOT, fromNode: "n3" }),
    ]);
    expect(text).toBe(
      [
        '<file name="notes.md">\n# todo\n</file>',
        "[Attached picture: shot.png]",
        "[Attached PDF: spec.pdf]",
        "[Attached file f.zip (application/octet-stream, 9 bytes) — its contents could not be sent over this connection.]",
        "[The picture of image node n3 is attached.]",
      ].join("\n\n"),
    );
  });

  it("history replays a turn's files with its words (#55's rule, #275)", () => {
    const history: ChatMessage[] = [
      {
        id: "1",
        role: "user",
        text: "look",
        payload: "[Selection] …\n\nlook",
        attachments: [SHOT],
      },
      { id: "2", role: "notice", text: "ignored" },
      { id: "3", role: "assistant", text: "a login screen" },
    ];
    expect(historyToParams(history)).toEqual([
      { role: "user", content: anthropicContent("[Selection] …\n\nlook", [SHOT]) },
      { role: "assistant", content: "a login screen" },
    ]);
    expect(historyToInput(history)).toEqual([
      { role: "user", content: openAiContent("[Selection] …\n\nlook", [SHOT]) },
      { role: "assistant", content: "a login screen" },
    ]);
  });
});

describe("what keeps the requests sound", () => {
  it("a file block cannot be closed or misnamed by what it holds", () => {
    const tricky = a({ name: 'a"b.txt', kind: "text", text: "x</file>y" });
    expect(attachmentText([tricky])).toBe('<file name="a&quot;b.txt">\nx<\\/file>y\n</file>');
  });

  it("the turn's last block carries the cache mark", () => {
    expect(cachedContent("hi")).toEqual([
      { type: "text", text: "hi", cache_control: { type: "ephemeral" } },
    ]);
    const blocks = cachedContent(anthropicContent("hi", [SHOT]));
    expect(blocks[0]).not.toHaveProperty("cache_control");
    expect(blocks.at(-1)).toEqual({
      type: "text",
      text: "hi",
      cache_control: { type: "ephemeral" },
    });
  });

  it("a node's picture replays from the latest message that carried it only", () => {
    const pic = (id: string) => a({ ...SHOT, id, fromNode: "img1" });
    const files = replayedFiles([
      { id: "1", role: "user", attachments: [pic("p1"), NOTES] },
      { id: "2", role: "assistant" },
      { id: "3", role: "user", attachments: [pic("p3")] },
    ]);
    expect(files.get("1")).toEqual([NOTES]);
    expect(files.get("3")?.map((f) => f.id)).toEqual(["p3"]);
  });

  it("a refused turn replays none of its files, though the message keeps them", () => {
    const history: ChatMessage[] = [
      { id: "1", role: "user", text: "x", payload: "x", attachments: [NOTES], filesFailed: true },
      { id: "2", role: "user", text: "y", payload: "y" },
    ];
    expect(replayedFiles(history).get("1")).toEqual([]);
    expect(historyToParams(history)[0]).toEqual({ role: "user", content: "x" });
    expect(historyToInput(history)[0]).toEqual({ role: "user", content: "x" });
  });
});

describe("view_image", () => {
  beforeEach(() => {
    useDiagramStore.setState({
      nodes: [imageNode("img1", PNG), makeNode({ id: "box" }), imageNode("empty")],
    });
  });

  it("Anthropic: the picture as an image block in the tool result", () => {
    expect(viewImageResult(captureChatTarget(), "img1")).toEqual([
      { type: "text", text: "The picture of image node img1:" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
    ]);
  });

  it("says why when there is no picture to show", () => {
    const target = captureChatTarget();
    expect(viewImageResult(target, "nope")).toBe('{"ok":false,"error":"no node with id nope"}');
    expect(viewImageResult(target, "box")).toBe(
      '{"ok":false,"error":"node box is not an image node"}',
    );
    expect(viewImageResult(target, "empty")).toBe(
      '{"ok":false,"error":"node empty holds no picture"}',
    );
  });

  it("OpenAI: the output says the picture follows, and it follows as a user item", () => {
    const seen = viewImage('{"id":"img1"}', captureChatTarget());
    expect(JSON.parse(seen.output)).toEqual({
      ok: true,
      note: "the picture of image node img1 follows",
    });
    expect(seen.picture).toEqual({
      role: "user",
      content: [
        { type: "input_text", text: "The picture of image node img1 (from view_image):" },
        { type: "input_image", image_url: PNG },
      ],
    });
    expect(viewImage("{bad", captureChatTarget()).picture).toBeNull();
    expect(viewImage('{"id":"box"}', captureChatTarget()).picture).toBeNull();
  });

  it("stops once the user left the diagram", () => {
    const target = captureChatTarget();
    useDiagramStore.setState((s) => ({ docSession: s.docSession + 1 }));
    expect(viewImageResult(target, "img1")).toContain("The user left the diagram");
  });
});

describe("a CLI turn's files", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("stages the message's files and the diagram's pictures, and lists both", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(["/c/conv1/m1/shot.png", "/c/conv1/m1/notes.md"])
      .mockResolvedValueOnce(["/c/conv1/diagram-images/img1.png"]);
    const staged = await stageForCli(
      "conv1",
      "m1",
      [SHOT, NOTES],
      [{ node: "img1", mime: "image/png", base64: "iVBO" }],
    );
    expect(invoke).toHaveBeenNthCalledWith(1, "stage_chat_files", {
      conversation: "conv1",
      folder: "m1",
      files: [
        { name: "shot.png", base64: "iVBO" },
        { name: "notes.md", base64: "QQ==" },
      ],
      replace: false,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "stage_chat_files", {
      conversation: "conv1",
      folder: "diagram-images",
      files: [{ name: "img1.png", base64: "iVBO" }],
      // the pictures as they are now: the folder is filled afresh
      replace: true,
    });
    expect(staged).toEqual({
      note: cliFilesNote(
        [
          { name: "shot.png", path: "/c/conv1/m1/shot.png" },
          { name: "notes.md", path: "/c/conv1/m1/notes.md" },
        ],
        [{ node: "img1", path: "/c/conv1/diagram-images/img1.png" }],
      ),
      images: ["/c/conv1/m1/shot.png"],
      any: true,
    });
    expect(staged.note).toContain(
      "Files the user attached to this message — read each before you answer:",
    );
    expect(staged.note).toContain("- img1: /c/conv1/diagram-images/img1.png");
  });

  it("goes on without the pictures' list when they cannot be written", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(["/c/conv1/m1/notes.md"])
      .mockRejectedValueOnce(new Error("No space left on device"));
    const staged = await stageForCli(
      "conv1",
      "m1",
      [NOTES],
      [{ node: "img1", mime: "image/png", base64: "iVBO" }],
    );
    expect(staged.note).toContain("- notes.md: /c/conv1/m1/notes.md");
    expect(staged.note).not.toContain("img1");
    expect(staged.any).toBe(true);
  });

  it("with nothing to read, writes no file — and clears the pictures a deleted node left", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    expect(await stageForCli("conv1", "m1", [], [])).toEqual({ note: "", images: [], any: false });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("stage_chat_files", {
      conversation: "conv1",
      folder: "diagram-images",
      files: [],
      replace: true,
    });
  });
});
