import { PROVIDER_METADATA } from "../../contracts/providerMetadata";
import { discoverCursorFiles, discoverSingleCursorFile } from "../../discovery/providers/cursor";
import { asArray, asRecord, readString } from "../../parsing/helpers";
import { PROVIDER_EVENT_PARSERS, PROVIDER_PAYLOAD_PARSERS } from "../../parsing/providerParsers";

import type { ProviderAdapter } from "../types";
import { emptySourceMetadata, monotonicTimestampNormalization, sortModels } from "./shared";

export const cursorAdapter: ProviderAdapter = {
  ...PROVIDER_METADATA.cursor,
  sourceFormat: "jsonl_stream",
  supportsIncrementalCheckpoints: true,
  discoverAll: discoverCursorFiles,
  discoverOne: discoverSingleCursorFile,
  parsePayload: PROVIDER_PAYLOAD_PARSERS.cursor,
  parseEvent: PROVIDER_EVENT_PARSERS.cursor,
  extractSourceMetadata: (payload) => {
    const models = new Set<string>();
    let gitBranch: string | null = null;
    let cwd: string | null = null;

    for (const entry of asArray(payload)) {
      const record = asRecord(entry);
      if (!record) {
        continue;
      }
      const messageRecord = asRecord(record.message);
      const metadataRecord = asRecord(record.metadata);
      const gitRecord = asRecord(record.git) ?? asRecord(metadataRecord?.git);
      const model = readString(messageRecord?.model) ?? readString(record.model);
      if (model) {
        models.add(model);
      }
      cwd ??=
        readString(record.cwd) ?? readString(messageRecord?.cwd) ?? readString(metadataRecord?.cwd);
      gitBranch ??=
        readString(gitRecord?.branch) ?? readString(record.gitBranch) ?? readString(record.branch);
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

    const messageRecord = asRecord(record.message);
    const metadataRecord = asRecord(record.metadata);
    const gitRecord = asRecord(record.git) ?? asRecord(metadataRecord?.git);
    const model = readString(messageRecord?.model) ?? readString(record.model);
    if (model) {
      accumulator.models.add(model);
    }
    accumulator.cwd ??=
      readString(record.cwd) ?? readString(messageRecord?.cwd) ?? readString(metadataRecord?.cwd);
    accumulator.gitBranch ??=
      readString(gitRecord?.branch) ?? readString(record.gitBranch) ?? readString(record.branch);
  },
  normalizeMessageTimestamp: monotonicTimestampNormalization,
};
