import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (/\.(ts|tsx|d\.ts)$/.test(path)) {
        files.push(path);
      }
    }
  }

  return files;
}

describe("renderer/browser core imports", () => {
  it("uses the browser-safe core entrypoint from renderer and shared code", () => {
    const workspaceRoot = process.cwd();
    const roots = [
      join(workspaceRoot, "apps", "desktop", "src", "renderer"),
      join(workspaceRoot, "apps", "desktop", "src", "shared"),
    ];

    const offenders: string[] = [];
    for (const root of roots) {
      for (const filePath of listSourceFiles(root)) {
        const content = readFileSync(filePath, "utf8");
        if (
          /^import\s.+from\s+"@codetrail\/core"$/m.test(content) ||
          /^import\s.+from\s+'@codetrail\/core'$/m.test(content)
        ) {
          offenders.push(filePath);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
