import { basename, dirname, join, normalize, resolve } from "node:path";

import type { ResolvedDiscoveryDependencies } from "../shared";
import type { WorktreeSource } from "../types";

const CLAUDE_MANAGED_WORKTREE_PATTERN = /[\\/]\.claude[\\/]worktrees[\\/](?<name>[^\\/]+)$/;
const CODEX_MANAGED_WORKTREE_PATTERN =
  /[\\/]\.codex[\\/]worktrees[\\/](?<slot>[^\\/]+)[\\/](?<name>[^\\/]+)$/;

export function matchClaudeManagedWorktree(
  value: string | null,
): { canonicalProjectPath: string; worktreeLabel: string } | null {
  if (!value) {
    return null;
  }
  const normalizedValue = normalize(value);
  const match = normalizedValue.match(CLAUDE_MANAGED_WORKTREE_PATTERN);
  const worktreeLabel = match?.groups?.name;
  if (!worktreeLabel) {
    return null;
  }

  return {
    canonicalProjectPath: normalizedValue.slice(0, match.index),
    worktreeLabel,
  };
}

export function matchCodexManagedWorktree(
  value: string | null,
): { slot: string; repoName: string } | null {
  if (!value) {
    return null;
  }
  const normalizedValue = normalize(value);
  const match = normalizedValue.match(CODEX_MANAGED_WORKTREE_PATTERN);
  const slot = match?.groups?.slot;
  const repoName = match?.groups?.name;
  if (!slot || !repoName) {
    return null;
  }
  return { slot, repoName };
}

export function isWorktreePath(value: string | null): boolean {
  return matchClaudeManagedWorktree(value) !== null || matchCodexManagedWorktree(value) !== null;
}

export function inferGitCanonicalProjectPath(
  cwd: string | null,
  dependencies: ResolvedDiscoveryDependencies,
): { canonicalProjectPath: string; worktreeSource: Extract<WorktreeSource, "git_live"> } | null {
  if (!cwd || !dependencies.fs.existsSync(cwd)) {
    return null;
  }

  const gitPath = join(cwd, ".git");
  if (!dependencies.fs.existsSync(gitPath)) {
    return null;
  }

  let commonDirPath: string | null = null;
  try {
    const gitStat = dependencies.fs.statSync(gitPath);
    if (gitStat.isDirectory()) {
      commonDirPath = gitPath;
    } else {
      const gitFile = dependencies.fs.readFileSync(gitPath, "utf8");
      const gitDirMatch = gitFile.match(/^gitdir:\s*(.+)\s*$/m);
      if (!gitDirMatch?.[1]) {
        return null;
      }

      const gitDir = resolve(cwd, gitDirMatch[1].trim());
      const commonDirFile = join(gitDir, "commondir");
      if (dependencies.fs.existsSync(commonDirFile)) {
        const commondir = dependencies.fs.readFileSync(commonDirFile, "utf8").trim();
        if (!commondir) {
          return null;
        }
        commonDirPath = resolve(gitDir, commondir);
      } else {
        commonDirPath = gitDir;
      }
    }
  } catch {
    return null;
  }

  if (!commonDirPath) {
    return null;
  }

  const normalizedCommonDir = normalize(commonDirPath);
  if (basename(normalizedCommonDir) !== ".git") {
    return null;
  }

  return {
    canonicalProjectPath: dirname(normalizedCommonDir),
    worktreeSource: "git_live",
  };
}
