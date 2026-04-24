import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProvider } from "../../context/AppContext";
import { SendProvider } from "../../context/SendContext";
import { GitStatusPane } from "./GitStatusPane";

function renderGitStatusPane() {
  render(
    <AppProvider>
      <SendProvider value={vi.fn()}>
        <GitStatusPane
          pane={{ id: "pane-1", kind: "GitStatus", resource_id: null }}
          workspaceId="workspace-1"
          focused={true}
        />
      </SendProvider>
    </AppProvider>,
  );
}

describe("GitStatusPane", () => {
  it("auto-focuses the commit message input", () => {
    renderGitStatusPane();

    expect(screen.getByRole("textbox", { name: /commit message/i })).toBe(document.activeElement);
  });
});
