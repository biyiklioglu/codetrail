import type { ProviderMetadata } from "../contracts/providerMetadata";
import type { ResolvedDiscoveryDependencies } from "../discovery/shared";
import type { DiscoveredSessionFile, ResolvedDiscoveryConfig } from "../discovery/types";
import type {
  ParseProviderEventArgs,
  ParseProviderEventResult,
  ParseProviderPayloadArgs,
  ParsedProviderMessage,
} from "../parsing/providerParsers";

export type ReadFileText = (filePath: string) => string;

export type ProviderSource = unknown[] | Record<string, unknown>;

export type ProviderReadSourceResult = {
  payload: ProviderSource;
};

export type ProviderSourceMetadata = {
  models: string[];
  gitBranch: string | null;
  cwd: string | null;
};

export type ProviderSourceMetadataAccumulator = {
  models: Set<string>;
  gitBranch: string | null;
  cwd: string | null;
};

export type ProviderTimestampNormalizationResult<T extends { createdAt: string }> = {
  message: T;
  previousTimestampMs: number;
};

export type ProviderAdapter = ProviderMetadata & {
  supportsIncrementalCheckpoints: boolean;
  discoverAll: (
    config: ResolvedDiscoveryConfig,
    dependencies: ResolvedDiscoveryDependencies,
  ) => DiscoveredSessionFile[];
  discoverOne: (
    filePath: string,
    config: ResolvedDiscoveryConfig,
    dependencies: ResolvedDiscoveryDependencies,
  ) => DiscoveredSessionFile | null;
  readSource: (filePath: string, readFileText: ReadFileText) => ProviderReadSourceResult | null;
  parsePayload: (args: ParseProviderPayloadArgs) => ParsedProviderMessage[];
  parseEvent: (args: ParseProviderEventArgs) => ParseProviderEventResult;
  extractSourceMetadata: (payload: ProviderSource) => ProviderSourceMetadata;
  updateSourceMetadataFromEvent: (
    event: unknown,
    accumulator: ProviderSourceMetadataAccumulator,
  ) => void;
  normalizeMessageTimestamp: <T extends { createdAt: string }>(
    message: T,
    context: { fileMtimeMs: number; previousTimestampMs: number },
  ) => ProviderTimestampNormalizationResult<T>;
};
