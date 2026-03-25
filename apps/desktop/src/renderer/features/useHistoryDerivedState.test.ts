// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { formatSelectedSummaryMessageCount } from "./useHistoryDerivedState";

describe("formatSelectedSummaryMessageCount", () => {
  it("uses locale-aware separators for large message counts", () => {
    const formatter = new Intl.NumberFormat();
    expect(formatSelectedSummaryMessageCount(10_393, 49_821, "messages")).toBe(
      `${formatter.format(10_393)} of ${formatter.format(49_821)} messages`,
    );
  });
});
