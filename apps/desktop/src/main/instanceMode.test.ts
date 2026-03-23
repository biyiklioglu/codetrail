import { describe, expect, it } from "vitest";

import { normalizeInstanceId, resolveInstanceId, resolveSideBySideInstance } from "./instanceMode";

describe("instanceMode", () => {
  it("prefers the explicit instance CLI flag", () => {
    expect(
      resolveInstanceId(["electron", ".", "--instance", "compare-ui"], {
        CODETRAIL_INSTANCE: "ignored",
      }),
    ).toBe("compare-ui");
    expect(
      resolveInstanceId(["electron", ".", "--instance=compare-ui"], {
        CODETRAIL_INSTANCE: "ignored",
      }),
    ).toBe("compare-ui");
  });

  it("falls back to the environment variable", () => {
    expect(resolveInstanceId(["electron", "."], { CODETRAIL_INSTANCE: "compare-ui" })).toBe(
      "compare-ui",
    );
  });

  it("normalizes instance ids for safe path usage", () => {
    expect(normalizeInstanceId("  Compare Build / Preview  ")).toBe("compare-build-preview");
    expect(normalizeInstanceId("...")).toBeNull();
  });

  it("derives isolated app paths for side-by-side instances", () => {
    expect(
      resolveSideBySideInstance(
        ["electron", ".", "--instance", "compare-ui"],
        {},
        "/Users/acme/Library/Application Support/@codetrail/desktop",
      ),
    ).toEqual({
      id: "compare-ui",
      titleSuffix: " (compare-ui)",
      userDataPath: "/Users/acme/Library/Application Support/@codetrail/desktop (compare-ui)",
      sessionDataPath:
        "/Users/acme/Library/Application Support/@codetrail/session-data (compare-ui)",
    });
  });

  it("returns null when no side-by-side instance is requested", () => {
    expect(resolveSideBySideInstance(["electron", "."], {}, "/tmp/@codetrail/desktop")).toBeNull();
  });
});
