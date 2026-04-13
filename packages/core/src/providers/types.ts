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

export type ProviderJsonPrimitive = string | number | boolean | null;
export type ProviderJsonValue = ProviderJsonPrimitive | ProviderJsonObject | ProviderJsonArray;
export type ProviderJsonObject = { [key: string]: ProviderJsonValue };
export type ProviderJsonArray = ProviderJsonValue[];
export type ProviderSource = ProviderJsonArray | ProviderJsonObject;

export type ProviderReadSourceResult = {
  payload: ProviderSource;
};

export type ProviderOversizedJsonlEventContext = {
  lineBytes: number;
  primaryByteLimit: number;
  rescueByteLimit: number;
};

export type ProviderOversizedJsonlSanitization = {
  replacedFieldCount: number;
  omittedBytes: number;
  mediaKinds: string[];
  transformedShape: boolean;
};

export type ProviderOversizedJsonlEventResult = {
  event: unknown;
  sanitization: ProviderOversizedJsonlSanitization | null;
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

type CommonProviderAdapter = ProviderMetadata & {
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
  discoverChanged?: (
    filePath: string,
    config: ResolvedDiscoveryConfig,
    dependencies: ResolvedDiscoveryDependencies,
  ) => DiscoveredSessionFile[];
  sanitizeOversizedJsonlEvent?: (
    event: unknown,
    context: ProviderOversizedJsonlEventContext,
  ) => ProviderOversizedJsonlEventResult;
  parsePayload: (args: ParseProviderPayloadArgs) => ParsedProviderMessage[];
  parseEvent: (args: ParseProviderEventArgs) => ParseProviderEventResult;
  extractSourceMetadata: (payload: ProviderSource) => ProviderSourceMetadata;
  updateSourceMetadataFromEvent?: (
    event: unknown,
    accumulator: ProviderSourceMetadataAccumulator,
  ) => void;
  normalizeMessageTimestamp: <T extends { createdAt: string }>(
    message: T,
    context: { fileMtimeMs: number; previousTimestampMs: number },
  ) => ProviderTimestampNormalizationResult<T>;
};

export type JsonlStreamProviderAdapter = CommonProviderAdapter & {
  sourceFormat: "jsonl_stream";
};

export type MaterializedJsonProviderAdapter = CommonProviderAdapter & {
  sourceFormat: "materialized_json";
  readSource: (
    discovered: DiscoveredSessionFile,
    readFileText: ReadFileText,
  ) => ProviderReadSourceResult | null;
};

export type ProviderAdapter = JsonlStreamProviderAdapter | MaterializedJsonProviderAdapter;
