import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("desktop renderer build", () => {
  it("keeps native-node modules out of the renderer bundle", () => {
    const workspaceRoot = process.cwd();
    const desktopDir = join(workspaceRoot, "apps", "desktop");

    execFileSync("bun", ["run", "--cwd", "apps/desktop", "build"], {
      cwd: workspaceRoot,
      stdio: "pipe",
    });

    const rendererBundlePath = join(desktopDir, "dist", "renderer", "main.js");
    const rendererMapPath = join(desktopDir, "dist", "renderer", "main.js.map");
    expect(existsSync(rendererBundlePath)).toBe(true);
    expect(existsSync(rendererMapPath)).toBe(true);

    const bundle = readFileSync(rendererBundlePath, "utf8");
    const sourceMap = readFileSync(rendererMapPath, "utf8");

    expect(bundle).not.toContain("better-sqlite3");
    expect(bundle).not.toContain('The "original" argument must be of type Function');
    expect(bundle).not.toContain("cppdb");
    expect(sourceMap).not.toContain("packages/core/src/index.ts");
    expect(sourceMap).not.toContain("packages/core/src/db/bootstrap.ts");
    expect(sourceMap).not.toContain("packages/core/src/discovery/shared.ts");
  });
});
