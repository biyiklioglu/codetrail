// @vitest-environment jsdom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { createAppClient } from "./test/appTestFixtures";
import { renderWithClient } from "./test/renderWithClient";

describe("App periodic refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires incremental refresh repeatedly on each interval tick", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient();
    renderWithClient(<App />, client);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    // Count indexer:refresh calls before enabling periodic refresh
    const refreshCallsBefore = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    // Open the periodic refresh dropdown and select 3s
    await user.click(screen.getByRole("button", { name: "Periodic refresh interval" }));
    await user.click(screen.getByRole("option", { name: "3s" }));

    // Advance timer past first tick
    await vi.advanceTimersByTimeAsync(3100);
    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:refresh",
      ).length;
      expect(refreshCalls).toBeGreaterThan(refreshCallsBefore);
    });

    const refreshCallsAfterFirst = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    // Advance timer past second tick — should fire again
    await vi.advanceTimersByTimeAsync(3100);
    await waitFor(() => {
      const refreshCalls = client.invoke.mock.calls.filter(
        ([channel]) => channel === "indexer:refresh",
      ).length;
      expect(refreshCalls).toBeGreaterThan(refreshCallsAfterFirst);
    });
  });

  it("stops periodic refresh when set back to Off", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const client = createAppClient();
    renderWithClient(<App />, client);

    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });

    // Enable periodic refresh
    await user.click(screen.getByRole("button", { name: "Periodic refresh interval" }));
    await user.click(screen.getByRole("option", { name: "3s" }));

    // Let it tick once
    await vi.advanceTimersByTimeAsync(3100);

    const refreshCallsBeforeOff = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;

    // Disable periodic refresh
    await user.click(screen.getByRole("button", { name: "Periodic refresh interval" }));
    await user.click(screen.getByRole("option", { name: "Off" }));

    // Advance time — should NOT fire more refreshes
    await vi.advanceTimersByTimeAsync(10_000);

    const refreshCallsAfterOff = client.invoke.mock.calls.filter(
      ([channel]) => channel === "indexer:refresh",
    ).length;
    expect(refreshCallsAfterOff).toBe(refreshCallsBeforeOff);
  });
});
