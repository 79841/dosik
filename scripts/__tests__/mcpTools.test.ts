import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createLibrary } from "../mcp/library.mjs";
import { applyOpsSchema, loadSpec, opNames } from "../mcp/opSchema.mjs";
import { HEADLESS_FORMATS, WINDOWED_FORMATS } from "../../src/features/headless/cli";
import { DRAWING_META_KEY as VIEW_DRAWING_KEY } from "../../src/features/mcp-view/diagramView";
import { elideImages as elideImagesTs } from "../../src/shared/lib/imageData";
import {
  DRAWING_META_KEY,
  elideImages,
  FILE_FORMATS,
  liveDeps,
  McpResult,
  runTool,
  ToolError,
  toolDefinitions,
  WINDOWED,
} from "../mcp/tools.mjs";

const ready = { state: "ready" as const };

const VIEW = {
  title: "Flow",
  shapes: 3,
  connectors: 2,
};

const deps = (overrides: Record<string, unknown> = {}) => ({
  resolvePort: () => 4517,
  probeBridge: vi.fn(async () => ready),
  sendOps: vi.fn(async () => ({ status: 200, body: { ok: true, applied: 1, errors: [] } })),
  readDiagram: vi.fn(async () => ({ nodes: [], edges: [] })),
  readApi: vi.fn(async () => ({ endpoints: {} })),
  exportFile: vi.fn(async (_port: number, path: string) => ({ written: path })),
  renderSvg: vi.fn(async () => ({
    svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    view: VIEW,
  })),
  fileMode: {
    read: vi.fn(async () => ({ nodes: [{ id: "a" }], edges: [] })),
    apply: vi.fn(async () => ({ ok: true, applied: 1, errors: [], written: true })),
    exportTo: vi.fn(async (_file: string, path: string) => ({ written: path })),
  },
  openInApp: vi.fn(async (file: string) => ({ opened: file })),
  ...overrides,
});

