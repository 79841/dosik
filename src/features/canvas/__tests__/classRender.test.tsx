import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { classNodeHeight } from "../../../shared/lib/classShape";
import { ClassSvg } from "../ClassSvg";

const draw = (props: Partial<Parameters<typeof ClassSvg>[0]> = {}) => {
  const data = {
    stereotype: props.stereotype,
    attributes: props.attributes,
    methods: props.methods,
  };
  const { container } = render(
    <svg aria-label="canvas">
      <ClassSvg
        width={200}
        height={classNodeHeight(data)}
        fill="#EEE9F8"
        body="#FFFFFF"
        border="#E2DFDA"
        text="#1A1918"
        ink="#1A1918"
        muted="#6F6C67"
        name="Order"
        {...props}
      />
    </svg>,
  );
  return container;
};

const texts = (c: Element) => Array.from(c.querySelectorAll("text")).map((t) => t.textContent);

describe("ClassSvg — Studio object card (#210 D13)", () => {
  it("has a tinted header band, white body, 1px border and a left-aligned name", () => {
    const c = draw({ attributes: ["+ a: int"], methods: ["+ run(): void"] });
    expect(c.querySelector('rect[fill="#FFFFFF"]')).not.toBeNull();
    expect(c.querySelector('path[fill="#EEE9F8"]')).not.toBeNull();
    const edge = c.querySelector('rect[stroke="#E2DFDA"]');
    expect(edge?.getAttribute("stroke-width")).toBe("1");
    expect(edge?.getAttribute("fill")).toBe("none");
    for (const line of c.querySelectorAll("line"))
      expect(line.getAttribute("stroke")).toBe("#E2DFDA");
    const name = [...c.querySelectorAll("text")].find((t) => t.textContent === "Order");
    expect(name?.getAttribute("text-anchor")).toBe("start");
    expect(name?.getAttribute("font-weight")).toBe("600");
  });
});

describe("ClassSvg", () => {
  it("draws no divider when there are no members", () => {
    const c = draw();
    expect(c.querySelectorAll("line")).toHaveLength(0);
    expect(texts(c)).toEqual(["Order"]);
  });

  it("draws one divider with only attributes", () => {
    expect(draw({ attributes: ["+ a: int"] }).querySelectorAll("line")).toHaveLength(1);
  });

  it("draws two dividers with attributes and methods", () => {
    const c = draw({ attributes: ["+ a: int"], methods: ["+ run(): void"] });
    expect(c.querySelectorAll("line")).toHaveLength(2);
  });

  it("keeps dividers inside the box height", () => {
    const data = { stereotype: "interface", attributes: ["+ a"], methods: ["+ m()"] };
    const c = draw(data);
    const h = classNodeHeight(data);
    for (const line of c.querySelectorAll("line")) {
      const y = Number(line.getAttribute("y1"));
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(h);
    }
  });

  it("wraps the stereotype in «»", () => {
    expect(texts(draw({ stereotype: "interface" }))).toContain("«interface»");
  });

  it("italicizes the name when abstract", () => {
    const c = draw({ isAbstract: true });
    const name = Array.from(c.querySelectorAll("text")).find((t) => t.textContent === "Order");
    expect(name?.getAttribute("font-style")).toBe("italic");
  });

  it("does not italicize when not abstract", () => {
    const c = draw();
    const name = Array.from(c.querySelectorAll("text")).find((t) => t.textContent === "Order");
    expect(name?.getAttribute("font-style")).toBeNull();
  });

  it("colors only the visibility symbol differently and leaves the rest verbatim", () => {
    const c = draw({ attributes: ["+ name: string"] });
    const spans = Array.from(c.querySelectorAll("tspan"));

    expect(spans[0]?.textContent).toBe("+");
    expect(spans[0]?.getAttribute("fill")).toBe("#6F6C67");
    expect(spans[1]?.textContent).toBe(" name: string");
  });

  it("does not split lines without a symbol", () => {
    const c = draw({ attributes: ["count: int"] });
    expect(c.querySelectorAll("tspan")).toHaveLength(0);
    expect(texts(c)).toContain("count: int");
  });

  it("draws every member on its own line", () => {
    const c = draw({ attributes: ["+ a", "- b"], methods: ["+ m()", "+ n()", "# o()"] });
    const body = texts(c).filter((t) => t !== "Order");
    expect(body).toHaveLength(5);
  });

  it("keeps attribute rows and method rows from overlapping", () => {
    const c = draw({ attributes: ["+ a", "- b"], methods: ["+ m()"] });
    const ys = Array.from(c.querySelectorAll("text"))
      .map((t) => Number(t.getAttribute("y")))
      .filter((y) => Number.isFinite(y));

    expect(new Set(ys).size).toBe(ys.length);
  });
});
