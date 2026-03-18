import { PROVIDER_METADATA } from "../../contracts/providerMetadata";
import { discoverClaudeFiles, discoverSingleClaudeFile } from "../../discovery/providers/claude";
import { asArray, asRecord, readString } from "../../parsing/helpers";
import { PROVIDER_EVENT_PARSERS, PROVIDER_PAYLOAD_PARSERS } from "../../parsing/providerParsers";

import type { ProviderAdapter } from "../types";
import { defaultTimestampNormalization, readJsonlStreamSource } from "./shared";

function extractClaudeSourceMetadata(payload: unknown[]) {
  const models = new Set<string>();
  let gitBranch: string | null = null;
  let cwd: string | null = null;

  for (const entry of asArray(payload)) {
    const record = asRecord(entry);
    const message = asRecord(record?.message);
    const model = readString(message?.model);
    if (model) {
      models.add(model);
    }

    gitBranch ??= readString(record?.gitBranch);
    cwd ??= readString(record?.cwd);
  }

  return {
    models: [...models].sort(),
    gitBranch,
    cwd,
  };
}

export const claudeAdapter: ProviderAdapter = {
  ...PROVIDER_METADATA.claude,
  supportsIncrementalCheckpoints: true,
  discoverAll: discoverClaudeFiles,
  discoverOne: discoverSingleClaudeFile,
  readSource: readJsonlStreamSource,
  parsePayload: PROVIDER_PAYLOAD_PARSERS.claude,
  parseEvent: PROVIDER_EVENT_PARSERS.claude,
  extractSourceMetadata: (payload) => extractClaudeSourceMetadata(payload as unknown[]),
  updateSourceMetadataFromEvent: (event, accumulator) => {
    const record = asRecord(event);
    if (!record) {
      return;
    }

    const message = asRecord(record.message);
    const model = readString(message?.model);
    if (model) {
      accumulator.models.add(model);
    }
    accumulator.gitBranch ??= readString(record.gitBranch);
    accumulator.cwd ??= readString(record.cwd);
  },
  normalizeMessageTimestamp: defaultTimestampNormalization,
};
