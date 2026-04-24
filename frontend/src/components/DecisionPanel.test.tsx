import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DecisionPanel } from "./DecisionPanel";

describe("DecisionPanel", () => {
  it("auto-focuses the primary response textarea", () => {
    render(
      <DecisionPanel
        runId="run-1"
        question="Approve this command?"
        context={[]}
        onRespond={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: /response/i })).toBe(document.activeElement);
  });
});
