import { PROVIDER_METADATA } from "../../contracts/providerMetadata";
import { discoverGeminiFiles, discoverSingleGeminiFile } from "../../discovery/providers/gemini";
import { asArray, asRecord, readString } from "../../parsing/helpers";
import { PROVIDER_EVENT_PARSERS, PROVIDER_PAYLOAD_PARSERS } from "../../parsing/providerParsers";

import type { ProviderAdapter } from "../types";
import {
  defaultTimestampNormalization,
  emptySourceMetadata,
  readMaterializedJsonSource,
  sortModels,
} from "./shared";

export const geminiAdapter: ProviderAdapter = {
  ...PROVIDER_METADATA.gemini,
  sourceFormat: "materialized_json",
  supportsIncrementalCheckpoints: false,
  discoverAll: discoverGeminiFiles,
  discoverOne: discoverSingleGeminiFile,
  readSource: readMaterializedJsonSource,
  parsePayload: PROVIDER_PAYLOAD_PARSERS.gemini,
  parseEvent: PROVIDER_EVENT_PARSERS.gemini,
  extractSourceMetadata: (payload) => {
    const root = asRecord(payload);
    const models = new Set<string>();
    for (const message of asArray(root?.messages)) {
      const record = asRecord(message);
      if (!record) {
        continue;
      }
      const model = readString(record.model);
      if (model) {
        models.add(model);
      }
    }

    return {
      ...emptySourceMetadata(),
      models: sortModels(models),
    };
  },
  normalizeMessageTimestamp: defaultTimestampNormalization,
};
