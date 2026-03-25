import { describe, expect, it } from "vitest";

import { compactMetadata, stringifyCompactMetadata } from "./metadata";

describe("metadata helpers", () => {
  it("omits empty values and keeps useful ones", () => {
    expect(
      compactMetadata({
        emptyString: "",
        emptyArray: [],
        nil: null,
        provider: "Codex Desktop",
        count: 1,
      }),
    ).toEqual({
      provider: "Codex Desktop",
      count: 1,
    });
  });

  it("soft-fails when optional metadata inspection throws", () => {
    const value = {
      get broken() {
        throw new Error("boom");
      },
    };

    expect(compactMetadata(value)).toBeNull();
    expect(stringifyCompactMetadata(value)).toBeNull();
  });
});
