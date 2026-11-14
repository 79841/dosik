import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "../ErrorBoundary";

const Bomb = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) throw new Error("boom: render failed");
  return <div>content alive</div>;
};

describe("ErrorBoundary", () => {
  it("Renders the children as is when they are fine", () => {
    render(
      <ErrorBoundary>
        <div>fine</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("fine")).toBeInTheDocument();
  });

  it("Shows a fallback screen instead of the whole app when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText(/boom: render failed/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it("Try again re-renders without a reload", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();

    const Harness = () => {
      const [broken, setBroken] = useState(true);
      return (
        <div>
          <button type="button" onClick={() => setBroken(false)}>
            fix
          </button>
          <ErrorBoundary>
            <Bomb shouldThrow={broken} />
          </ErrorBoundary>
        </div>
      );
    };
    render(<Harness />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    await user.click(screen.getByText("fix"));
    await user.click(screen.getByText("Try again"));
    expect(screen.getByText("content alive")).toBeInTheDocument();
    spy.mockRestore();
  });
});
