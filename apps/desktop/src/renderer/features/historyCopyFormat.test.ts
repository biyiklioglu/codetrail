import { describe, expect, it } from "vitest";

import { formatProjectDetails, formatSessionDetails } from "./historyCopyFormat";

describe("historyCopyFormat", () => {
  it("includes project metadata when available", () => {
    expect(
      formatProjectDetails({
        id: "project_1",
        provider: "codex",
        name: "codetrail",
        path: "/workspace/codetrail",
        providerProjectKey: "workspace-key",
        repositoryUrl: "https://example.com/codetrail.git",
        resolutionState: "resolved",
        resolutionSource: "git_live",
        sessionCount: 3,
        messageCount: 42,
        bookmarkCount: 0,
        lastActivity: "2026-03-24T10:00:00.000Z",
      }),
    ).toContain("Provider Project Key: workspace-key");
  });

  it("includes session metadata when available", () => {
    const output = formatSessionDetails({
      id: "session_1",
      projectId: "project_1",
      provider: "codex",
      filePath: "/workspace/codetrail/session.jsonl",
      title: "Investigate metadata persistence",
      modelNames: "gpt-5.4",
      startedAt: "2026-03-24T10:00:00.000Z",
      endedAt: "2026-03-24T10:05:00.000Z",
      durationMs: 300000,
      gitBranch: "main",
      cwd: "/Users/test/.codex/worktrees/c5dd/codetrail",
      sessionIdentity: "codex:abc:/workspace/codetrail/session.jsonl",
      providerSessionId: "abc",
      sessionKind: "forked",
      canonicalProjectPath: "/Users/test/src/codetrail",
      repositoryUrl: "https://example.com/codetrail.git",
      gitCommitHash: "deadbeef",
      lineageParentId: "parent-123",
      providerClient: "Codex Desktop",
      providerSource: "vscode",
      providerClientVersion: "0.116.0-alpha.10",
      resolutionSource: "codex_fork",
      worktreeLabel: "c5dd",
      worktreeSource: "codex_fork",
      messageCount: 12,
      bookmarkCount: 0,
      tokenInputTotal: 100,
      tokenOutputTotal: 200,
    });

    expect(output).toContain("Project Path: /Users/test/src/codetrail");
    expect(output).toContain("Workspace Path: /Users/test/.codex/worktrees/c5dd/codetrail");
    expect(output).toContain("Provider Session ID: abc");
    expect(output).toContain("Worktree Source: codex_fork");
    expect(output).toContain("Git Commit: deadbeef");
  });
});
