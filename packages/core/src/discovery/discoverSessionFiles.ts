import { homedir, platform } from "node:os";
import { join } from "node:path";

import type { Provider } from "../contracts/canonical";
import {
  PROVIDER_METADATA,
  type ProviderDiscoveryPathKey,
  createProviderRecord,
} from "../contracts/providerMetadata";
import { PROVIDER_ADAPTER_LIST } from "../providers";
import {
  type DiscoveryDependencies,
  type DiscoveryFileSystem,
  getDiscoveryPath,
  resolveDiscoveryDependencies,
} from "./shared";
import type { DiscoveredSessionFile, DiscoveryConfig, ResolvedDiscoveryConfig } from "./types";

export type { DiscoveryDependencies, DiscoveryFileSystem } from "./shared";

function defaultCopilotRoot(): string {
  const os = platform();
  if (os === "darwin") {
    return join(homedir(), "Library", "Application Support", "Code", "User", "workspaceStorage");
  }
  if (os === "win32") {
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "Code",
      "User",
      "workspaceStorage",
    );
  }
  return join(homedir(), ".config", "Code", "User", "workspaceStorage");
}

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  claudeRoot: join(homedir(), ".claude", "projects"),
  codexRoot: join(homedir(), ".codex", "sessions"),
  geminiRoot: join(homedir(), ".gemini", "tmp"),
  geminiHistoryRoot: join(homedir(), ".gemini", "history"),
  geminiProjectsPath: join(homedir(), ".gemini", "projects.json"),
  cursorRoot: join(homedir(), ".cursor", "projects"),
  copilotRoot: defaultCopilotRoot(),
  includeClaudeSubagents: false,
};

export function resolveDiscoveryConfig(
  config: Partial<DiscoveryConfig> = {},
): ResolvedDiscoveryConfig {
  const merged: DiscoveryConfig = {
    ...DEFAULT_DISCOVERY_CONFIG,
    ...config,
  };

  return {
    providers: createProviderRecord((provider) => ({
      paths: resolveProviderPaths(provider, merged),
      options: {
        includeSubagents: provider === "claude" ? merged.includeClaudeSubagents : false,
      },
    })),
  };
}

function resolveProviderPaths(
  provider: Provider,
  config: DiscoveryConfig,
): Partial<Record<ProviderDiscoveryPathKey, string>> {
  const paths: Partial<Record<ProviderDiscoveryPathKey, string>> = {};

  for (const { key } of PROVIDER_METADATA[provider].discoveryPaths) {
    const value = config[key];
    if (typeof value === "string" && value.length > 0) {
      paths[key] = value;
    }
  }

  return paths;
}

export type DiscoverySettingsPath = {
  provider: Provider;
  providerLabel: string;
  key: ProviderDiscoveryPathKey;
  label: string;
  value: string;
  watch: boolean;
};

// Discovery stays deliberately tolerant: missing roots, unreadable files, and provider-specific
// oddities should reduce coverage, not abort a full indexing run.
export function discoverSessionFiles(
  config: DiscoveryConfig = DEFAULT_DISCOVERY_CONFIG,
  dependencies: DiscoveryDependencies = {},
): DiscoveredSessionFile[] {
  const resolvedDependencies = resolveDiscoveryDependencies(dependencies);
  const resolvedConfig = resolveDiscoveryConfig(config);

  return PROVIDER_ADAPTER_LIST.flatMap((provider) =>
    provider.discoverAll(resolvedConfig, resolvedDependencies),
  ).sort((left, right) => {
    const byMtime = right.fileMtimeMs - left.fileMtimeMs;
    if (byMtime !== 0) {
      return byMtime;
    }

    return left.filePath.localeCompare(right.filePath);
  });
}

/**
 * Determines which provider a single file belongs to and constructs a {@link DiscoveredSessionFile}
 * using the same rules as the per-provider discover functions. Returns `null` if the file is
 * unrecognised, not statable, or is a subagent transcript.
 */
export function discoverSingleFile(
  filePath: string,
  config: DiscoveryConfig,
  dependencies: DiscoveryDependencies = {},
): DiscoveredSessionFile | null {
  if (/[\\/]subagents[\\/]/.test(filePath)) {
    return null;
  }

  const resolvedDependencies = resolveDiscoveryDependencies(dependencies);
  const resolvedConfig = resolveDiscoveryConfig(config);

  for (const provider of PROVIDER_ADAPTER_LIST) {
    const discovered = provider.discoverOne(filePath, resolvedConfig, resolvedDependencies);
    if (discovered) {
      return discovered;
    }
  }

  return null;
}

export function listDiscoverySettingsPaths(
  config: DiscoveryConfig = DEFAULT_DISCOVERY_CONFIG,
): DiscoverySettingsPath[] {
  const resolvedConfig = resolveDiscoveryConfig(config);
  return PROVIDER_ADAPTER_LIST.flatMap((provider) =>
    provider.discoveryPaths.flatMap((pathDef) => {
      const value = getDiscoveryPath(resolvedConfig, provider.id, pathDef.key);
      if (!value) {
        return [];
      }
      return [
        {
          provider: provider.id,
          providerLabel: provider.label,
          key: pathDef.key,
          label: pathDef.label,
          value,
          watch: pathDef.watch,
        },
      ];
    }),
  );
}

export function listDiscoveryWatchRoots(
  config: DiscoveryConfig = DEFAULT_DISCOVERY_CONFIG,
): string[] {
  const roots = new Set<string>();
  for (const path of listDiscoverySettingsPaths(config)) {
    if (path.watch) {
      roots.add(path.value);
    }
  }
  return [...roots];
}
