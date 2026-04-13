import { PROVIDER_METADATA } from "../../contracts/providerMetadata";
import {
  discoverChangedOpenCodeFiles,
  discoverOpenCodeFiles,
  discoverSingleOpenCodeFile,
  readOpenCodeSource,
} from "../../discovery/providers/opencode";
import { asArray, asRecord, readString } from "../../parsing/helpers";
import { PROVIDER_EVENT_PARSERS, PROVIDER_PAYLOAD_PARSERS } from "../../parsing/providerParsers";

import type { ProviderAdapter } from "../types";
import { defaultTimestampNormalization, emptySourceMetadata, sortModels } from "./shared";

export const opencodeAdapter: ProviderAdapter = {
  ...PROVIDER_METADATA.opencode,
  sourceFormat: "materialized_json",
  supportsIncrementalCheckpoints: false,
  discoverAll: discoverOpenCodeFiles,
  discoverOne: discoverSingleOpenCodeFile,
  discoverChanged: discoverChangedOpenCodeFiles,
  readSource: readOpenCodeSource,
  parsePayload: PROVIDER_PAYLOAD_PARSERS.opencode,
  parseEvent: PROVIDER_EVENT_PARSERS.opencode,
  extractSourceMetadata: (payload) => {
    const root = asRecord(payload);
    const session = asRecord(root?.session);
    const models = new Set<string>();
    let cwd = readString(session?.directory);

    for (const entry of asArray(root?.messages)) {
      const record = asRecord(entry);
      const messageData = asRecord(record?.data);
      const path = asRecord(messageData?.path);
      const model = readString(messageData?.modelID) ?? readString(asRecord(messageData?.model)?.modelID);
      if (model) {
        models.add(model);
      }
      cwd ??= readString(path?.cwd);
    }

    return {
      ...emptySourceMetadata(),
      models: sortModels(models),
      cwd,
    };
  },
  normalizeMessageTimestamp: defaultTimestampNormalization,
};
