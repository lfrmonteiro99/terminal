import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProvider } from "../../context/AppContext";
import { SendProvider } from "../../context/SendContext";
import { SearchPane } from "./SearchPane";

function renderSearchPane() {
  render(
    <AppProvider>
      <SendProvider value={vi.fn()}>
        <SearchPane
          pane={{ id: "pane-1", kind: "Search", resource_id: null }}
          workspaceId="workspace-1"
          focused={true}
        />
      </SendProvider>
    </AppProvider>,
  );
}

describe("SearchPane", () => {
  it("auto-focuses the search input", () => {
    renderSearchPane();

    expect(screen.getByRole("textbox", { name: /search files/i })).toBe(document.activeElement);
  });
});
