import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDiscoveryDependencies } from "../shared";
import {
  inferGitCanonicalProjectPath,
  isWorktreePath,
  matchClaudeManagedWorktree,
  matchCodexManagedWorktree,
} from "./worktreeHelpers";

describe("worktreeHelpers", () => {
  it("matches Claude-managed worktree paths", () => {
    expect(matchClaudeManagedWorktree("/Users/test/repo/.claude/worktrees/funny-haibt")).toEqual({
      canonicalProjectPath: "/Users/test/repo",
      worktreeLabel: "funny-haibt",
    });
    expect(matchClaudeManagedWorktree("/Users/test/repo")).toBeNull();
  });

  it("matches Codex-managed worktree paths", () => {
    expect(matchCodexManagedWorktree("/Users/test/.codex/worktrees/c5dd/test123")).toEqual({
      slot: "c5dd",
      repoName: "test123",
    });
    expect(matchCodexManagedWorktree("/Users/test/src/test123")).toBeNull();
  });

  it("detects supported worktree paths", () => {
    expect(isWorktreePath("/Users/test/repo/.claude/worktrees/funny-haibt")).toBe(true);
    expect(isWorktreePath("/Users/test/.codex/worktrees/c5dd/test123")).toBe(true);
    expect(isWorktreePath("/Users/test/src/test123")).toBe(false);
    expect(isWorktreePath(null)).toBe(false);
  });

  it("infers a canonical root from live git worktree metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-worktree-helper-"));
    const repoRoot = join(dir, "repo");
    const commonGitDir = join(repoRoot, ".git");
    const worktreePath = join(dir, ".codex", "worktrees", "c5dd", "repo");
    const worktreeGitDir = join(dir, ".git", "worktrees", "c5dd");

    mkdirSync(commonGitDir, { recursive: true });
    mkdirSync(worktreePath, { recursive: true });
    mkdirSync(worktreeGitDir, { recursive: true });
    writeFileSync(join(worktreePath, ".git"), `gitdir: ${worktreeGitDir}\n`);
    writeFileSync(join(worktreeGitDir, "commondir"), "../../../repo/.git\n");

    expect(inferGitCanonicalProjectPath(worktreePath, resolveDiscoveryDependencies())).toEqual({
      canonicalProjectPath: repoRoot,
      worktreeSource: "git_live",
    });

    rmSync(dir, { recursive: true, force: true });
  });
});
