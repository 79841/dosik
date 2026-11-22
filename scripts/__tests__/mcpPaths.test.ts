import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appDataDir,
  isDevRun,
  libraryLocation,
  libraryRecordDir,
  MCP_PATHS,
  windowsDocuments,
  PACKAGE_INFO,
  resolveMcpPaths,
} from "../mcp/paths.mjs";

/**
 * Where the MCP server finds its parts (#252): in the repository it builds
 * them as before; packaged with the app — a folder with `package-info.json`
 * beside the server — everything sits next to it and nothing is built.
 */
describe("MCP server paths (#252)", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("in the repository: the repo's bundles, spec and app identifier", () => {
    expect(MCP_PATHS.packaged).toBe(false);
    expect(MCP_PATHS.headlessBundle).toMatch(/dist-cli[/\\]dosik-headless\.mjs$/);
    expect(MCP_PATHS.viewBundle).toMatch(/dist-mcp-view[/\\]diagram-view\.js$/);
    expect(MCP_PATHS.openapi).toMatch(/docs[/\\]openapi\.yaml$/);
    expect(MCP_PATHS.bundleId).toBe("app.dosik.desktop");
    expect(MCP_PATHS.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("packaged: everything beside the server, identity from package-info.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "dosik-mcp-paths-"));
    made.push(dir);
    writeFileSync(
      join(dir, PACKAGE_INFO),
      JSON.stringify({ identifier: "app.dosik.desktop", version: "0.2.0" }),
    );
    const paths = resolveMcpPaths(dir);
    expect(paths).toEqual({
      packaged: true,
      root: dir,
      headlessBundle: join(dir, "dosik-headless.mjs"),
      viewBundle: join(dir, "diagram-view.js"),
      openapi: join(dir, "openapi.yaml"),
      bundleId: "app.dosik.desktop",
      version: "0.2.0",
    });
  });

  it("a folder without package-info.json is the repository layout", () => {
    const repo = mkdtempSync(join(tmpdir(), "dosik-mcp-repo-"));
    made.push(repo);
    const here = join(repo, "scripts", "mcp");
    mkdirSync(here, { recursive: true });
    mkdirSync(join(repo, "src-tauri"));
    writeFileSync(
      join(repo, "src-tauri", "tauri.conf.json"),
      JSON.stringify({ identifier: "x.y" }),
    );
    writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "9.9.9" }));
    const paths = resolveMcpPaths(here);
    expect(paths.packaged).toBe(false);
    expect(paths.root).toBe(repo);
    expect(paths.bundleId).toBe("x.y");
  });
});

/**
 * Where the app keeps its library record (#253): the MCP server registers
 * projects there for the app to take in, so it must find the very folder the
 * app writes — Tauri's app data folder for the bundle identifier.
 */