describe("MCP tools (#2)", () => {
  it("has six tools for a diagram — not one per op — and five for the library", () => {
    // ops are already one language defined by the spec. Spreading them over 11
    // tools would write that spec in two places. The fifth is an explicit tool
    // that opens a file in the app (#149). The library's projects are folders,
    // and their tools work on folders (#253)
    expect(toolDefinitions().map((t) => t.name)).toEqual([
      "get_diagram",
      "apply_ops",
      "describe_ops",
      "export_diagram",
      "open_in_dosik",
      "render_diagram",
      "list_projects",
      "add_project",
      "list_project",
      "create_folder",
      "create_diagram",
    ]);
  });

  it("runs the library tools on the library it is given — without the app", async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "dosik-mcp-tools-")));
    try {
      const folder = join(base, "Lib");
      mkdirSync(join(folder, "P"), { recursive: true });
      const library = createLibrary({
        bundleId: "app.test",
        env: { DOSIK_APP_DATA: join(base, "data"), DOSIK_LIBRARY_DIR: folder },
        home: join(base, "home"),
      });
      const d = deps({ library, probeBridge: vi.fn(async () => ({ state: "down" })) });
      await expect(runTool("list_projects", {}, d)).resolves.toEqual({
        libraryFolder: folder,
        projects: [{ name: "P", path: join(folder, "P"), missing: false }],
      });
      await expect(
        runTool("create_diagram", { path: join(folder, "P"), title: "Flow" }, d),
      ).resolves.toEqual({ path: join(folder, "P", "Flow.dosik"), name: "Flow" });
      expect(d.probeBridge).not.toHaveBeenCalled();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("says so when a library tool runs on a server with no library", async () => {
    await expect(runTool("list_projects", {}, deps())).rejects.toThrow(/no library/);
  });

  it("says in the library tools' descriptions that they need no app", () => {
    for (const name of [
      "list_projects",
      "add_project",
      "list_project",
      "create_folder",
      "create_diagram",
    ]) {
      const tool = toolDefinitions().find((t) => t.name === name);
      expect(tool?.description, name).toMatch(/without the Dosik app/);
    }
  });

  it("derives the apply_ops schema from openapi.yaml — not written by hand", () => {
    const spec = loadSpec();
    const schema = applyOpsSchema(spec);
    expect(schema.properties.ops.items).toEqual({ $ref: "#/$defs/Op" });

    // when the spec gains an op, the schema grows with it: every definition the
    // discriminator points to must be inside $defs
    const mapping = spec.components.schemas.Op.discriminator.mapping as Record<string, string>;
    for (const [name, ref] of Object.entries(mapping)) {
      const defName = ref.replace("#/components/schemas/", "");
      expect(Object.keys(schema.$defs)).toContain(defName);
      expect(schema.properties.ops.description).toContain(name);
    }
    // were OpenAPI $refs rewritten to JSON Schema form — a single leftover one
    // and clients cannot resolve it
    expect(JSON.stringify(schema)).not.toContain("#/components/schemas/");
    expect(opNames(spec).length).toBeGreaterThan(5);
  });

  it("lists new_diagram and none of the four page ops — spec, store and Rust summary agree (#229 D15, T31)", () => {
    const spec = loadSpec();
    const names = opNames(spec);
    expect(names).toContain("new_diagram");
    for (const gone of ["add_page", "switch_page", "rename_page", "delete_page"]) {
      expect(names).not.toContain(gone);
    }
    const schemas = spec.components.schemas as Record<string, unknown>;
    for (const gone of [
      "AddPageOp",
      "SwitchPageOp",
      "RenamePageOp",
      "DeletePageOp",
      "DiagramBook",
    ]) {
      expect(schemas).not.toHaveProperty(gone);
    }
    expect(schemas).toHaveProperty("NewDiagramOp");
    // the project a snapshot names carries the folders it is in
    const ref = schemas.ProjectRef as { oneOf: { properties?: Record<string, unknown> }[] };
    expect(ref.oneOf.find((branch) => branch.properties)?.properties).toHaveProperty("path");
    // apply_ops says what new_diagram does, and that a file has none of it
    const apply = toolDefinitions().find((t) => t.name === "apply_ops")!;
    expect(apply.description).toContain(
      "`new_diagram` starts another diagram in the app (not with `file`)",
    );
  });

  it("parses openapi.yaml", () => {
    // when this work started the spec was not valid YAML: the parser read
    // `shape: icon` inside an unquoted description as a nested mapping
    expect(() => loadSpec()).not.toThrow();
  });

  it("leaves the app alone for empty ops", async () => {
    const d = deps();
    await expect(runTool("apply_ops", { ops: [] }, d)).rejects.toThrow(ToolError);
    expect(d.probeBridge).not.toHaveBeenCalled();
  });

  it("passes on the bridge's reason when it rejects", async () => {
    const d = deps({
      sendOps: vi.fn(async () => ({
        status: 200,
        body: { ok: false, errors: ["add_node: missing x"] },
      })),
    });
    await expect(runTool("apply_ops", { ops: [{ op: "clear" }] }, d)).rejects.toThrow(/missing x/);
  });

  it("asks for a check rather than a retry when the apply is unconfirmed", async () => {
    // the bridge's 202 is not "failed" but "handed to the window, no confirmation
    // within 3 seconds". Re-sending would apply the same edit twice — an add_node
    // without an id makes one more shape in the same place
    const d = deps({
      sendOps: vi.fn(async () => ({ status: 202, body: { ok: true, queued: true } })),
    });
    const result = (await runTool("apply_ops", { ops: [{ op: "clear" }] }, d)) as {
      queued: boolean;
      note: string;
    };
    expect(result.queued).toBe(true);
    expect(result.note).toMatch(/get_diagram/);
    expect(result.note).toMatch(/do not re-send/);
  });

  it("takes the format list from the headless CLI — never copies it", () => {
    // the same argument as for the op schema applies here, except nothing used to
    // catch drift on this side (#2)
    expect(FILE_FORMATS).toEqual([...HEADLESS_FORMATS]);
    expect(WINDOWED).toEqual([...WINDOWED_FORMATS]);
  });

  it("rejects relative paths — they silently create files inside the repo", async () => {
    const d = deps();
    await expect(runTool("export_diagram", { path: "diagram.mmd" }, d)).rejects.toThrow(
      /must be absolute/,
    );
    expect(d.exportFile).not.toHaveBeenCalled();
  });

  it("leaves no OpenAPI-only keywords in the generated schema", () => {
    // validators silently ignore unknown keywords. If `nullable: true` came
    // through as is, destroyY's null would vanish from the schema (#2)
    const json = JSON.stringify(applyOpsSchema(loadSpec()));
    for (const keyword of ["nullable", '"example"', '"xml"']) {
      expect(json).not.toContain(keyword);
    }
  });

  it("advertises that destroyY accepts null", () => {
    // so clearing a UML destroy marker does not go missing on the MCP path alone
    const schema = applyOpsSchema(loadSpec()) as {
      $defs: { NodePatch: { properties: { destroyY: { type: unknown } } } };
    };
    expect(schema.$defs.NodePatch.properties.destroyY.type).toEqual(["number", "null"]);
  });

  it("does not launch the app when it is closed — asks for it to be opened", async () => {
    // this server is a helper process the client starts and stops per conversation.
    // Opening the user's window is not its job — the same goes for Figma, Blender and draw.io
    const d = deps({ probeBridge: vi.fn(async () => ({ state: "down" })) });
    await expect(runTool("get_diagram", {}, d)).rejects.toThrow(ToolError);
    await expect(runTool("get_diagram", {}, d)).rejects.toThrow(/not running.*Open the Dosik app/s);
    expect(d.readDiagram).not.toHaveBeenCalled();
  });

  it("leaves the app alone for edits and exports when it is closed", async () => {
    const d = deps({ probeBridge: vi.fn(async () => ({ state: "down" })) });
    await expect(runTool("apply_ops", { ops: [{ op: "clear" }] }, d)).rejects.toThrow(
      /not running/,
    );
    await expect(runTool("export_diagram", { path: "/tmp/x.md" }, d)).rejects.toThrow(
      /not running/,
    );
    expect(d.sendOps).not.toHaveBeenCalled();
    expect(d.exportFile).not.toHaveBeenCalled();
  });

  it("says in the description which tools need the app — not only after they fail", () => {
    const byName = Object.fromEntries(toolDefinitions().map((t) => [t.name, t.description]));
    for (const name of ["get_diagram", "apply_ops", "export_diagram"]) {
      expect(byName[name]).toMatch(/Without `file`, requires the Dosik app to be open/);
    }
    // what can be used is answered without the app
    expect(byName.describe_ops).not.toMatch(/Requires the Dosik app/);
  });

  it("answers describe_ops from the spec even when the app is closed", async () => {
    const d = deps({ probeBridge: vi.fn(async () => ({ state: "down" })) });
    const result = (await runTool("describe_ops", {}, d)) as {
      ops: string[];
      schema: { $defs: Record<string, unknown> };
      bridge?: unknown;
    };
    expect(result.ops).toEqual(opNames(loadSpec()));
    expect(result.schema.$defs).toHaveProperty("PaletteColor");
    expect(result.bridge).toBeUndefined();
    expect(d.readApi).not.toHaveBeenCalled();
  });

  it("adds the bridge's examples to describe_ops when the app is open", async () => {
    const d = deps();
    const result = (await runTool("describe_ops", {}, d)) as { ops: string[]; bridge?: unknown };
    expect(result.ops.length).toBeGreaterThan(0);
    expect(result.bridge).toEqual({ endpoints: {} });
  });

  it("says so when someone else holds the port", async () => {
    const d = deps({
      probeBridge: vi.fn(async () => ({ state: "foreign", detail: "vite" })),
    });
    await expect(runTool("get_diagram", {}, d)).rejects.toThrow(/DOSIK_PORT/);
    expect(d.readDiagram).not.toHaveBeenCalled();
  });

  it("rejects PNG with a reason — SVG is drawn without a window (#148)", async () => {
    const d = deps();
    for (const ext of ["png"]) {
      await expect(runTool("export_diagram", { path: `/tmp/a.${ext}` }, d)).rejects.toThrow(
        /rendered canvas/,
      );
    }
    // a rejection does nothing — not even launch the app
    expect(d.probeBridge).not.toHaveBeenCalled();
    expect(d.exportFile).not.toHaveBeenCalled();
  });

  it("exports a supported format", async () => {
    for (const format of FILE_FORMATS) {
      // an older .dosik.json only where one is: written over in place
      const d = deps({ exists: () => true });
      const path = `/tmp/a.${format}`;
      await expect(runTool("export_diagram", { path }, d)).resolves.toEqual({ written: path });
      expect(d.exportFile).toHaveBeenCalledWith(4517, path);
    }
  });

  it("never makes a new .dosik.json — a new file is a .dosik", async () => {
    const d = deps({ exists: () => false });
    for (const args of [
      { path: "/tmp/new.dosik.json" },
      { file: "/tmp/a.dosik", path: "/tmp/New.DOSIK.JSON" },
    ]) {
      await expect(runTool("export_diagram", args, d)).rejects.toThrow(
        /A new diagram file is a `\.dosik`/,
      );
    }
    expect(d.exportFile).not.toHaveBeenCalled();
    expect(d.fileMode.exportTo).not.toHaveBeenCalled();
    await expect(runTool("export_diagram", { path: "/tmp/new.dosik.json" }, d)).rejects.toThrow(
      "Use /tmp/new.dosik instead",
    );
  });

  it("lists the supported formats for an unknown one", async () => {
    await expect(runTool("export_diagram", { path: "/tmp/a.docx" }, deps())).rejects.toThrow(
      /available: md, mmd, dosik, dosik\.json, svg/,
    );
    // PowerPoint export is gone (#192)
    await expect(runTool("export_diagram", { path: "/tmp/a.pptx" }, deps())).rejects.toThrow(
      /Unknown format: \.pptx/,
    );
  });

  describe("file mode — the target is explicit in the arguments (#149)", () => {
    const FILE = "/tmp/plan.dosik";

    it("advertises a file argument on read, edit and export", () => {
      const byName = Object.fromEntries(toolDefinitions().map((t) => [t.name, t.inputSchema]));
      for (const name of ["get_diagram", "apply_ops", "export_diagram", "render_diagram"]) {
        const props = (byName[name] as { properties: Record<string, { description?: string }> })
          .properties;
        expect(props.file?.description).toMatch(/`\.dosik`/);
        // a model that has never seen the format learns it is the document it reads
        expect(props.file?.description).toContain(
          "A `.dosik` file is JSON (the same document as get_diagram)",
        );
      }
    });

    it("does not even look for the app when file is given", async () => {
      const d = deps({ probeBridge: vi.fn(async () => ({ state: "down" })) });
      await expect(runTool("get_diagram", { file: FILE }, d)).resolves.toEqual({
        nodes: [{ id: "a" }],
        edges: [],
      });
      await runTool("apply_ops", { file: FILE, ops: [{ op: "clear" }] }, d);
      await runTool("export_diagram", { file: FILE, path: "/tmp/plan.md" }, d);
      expect(d.probeBridge).not.toHaveBeenCalled();
      expect(d.fileMode.read).toHaveBeenCalledWith(FILE);
      expect(d.fileMode.apply).toHaveBeenCalledWith(FILE, [{ op: "clear" }]);
      expect(d.fileMode.exportTo).toHaveBeenCalledWith(FILE, "/tmp/plan.md");
      expect(d.sendOps).not.toHaveBeenCalled();
    });

    it("returns edit results in the bridge's shape, tagged with the file", async () => {
      await expect(
        runTool("apply_ops", { file: FILE, ops: [{ op: "clear" }] }, deps()),
      ).resolves.toEqual({ ok: true, applied: 1, errors: [], file: FILE });
    });

    it("reports a rejected file edit in the bridge's wording — the file is untouched", async () => {
      const d = deps({
        fileMode: {
          ...deps().fileMode,
          apply: vi.fn(async () => ({
            ok: false,
            applied: 0,
            errors: ["add_node: color must be one of violet"],
            written: false,
          })),
        },
      });
      await expect(runTool("apply_ops", { file: FILE, ops: [{ op: "clear" }] }, d)).rejects.toThrow(
        /Rejected: add_node: color.*file was not changed/s,
      );
    });

    it("requires file to be an absolute .dosik path", async () => {
      const d = deps();
      await expect(runTool("get_diagram", { file: "plan.dosik" }, d)).rejects.toThrow(/absolute/);
      await expect(runTool("get_diagram", { file: "/tmp/plan.json" }, d)).rejects.toThrow(
        /`\.dosik`/,
      );
      await expect(runTool("get_diagram", { file: "/tmp/plan.dosikx" }, d)).rejects.toThrow(
        /`\.dosik`/,
      );
      await expect(runTool("get_diagram", { file: 3 }, d)).rejects.toThrow(/string/);
      expect(d.fileMode.read).not.toHaveBeenCalled();
    });

    it("still takes an older .dosik.json — read, edited and exported where it is", async () => {
      const d = deps();
      const old = "/tmp/Old Plan.DOSIK.JSON";
      await runTool("get_diagram", { file: old }, d);
      await runTool("apply_ops", { file: old, ops: [{ op: "clear" }] }, d);
      await runTool("export_diagram", { file: old, path: "/tmp/plan.svg" }, d);
      expect(d.fileMode.read).toHaveBeenCalledWith(old);
      expect(d.fileMode.apply).toHaveBeenCalledWith(old, [{ op: "clear" }]);
      expect(d.fileMode.exportTo).toHaveBeenCalledWith(old, "/tmp/plan.svg");
      await runTool("get_diagram", { file: "/tmp/UPPER.DOSIK" }, d);
      expect(d.fileMode.read).toHaveBeenCalledWith("/tmp/UPPER.DOSIK");
    });

    it("says a new file is a .dosik", () => {
      const tool = toolDefinitions().find((t) => t.name === "apply_ops");
      expect(tool?.description).toMatch(/a new file is a `\.dosik`/i);
    });

    it("exports to a .dosik — the document itself", async () => {
      const d = deps();
      await runTool("export_diagram", { file: FILE, path: "/tmp/copy.dosik" }, d);
      expect(d.fileMode.exportTo).toHaveBeenCalledWith(FILE, "/tmp/copy.dosik");
      const tool = toolDefinitions().find((t) => t.name === "export_diagram");
      expect(tool?.description).toMatch(/\bdosik\b/);
    });

    it("runs file-mode exports through the same format check", async () => {
      const d = deps();
      await expect(
        runTool("export_diagram", { file: FILE, path: "/tmp/a.png" }, d),
      ).rejects.toThrow(/rendered canvas/);
      expect(d.fileMode.exportTo).not.toHaveBeenCalled();
    });

    it("mentions the file argument in the app-closed message — without switching over silently", async () => {
      const d = deps({ probeBridge: vi.fn(async () => ({ state: "down" })) });
      await expect(runTool("get_diagram", {}, d)).rejects.toThrow(/pass `file`/);
      expect(d.fileMode.read).not.toHaveBeenCalled();
    });
  });

  describe("open_in_dosik (#149)", () => {
    it("opens the file in the installed app", async () => {
      const d = deps();
      await expect(runTool("open_in_dosik", { file: "/tmp/plan.dosik" }, d)).resolves.toMatchObject(
        { opened: "/tmp/plan.dosik" },
      );
      expect(d.openInApp).toHaveBeenCalledWith("/tmp/plan.dosik");
      // not through the bridge — the OS opens it
      expect(d.probeBridge).not.toHaveBeenCalled();
    });

    it("requires file and runs the same check", async () => {
      const d = deps();
      await expect(runTool("open_in_dosik", {}, d)).rejects.toThrow(/`file` is required/);
      await expect(runTool("open_in_dosik", { file: "a.dosik" }, d)).rejects.toThrow(/absolute/);
      expect(d.openInApp).not.toHaveBeenCalled();
    });

    it("says in the description that other tools must not call it as a side effect — only when the user asks", () => {
      const tool = toolDefinitions().find((t) => t.name === "open_in_dosik");
      expect(tool?.description).toMatch(/only when the user asks/);
    });

    it("takes a .dosik — says so in its description", () => {
      const tool = toolDefinitions().find((t) => t.name === "open_in_dosik") as {
        description: string;
        inputSchema: { properties: { file: { description: string } } };
      };
      expect(tool.description).toMatch(/`\.dosik`/);
      expect(tool.inputSchema.properties.file.description).toMatch(/`\.dosik`/);
    });

    it("mentions tabs in the description — opens as a new active tab, and edits without file go to the active tab (#218)", () => {
      const tool = toolDefinitions().find((t) => t.name === "open_in_dosik");
      expect(tool?.description).toMatch(/new tab and becomes the active one/);
      expect(tool?.description).toMatch(/go to the active tab/);
    });
  });

  describe("render_diagram — returns SVG drawn without a window (#148)", () => {
    it("draws without the app when file is given", async () => {
      const d = deps({ probeBridge: vi.fn(async () => ({ state: "down" })) });
      const out = await runTool("render_diagram", { file: "/tmp/a.dosik.json", theme: "dark" }, d);
      expect(out).toContain("<svg");
      expect(d.renderSvg).toHaveBeenCalledWith({ file: "/tmp/a.dosik.json", theme: "dark" });
      expect(d.probeBridge).not.toHaveBeenCalled();
    });

    it("draws the app canvas without file — and asks for the app when it is closed", async () => {
      const d = deps();
      await runTool("render_diagram", {}, d);
      // no theme means auto — it follows the theme of the surface it lands on (#202)
      expect(d.renderSvg).toHaveBeenCalledWith({ port: 4517, theme: "auto" });
      const down = deps({ probeBridge: vi.fn(async () => ({ state: "down" })) });
      await expect(runTool("render_diagram", {}, down)).rejects.toThrow(/not running/);
    });

    it("accepts only auto, light and dark for theme", async () => {
      await expect(runTool("render_diagram", { theme: "sepia" }, deps())).rejects.toThrow(
        /`theme` must be "auto", "light" or "dark"/,
      );
    });

    it("tells the model to render the result for the user — pasting it as text is useless", () => {
      const tool = toolDefinitions().find((t) => t.name === "render_diagram");
      expect(tool?.description).toMatch(/render the SVG/i);
      expect(tool?.description).toMatch(/no app/i);
    });
  });

  describe("hardening (#151)", () => {
    it("says to edit without file after open_in_dosik — the edits land on the open tab", async () => {
      const out = (await runTool("open_in_dosik", { file: "/tmp/plan.dosik" }, deps())) as {
        note: string;
      };
      expect(out.note).toMatch(/without `file`/);
      const tool = toolDefinitions().find((t) => t.name === "open_in_dosik");
      expect(tool?.description).toMatch(/without `file`/);
    });

    it("no longer says the app does not read the file again — it does now", async () => {
      const out = (await runTool("open_in_dosik", { file: "/tmp/plan.dosik" }, deps())) as {
        note: string;
      };
      const said = `${JSON.stringify(toolDefinitions())} ${out.note}`;
      expect(said).not.toMatch(/not reload|does not reread|would not show|overwrite them/i);
    });

    it("lets open_in_dosik pass .dosik and the legacy .json files the app opens — the app decides", async () => {
      const d = deps();
      await runTool("open_in_dosik", { file: "/tmp/old.mdgram.json" }, d);
      expect(d.openInApp).toHaveBeenCalledWith("/tmp/old.mdgram.json");
      await runTool("open_in_dosik", { file: "/tmp/Flow.DOSIK" }, d);
      expect(d.openInApp).toHaveBeenCalledWith("/tmp/Flow.DOSIK");
      await expect(runTool("open_in_dosik", { file: "/tmp/a.txt" }, d)).rejects.toThrow(
        /`\.dosik`/,
      );
    });

    it("treats file: null as absent — for clients that fill optional arguments with null", async () => {
      const d = deps();
      await runTool("get_diagram", { file: null }, d);
      expect(d.readDiagram).toHaveBeenCalled();
      expect(d.fileMode.read).not.toHaveBeenCalled();
    });

    it("passes on a report of a failed write as a rejection", async () => {
      const d = deps({
        fileMode: {
          ...deps().fileMode,
          apply: vi.fn(async () => ({
            ok: false,
            applied: 1,
            errors: ["write failed: ENOENT"],
            written: false,
          })),
        },
      });
      await expect(
        runTool("apply_ops", { file: "/tmp/x/a.dosik.json", ops: [{ op: "clear" }] }, d),
      ).rejects.toThrow(/write failed: ENOENT/);
    });
  });

  describe("hardening (#152)", () => {
    it("suggests a file instead of dumping an oversized render_diagram into the chat", async () => {
      const d = deps({
        renderSvg: vi.fn(async () => ({ svg: `<svg>${"x".repeat(300 * 1024)}</svg>`, view: VIEW })),
      });
      await expect(runTool("render_diagram", { file: "/tmp/a.dosik.json" }, d)).rejects.toThrow(
        /export_diagram/,
      );
    });

    it("accepts an SVG theme on export_diagram too", async () => {
      const d = deps();
      await runTool("export_diagram", { path: "/tmp/a.svg", theme: "dark" }, d);
      expect(d.exportFile).toHaveBeenCalledWith(4517, "/tmp/a.svg", { theme: "dark" });
      await runTool(
        "export_diagram",
        { file: "/tmp/a.dosik.json", path: "/tmp/b.svg", theme: "dark" },
        d,
      );
      expect(d.fileMode.exportTo).toHaveBeenCalledWith("/tmp/a.dosik.json", "/tmp/b.svg", {
        theme: "dark",
      });
      await expect(
        runTool("export_diagram", { path: "/tmp/a.md", theme: "dark" }, d),
      ).rejects.toThrow(/only for \.svg/);
    });
  });
});

