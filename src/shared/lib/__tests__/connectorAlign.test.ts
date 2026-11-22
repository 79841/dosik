import { describe, expect, it } from "vitest";

import { ALIGN_REACH, alignToConnectors } from "../connectorAlign";
import type { DiagramEdge, DiagramNode } from "../types";
import { makeEdge, makeNode } from "./testFixtures";

/*
 * A 160×144 box `a` and a 160×164 box `b` joined right side to left side:
 * their middles stand level only with `b` 10px above `a` — off the 8px grid.
 */
const a = makeNode({ id: "a", x: 0, y: 0, width: 160, height: 144 });
const b = makeNode({ id: "b", x: 240, y: 40, width: 160, height: 164 });
const link = makeEdge({
  id: "e",
  source: "a",
  target: "b",
  sourceHandle: "right",
  targetHandle: "left",
});
const withData = (edge: DiagramEdge, data: Partial<DiagramEdge["data"]>): DiagramEdge => ({
  ...edge,
  data: { ...edge.data, ...data } as DiagramEdge["data"],
});
const at = (moves: Record<string, { x: number; y: number }>) => new Map(Object.entries(moves));
const align = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  moves: Record<string, { x: number; y: number }>,
) => alignToConnectors(nodes, edges, at(moves));

describe("alignToConnectors", () => {
  it("reaches 6px", () => {
    expect(ALIGN_REACH).toBe(6);
  });

  it("gives the move that brings the moving end level with the one that stays", () => {
    expect(align([a, b], [link], { b: { x: 240, y: -8 } })).toEqual({ x: 0, y: -2 });
    expect(align([a, b], [link], { b: { x: 240, y: -16 } })).toEqual({ x: 0, y: 6 });
  });

  it("gives none past the reach — the grid stands", () => {
    expect(align([a, b], [link], { b: { x: 240, y: 0 } })).toEqual({ x: 0, y: 0 });
    expect(align([a, b], [link], { b: { x: 240, y: -17 } })).toEqual({ x: 0, y: 0 });
  });

  it("works from either end — the source moving takes the opposite move", () => {
    // b's middle stays at 122; a's comes to 120
    expect(align([a, b], [link], { a: { x: 0, y: 48 } })).toEqual({ x: 0, y: 2 });
  });

  it("lines up a bottom-to-top line in x", () => {
    const top = makeNode({ id: "t", x: 0, y: 0, width: 144, height: 80 });
    const under = makeNode({ id: "u", x: 0, y: 160, width: 164, height: 80 });
    const down = makeEdge({
      id: "d",
      source: "t",
      target: "u",
      sourceHandle: "bottom",
      targetHandle: "top",
    });
    expect(align([top, under], [down], { u: { x: -8, y: 160 } })).toEqual({ x: -2, y: 0 });
  });

  it("lines up a top-to-bottom line, running up, in x", () => {
    const low = makeNode({ id: "l", x: 0, y: 160, width: 144, height: 80 });
    const high = makeNode({ id: "h", x: 0, y: 0, width: 164, height: 80 });
    const up = makeEdge({
      id: "u",
      source: "l",
      target: "h",
      sourceHandle: "top",
      targetHandle: "bottom",
    });
    expect(align([low, high], [up], { h: { x: -8, y: 0 } })).toEqual({ x: -2, y: 0 });
  });

  it("keeps each end's own spot on its side", () => {
    // b's end 30% down its left side: level with a's middle (72) at b.y = 72 - 49.2
    const placed = { ...link, targetHandle: "left-30" };
    // to a hundredth of a px, so the saved position reads 22.8
    expect(align([a, b], [placed], { b: { x: 240, y: 24 } }).y).toBe(-1.2);
  });

  it("leaves lines between two shapes that move together alone", () => {
    expect(align([a, b], [link], { a: { x: 0, y: 8 }, b: { x: 240, y: -8 } })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("takes the nearest of several lines on one axis", () => {
    const c = makeNode({ id: "c", x: 480, y: 6, width: 160, height: 144 });
    const toC = makeEdge({
      id: "f",
      source: "b",
      target: "c",
      sourceHandle: "right",
      targetHandle: "left",
    });
    // a's end at 72, c's at 78: b's middle (82 below its top) at -8 + 82 = 74
    expect(align([a, b, c], [link, toC], { b: { x: 240, y: -8 } }).y).toBe(-2);
    expect(align([a, b, c], [link, toC], { b: { x: 240, y: 0 } }).y).toBe(-4);
  });

  it("reads only orthogonal lines with no bends of their own", () => {
    for (const data of [
      { pathStyle: "straight" as const },
      { pathStyle: "curved" as const },
      { waypoints: [{ x: 200, y: 72 }] },
    ]) {
      expect(align([a, b], [withData(link, data)], { b: { x: 240, y: -8 } })).toEqual({
        x: 0,
        y: 0,
      });
    }
    expect(
      align([a, b], [withData(link, { pathStyle: "orthogonal", waypoints: [] })], {
        b: { x: 240, y: -8 },
      }),
    ).toEqual({ x: 0, y: -2 });
  });

  it("reads only ends on facing sides that look at each other", () => {
    const sameSide = { ...link, targetHandle: "right" };
    expect(align([a, b], [sameSide], { b: { x: 240, y: -8 } })).toEqual({ x: 0, y: 0 });
    const behind = { ...link, sourceHandle: "left", targetHandle: "right" };
    expect(align([a, b], [behind], { b: { x: 240, y: -8 } })).toEqual({ x: 0, y: 0 });
    const centre = { ...link, targetHandle: "body" };
    expect(align([a, b], [centre], { b: { x: 240, y: -8 } })).toEqual({ x: 0, y: 0 });
  });

  it("leaves free arrow ends, lifelines, backdrops and self-loops alone", () => {
    const anchor = makeNode({ id: "b", shape: "anchor", x: 240, y: 40 });
    expect(align([a, anchor], [link], { b: { x: 240, y: 70 } })).toEqual({ x: 0, y: 0 });
    const lifeline = makeNode({ id: "b", shape: "lifeline", x: 240, y: 40, height: 164 });
    expect(align([a, lifeline], [link], { b: { x: 240, y: -8 } })).toEqual({ x: 0, y: 0 });
    const frame = makeNode({ id: "b", shape: "frame", x: 240, y: 40, width: 160, height: 164 });
    expect(align([a, frame], [link], { b: { x: 240, y: -8 } })).toEqual({ x: 0, y: 0 });
    const loop = { ...link, target: "a", targetHandle: "left" };
    expect(align([a], [loop], { a: { x: 0, y: 2 } })).toEqual({ x: 0, y: 0 });
  });
});
