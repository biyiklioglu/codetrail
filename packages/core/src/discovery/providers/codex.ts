import { basename, extname } from "node:path";

import {
  type ResolvedDiscoveryDependencies,
  getDiscoveryPath,
  isUnderRoot,
  projectNameFromPath,
  providerSessionIdentity,
  safeStat,
  walkFiles,
} from "../shared";
import type { DiscoveredSessionFile, ResolvedDiscoveryConfig } from "../types";
import { readCodexJsonlMeta } from "./codexHelpers";

function toDiscoveredCodexFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  const codexRoot = getDiscoveryPath(config, "codex", "codexRoot");
  if (!codexRoot || extname(filePath) !== ".jsonl" || !isUnderRoot(filePath, codexRoot)) {
    return null;
  }

  const fileStat = safeStat(filePath, dependencies);
  if (!fileStat) {
    return null;
  }

  const meta = readCodexJsonlMeta(filePath, dependencies);
  const sourceSessionId = meta.sessionId ?? basename(filePath, ".jsonl");
  const sessionIdentity = providerSessionIdentity("codex", sourceSessionId, filePath);
  const projectPath = meta.cwd ?? "";

  return {
    provider: "codex",
    projectPath,
    projectName: projectNameFromPath(projectPath),
    sessionIdentity,
    sourceSessionId,
    filePath,
    fileSize: fileStat.size,
    fileMtimeMs: Math.trunc(fileStat.mtimeMs),
    metadata: {
      includeInHistory: true,
      isSubagent: false,
      unresolvedProject: false,
      gitBranch: meta.gitBranch,
      cwd: meta.cwd,
    },
  };
}

export function discoverCodexFiles(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  const codexRoot = getDiscoveryPath(config, "codex", "codexRoot");
  if (!codexRoot || !dependencies.fs.existsSync(codexRoot)) {
    return [];
  }
  return walkFiles(codexRoot, dependencies)
    .map((filePath) => toDiscoveredCodexFile(filePath, config, dependencies))
    .filter((file): file is DiscoveredSessionFile => file !== null);
}

export function discoverSingleCodexFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  return toDiscoveredCodexFile(filePath, config, dependencies);
}
