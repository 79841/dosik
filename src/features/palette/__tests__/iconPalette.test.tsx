import { ReactFlowProvider } from "@xyflow/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ICON_IDS } from "../../../shared/lib/iconIds";
import { useDiagramStore } from "../../../shared/lib/store";
import { ShapePalette } from "../ShapePalette";

describe("icon palette (#9)", () => {
  beforeEach(() => {
    useDiagramStore.getState().loadDoc({ version: 1, title: "T", nodes: [], edges: [] }, null);
  });

  it("the Icons group opens a 20-glyph grid, and clicking one creates that icon node", async () => {
    const user = userEvent.setup();
    render(
      <ReactFlowProvider>
        <ShapePalette />
      </ReactFlowProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Architecture icons" }));
    const menu = screen.getByRole("menu", { name: "Architecture icons" });
    expect(menu.querySelectorAll("button")).toHaveLength(ICON_IDS.length);
    await user.click(screen.getByRole("menuitem", { name: "Database" }));
    const node = useDiagramStore.getState().nodes[0]!;
    expect(node.data).toMatchObject({ shape: "icon", icon: "database" });
    expect([node.width, node.height]).toEqual([96, 96]);
  });
});
