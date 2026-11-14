import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { entityNodeHeight } from "../../../shared/lib/entityShape";
import { EntitySvg } from "../EntitySvg";

const columns = ["id uuid PK", "user_id uuid FK", "total numeric"];

const draw = () =>
  render(
    <svg aria-label="canvas">
      <EntitySvg
        width={240}
        height={entityNodeHeight(columns)}
        fill="#FBEFD9"
        body="#FFFFFF"
        border="#E2DFDA"
        text="#1A1918"
        ink="#1A1918"
        muted="#6F6C67"
        name="orders"
        columns={columns}
      />
    </svg>,
  ).container;

describe("EntitySvg — Studio object card (#210 D13)", () => {
  it("has a tinted header band, white body and 1px border", () => {
    const c = draw();
    expect(c.querySelector('rect[fill="#FFFFFF"]')).not.toBeNull();
    expect(c.querySelector('path[fill="#FBEFD9"]')).not.toBeNull();
    const edge = c.querySelector('rect[stroke="#E2DFDA"]');
    expect(edge?.getAttribute("stroke-width")).toBe("1");
  });

  it("left-aligns the name, keys in faint ink, PK in bold — no underline", () => {
    const c = draw();
    const texts = [...c.querySelectorAll("text")];
    expect(texts.find((t) => t.textContent === "orders")?.getAttribute("text-anchor")).toBe(
      "start",
    );
    expect(texts.find((t) => t.textContent === "PK")?.getAttribute("fill")).toBe("#6F6C67");
    const pk = texts.find((t) => t.textContent === "id");
    expect(pk?.getAttribute("font-weight")).toBe("600");
    expect(pk?.getAttribute("text-decoration")).toBeNull();
    expect(pk?.getAttribute("fill")).toBe("#1A1918");
  });
});