describe("the app's data and library folders (#253)", () => {
  const ID = "app.dosik.desktop";

  it("is the app data folder Tauri uses on each platform", () => {
    expect(appDataDir(ID, "darwin", {}, "/Users/a")).toBe(
      "/Users/a/Library/Application Support/app.dosik.desktop",
    );
    expect(
      appDataDir(ID, "win32", { APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "C:\\Users\\a"),
    ).toBe("C:\\Users\\a\\AppData\\Roaming\\app.dosik.desktop");
    // no APPDATA: the roaming folder in the home folder
    expect(appDataDir(ID, "win32", {}, "C:\\Users\\a")).toBe(
      "C:\\Users\\a\\AppData\\Roaming\\app.dosik.desktop",
    );
    expect(appDataDir(ID, "linux", {}, "/home/a")).toBe("/home/a/.local/share/app.dosik.desktop");
    expect(appDataDir(ID, "linux", { XDG_DATA_HOME: "/data" }, "/home/a")).toBe(
      "/data/app.dosik.desktop",
    );
    // a relative XDG_DATA_HOME is ignored, as the XDG spec says
    expect(appDataDir(ID, "linux", { XDG_DATA_HOME: "rel" }, "/home/a")).toBe(
      "/home/a/.local/share/app.dosik.desktop",
    );
  });

  it("DOSIK_APP_DATA names another one — a test instance with an identifier of its own", () => {
    expect(appDataDir(ID, "darwin", { DOSIK_APP_DATA: "/tmp/other" }, "/Users/a")).toBe(
      "/tmp/other",
    );
    // only a whole path counts
    expect(appDataDir(ID, "darwin", { DOSIK_APP_DATA: "rel" }, "/Users/a")).toBe(
      "/Users/a/Library/Application Support/app.dosik.desktop",
    );
    expect(appDataDir(ID, "darwin", { DOSIK_APP_DATA: "" }, "/Users/a")).toBe(
      "/Users/a/Library/Application Support/app.dosik.desktop",
    );
  });

  it("DOSIK_DEV=1 means a development run's record and library — kept apart like the app keeps them", () => {
    expect(isDevRun({})).toBe(false);
    expect(isDevRun({ DOSIK_DEV: "0" })).toBe(false);
    expect(isDevRun({ DOSIK_DEV: "" })).toBe(false);
    for (const on of ["1", "true", "YES"]) expect(isDevRun({ DOSIK_DEV: on })).toBe(true);
    expect(libraryRecordDir("/data", false, "darwin")).toBe("/data/library");
    expect(libraryRecordDir("/data", true, "darwin")).toBe("/data/library-dev");
    expect(libraryRecordDir("C:\\data", true, "win32")).toBe("C:\\data\\library-dev");
  });

  it("finds the library folder by the app's rule — DOSIK_LIBRARY_DIR, else Documents/Dosik (Dosik Dev)", () => {
    expect(libraryLocation({}, false, "/Users/a", "darwin")).toBe("/Users/a/Documents/Dosik");
    expect(libraryLocation({}, true, "/Users/a", "darwin")).toBe("/Users/a/Documents/Dosik Dev");
    for (const dev of [false, true]) {
      expect(libraryLocation({ DOSIK_LIBRARY_DIR: "/x/Lib" }, dev, "/Users/a", "darwin")).toBe(
        "/x/Lib",
      );
    }
    expect(libraryLocation({ DOSIK_LIBRARY_DIR: "rel" }, false, "/Users/a", "darwin")).toBe(
      "/Users/a/Documents/Dosik",
    );
    expect(libraryLocation({}, false, "C:\\Users\\a", "win32")).toBe(
      "C:\\Users\\a\\Documents\\Dosik",
    );
    // Documents where Windows keeps it — moved into OneDrive, say — as the app asks the OS for it
    expect(
      libraryLocation({}, false, "C:\\Users\\a", "win32", "C:\\Users\\a\\OneDrive\\Documents"),
    ).toBe("C:\\Users\\a\\OneDrive\\Documents\\Dosik");
    expect(
      libraryLocation({ DOSIK_LIBRARY_DIR: "D:\\Lib" }, false, "C:\\Users\\a", "win32", "E:\\Docs"),
    ).toBe("D:\\Lib");
  });

  it("asks Windows for its Documents folder as the app does, and trusts only a whole, readable path", () => {
    const answering = (text: string) => () => text;
    // a Korean Windows names OneDrive's Documents in Korean (written as code points)
    expect(windowsDocuments(answering("C:\\Users\\a\\OneDrive\\\uBB38\uC11C\r\n"))).toBe(
      "C:\\Users\\a\\OneDrive\\\uBB38\uC11C",
    );
    expect(windowsDocuments(answering("D:\\Docs"))).toBe("D:\\Docs");
    // not a whole path, letters that did not come through, or nothing: not used
    expect(windowsDocuments(answering("Documents"))).toBeUndefined();
    expect(windowsDocuments(answering("D:\\\uFFFD\\Documents"))).toBeUndefined();
    expect(windowsDocuments(answering(""))).toBeUndefined();
    // the asking fails — PowerShell missing, too slow: the home folder's Documents stands
    expect(
      windowsDocuments(() => {
        throw new Error("spawn powershell ENOENT");
      }),
    ).toBeUndefined();
  });
});
