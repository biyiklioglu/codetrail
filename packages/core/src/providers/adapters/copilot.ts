import { PROVIDER_METADATA } from "../../contracts/providerMetadata";
import { discoverCopilotFiles, discoverSingleCopilotFile } from "../../discovery/providers/copilot";
import { asArray, asRecord, readString } from "../../parsing/helpers";
import { PROVIDER_EVENT_PARSERS, PROVIDER_PAYLOAD_PARSERS } from "../../parsing/providerParsers";

import type { ProviderAdapter } from "../types";
import {
  defaultTimestampNormalization,
  emptySourceMetadata,
  readMaterializedJsonSource,
  sortModels,
} from "./shared";

export const copilotAdapter: ProviderAdapter = {
  ...PROVIDER_METADATA.copilot,
  sourceFormat: "materialized_json",
  supportsIncrementalCheckpoints: false,
  discoverAll: discoverCopilotFiles,
  discoverOne: discoverSingleCopilotFile,
  readSource: readMaterializedJsonSource,
  parsePayload: PROVIDER_PAYLOAD_PARSERS.copilot,
  parseEvent: PROVIDER_EVENT_PARSERS.copilot,
  extractSourceMetadata: (payload) => {
    const root = asRecord(payload);
    const models = new Set<string>();
    for (const request of asArray(root?.requests)) {
      const record = asRecord(request);
      if (!record) {
        continue;
      }
      const model = readString(record.modelId);
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
