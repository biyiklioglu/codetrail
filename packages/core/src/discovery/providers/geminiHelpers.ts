import { createHash } from "node:crypto";
import { basename, join } from "node:path";

import {
  type ResolvedDiscoveryDependencies,
  getDiscoveryPath,
  parseJsonFile,
  safeReadDir,
  safeReadUtf8File,
} from "../shared";
import type { GeminiProjectResolution, ResolvedDiscoveryConfig } from "../types";

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function buildGeminiProjectResolution(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): GeminiProjectResolution {
  const hashToPath = new Map<string, string>();

  for (const rootPath of [
    getDiscoveryPath(config, "gemini", "geminiRoot"),
    getDiscoveryPath(config, "gemini", "geminiHistoryRoot"),
  ]) {
    if (!rootPath || !dependencies.fs.existsSync(rootPath)) {
      continue;
    }

    for (const dirEntry of safeReadDir(rootPath, dependencies)) {
      if (!dirEntry.isDirectory()) {
        continue;
      }

      const projectRootFile = join(rootPath, dirEntry.name, ".project_root");
      if (!dependencies.fs.existsSync(projectRootFile)) {
        continue;
      }

      const rootPathValue = (safeReadUtf8File(projectRootFile, dependencies) ?? "").trim();
      if (!rootPathValue) {
        continue;
      }

      hashToPath.set(sha256(rootPathValue), rootPathValue);
    }
  }

  const geminiProjectsPath = getDiscoveryPath(config, "gemini", "geminiProjectsPath");
  if (geminiProjectsPath && dependencies.fs.existsSync(geminiProjectsPath)) {
    const projects = parseJsonFile<{ projects?: Record<string, string> }>(
      geminiProjectsPath,
      dependencies,
    );
    for (const pathValue of Object.keys(projects?.projects ?? {})) {
      hashToPath.set(sha256(pathValue), pathValue);
    }
  }

  return { hashToPath };
}

export function geminiContainerDir(filePath: string): string {
  const separator = filePath.includes("\\") ? "\\" : "/";
  const hasLeadingSeparator = filePath.startsWith("/") || filePath.startsWith("\\");
  const parts = filePath.split(/[\\/]+/).filter((part) => part.length > 0);
  const sessionsIndex = parts.lastIndexOf("sessions");
  if (sessionsIndex > 0) {
    return joinPathSegments(parts.slice(0, sessionsIndex), separator, hasLeadingSeparator);
  }

  const chatsIndex = parts.lastIndexOf("chats");
  if (chatsIndex > 0) {
    return joinPathSegments(parts.slice(0, chatsIndex), separator, hasLeadingSeparator);
  }

  return joinPathSegments(
    parts.slice(0, Math.max(0, parts.length - 3)),
    separator,
    hasLeadingSeparator,
  );
}

function joinPathSegments(
  parts: string[],
  separator: "/" | "\\",
  hasLeadingSeparator: boolean,
): string {
  if (parts.length === 0) {
    return hasLeadingSeparator ? separator : "";
  }

  const joined = parts.join(separator);
  if (hasLeadingSeparator && !joined.includes(":")) {
    return `${separator}${joined}`;
  }
  return joined;
}

export function geminiFallbackProjectName(filePath: string): string {
  return basename(geminiContainerDir(filePath));
}
