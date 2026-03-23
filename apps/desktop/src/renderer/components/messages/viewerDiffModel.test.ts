import { describe, expect, it } from "vitest";

import { buildDiffViewModel } from "./viewerDiffModel";

describe("viewerDiffModel", () => {
  it("pairs multi-line removed and added blocks in order", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      "-before A",
      "-before B",
      "+after A",
      "+after B",
    ].join("\n");

    const model = buildDiffViewModel(diff, "/Users/acme/repo/a.ts", ["/Users/acme/repo"]);

    expect(model.rows).toEqual([
      expect.objectContaining({
        kind: "paired",
        leftText: "before A",
        rightText: "after A",
      }),
      expect.objectContaining({
        kind: "paired",
        leftText: "before B",
        rightText: "after B",
      }),
    ]);
  });
});