describe("get_diagram returns images as placeholders (#155)", () => {
  const png = `data:image/png;base64,${"A".repeat(40_000)}`;
  const doc = {
    title: "t",
    nodes: [
      { id: "i", data: { label: "", shape: "image", src: png } },
      { id: "r", data: { label: "box", shape: "rect" } },
    ],
    edges: [],
  };

  it("file mode — does not pass base64 from the CLI-read document to the model", async () => {
    const d = deps({ fileMode: { ...deps().fileMode, read: vi.fn(async () => doc) } });
    const result = (await runTool("get_diagram", { file: "/tmp/a.dosik.json" }, d)) as typeof doc;
    expect(JSON.stringify(result)).not.toContain(png);
    expect(result.nodes[0].data.src).toBe("elided:image/png;29KB");
  });

  it("uses the same placeholder as the app — so the app recognizes it when sent back", () => {
    expect(elideImages(doc)).toEqual(elideImagesTs(doc));
  });

  it("handles one canvas only — no pages branch, same as the app (#229 D17)", () => {
    const book = {
      version: 2,
      title: "t",
      pages: [{ id: "p", name: "P", nodes: doc.nodes, edges: [] }],
    };
    expect(elideImages(book)).toEqual(book);
    expect(elideImages(book)).toEqual(elideImagesTs(book));
  });

  it("has no page wording in the tool descriptions (#229 D17, T24)", () => {
    for (const view of [false, true]) {
      for (const tool of toolDefinitions(loadSpec(), { view })) {
        expect(tool.description).not.toMatch(/several pages|every page|\bpages\b/);
      }
    }
  });

  it("live — reads get placeholders, drawing (export, render) gets the images", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const live = liveDeps();
      await live.readDiagram(4517);
      await live.readInlineDiagram(4517);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(urls).toEqual([
      "http://127.0.0.1:4517/api/diagram",
      "http://127.0.0.1:4517/api/diagram?images=inline",
    ]);
  });

  describe("in-chat app — only on hosts that render UI (#202)", () => {
    const UI = { view: true };

    it("keeps the tool list unchanged for non-UI hosts — byte for byte", () => {
      expect(toolDefinitions(loadSpec(), { view: false })).toEqual(toolDefinitions());
      expect(JSON.stringify(toolDefinitions())).not.toContain("ui://");
    });

    it("points only render_diagram to the app on UI hosts — the other five are unchanged", () => {
      const plain = toolDefinitions();
      const withView = toolDefinitions(loadSpec(), UI);
      const render = withView.find((t) => t.name === "render_diagram") as {
        _meta?: unknown;
        description: string;
        inputSchema: unknown;
      };
      expect(render._meta).toEqual({
        ui: { resourceUri: "ui://dosik/diagram-view" },
        "ui/resourceUri": "ui://dosik/diagram-view",
      });
      // same input — only where the result is shown changes
      expect(render.inputSchema).toEqual(
        plain.find((t) => t.name === "render_diagram")?.inputSchema,
      );
      // does not ask the model to redraw the SVG — the app draws it
      expect(render.description).not.toMatch(/render the SVG/i);
      expect(render.description).toMatch(/view in the chat/i);
      expect(render.description).toMatch(/export_diagram/);
      expect(withView.filter((t) => t.name !== "render_diagram")).toEqual(
        plain.filter((t) => t.name !== "render_diagram"),
      );
    });

    it("keeps returning an SVG string for non-UI hosts", async () => {
      const out = await runTool("render_diagram", { file: "/tmp/a.dosik.json" }, deps());
      expect(out).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    });

    it("gives the model only a summary on UI hosts — the SVG goes to the app side only", async () => {
      const d = deps();
      const out = (await runTool("render_diagram", { file: "/tmp/a.dosik.json" }, d, UI)) as {
        result: {
          content: { type: string; text: string }[];
          structuredContent: Record<string, unknown>;
        };
      };
      expect(out).toBeInstanceOf(McpResult);
      const { content, structuredContent } = out.result;
      expect(content).toEqual([
        { type: "text", text: 'Showing "Flow" in the chat — 3 shapes, 2 connectors.' },
      ]);
      expect(content[0]?.text).not.toContain("<svg");
      expect(structuredContent).toEqual({
        theme: "light",
        ...VIEW,
        target: { file: "/tmp/a.dosik.json" },
      });
    });

    it("keeps the picture out of structuredContent — a host may show that to the model (#251)", async () => {
      const out = (await runTool(
        "render_diagram",
        { file: "/tmp/a.dosik.json" },
        deps(),
        UI,
      )) as McpResult;
      expect(JSON.stringify(out.result.structuredContent)).not.toContain("<svg");
      // the view's part of the result, which hosts pass to the view and not to the model
      expect(out.result._meta).toEqual({
        [DRAWING_META_KEY]: {
          svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
          theme: "light",
        },
      });
    });

    it("names the picture's key as the view reads it", () => {
      expect(DRAWING_META_KEY).toBe(VIEW_DRAWING_KEY);
    });

    it("leaves file out of target when the open app is the target — no open-in-app button needed", async () => {
      const out = (await runTool("render_diagram", { theme: "dark" }, deps(), UI)) as McpResult;
      expect(out.result.structuredContent).toMatchObject({ theme: "dark", target: {} });
    });

    it("carries the drawing in the other theme too — the app matches the host without calling back (#251)", async () => {
      const d = deps({
        renderSvg: vi.fn(async () => ({
          svg: "<svg>light</svg>",
          view: VIEW,
          alternate: { theme: "dark", svg: "<svg>dark</svg>" },
        })),
      });
      const out = (await runTool(
        "render_diagram",
        { file: "/tmp/a.dosik.json" },
        d,
        UI,
      )) as McpResult;
      expect(out.result._meta[DRAWING_META_KEY]).toEqual({
        svg: "<svg>light</svg>",
        theme: "light",
        alternate: { theme: "dark", svg: "<svg>dark</svg>" },
      });
      // neither picture goes where a model may read it
      expect(JSON.stringify(out.result.content)).not.toContain("<svg");
      expect(JSON.stringify(out.result.structuredContent)).not.toContain("<svg");
    });

    it("leaves the other theme out when both would pass 4MB — the drawing itself still goes (#251)", async () => {
      const d = deps({
        renderSvg: vi.fn(async () => ({
          svg: `<svg>${"x".repeat(2500 * 1024)}</svg>`,
          view: VIEW,
          alternate: { theme: "dark", svg: `<svg>${"y".repeat(2500 * 1024)}</svg>` },
        })),
      });
      const out = (await runTool(
        "render_diagram",
        { file: "/tmp/a.dosik.json" },
        d,
        UI,
      )) as McpResult;
      expect(out.result._meta[DRAWING_META_KEY]).toMatchObject({ theme: "light" });
      expect(out.result._meta[DRAWING_META_KEY]).not.toHaveProperty("alternate");
    });

    it("asks a text host's render for one theme only — its SVG follows the page itself", async () => {
      const d = deps();
      await runTool("render_diagram", { file: "/tmp/a.dosik.json" }, d);
      expect(d.renderSvg).toHaveBeenCalledWith({ file: "/tmp/a.dosik.json", theme: "auto" });
    });

    it("accepts a drawing up to 4MB for the chat view", async () => {
      const big = (kb: number) =>
        deps({
          renderSvg: vi.fn(async () => ({
            svg: `<svg>${"x".repeat(kb * 1024)}</svg>`,
            view: VIEW,
          })),
        });
      await expect(
        runTool("render_diagram", { file: "/tmp/a.dosik.json" }, big(300), UI),
      ).resolves.toBeInstanceOf(McpResult);
      await expect(
        runTool("render_diagram", { file: "/tmp/a.dosik.json" }, big(4200), UI),
      ).rejects.toThrow(/export_diagram/);
    });

    it("says what went wrong when headless does not report what it drew (#202)", async () => {
      const d = deps({ renderSvg: vi.fn(async () => ({ svg: "<svg/>", view: undefined })) });
      await expect(runTool("render_diagram", { file: "/tmp/a.dosik.json" }, d, UI)).rejects.toThrow(
        /did not report what it drew/,
      );
      // the text form does not use the summary
      await expect(runTool("render_diagram", { file: "/tmp/a.dosik.json" }, d)).resolves.toBe(
        "<svg/>",
      );
    });

    it("gives UI hosts the same error as before when the app is closed", async () => {
      const down = deps({ probeBridge: vi.fn(async () => ({ state: "down" })) });
      await expect(runTool("render_diagram", {}, down, UI)).rejects.toThrow(/not running/);
    });

    it("targets the open app for file: null — in the UI form too", async () => {
      const d = deps();
      const out = (await runTool("render_diagram", { file: null }, d, UI)) as McpResult;
      expect(d.renderSvg).toHaveBeenCalledWith({ port: 4517, theme: "light", alternate: "dark" });
      expect(out.result.structuredContent).toMatchObject({ target: {} });
    });

    it("accepts only auto, light and dark for theme in the UI form too", async () => {
      await expect(runTool("render_diagram", { theme: "sepia" }, deps(), UI)).rejects.toThrow(
        /`theme` must be "auto", "light" or "dark"/,
      );
    });

    it("leaves other tools' results unchanged on UI hosts", async () => {
      const d = deps();
      expect(await runTool("get_diagram", {}, d, UI)).toEqual(await runTool("get_diagram", {}, d));
    });
  });

  it("also carries the old ui/resourceUri key in the UI form for older hosts — like ext-apps registerAppTool", () => {
    const render = toolDefinitions(loadSpec(), { view: true }).find(
      (t) => t.name === "render_diagram",
    ) as { _meta?: Record<string, unknown> };
    expect(render._meta?.["ui/resourceUri"]).toBe("ui://dosik/diagram-view");
  });

  it("says an oversized result in the UI form is too large to send to the view", async () => {
    const d = deps({
      renderSvg: vi.fn(async () => ({ svg: `<svg>${"x".repeat(4200 * 1024)}</svg>`, view: VIEW })),
    });
    await expect(
      runTool("render_diagram", { file: "/tmp/a.dosik.json" }, d, { view: true }),
    ).rejects.toThrow(/too large to send to the chat view/);
  });

  describe("theme auto (#202)", () => {
    const UI = { view: true };

    it("draws auto as light in the UI form, with the other theme alongside — the app shows the host's (#251)", async () => {
      const d = deps();
      const out = (await runTool(
        "render_diagram",
        { file: "/tmp/a.dosik.json", theme: "auto" },
        d,
        UI,
      )) as McpResult;
      expect(d.renderSvg).toHaveBeenCalledWith({
        file: "/tmp/a.dosik.json",
        theme: "light",
        alternate: "dark",
      });
      expect(out.result.structuredContent).toMatchObject({ theme: "light" });
      await runTool("render_diagram", { file: "/tmp/a.dosik.json", theme: "dark" }, d, UI);
      expect(d.renderSvg).toHaveBeenLastCalledWith({
        file: "/tmp/a.dosik.json",
        theme: "dark",
        alternate: "light",
      });
    });

    it("says in the text-form description that auto follows the page", () => {
      const render = toolDefinitions().find((t) => t.name === "render_diagram") as {
        description: string;
        inputSchema: { properties: { theme: { enum: string[] } } };
      };
      expect(render.inputSchema.properties.theme.enum).toEqual(["auto", "light", "dark"]);
      expect(render.description).toMatch(/follow the page/i);
    });
  });
});
