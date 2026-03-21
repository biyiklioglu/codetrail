import { PROVIDER_METADATA } from "../../contracts/providerMetadata";
import { discoverCodexFiles, discoverSingleCodexFile } from "../../discovery/providers/codex";
import { asArray, asRecord, readString } from "../../parsing/helpers";
import { PROVIDER_EVENT_PARSERS, PROVIDER_PAYLOAD_PARSERS } from "../../parsing/providerParsers";
import { sanitizeCodexOversizedJsonlEvent } from "../oversized/codex";

import type { ProviderAdapter } from "../types";
import {
  defaultTimestampNormalization,
  emptySourceMetadata,
  readJsonlStreamSource,
  sortModels,
} from "./shared";

export const codexAdapter: ProviderAdapter = {
  ...PROVIDER_METADATA.codex,
  supportsIncrementalCheckpoints: true,
  discoverAll: discoverCodexFiles,
  discoverOne: discoverSingleCodexFile,
  readSource: readJsonlStreamSource,
  sanitizeOversizedJsonlEvent: sanitizeCodexOversizedJsonlEvent,
  parsePayload: PROVIDER_PAYLOAD_PARSERS.codex,
  parseEvent: PROVIDER_EVENT_PARSERS.codex,
  extractSourceMetadata: (payload) => {
    const models = new Set<string>();
    let gitBranch: string | null = null;
    let cwd: string | null = null;

    for (const entry of asArray(payload)) {
      const record = asRecord(entry);
      const payloadRecord = asRecord(record?.payload);
      const payloadGit = asRecord(payloadRecord?.git);
      const model = readString(payloadRecord?.model);
      if (model) {
        models.add(model);
      }
      cwd ??= readString(payloadRecord?.cwd);
      gitBranch ??= readString(payloadGit?.branch);
    }

    return {
      ...emptySourceMetadata(),
      models: sortModels(models),
      gitBranch,
      cwd,
    };
  },
  updateSourceMetadataFromEvent: (event, accumulator) => {
    const record = asRecord(event);
    if (!record) {
      return;
    }

    const payloadRecord = asRecord(record.payload);
    const payloadGit = asRecord(payloadRecord?.git);
    const model = readString(payloadRecord?.model);
    if (model) {
      accumulator.models.add(model);
    }
    accumulator.cwd ??= readString(payloadRecord?.cwd);
    accumulator.gitBranch ??= readString(payloadGit?.branch);
  },
  normalizeMessageTimestamp: defaultTimestampNormalization,
};
