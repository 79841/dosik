import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pickDiagramPath, readDiagramFile, saveBinaryFile, saveTextFile } from "../file";

const mockedInvoke = vi.mocked(invoke);
const mockedSave = vi.mocked(save);
const mockedOpen = vi.mocked(open);

describe("saveTextFile", () => {
  beforeEach(() => {
    mockedInvoke.mockResolvedValue(undefined);
  });

  it("Saves straight away without a dialog when there is an existing path (presetPath)", async () => {
    const path = await saveTextFile("data", [], "x.txt", "/tmp/existing.txt");
    expect(path).toBe("/tmp/existing.txt");
    expect(mockedSave).not.toHaveBeenCalled();
    expect(mockedInvoke).toHaveBeenCalledWith("write_text_file", {
      path: "/tmp/existing.txt",
      contents: "data",
    });
  });

  it("Returns null and writes nothing when the dialog is cancelled", async () => {
    mockedSave.mockResolvedValue(null);
    const path = await saveTextFile("data", [], "x.txt");
    expect(path).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("Propagates a file write failure as an exception (Toolbar shows the error state)", async () => {
    mockedSave.mockResolvedValue("/tmp/x.txt");
    mockedInvoke.mockRejectedValue(new Error("/tmp/x.txt: permission denied"));
    await expect(saveTextFile("data", [], "x.txt")).rejects.toThrow("permission denied");
  });
});

describe("saveBinaryFile", () => {
  it("Passes the base64 payload to the binary write command", async () => {
    mockedSave.mockResolvedValue("/tmp/img.png");
    mockedInvoke.mockResolvedValue(undefined);
    const path = await saveBinaryFile("QUJD", [], "img.png");
    expect(path).toBe("/tmp/img.png");
    expect(mockedInvoke).toHaveBeenCalledWith("write_binary_file", {
      path: "/tmp/img.png",
      base64: "QUJD",
    });
  });
});

describe("pickDiagramPath · readDiagramFile — picking and reading are separate: an already-open path is not read again (#218 D9)", () => {
  it("null when the dialog is cancelled (non-string)", async () => {
    mockedOpen.mockResolvedValue(null);
    expect(await pickDiagramPath()).toBeNull();
  });

  it("Returns the chosen path as is — without reading it yet", async () => {
    mockedOpen.mockResolvedValue("/tmp/ok.dosik.json");
    expect(await pickDiagramPath()).toBe("/tmp/ok.dosik.json");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("offers .dosik first, the older .dosik.json and plain JSON still (#253 R11)", async () => {
    mockedOpen.mockResolvedValue("/tmp/ok.dosik");
    expect(await pickDiagramPath()).toBe("/tmp/ok.dosik");
    expect(mockedOpen).toHaveBeenLastCalledWith({
      multiple: false,
      filters: [
        { name: "Dosik Diagram", extensions: ["dosik", "dosik.json", "mdgram.json", "json"] },
      ],
    });
  });

  it("Rejects a file without nodes/edges arrays", async () => {
    mockedInvoke.mockResolvedValue(JSON.stringify({ hello: "world" }));
    await expect(readDiagramFile("/tmp/bad.json")).rejects.toThrow("Not a valid diagram file");
  });

  it("Rejects a multi-page document with a reason (#229 D2, T20)", async () => {
    mockedInvoke.mockResolvedValue(
      '{"version":2,"title":"Book","pages":[{"id":"p","name":"P","nodes":[],"edges":[]}]}',
    );
    await expect(readDiagramFile("/tmp/book.dosik.json")).rejects.toThrow(
      "This diagram has pages — Dosik now opens one-canvas diagrams only",
    );
  });

  it("Propagates a non-JSON file as a parse exception", async () => {
    mockedInvoke.mockResolvedValue("not-json{{{");
    await expect(readDiagramFile("/tmp/garbage.json")).rejects.toThrow();
  });

  it("Returns the document for a valid file", async () => {
    mockedInvoke.mockResolvedValue(
      JSON.stringify({ version: 1, title: "T", nodes: [], edges: [] }),
    );
    const doc = await readDiagramFile("/tmp/ok.dosik.json");
    expect(doc.title).toBe("T");
    expect(mockedInvoke).toHaveBeenCalledWith("read_text_file", { path: "/tmp/ok.dosik.json" });
  });
});
