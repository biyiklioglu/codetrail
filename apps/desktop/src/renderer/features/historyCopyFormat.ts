import type { ProjectSummary, SessionSummary } from "../app/types";
import { deriveSessionTitle, prettyProvider } from "../lib/viewUtils";
import { formatDuration } from "./historyControllerShared";

export function formatProjectDetails(
  project: ProjectSummary,
  overrides: {
    messageCount?: number;
  } = {},
): string {
  const messageCount = overrides.messageCount ?? project.messageCount;
  const lines = [
    `Name: ${project.name || "(untitled project)"}`,
    `Provider: ${prettyProvider(project.provider)}`,
    `Project ID: ${project.id}`,
    `Path: ${project.path || "-"}`,
    `Sessions: ${project.sessionCount}`,
    `Messages: ${messageCount}`,
    `Last Activity: ${project.lastActivity ?? "-"}`,
  ];

  pushIfValue(lines, "Provider Project Key", project.providerProjectKey);
  pushIfValue(lines, "Repository URL", project.repositoryUrl);
  pushIfValue(lines, "Resolution State", project.resolutionState);
  pushIfValue(lines, "Resolution Source", project.resolutionSource);

  return lines.join("\n");
}

export function formatSessionDetails(
  session: SessionSummary,
  options: {
    projectLabel?: string | null;
    messageCount?: number;
    page?: {
      current: number;
      total: number;
    } | null;
  } = {},
): string {
  const messageCount = options.messageCount ?? session.messageCount;
  const lines = [
    `Title: ${deriveSessionTitle(session)}`,
    `Provider: ${prettyProvider(session.provider)}`,
    `Project: ${options.projectLabel || "(unknown project)"}`,
    `Session ID: ${session.id}`,
    `Session Kind: ${session.sessionKind ?? "regular"}`,
    `File: ${session.filePath}`,
    `Project Path: ${session.canonicalProjectPath ?? "-"}`,
    `Workspace Path: ${session.cwd ?? "-"}`,
    `Branch: ${session.gitBranch ?? "-"}`,
    `Models: ${session.modelNames || "-"}`,
    `Started: ${session.startedAt ?? "-"}`,
    `Ended: ${session.endedAt ?? "-"}`,
    `Duration: ${formatDuration(session.durationMs)}`,
    `Messages: ${messageCount}`,
  ];

  pushIfValue(lines, "Session Identity", session.sessionIdentity);
  pushIfValue(lines, "Provider Session ID", session.providerSessionId);
  pushIfValue(lines, "Repository URL", session.repositoryUrl);
  pushIfValue(lines, "Git Commit", session.gitCommitHash);
  pushIfValue(lines, "Lineage Parent", session.lineageParentId);
  pushIfValue(lines, "Provider Client", session.providerClient);
  pushIfValue(lines, "Provider Source", session.providerSource);
  pushIfValue(lines, "Provider Version", session.providerClientVersion);
  pushIfValue(lines, "Resolution Source", session.resolutionSource);
  pushIfValue(lines, "Worktree Label", session.worktreeLabel);
  pushIfValue(lines, "Worktree Source", session.worktreeSource);

  if (options.page) {
    lines.push(`Page: ${options.page.current}/${options.page.total}`);
  }

  return lines.join("\n");
}

function pushIfValue(lines: string[], label: string, value: string | null | undefined): void {
  if (!value) {
    return;
  }
  lines.push(`${label}: ${value}`);
}
