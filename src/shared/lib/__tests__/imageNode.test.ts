import { beforeEach, describe, expect, it } from "vitest";

import { elidedSrc, elideImages } from "../imageData";
import { useDiagramStore } from "../store";
import { cloneSnapshot } from "../store/history";
import { makeDoc, makeNode } from "./testFixtures";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const node = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id);
const imageNode = (id: string, src: string) => {
  const base = makeNode({ id, shape: "image" });
  return { ...base, data: { ...base.data, src } };
};
const ops = (list: unknown[]) => useDiagramStore.getState().applyOps(list as never);

describe("Image node — store and bridge (#8)", () => {
  beforeEach(() => useDiagramStore.getState().loadDoc(makeDoc([], []), null));

  it("add_node creates an image with src", () => {
    const result = ops([
      {
        op: "add_node",
        node: {
          id: "i",
          label: "screenshot",
          shape: "image",
          src: PNG,
          x: 0,
          y: 0,
          width: 320,
          height: 200,
        },
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(node("i")?.data).toMatchObject({ shape: "image", src: PNG, label: "screenshot" });
    expect(node("i")?.width).toBe(320);
  });

  it("images must have src, and other shapes must not", () => {
    expect(
      ops([{ op: "add_node", node: { label: "", shape: "image", x: 0, y: 0 } }]).errors[0],
    ).toMatch(/image needs src/);
    expect(ops([{ op: "add_node", node: { label: "a", src: PNG, x: 0, y: 0 } }]).errors[0]).toMatch(
      /src is only valid with shape "image"/,
    );
  });

  it("SVG or URLs are rejected", () => {
    for (const src of ["data:image/svg+xml;base64,PHN2Zz4=", "https://x.test/a.png"]) {
      expect(
        ops([{ op: "add_node", node: { label: "", shape: "image", src, x: 0, y: 0 } }]).errors[0],
      ).toMatch(/data URL/);
    }
  });

  it("update_node swaps the picture, and drops it when changing to a non-image shape", () => {
    ops([{ op: "add_node", node: { id: "i", label: "", shape: "image", src: PNG, x: 0, y: 0 } }]);
    const other = "data:image/jpeg;base64,/9j/4AAQ";
    expect(ops([{ op: "update_node", id: "i", set: { src: other } }]).errors).toEqual([]);
    expect(node("i")?.data.src).toBe(other);
    expect(ops([{ op: "update_node", id: "i", set: { shape: "rounded" } }]).errors).toEqual([]);
    expect(node("i")?.data.src).toBeUndefined();
  });

  it("cannot change to an image without a picture", () => {
    ops([{ op: "add_node", node: { id: "r", label: "r", x: 0, y: 0 } }]);
    expect(ops([{ op: "update_node", id: "r", set: { shape: "image" } }]).errors[0]).toMatch(
      /image needs src/,
    );
    expect(ops([{ op: "update_node", id: "r", set: { src: PNG } }]).errors[0]).toMatch(
      /src is only valid on shape "image"/,
    );
  });

  it("drops unusable src when reading from a file — the shape stays", () => {
    const bad = {
      ...makeNode({ id: "i", shape: "image" }),
      data: {
        label: "",
        shape: "image" as const,
        color: "violet" as const,
        src: "javascript:alert(1)",
      },
    };
    const stray = {
      ...makeNode({ id: "r" }),
      data: { label: "r", shape: "rounded" as const, color: "violet" as const, src: PNG },
    };
    useDiagramStore.getState().loadDoc(makeDoc([bad, stray], []), null);
    expect(node("i")?.data.src).toBeUndefined();
    expect(node("i")?.data.shape).toBe("image");
    expect(node("r")?.data.src).toBeUndefined();
  });

  it("addImage creates an image in a single undo step", () => {
    const past = useDiagramStore.getState().past.length;
    const id = useDiagramStore
      .getState()
      .addImage(PNG, { x: 10, y: 20 }, { width: 100, height: 50 });
    expect(node(id)?.data).toMatchObject({ shape: "image", src: PNG });
    expect(node(id)?.position).toEqual({ x: 10, y: 20 });
    expect(useDiagramStore.getState().past.length).toBe(past + 1);
  });
});

describe("Sending back a document read with placeholders keeps the images (#155)", () => {
  const ELIDED = elidedSrc(PNG);
  beforeEach(() => {
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
    ops([
      { op: "add_node", node: { id: "i", label: "shot", shape: "image", src: PNG, x: 0, y: 0 } },
    ]);
  });

  it("set_diagram — editing and sending back the get_diagram document keeps the images", () => {
    const doc = elideImages(useDiagramStore.getState().toDoc());
    doc.nodes[0].data.label = "renamed";
    expect(ops([{ op: "set_diagram", doc }]).errors).toEqual([]);
    expect(node("i")?.data).toMatchObject({ label: "renamed", src: PNG });
  });

  it("set_diagram — the image stays even when sent without src (#155)", () => {
    const doc = elideImages(useDiagramStore.getState().toDoc());
    delete (doc.nodes[0].data as { src?: string }).src;
    expect(ops([{ op: "set_diagram", doc }]).errors).toEqual([]);
    expect(node("i")?.data.src).toBe(PNG);
  });

  it("update_node — a placeholder from another node is an error, not silently swallowed as a no-op", () => {
    const other = `data:image/png;base64,${"B".repeat(4000)}`;
    ops([{ op: "add_node", node: { id: "j", label: "", shape: "image", src: other, x: 0, y: 0 } }]);
    const result = ops([{ op: "update_node", id: "i", set: { src: elidedSrc(other) } }]);
    expect(result.errors[0]).toMatch(/stands for an image already in the diagram/);
    expect(node("i")?.data.src).toBe(PNG);
  });

  it("set_diagram — a placeholder for a missing image is an error, not silently emptied", () => {
    const doc = elideImages(useDiagramStore.getState().toDoc());
    doc.nodes[0].id = "other";
    const result = ops([{ op: "set_diagram", doc }]);
    expect(result.errors[0]).toMatch(/set_diagram: nodes\[0\].*stands for an image already/);
    expect(node("i")?.data.src).toBe(PNG);
  });

  it("set_diagram — reports unusable src as an error (same as add_node)", () => {
    const doc = makeDoc([imageNode("x", "data:image/svg+xml;base64,PHN2Zz4=")], []);
    const result = ops([{ op: "set_diagram", doc }]);
    expect(result.errors[0]).toMatch(/src must be a base64 data URL/);
    expect(result.applied).toBe(0);
    expect(node("i")).toBeDefined();
  });

  it("update_node — a placeholder src means 'leave as is'", () => {
    const result = ops([{ op: "update_node", id: "i", set: { label: "b", src: ELIDED } }]);
    expect(result.errors).toEqual([]);
    expect(node("i")?.data).toMatchObject({ label: "b", src: PNG });
  });

  it("add_node — a placeholder cannot create a new image", () => {
    const result = ops([
      { op: "add_node", node: { label: "", shape: "image", src: ELIDED, x: 0, y: 0 } },
    ]);
    expect(result.errors[0]).toMatch(/stands for an image already in the diagram/);
  });
});

describe("Undo history does not duplicate images (#155)", () => {
  it("snapshot deep copies do not carry data URLs", () => {
    const cloned: string[] = [];
    const real = globalThis.structuredClone;
    globalThis.structuredClone = ((value: unknown) => {
      cloned.push(JSON.stringify(value));
      return real(value);
    }) as typeof structuredClone;
    try {
      const snap = cloneSnapshot({
        title: "t",
        nodes: [imageNode("i", PNG)],
        edges: [],
      });
      expect(snap.nodes[0].data.src).toBe(PNG);
    } finally {
      globalThis.structuredClone = real;
    }
    expect(cloned.length).toBeGreaterThan(0);
    expect(cloned.some((c) => c.includes(PNG))).toBe(false);
  });
});

describe("An image remembers the file it was made from — `original`", () => {
  const ORIGINAL = "/Users/someone/Desktop/shot.png";
  const linked = (id: string, original: unknown, shape = "image") => {
    const base = makeNode({ id, shape: shape as never });
    return { ...base, data: { ...base.data, src: PNG, original } } as never;
  };
  beforeEach(() => useDiagramStore.getState().loadDoc(makeDoc([], []), null));

  it("addImage keeps the path beside the stored copy", () => {
    const id = useDiagramStore
      .getState()
      .addImage(PNG, { x: 0, y: 0 }, { width: 100, height: 50 }, ORIGINAL);
    expect(node(id)?.data).toMatchObject({ src: PNG, original: ORIGINAL });
    const plain = useDiagramStore
      .getState()
      .addImage(PNG, { x: 0, y: 0 }, { width: 10, height: 10 });
    expect(node(plain)?.data).not.toHaveProperty("original");
  });

  it("reading a file keeps an absolute path to a picture, on an image only", () => {
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [
            linked("mac", ORIGINAL),
            linked("win", "C:\\Users\\someone\\Pictures\\photo.JPG"),
            linked("relative", "shot.png"),
            linked("notPicture", "/Users/someone/.ssh/id_rsa"),
            linked("tooLong", `/${"a".repeat(4100)}.png`),
            linked("number", 42),
            linked("unc", "\\\\server\\share\\x.png"),
            linked("slashes", "//server/share/x.png"),
            linked("automount", "/net/server/share/x.png"),
            linked("automountCase", "/NET/server/share/x.png"),
            linked("box", ORIGINAL, "rounded"),
          ],
          [],
        ),
        null,
      );
    expect(node("mac")?.data.original).toBe(ORIGINAL);
    expect(node("win")?.data.original).toBe("C:\\Users\\someone\\Pictures\\photo.JPG");
    for (const id of [
      "relative",
      "notPicture",
      "tooLong",
      "number",
      "unc",
      "slashes",
      "automount",
      "automountCase",
      "box",
    ]) {
      expect(node(id)?.data, id).not.toHaveProperty("original");
    }
  });

  it("turning the image into another shape drops the link with the picture", () => {
    useDiagramStore.getState().loadDoc(makeDoc([linked("i", ORIGINAL)], []), null);
    useDiagramStore.getState().updateNodeData("i", { shape: "rounded" });
    expect(node("i")?.data).not.toHaveProperty("src");
    expect(node("i")?.data).not.toHaveProperty("original");
  });

  it("update_node — a new picture or another shape drops the link; the placeholder keeps it", () => {
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc([linked("a", ORIGINAL), linked("b", ORIGINAL), linked("c", ORIGINAL)], []),
        null,
      );
    const other = "data:image/png;base64,AAAA";
    expect(
      ops([
        { op: "update_node", id: "a", set: { src: other } },
        { op: "update_node", id: "b", set: { shape: "rounded" } },
        { op: "update_node", id: "c", set: { src: elidedSrc(PNG), label: "kept" } },
      ]).errors,
    ).toEqual([]);
    expect(node("a")?.data).not.toHaveProperty("original");
    expect(node("b")?.data).not.toHaveProperty("original");
    expect(node("c")?.data.original).toBe(ORIGINAL);
    // the same picture sent back inline is no new picture
    useDiagramStore.getState().loadDoc(makeDoc([linked("d", ORIGINAL)], []), null);
    expect(ops([{ op: "update_node", id: "d", set: { src: PNG } }]).errors).toEqual([]);
    expect(node("d")?.data.original).toBe(ORIGINAL);
  });

  it("set_diagram — the read document sent back keeps the link, with or without it", () => {
    useDiagramStore
      .getState()
      .loadDoc(makeDoc([linked("a", ORIGINAL), linked("b", ORIGINAL)], []), null);
    const read = elideImages({ nodes: useDiagramStore.getState().nodes, edges: [] });
    const [a, b] = read.nodes;
    const withoutLink = { ...b!, data: { ...b!.data } };
    delete (withoutLink.data as { original?: string }).original;
    expect(
      ops([{ op: "set_diagram", doc: { nodes: [a, withoutLink], edges: [] } }]).errors,
    ).toEqual([]);
    expect(node("a")?.data.original).toBe(ORIGINAL);
    expect(node("b")?.data.original).toBe(ORIGINAL);
  });

  it("set_diagram — a link is never taken from the document sent: not with a new picture, not on a new node", () => {
    useDiagramStore.getState().loadDoc(makeDoc([linked("a", ORIGINAL)], []), null);
    const other = "data:image/png;base64,AAAA";
    const fresh = {
      ...makeNode({ id: "n", shape: "image" }),
      data: { label: "", shape: "image", src: PNG, original: "/Users/someone2/x.png" },
    };
    const a = { ...node("a")!, data: { ...node("a")!.data, src: other } };
    expect(ops([{ op: "set_diagram", doc: { nodes: [a, fresh], edges: [] } }]).errors).toEqual([]);
    expect(node("a")?.data).toMatchObject({ src: other });
    expect(node("a")?.data).not.toHaveProperty("original");
    expect(node("n")?.data).not.toHaveProperty("original");
  });

  it("a read for a model leaves the link out", () => {
    useDiagramStore.getState().loadDoc(makeDoc([linked("a", ORIGINAL)], []), null);
    const read = elideImages({ nodes: useDiagramStore.getState().nodes, edges: [] });
    expect(read.nodes[0]!.data).not.toHaveProperty("original");
    // the app's own document keeps it
    expect(node("a")?.data.original).toBe(ORIGINAL);
  });

  it("copy and paste — the copy links the same file", () => {
    useDiagramStore.getState().loadDoc(makeDoc([linked("i", ORIGINAL)], []), null);
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
    useDiagramStore.getState().copySelection();
    useDiagramStore.getState().paste();
    const copies = useDiagramStore.getState().nodes.filter((n) => n.id !== "i");
    expect(copies.map((n) => n.data.original)).toEqual([ORIGINAL]);
  });
});
