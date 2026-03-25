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

  it("resolves relative diff header paths against the selected project root", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "-before",
      "+after",
    ].join("\n");

    const model = buildDiffViewModel(diff, undefined, ["/Users/acme/repo"]);

    expect(model.displayFilePath).toBe("src/a.ts");
    expect(model.absoluteFilePath).toBe("/Users/acme/repo/src/a.ts");
    expect(model.sourceLanguage).toBe("typescript");
  });

  it("rejects relative diff header paths that traverse above the project root", () => {
    const diff = [
      "diff --git a/../../etc/passwd b/../../etc/passwd",
      "--- a/../../etc/passwd",
      "+++ b/../../etc/passwd",
      "@@ -1,1 +1,1 @@",
      "-before",
      "+after",
    ].join("\n");

    const model = buildDiffViewModel(diff, undefined, ["/Users/acme/repo"]);

    expect(model.displayFilePath).toBe("../../etc/passwd");
    expect(model.absoluteFilePath).toBeNull();
  });

  it("does not pick an absolute path when multiple project roots match the same relative path", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "-before",
      "+after",
    ].join("\n");

    const model = buildDiffViewModel(diff, undefined, [
      "/Users/acme/repo-one",
      "/Users/acme/repo-two",
    ]);

    expect(model.displayFilePath).toBe("src/a.ts");
    expect(model.absoluteFilePath).toBeNull();
  });

  it("normalizes Windows absolute paths before trimming the selected project root", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "-before",
      "+after",
    ].join("\n");

    const model = buildDiffViewModel(diff, "C:\\Users\\acme\\repo\\src\\a.ts", [
      "C:\\Users\\acme\\repo",
    ]);

    expect(model.displayFilePath).toBe("src/a.ts");
    expect(model.absoluteFilePath).toBe("C:/Users/acme/repo/src/a.ts");
    expect(model.sourceLanguage).toBe("typescript");
  });

  it("normalizes dot segments in relative diff header paths", () => {
    const diff = [
      "diff --git a/src/./nested/../a.ts b/src/./nested/../a.ts",
      "--- a/src/./nested/../a.ts",
      "+++ b/src/./nested/../a.ts",
      "@@ -1,1 +1,1 @@",
      "-before",
      "+after",
    ].join("\n");

    const model = buildDiffViewModel(diff, undefined, ["/Users/acme/repo"]);

    expect(model.displayFilePath).toBe("src/a.ts");
    expect(model.absoluteFilePath).toBe("/Users/acme/repo/src/a.ts");
  });
});
