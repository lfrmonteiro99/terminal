import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProvider } from "../../context/AppContext";
import { SendProvider } from "../../context/SendContext";
import { GitHistoryPane } from "./GitHistoryPane";

function renderGitHistoryPane() {
  render(
    <AppProvider>
      <SendProvider value={vi.fn()}>
        <GitHistoryPane
          pane={{ id: "pane-1", kind: "GitHistory", resource_id: null }}
          workspaceId="workspace-1"
          focused={true}
        />
      </SendProvider>
    </AppProvider>,
  );
}

describe("GitHistoryPane", () => {
  it("labels the icon-only refresh button", () => {
    renderGitHistoryPane();

    expect(screen.getByRole("button", { name: /refresh commit history/i })).toBeDefined();
  });
});
