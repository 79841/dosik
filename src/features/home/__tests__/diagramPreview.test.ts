import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiagramDoc } from "../../../shared/lib/types";
import {
  loadPicture,
  PREVIEW_CACHE_CHARS,
  peekPicture,
  PREVIEW_CACHE_LIMIT,
  previewCacheSize,
  previewDoc,
  previewSrc,
  resetPreviewCacheForTests,
} from "../diagramPreview";
import { loadedFile } from "../../../test/rustAnswers";

const mockedInvoke = vi.mocked(invoke);

const node = (id: string, label: string) => ({
  id,
  type: "shape",
  position: { x: 0, y: 0 },
  data: { label, shape: "rect", color: "mono" },
});

const doc: DiagramDoc = {
  version: 1,
  title: "One",
  nodes: [node("a", "Alpha")] as DiagramDoc["nodes"],
  edges: [],
};

const decode = (src: string | null) =>
  decodeURIComponent((src ?? "").replace("data:image/svg+xml;charset=utf-8,", ""));

/** a promise and its resolver — a read that lands when the test says */
const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("Home diagram images (#161, #220 D14)", () => {
  beforeEach(() => {
    resetPreviewCacheForTests();
    mockedInvoke.mockReset();
  });

  describe("previewDoc (T11)", () => {
    it("the diagram as is — normalized the same way as opening a file", () => {
      const shown = previewDoc(doc);
      expect(shown?.nodes.map((n) => n.data.label)).toEqual(["Alpha"]);
      // sizes come from normalization, as a file load would set them
      expect(shown?.nodes[0]?.width).toBeGreaterThan(0);
      expect(shown?.title).toBe("One");
    });
  });

  it("builds an SVG data URL for img — in theme colors", () => {
    const light = previewSrc(doc, "light");
    expect(light).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decode(light)).toContain("Alpha");
    expect(decode(previewSrc(doc, "dark"))).not.toBe(decode(light));
  });

  it("an empty diagram has no image", () => {
    expect(previewSrc({ ...doc, nodes: [] }, "light")).toBeNull();
  });

  describe("image cache (T12)", () => {
    it("loads once for the same modified time, reloads after an edit", async () => {
      mockedInvoke.mockResolvedValue(loadedFile(doc));
      await loadPicture("d1", 100, "light");
      await loadPicture("d1", 100, "light");
      expect(mockedInvoke).toHaveBeenCalledTimes(1);
      await loadPicture("d1", 200, "light");
      expect(mockedInvoke).toHaveBeenCalledTimes(2);
    });

    it("an edited diagram's image replaces the old one — they do not pile up (#161)", async () => {
      mockedInvoke.mockResolvedValue(loadedFile(doc));
      for (const t of [1, 2, 3, 4]) await loadPicture("d1", t, "light");
      expect(previewCacheSize()).toBe(1);
      await loadPicture("d1", 4, "dark");
      expect(previewCacheSize()).toBe(2);
    });

    it("two images of the same diagram (two themes) at once — reads the file once, holds nothing after", async () => {
      const read = deferred<ReturnType<typeof loadedFile>>();
      mockedInvoke.mockReturnValue(read.promise);
      const pictures = (["light", "dark"] as const).map((theme) => loadPicture("d1", 1, theme));
      expect(mockedInvoke).toHaveBeenCalledTimes(1);
      read.resolve(loadedFile(doc));
      const drawn = await Promise.all(pictures);
      expect(drawn.every((src) => src?.startsWith("data:"))).toBe(true);
      expect(previewCacheSize()).toBe(2);
      // the shared read is gone: an edit later reads the file again
      mockedInvoke.mockResolvedValue(loadedFile(doc));
      await loadPicture("d1", 2, "light");
      expect(mockedInvoke).toHaveBeenCalledTimes(2);
    });

    describe("yielding before drawing", () => {
      beforeEach(() => vi.useFakeTimers());
      afterEach(() => vi.useRealTimers());

      it("draws in the next task (setTimeout 0) even after loading — no draw unless timers run", async () => {
        mockedInvoke.mockResolvedValue(loadedFile(doc));
        const spy = vi.spyOn(globalThis, "setTimeout");
        let drawn = false;
        void loadPicture("d2", 1, "light").then(() => {
          drawn = true;
        });
        for (let i = 0; i < 5; i++) await Promise.resolve();
        expect(spy).toHaveBeenCalledWith(expect.any(Function), 0);
        expect(drawn).toBe(false);
        await vi.runAllTimersAsync();
        expect(drawn).toBe(true);
        spy.mockRestore();
      });
    });

    it(`image count cap ${PREVIEW_CACHE_LIMIT} — forgets the least recently viewed first (#161)`, async () => {
      mockedInvoke.mockResolvedValue(loadedFile(doc));
      for (let i = 0; i < PREVIEW_CACHE_LIMIT + 5; i++) await loadPicture(`d${i}`, 1, "light");
      expect(previewCacheSize()).toBe(PREVIEW_CACHE_LIMIT);
      const reads = mockedInvoke.mock.calls.length;
      // the newest is still held; the first was forgotten and is read again
      await loadPicture(`d${PREVIEW_CACHE_LIMIT + 4}`, 1, "light");
      expect(mockedInvoke.mock.calls.length).toBe(reads);
      await loadPicture("d0", 1, "light");
      expect(mockedInvoke.mock.calls.length).toBe(reads + 1);
    });

    it("a cap on total data URL characters too — on overflow forgets the least recently viewed first", async () => {
      expect(PREVIEW_CACHE_CHARS).toBe(32_000_000);
      mockedInvoke.mockResolvedValue(loadedFile(doc));
      const size = (await loadPicture("probe", 1, "light"))!.length;
      // a budget of two and a half pictures: the third pushes the oldest out
      resetPreviewCacheForTests({ chars: Math.floor(size * 2.5) });
      await loadPicture("a", 1, "light");
      await loadPicture("b", 1, "light");
      expect(previewCacheSize()).toBe(2);
      await loadPicture("a", 1, "light"); // a is the most recently shown now
      await loadPicture("c", 1, "light");
      expect(previewCacheSize()).toBe(2);
      const reads = mockedInvoke.mock.calls.length;
      await loadPicture("a", 1, "light");
      expect(mockedInvoke.mock.calls.length).toBe(reads);
      await loadPicture("b", 1, "light");
      expect(mockedInvoke.mock.calls.length).toBe(reads + 1);
    });

    it("an image larger than the budget still shows — the most recent one stays", async () => {
      mockedInvoke.mockResolvedValue(loadedFile(doc));
      resetPreviewCacheForTests({ chars: 10 });
      expect(await loadPicture("big", 1, "light")).toMatch(/^data:/);
      expect(previewCacheSize()).toBe(1);
    });

    it("does not remember a failed load — tries again next time", async () => {
      mockedInvoke.mockRejectedValueOnce(new Error("gone"));
      await expect(loadPicture("d1", 1, "light")).rejects.toThrow("gone");
      expect(previewCacheSize()).toBe(0);
      mockedInvoke.mockResolvedValueOnce(loadedFile(doc));
      expect(await loadPicture("d1", 1, "light")).toMatch(/^data:/);
    });
  });

  describe("peeking at finished images (#221 D19)", () => {
    beforeEach(() => {
      resetPreviewCacheForTests();
      mockedInvoke.mockReset();
    });

    it("only finished images synchronously — drawing·missing·other modified time are undefined, an empty diagram is null", async () => {
      expect(peekPicture("d1", 1, "light")).toBeUndefined();
      mockedInvoke.mockResolvedValue(loadedFile(doc));
      const picture = loadPicture("d1", 1, "light");
      expect(peekPicture("d1", 1, "light")).toBeUndefined();
      const src = await picture;
      expect(peekPicture("d1", 1, "light")).toBe(src);
      expect(peekPicture("d1", 2, "light")).toBeUndefined();
      expect(peekPicture("d1", 1, "dark")).toBeUndefined();
      expect(mockedInvoke).toHaveBeenCalledTimes(1);
      mockedInvoke.mockResolvedValue(loadedFile({ ...doc, nodes: [] }));
      await loadPicture("d2", 1, "light");
      expect(peekPicture("d2", 1, "light")).toBeNull();
    });
  });
});
